/**
 * Runtime facts at audit time. The digest says what the code contains; this
 * says whether it is running: the live URL, the health endpoint, and the
 * surface flags. Every probe is bounded, and a URL that could reach inside the
 * network is refused.
 *
 * ## Why this no longer reads `process.env`
 *
 * It used to answer "which of the environment variables your code references
 * are actually set?" — by looking them up in *this* process. The audit runs on
 * SparkTower's server, not on the audited project's, so the answer was about
 * SparkTower's own configuration and was shown to the person auditing their
 * project as though it were about theirs. Wrong for them, and a disclosure for
 * us: the variable names come from the *caller's* uploaded code, so anyone
 * could upload a file mentioning `STRIPE_SECRET_KEY`, `SESSION_SECRET`,
 * `GOOGLE_CLIENT_SECRET` and read back exactly which of them exist in
 * production. Names only, never values — but the caller wrote the question,
 * which is the part that makes it an oracle rather than a report.
 *
 * So the question is only answered by something that can actually see the
 * project's own environment (the editor bridge, running on the developer's
 * machine, passing `envSetOnHost`). With no such source it says it did not
 * check, rather than reporting an empty list as though nothing were set.
 */
import { isIP } from "net";
import { safeFetch } from "./safe-fetch";

export interface ProbeResult { url: string; ok: boolean; status: number | null; ms: number; error?: string }
export interface RuntimeFacts {
  at: string;
  liveUrl: ProbeResult | null;
  health: ProbeResult | null;
  surfaces: { loaded: boolean; enabled: number; off: string[] } | null;
  env: {
    /** Variable names the code refers to. Read from the source, so always answerable. */
    referenced: number;
    /**
     * Which of them are set where the code runs, and which are not — null when
     * nothing could see that environment. Null is not "none": an empty list
     * would read as "you have configured nothing", which is a different and
     * much more alarming claim than "not checked".
     */
    setThere: string[] | null;
    missingThere: string[] | null;
    /** Said in the report when the answer is null, so the gap explains itself. */
    note: string;
  };
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
  try {
    /*
     * Through the shared guard (server/safe-fetch.ts), which re-checks every
     * redirect. This used to call fetch with `redirect: "follow"` after
     * checking only the address it was given — so a live URL answering
     * "302 Location: http://169.254.169.254/" walked the probe straight into
     * the metadata service, and the report would have carried the status back.
     */
    const res = await safeFetch(url, { method, timeoutMs, allowHttp: true, maxBytes: 64 * 1024, userAgent: "SparkTower-audit-probe/1" });
    return { url, ok: res.ok, status: res.status, ms: Date.now() - t0 };
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    return { url, ok: false, status: null, ms: Date.now() - t0, error: /abort|timeout/i.test(message) ? "timed out" : message.slice(0, 120) };
  }
}


export async function probeRuntime(input: {
  liveUrl: string | null | undefined;
  envVarNames: string[];
  /** Names set where the project actually runs, from something that can see it. Never this process. */
  envSetOnHost?: string[] | null;
}): Promise<RuntimeFacts> {
  const base = safeProbeUrl(input.liveUrl);
  let liveUrl: ProbeResult | null = null, health: ProbeResult | null = null, surfaces: RuntimeFacts["surfaces"] = null;
  if (base) {
    const origin = base.origin;
    [liveUrl, health] = await Promise.all([probe(base.toString(), "HEAD"), probe(`${origin}/_health`, "GET")]);
    if (liveUrl.ok || health.ok) {
      try {
        /*
         * Through the same guard as the two probes above, and for the same
         * reason. This one was left on a bare `fetch` with the default
         * `redirect: "follow"`, five lines under the comment describing the
         * hole that fixed — so a live URL the caller controls could answer
         * `302 Location: http://169.254.169.254/…` and walk the server into
         * the network it sits in. The address that was checked is the only one
         * that gets connected to.
         */
        const res = await safeFetch(`${origin}/api/surfaces`, {
          method: "GET", timeoutMs: 8000, allowHttp: true, maxBytes: 256 * 1024,
          userAgent: "SparkTower-audit-probe/1",
        });
        if (res.ok) {
          const body = JSON.parse(res.body.toString("utf8")) as { enabled?: Record<string, boolean>; loaded?: boolean };
          const enabled = body.enabled ?? {};
          surfaces = { loaded: !!body.loaded, enabled: Object.values(enabled).filter(Boolean).length, off: Object.entries(enabled).filter(([, v]) => !v).map(([k]) => k) };
        }
      } catch { /* not a SparkTower deployment, or no surfaces endpoint; fine */ }
    }
  }
  const names = [...new Set(input.envVarNames)].filter((n) => /^[A-Z][A-Z0-9_]{2,}$/.test(n)).slice(0, 80);

  /*
   * Only a host that can see the project's own environment answers this, and
   * only about names the code actually refers to — so a bridge cannot be used
   * to enumerate a machine either.
   */
  const reported = input.envSetOnHost ? new Set(input.envSetOnHost) : null;
  const setThere = reported ? names.filter((n) => reported.has(n)) : null;

  return {
    at: new Date().toISOString(),
    liveUrl, health, surfaces,
    env: {
      referenced: names.length,
      setThere,
      missingThere: setThere ? names.filter((n) => !setThere.includes(n)) : null,
      note: setThere
        ? "Reported by the editor bridge, from the machine the project runs on. Names only, never values."
        : "Not checked: nothing here can see the environment this project runs in. Connect the editor bridge to have it answered.",
    },
  };
}

export function renderRuntime(r: RuntimeFacts | null | undefined): string | null {
  if (!r) return null;
  const p = (x: ProbeResult | null, what: string) => !x ? `${what}: no public URL to probe` : x.ok ? `${what}: answers ${x.status} in ${x.ms}ms` : `${what}: NOT answering (${x.status ?? x.error ?? "no response"})`;
  return [
    `RUNTIME (probed ${r.at.slice(0, 16).replace("T", " ")}; separates "code exists" from "it is running")`,
    `- ${p(r.liveUrl, "Live URL")}`,
    `- ${p(r.health, "Health endpoint")}`,
    r.surfaces ? `- Surface flags: ${r.surfaces.loaded ? "loaded" : "NOT loaded (serving defaults)"}, ${r.surfaces.enabled} on${r.surfaces.off.length ? `, off: ${r.surfaces.off.join(", ")}` : ""}` : "- Surface flags: not reachable",
    r.env.setThere
      ? `- Environment: ${r.env.referenced} variables referenced in code; ${r.env.setThere.length} set where it runs${r.env.missingThere?.length ? `; not set: ${r.env.missingThere.slice(0, 15).join(", ")}${r.env.missingThere.length > 15 ? " …" : ""}` : ""}. Names only, never values.`
      : `- Environment: ${r.env.referenced} variables referenced in code; whether they are set was not checked. ${r.env.note}`,
  ].join("\n");
}
