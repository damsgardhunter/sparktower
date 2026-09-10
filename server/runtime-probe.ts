/**
 * Runtime facts at audit time. The digest says what the code contains;
 * this says whether it is running: the live URL, the health endpoint, the
 * surface flags, and which referenced environment variables are set on
 * the instance that ran the audit. Names only, never values. Every probe
 * is bounded, and a URL that could reach inside the network is refused.
 */
import { isIP } from "net";

export interface ProbeResult { url: string; ok: boolean; status: number | null; ms: number; error?: string }
export interface RuntimeFacts {
  at: string;
  liveUrl: ProbeResult | null;
  health: ProbeResult | null;
  surfaces: { loaded: boolean; enabled: number; off: string[] } | null;
  env: { referenced: number; setHere: string[]; missingHere: string[]; instance: string };
}

/** Only public http(s) URLs; anything that could point at the network the server sits in is refused. */
export function safeProbeUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  // URL keeps IPv6 brackets in hostname ("[::1]"); strip them before the IP test.
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (isIP(host)) {
    if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return null;
  }
  if (u.username || u.password) return null;
  return u;
}

async function probe(url: string, method: "GET" | "HEAD", timeoutMs = 8000): Promise<ProbeResult> {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, redirect: "follow", signal: ctrl.signal, headers: { "user-agent": "SparkTower-audit-probe/1" } });
    return { url, ok: res.ok, status: res.status, ms: Date.now() - t0 };
  } catch (err) {
    return { url, ok: false, status: null, ms: Date.now() - t0, error: (err as Error)?.name === "AbortError" ? "timed out" : String((err as Error)?.message ?? err).slice(0, 120) };
  } finally { clearTimeout(timer); }
}

export async function probeRuntime(input: { liveUrl: string | null | undefined; envVarNames: string[]; instanceLabel?: string }): Promise<RuntimeFacts> {
  const base = safeProbeUrl(input.liveUrl);
  let liveUrl: ProbeResult | null = null, health: ProbeResult | null = null, surfaces: RuntimeFacts["surfaces"] = null;
  if (base) {
    const origin = base.origin;
    [liveUrl, health] = await Promise.all([probe(base.toString(), "HEAD"), probe(`${origin}/_health`, "GET")]);
    if (liveUrl.ok || health.ok) {
      try {
        const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 8000);
        const res = await fetch(`${origin}/api/surfaces`, { signal: ctrl.signal, headers: { "user-agent": "SparkTower-audit-probe/1" } });
        clearTimeout(timer);
        if (res.ok) {
          const body = await res.json() as { enabled?: Record<string, boolean>; loaded?: boolean };
          const enabled = body.enabled ?? {};
          surfaces = { loaded: !!body.loaded, enabled: Object.values(enabled).filter(Boolean).length, off: Object.entries(enabled).filter(([, v]) => !v).map(([k]) => k) };
        }
      } catch { /* not a SparkTower deployment, or no surfaces endpoint; fine */ }
    }
  }
  const names = [...new Set(input.envVarNames)].filter((n) => /^[A-Z][A-Z0-9_]{2,}$/.test(n)).slice(0, 80);
  const setHere = names.filter((n) => process.env[n] !== undefined && process.env[n] !== "");
  return {
    at: new Date().toISOString(),
    liveUrl, health, surfaces,
    env: { referenced: names.length, setHere, missingHere: names.filter((n) => !setHere.includes(n)), instance: input.instanceLabel ?? (process.env.NODE_ENV === "production" ? (process.env.REPLIT_DEPLOYMENT ? "production (Replit deployment)" : "production") : "development") },
  };
}

export function renderRuntime(r: RuntimeFacts | null | undefined): string | null {
  if (!r) return null;
  const p = (x: ProbeResult | null, what: string) => !x ? `${what}: no public URL to probe` : x.ok ? `${what}: answers ${x.status} in ${x.ms}ms` : `${what}: NOT answering (${x.status ?? x.error ?? "no response"})`;
  return [
    `RUNTIME (probed ${r.at.slice(0, 16).replace("T", " ")} from the ${r.env.instance} instance; separates "code exists" from "it is running")`,
    `- ${p(r.liveUrl, "Live URL")}`,
    `- ${p(r.health, "Health endpoint")}`,
    r.surfaces ? `- Surface flags: ${r.surfaces.loaded ? "loaded" : "NOT loaded (serving defaults)"}, ${r.surfaces.enabled} on${r.surfaces.off.length ? `, off: ${r.surfaces.off.join(", ")}` : ""}` : "- Surface flags: not reachable",
    `- Environment: ${r.env.referenced} variables referenced in code; ${r.env.setHere.length} set on this instance${r.env.missingHere.length ? `; not set here: ${r.env.missingHere.slice(0, 15).join(", ")}${r.env.missingHere.length > 15 ? " …" : ""}` : ""}. Names only; a variable unset in development may be set in production.`,
  ].join("\n");
}
