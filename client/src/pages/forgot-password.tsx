/**
 * "I can't get in" — the first half of a password reset.
 *
 * The screen deliberately tells you nothing about the address you typed. An
 * answer that differed for a known and an unknown address would turn this box
 * into a free membership check for anyone with a list of emails, so the server
 * always says 200 and this page always says the same sentence back
 * (server/auth-reset-routes.ts).
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { ApiError, errorText, waitPhrase } from "@/lib/api-error";
import { RATE_LIMITED } from "@shared/moderation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Loader2, MailCheck } from "lucide-react";
// The window is the server's, not this page's: copy that promises an hour
// while the token dies in fifteen minutes is worse than no copy.
import { resetWindowPhrase } from "@shared/password-reset";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** Seconds until the server will take another request, counted down so the button can say when. */
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const send = async () => {
    setError("");
    setBusy(true);
    try {
      await apiRequest("POST", "/api/auth/forgot-password", { email: email.trim() });
      setSent(true);
    } catch (e) {
      // A rate limit is the one case where nothing was sent, so the confirmation
      // would be a lie. Say when instead of showing a code.
      if (e instanceof ApiError && e.code === RATE_LIMITED) {
        const wait = e.retryAfterSeconds ?? 0;
        if (wait > 0) setCooldown(wait);
        setError(wait > 0
          ? `That's a few requests in a row. Try again in ${waitPhrase(wait)}.`
          : "That's a few requests in a row. Give it a minute and try again.");
      } else {
        setError(errorText(e, "Couldn't send that link. Try again in a moment."));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="w-full max-w-sm" data-testid="forgot-password-page">
        <CardHeader>
          <CardTitle className="text-lg">{sent ? "Check your inbox" : "Reset your password"}</CardTitle>
          <CardDescription>
            {sent
              ? "If there's an account for that address, a reset link is on its way."
              : "Enter the address you signed up with and we'll send you a link to set a new password."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3" data-testid="text-forgot-error">
              {error}
            </div>
          )}

          {sent ? (
            <div className="space-y-4">
              <div className="flex gap-3 text-sm text-muted-foreground">
                <MailCheck className="h-5 w-5 shrink-0 text-emerald-500" />
                <p data-testid="text-forgot-sent">
                  The link expires in {resetWindowPhrase()} and works once. Check the spam folder if it isn't
                  there — and if nothing arrives, the address may not have an account on it.
                </p>
              </div>
              <Button
                variant="outline"
                className="w-full"
                disabled={busy || cooldown > 0}
                onClick={send}
                data-testid="button-forgot-resend"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {cooldown > 0 ? `Send another in ${waitPhrase(cooldown)}` : "Send another link"}
              </Button>
            </div>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(e) => { e.preventDefault(); if (!busy && cooldown <= 0) void send(); }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="forgot-email">Email</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  autoFocus
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  data-testid="input-forgot-email"
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy || cooldown > 0} data-testid="button-submit-forgot">
                {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {cooldown > 0 ? `Try again in ${waitPhrase(cooldown)}` : "Send reset link"}
              </Button>
            </form>
          )}

          <p className="text-xs text-muted-foreground text-center">
            <Link href="/?login=1" className="inline-flex items-center gap-1 underline" data-testid="link-forgot-back-to-signin">
              <ArrowLeft className="h-3 w-3" /> Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
