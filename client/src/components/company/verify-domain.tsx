/**
 * Proving you control your company's website, before the company exists.
 *
 * ## Why this is a whole screen rather than a field
 *
 * Anyone could type a website into a box and be believed, and a company
 * nobody had checked could post a challenge that a builder spent a fortnight
 * entering. What is asked for now is a thing employees of a company can do and
 * strangers cannot: put a file on the site, or change its DNS.
 *
 * That is more work than typing, so the screen's job is to make it as small as
 * possible — the exact file contents and the exact record name, each with a
 * button that copies it, and a check that says precisely what it saw rather
 * than "failed". Most people doing this are on their second window with their
 * DNS provider open, and "no TXT record at _sparktower.acme.com yet" is the
 * difference between finishing and giving up.
 *
 * ## The two states it refuses to blur
 *
 * Not proved yet, and cannot be proved. A domain already claimed by another
 * company, or a free mail host, is a dead end and says so immediately —
 * sending somebody off to edit DNS for a domain we will never accept is the
 * worst thing this screen could do.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pill } from "@/components/nova";
import {
  AlertTriangle, Check, Copy, Globe, Loader2, RefreshCw, ShieldCheck,
} from "lucide-react";
import type { VerificationMethod } from "@shared/company-verification";

interface Verification {
  id: string;
  domain: string;
  token: string;
  verified: boolean;
  method: VerificationMethod | null;
  attemptsLeft: number;
  lastError: string | null;
  steps: Record<VerificationMethod, { title: string; steps: string[] }>;
}

/** One value with a button that copies it, because these are retyped by hand otherwise. */
function Copyable({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5">
        <code className="min-w-0 flex-1 truncate font-mono text-xs">{value}</code>
        <Button
          type="button" size="sm" variant="ghost" className="h-7 shrink-0 px-2"
          onClick={() => {
            void navigator.clipboard?.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          data-testid={`copy-${label.toLowerCase().replace(/\s+/g, "-")}`}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

export function VerifyDomain({ onVerified }: {
  /** Called with the verification to spend, and the domain it proved. */
  onVerified: (v: { id: string; domain: string }) => void;
}) {
  const [website, setWebsite] = useState("");
  const [verification, setVerification] = useState<Verification | null>(null);
  const [method, setMethod] = useState<VerificationMethod>("file");
  const [problem, setProblem] = useState<string | null>(null);
  /** A dead end — a taken domain or a free host — which no amount of checking fixes. */
  const [deadEnd, setDeadEnd] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/company-verifications", { website })).json() as Promise<{ verification: Verification }>,
    onSuccess: (res) => { setVerification(res.verification); setProblem(null); setDeadEnd(null); },
    onError: (e: any) => {
      const code = e?.body?.code;
      const message = errorText(e, "Couldn't start that.");
      // A taken domain or a free host will never work; say so instead of offering a retry.
      if (code === "domain_taken" || code === "unclaimable_domain") setDeadEnd(message);
      else setProblem(message);
    },
  });

  const check = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/company-verifications/${verification!.id}/check`, {})).json() as Promise<{ verification: Verification }>,
    onSuccess: (res) => {
      setVerification(res.verification);
      setProblem(null);
      if (res.verification.verified) onVerified({ id: res.verification.id, domain: res.verification.domain });
    },
    onError: (e: any) => {
      // A failed check is news, not an error: it says what was actually seen.
      if (e?.body?.verification) setVerification(e.body.verification);
      setProblem(errorText(e, "Couldn't check that just now."));
    },
  });

  if (verification?.verified) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3" data-testid="domain-verified">
        <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
        <p className="flex-1 text-sm">
          <span className="font-medium">{verification.domain}</span> is yours.
          <span className="text-muted-foreground"> Proved by {verification.method === "dns" ? "a DNS record" : "a file on the site"}.</span>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="verify-domain">
      <div>
        <Label htmlFor="verify-website">Your company's website</Label>
        <p className="mb-1.5 text-xs text-muted-foreground">
          You'll prove you control it. It's what stops anybody posting challenges in your company's name.
        </p>
        <div className="flex gap-2">
          <Input
            id="verify-website"
            value={verification?.domain ?? website}
            onChange={(e) => setWebsite(e.target.value)}
            disabled={!!verification}
            placeholder="acme.com"
            data-testid="input-verify-website"
          />
          {verification ? (
            <Button type="button" variant="outline" className="shrink-0" onClick={() => { setVerification(null); setProblem(null); }} data-testid="button-change-domain">
              Change
            </Button>
          ) : (
            <Button
              type="button" className="shrink-0"
              disabled={start.isPending || website.trim().length < 3}
              onClick={() => start.mutate()}
              data-testid="button-start-verification"
            >
              {start.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Globe className="mr-1.5 h-4 w-4" />}
              Continue
            </Button>
          )}
        </div>
      </div>

      {deadEnd && (
        <p className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm" data-testid="verify-dead-end">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span>{deadEnd}</span>
        </p>
      )}
      {problem && !verification && <p className="text-sm text-destructive">{problem}</p>}

      {verification && (
        <div className="space-y-3 rounded-lg border border-border p-3">
          {/* Two ways, because organisations are shaped differently: one can deploy, one can only ask IT for a DNS record. */}
          <div className="flex gap-1.5" role="tablist">
            {(["file", "dns"] as VerificationMethod[]).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={method === m}
                onClick={() => setMethod(m)}
                className={`rounded-full border px-3 py-1 text-xs transition ${method === m ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}
                data-testid={`tab-method-${m}`}
              >
                {verification.steps[m].title}
              </button>
            ))}
          </div>

          <ol className="space-y-1.5 text-sm">
            {verification.steps[method].steps.map((step, i) => (
              <li key={i} className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">{i + 1}</span>
                <span className="text-muted-foreground">{step}</span>
              </li>
            ))}
          </ol>

          {/* The exact strings, with copy buttons: these get retyped wrongly otherwise. */}
          <div className="grid gap-2 sm:grid-cols-2">
            <Copyable label={method === "dns" ? "Record name" : "File path"} value={method === "dns" ? `_sparktower.${verification.domain}` : "/.well-known/sparktower-verification.txt"} />
            <Copyable label={method === "dns" ? "Record value" : "File contents"} value={verification.token} />
          </div>

          {/* What the check actually saw. "No TXT record yet" is the difference between finishing and giving up. */}
          {verification.lastError && (
            <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs" data-testid="verify-last-error">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              <span>{verification.lastError}</span>
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button" size="sm"
              disabled={check.isPending || verification.attemptsLeft <= 0}
              onClick={() => check.mutate()}
              data-testid="button-check-verification"
            >
              {check.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
              Check it now
            </Button>
            {verification.attemptsLeft <= 3 && (
              <Pill tone={verification.attemptsLeft <= 0 ? "bad" : "warn"}>
                {verification.attemptsLeft <= 0 ? "Start again for a fresh token" : `${verification.attemptsLeft} checks left`}
              </Pill>
            )}
            <span className="text-xs text-muted-foreground">DNS can take a few minutes.</span>
          </div>
        </div>
      )}
    </div>
  );
}
