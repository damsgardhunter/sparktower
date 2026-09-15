import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldCheck } from "lucide-react";
import { postJson, type MfaStatus } from "@/components/mfa";

/**
 * Two-factor authentication: set it up (a key for the authenticator app, then
 * a code to confirm), and see or replace the recovery codes. Required for
 * reviewers, admins and the owner; open to anyone.
 */
export default function SecuritySettings() {
  const queryClient = useQueryClient();
  const { data: status, isLoading } = useQuery<MfaStatus>({ queryKey: ["/api/auth/mfa/status"] });
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try { await fn(); } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/auth/mfa/status"] });

  const start = () => run(async () => { setSetup(await postJson("/api/auth/mfa/setup")); setCode(""); });
  const enable = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const res = await postJson<{ recoveryCodes: string[] }>("/api/auth/mfa/enable", { code });
      setCodes(res.recoveryCodes);
      setSetup(null);
      await refresh();
    });
  };
  const regenerate = () => run(async () => { setCodes((await postJson<{ recoveryCodes: string[] }>("/api/auth/mfa/recovery-codes")).recoveryCodes); await refresh(); });

  if (isLoading || !status) return <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="max-w-xl mx-auto p-4 space-y-4" data-testid="page-security-settings">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="h-5 w-5 text-primary" /> Two-factor authentication
            <Badge variant={status.enabled ? "default" : "secondary"} data-testid="badge-mfa-state">{status.enabled ? "On" : "Off"}</Badge>
          </CardTitle>
          <CardDescription>
            {status.required
              ? "Your account has review or admin access, so signing in needs a code from an authenticator app as well as your password."
              : "Ask for a code from an authenticator app as well as your password when you sign in."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3" data-testid="text-mfa-settings-error">{error}</div>}

          {!status.enabled && !setup && (
            <Button onClick={start} disabled={busy} data-testid="button-mfa-start">Set up 2FA</Button>
          )}

          {setup && (
            <form onSubmit={enable} className="space-y-3">
              <ol className="list-decimal pl-5 space-y-2 text-sm">
                <li>
                  In your authenticator app (Google Authenticator, 1Password, Authy…), add an account with this key,
                  or <a href={setup.otpauthUrl} className="text-primary underline" data-testid="link-mfa-otpauth">open it in the app</a> on this device.
                  <code className="block mt-1.5 p-2 rounded bg-muted font-mono text-sm break-all select-all" data-testid="text-mfa-secret">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
                </li>
                <li>Enter the 6-digit code it shows.</li>
              </ol>
              <div className="space-y-1.5">
                <Label htmlFor="mfa-enable-code">Code</Label>
                <Input id="mfa-enable-code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" required data-testid="input-mfa-enable-code" />
              </div>
              <Button type="submit" disabled={busy || !code.trim()} data-testid="button-mfa-enable">Turn on</Button>
            </form>
          )}

          {codes && (
            <div className="space-y-2 rounded-md border p-3" data-testid="mfa-recovery-codes">
              <p className="text-sm font-medium">Recovery codes</p>
              <p className="text-sm text-muted-foreground">Save these somewhere safe. Each one signs you in once if you lose your phone. They won't be shown again.</p>
              <div className="grid grid-cols-2 gap-1 font-mono text-sm select-all">{codes.map((c) => <span key={c}>{c}</span>)}</div>
              <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(codes.join("\n"))}>Copy</Button>
            </div>
          )}

          {status.enabled && !codes && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-muted-foreground" data-testid="text-mfa-codes-left">{status.recoveryCodesLeft} recovery code{status.recoveryCodesLeft === 1 ? "" : "s"} left</span>
              <Button size="sm" variant="outline" onClick={regenerate} disabled={busy || !status.verified} data-testid="button-mfa-regenerate">New recovery codes</Button>
            </div>
          )}
          {status.enabled && (
            <p className="text-xs text-muted-foreground">Lost your phone and your recovery codes? Contact support to have 2FA reset after we confirm it's you.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
