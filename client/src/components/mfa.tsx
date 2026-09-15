import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export interface MfaStatus { required: boolean; enabled: boolean; verified: boolean; recoveryCodesLeft: number }

/** POST as JSON with the session cookie; the parsed body, or throws with the server's message. */
export async function postJson<T = any>(url: string, body: unknown = {}): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || "Something went wrong. Please try again."), { code: data.code });
  return data;
}

/**
 * The second step of signing in to an account with 2FA on: a code from the
 * authenticator app, or a recovery code. The password step already happened;
 * the server holds that for five minutes (server/mfa.ts).
 */
export function MfaCodeForm({ onVerified, onRestart }: { onVerified: () => void; onRestart?: () => void }) {
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await postJson("/api/auth/mfa/verify", { code });
      onVerified();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3" data-testid="form-mfa-code">
      <div className="flex items-center gap-2 text-sm font-medium"><ShieldCheck className="h-4 w-4 text-primary" /> Two-factor authentication</div>
      <p className="text-sm text-muted-foreground">
        {recovery ? "Enter one of the recovery codes you saved when you set up 2FA. Each works once." : "Enter the 6-digit code from your authenticator app."}
      </p>
      {error && <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3" data-testid="text-mfa-error">{error}</div>}
      <div className="space-y-1.5">
        <Label htmlFor="mfa-code">{recovery ? "Recovery code" : "Code"}</Label>
        <Input
          id="mfa-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode={recovery ? "text" : "numeric"}
          autoComplete="one-time-code"
          placeholder={recovery ? "xxxxx-xxxxx" : "123456"}
          autoFocus
          required
          data-testid="input-mfa-code"
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading || !code.trim()} data-testid="button-mfa-verify">
        {loading ? "Checking…" : "Verify"}
      </Button>
      <div className="flex justify-between text-xs">
        <button type="button" className="text-muted-foreground hover:underline" onClick={() => { setRecovery(!recovery); setCode(""); setError(""); }} data-testid="button-mfa-toggle-recovery">
          {recovery ? "Use the authenticator app" : "Use a recovery code"}
        </button>
        {onRestart && (
          <button type="button" className="text-muted-foreground hover:underline" onClick={onRestart} data-testid="button-mfa-restart">Start over</button>
        )}
      </div>
    </form>
  );
}

/**
 * For reviewers, admins and the owner whose session hasn't passed a second
 * factor: their review and admin tools refuse until it has, so say why and
 * where to fix it. Nothing for anyone else.
 */
export function MfaNotice() {
  const { user } = useAuth();
  const { data } = useQuery<MfaStatus>({ queryKey: ["/api/auth/mfa/status"], enabled: !!user, staleTime: 60_000 });
  if (!user || !data?.required || data.verified) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm bg-amber-100 text-amber-950 dark:bg-amber-950/60 dark:text-amber-100 border-b border-amber-300/60" data-testid="mfa-notice">
      <ShieldCheck className="h-4 w-4 shrink-0" />
      {data.enabled
        ? <span className="flex-1">This session signed in without your authenticator code, so review and admin tools are locked. Sign out and back in to use them.</span>
        : <span className="flex-1">Your account has review or admin access. Set up two-factor authentication to use those tools.</span>}
      {!data.enabled && <Button asChild size="sm" variant="outline" className="h-7 bg-transparent"><Link href="/settings/security" data-testid="link-mfa-setup">Set up 2FA</Link></Button>}
    </div>
  );
}
