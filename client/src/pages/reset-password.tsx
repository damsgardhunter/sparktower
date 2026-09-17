/**
 * The second half of a password reset: where the emailed link lands.
 *
 * Works signed out — the token in the link is the credential, and the person
 * arriving here is by definition someone who couldn't sign in.
 *
 * The policy itself is the server's (shared/passwords.ts, plus the breach
 * check that needs a network call). This screen states the length rule up
 * front so it isn't discovered by being refused, and otherwise repeats what
 * the server said.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ApiError, errorText, waitPhrase } from "@/lib/api-error";
import { RATE_LIMITED } from "@shared/moderation";
import { PASSWORD_MIN } from "@shared/passwords";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, TriangleAlert } from "lucide-react";
// The window is the server's, not this page's: copy that promises an hour
// while the token dies in fifteen minutes is worse than no copy.
import { resetWindowPhrase } from "@shared/password-reset";

/** The token is spent, unknown, or was never there — the only way on is a new email. */
function DeadLink({ title, detail, testId }: { title: string; detail: string; testId: string }) {
  return (
    <Card className="w-full max-w-sm" data-testid="reset-password-dead">
      <CardHeader className="space-y-2">
        <TriangleAlert className="h-7 w-7 text-amber-500" />
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription data-testid={testId}>{detail}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button asChild className="w-full" data-testid="link-request-new-reset">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
        <p className="text-xs text-muted-foreground text-center">
          <Link href="/?login=1" className="underline" data-testid="link-reset-dead-signin">Back to sign in</Link>
        </p>
      </CardContent>
    </Card>
  );
}

export default function ResetPasswordPage() {
  /*
   * Read the token once, then scrub it out of the address bar.
   *
   * A token left in the URL leaks in every direction at once: it rides along
   * in the Referer header of anything this page loads, it stays in browser
   * history and in a synced session, and it is right there in the screenshot
   * someone sends when they ask for help. Reading it into state and replacing
   * the entry costs nothing and closes all three.
   */
  const [token] = useState(() =>
    typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("token") ?? "");
  useEffect(() => {
    if (typeof window === "undefined" || !window.location.search) return;
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** Set when the server says the token itself is no good: the form can't help any more. */
  const [dead, setDead] = useState<"invalid" | "expired" | null>(null);
  const [done, setDone] = useState<{ email?: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) { setError("Those two don't match."); return; }
    // The server decides; this is the same rule said sooner (shared/passwords.ts).
    if (password.length < PASSWORD_MIN) {
      setError(`Use at least ${PASSWORD_MIN} characters — length is what makes a password hard to guess.`);
      return;
    }
    setBusy(true);
    try {
      const body = await (await apiRequest("POST", "/api/auth/reset-password", { token, password })).json();
      // Every session was just torn down, this browser's included.
      queryClient.setQueryData(["/api/auth/user"], null);
      setDone({ email: typeof body?.email === "string" ? body.email : undefined });
    } catch (err) {
      const code = err instanceof ApiError ? err.code : null;
      if (code === "expired" || code === "invalid") {
        setDead(code);
      } else if (code === RATE_LIMITED) {
        const wait = err instanceof ApiError ? err.retryAfterSeconds : null;
        setError(wait ? `Too many tries. Try again in ${waitPhrase(wait)}.` : "Too many tries. Give it a minute.");
      } else {
        // invalid_input and breached_password both explain themselves in `message`.
        setError(errorText(err, "That didn't work. Try again."));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      {!token ? (
        <DeadLink
          title="That link is missing its code"
          detail="Open the link from the reset email itself — the part after the address is what proves it's you, and copying only half of it loses it."
          testId="text-reset-no-token"
        />
      ) : dead === "expired" ? (
        <DeadLink
          title="That link has expired"
          detail={`Reset links last ${resetWindowPhrase()}, so nobody can use one they find later. A new one takes a few seconds.`}
          testId="text-reset-expired"
        />
      ) : dead === "invalid" ? (
        <DeadLink
          title="That link no longer works"
          detail="A reset link works once, and it's replaced whenever a newer one is sent. Ask for a fresh one and use the newest email."
          testId="text-reset-invalid"
        />
      ) : done ? (
        <Card className="w-full max-w-sm" data-testid="reset-password-done">
          <CardHeader className="space-y-2">
            <CheckCircle2 className="h-7 w-7 text-emerald-500" />
            <CardTitle className="text-lg">Password changed</CardTitle>
            <CardDescription data-testid="text-reset-done">
              Every phone and browser signed in to {done.email ?? "this account"} has been signed out,
              including this one. Sign in again with the new password.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full" data-testid="link-reset-signin">
              <Link href="/?login=1">Sign in</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="w-full max-w-sm" data-testid="reset-password-page">
          <CardHeader className="space-y-2">
            <KeyRound className="h-7 w-7 text-muted-foreground" />
            <CardTitle className="text-lg">Set a new password</CardTitle>
            <CardDescription>
              At least {PASSWORD_MIN} characters, and not one of the passwords that show up in public
              breach lists. A few ordinary words in a row beats a short scramble.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-3">
              {error && (
                <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3" data-testid="text-reset-error">
                  {error}
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="reset-password">New password</Label>
                <div className="relative">
                  <Input
                    id="reset-password"
                    type={showPassword ? "text" : "password"}
                    placeholder={`At least ${PASSWORD_MIN} characters`}
                    autoComplete="new-password"
                    autoFocus
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    data-testid="input-reset-password"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowPassword(!showPassword)}
                    data-testid="button-toggle-reset-password"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reset-confirm">Confirm password</Label>
                <Input
                  id="reset-confirm"
                  type={showPassword ? "text" : "password"}
                  placeholder="Type it again"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  data-testid="input-reset-confirm"
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy} data-testid="button-submit-reset">
                {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Change password
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Changing it signs out every device, so you'll sign in again afterwards.
              </p>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
