import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Download, KeyRound, Loader2, LogOut, ShieldCheck, Trash2 } from "lucide-react";
import { postJson, type MfaStatus } from "@/components/mfa";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/hooks/use-auth";

/** What the two session-ending routes report back. */
interface SessionsEnded { sessionsEnded: number; devicesSignedOut: number }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Two-factor authentication: set it up (a key for the authenticator app, then
 * a code to confirm). Required for
 * reviewers, admins and the owner; open to anyone.
 */
export default function SecuritySettings() {
  const queryClient = useQueryClient();
  const { data: status, isLoading } = useQuery<MfaStatus>({ queryKey: ["/api/auth/mfa/status"] });
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string; qrDataUrl?: string | null } | null>(null);
  const [code, setCode] = useState("");
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
      await postJson("/api/auth/mfa/enable", { code });
      setSetup(null);
      await refresh();
    });
  };

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
            <form onSubmit={enable} className="space-y-4">
              <ol className="list-decimal pl-5 space-y-3 text-sm">
                <li>
                  <span className="font-medium">Scan this with your authenticator app.</span>
                  <p className="text-muted-foreground mt-0.5">
                    Google Authenticator, Duo Mobile, Microsoft Authenticator, 1Password, Authy, Bitwarden — they all read
                    the same code. Any of them will do; you only need one.
                  </p>

                  {setup.qrDataUrl ? (
                    <div className="mt-2.5 inline-block rounded-lg bg-white p-3 shadow-sm" data-testid="img-mfa-qr-wrap">
                      {/*
                        On white in both themes on purpose: a QR inverted for dark
                        mode is one plenty of phone cameras quietly fail to read.
                      */}
                      <img src={setup.qrDataUrl} alt="QR code for setting up two-factor authentication" width={200} height={200} className="block h-[200px] w-[200px]" data-testid="img-mfa-qr" />
                    </div>
                  ) : (
                    <p className="mt-2 text-muted-foreground">Couldn't draw the QR code this time — use the key below instead; it does exactly the same thing.</p>
                  )}

                  <p className="mt-2">
                    Setting this up on the phone you're reading this on?{" "}
                    <a href={setup.otpauthUrl} className="text-primary underline" data-testid="link-mfa-otpauth">Open it in your authenticator</a> — no scanning needed.
                  </p>

                  <details className="mt-2">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground" data-testid="button-mfa-show-key">Can't scan it? Enter this key by hand</summary>
                    <code className="block mt-1.5 p-2 rounded bg-muted font-mono text-sm break-all select-all" data-testid="text-mfa-secret">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
                    <Button
                      type="button" size="sm" variant="outline" className="mt-1.5"
                      onClick={() => navigator.clipboard?.writeText(setup.secret)}
                      data-testid="button-mfa-copy-key"
                    >Copy key</Button>
                  </details>
                </li>
                <li>
                  <span className="font-medium">Enter the 6-digit code it shows.</span>
                  <p className="text-muted-foreground mt-0.5">It changes every 30 seconds. If it's rejected, wait for the next one rather than retyping the same one.</p>
                </li>
              </ol>
              <div className="space-y-1.5">
                <Label htmlFor="mfa-enable-code">Code</Label>
                <Input id="mfa-enable-code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" required data-testid="input-mfa-enable-code" />
              </div>
              <Button type="submit" disabled={busy || !code.trim()} data-testid="button-mfa-enable">Turn on</Button>
            </form>
          )}

          {status.enabled && (
            /*
             * Said plainly, because it is the whole trade. There are no recovery
             * codes to lose any more: the six digits from the app are the only
             * way in, and a lost phone is a conversation with an admin rather
             * than a string somebody screenshotted a year ago.
             */
            <p className="text-xs text-muted-foreground" data-testid="text-mfa-lost-phone">
              The 6-digit code from your app is the only way in — there are no recovery codes.
              If you lose your phone, an admin resets 2FA on your account once they've confirmed it's you.
            </p>
          )}
        </CardContent>
      </Card>
      <Password />
      <SignOutEverywhere />
      <YourData mfaEnabled={status.enabled} />
    </div>
  );
}

/**
 * Changing the password. The route takes the old one, so a borrowed tab can't
 * lock the owner out, and it ends every other session — which is the point of
 * changing it, and is said here rather than left as a surprise.
 *
 * An account that signs in with Google has no password at all. The provider is
 * on the account row, so that's asked before the form is offered; the form is
 * still reachable, because an account that had a password before Google was
 * linked still has one, and the route will say so if it doesn't.
 */
function Password() {
  const { user } = useAuth();
  const [anyway, setAnyway] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [noPassword, setNoPassword] = useState(false);
  const [done, setDone] = useState<SessionsEnded | null>(null);
  const [busy, setBusy] = useState(false);

  const google = user?.authProvider === "google";
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (next !== again) return setError("The two new passwords don't match.");
    setBusy(true);
    postJson<SessionsEnded>("/api/auth/change-password", { currentPassword: current, newPassword: next })
      .then((res) => { setDone(res); setCurrent(""); setNext(""); setAgain(""); })
      .catch((err: any) => {
        // The account turns out to have no password after all: say so instead of leaving the form up to fail again.
        if (err.code === "no_password") setNoPassword(true); else setError(err.message);
      })
      .finally(() => setBusy(false));
  };

  const explainGoogle = (
    <p className="text-sm text-muted-foreground" data-testid="text-password-google">
      You sign in to SparkTower with Google, so this account has no password of its own. Your password is your Google
      account's, and you change it with Google.
    </p>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg"><KeyRound className="h-5 w-5 text-primary" /> Password</CardTitle>
        <CardDescription>Change the password you sign in with. At least 8 characters — a few words beat a short scramble.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {noPassword ? explainGoogle : google && !anyway ? (
          <>
            {explainGoogle}
            <Button variant="outline" size="sm" onClick={() => setAnyway(true)} data-testid="button-password-anyway">
              I had a password before I linked Google
            </Button>
          </>
        ) : done ? (
          <div className="text-sm space-y-1" data-testid="text-password-changed">
            <p className="font-medium">Your password is changed.</p>
            <p className="text-muted-foreground">
              You're still signed in here, and everywhere else was signed out: {plural(done.sessionsEnded, "other browser session", "other browser sessions")} ended
              and {plural(done.devicesSignedOut, "phone", "phones")} signed out. Anyone who knew the old password will have to start again.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3" data-testid="form-change-password">
            {error && <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3" data-testid="text-password-error">{error}</div>}
            <div className="space-y-1.5">
              <Label htmlFor="current-password">Current password</Label>
              <Input id="current-password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required data-testid="input-current-password" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-password">New password</Label>
              <Input id="new-password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required data-testid="input-new-password" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">New password again</Label>
              <Input id="confirm-password" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required data-testid="input-confirm-password" />
            </div>
            <p className="text-sm text-muted-foreground">
              Changing it signs out every other browser and phone on your account. This page stays signed in.
            </p>
            <Button type="submit" disabled={busy || !current || !next || !again} data-testid="button-change-password">
              {busy && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}Change password
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Sign out everywhere, for a lost phone or a computer left signed in
 * somewhere. The phone has had this since it shipped (mobile/app/settings.tsx);
 * this session goes with the rest, so the page can only offer the way back in.
 */
function SignOutEverywhere() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<SessionsEnded | null>(null);

  const signOutAll = () => {
    setError("");
    setBusy(true);
    postJson<SessionsEnded>("/api/auth/logout-all")
      .then((res) => { setDone(res); setOpen(false); })
      .catch((err: any) => setError(err.message))
      .finally(() => setBusy(false));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg"><LogOut className="h-5 w-5 text-primary" /> Signed-in devices</CardTitle>
        <CardDescription>End every session on your account at once — a lost phone, or a computer you left signed in.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {done ? (
          <div className="text-sm space-y-2" data-testid="text-logout-all-done">
            <p className="font-medium">Signed out everywhere.</p>
            <p className="text-muted-foreground">
              {plural(done.sessionsEnded, "browser session", "browser sessions")} ended and {plural(done.devicesSignedOut, "phone", "phones")} signed
              out, this one included. Sign in again to carry on.
            </p>
            <Button size="sm" onClick={() => { window.location.href = "/"; }} data-testid="button-sign-in-again">Sign in again</Button>
          </div>
        ) : !open ? (
          <div className="flex items-start justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              Every browser and phone signed in to your account is signed out, including this one.
            </p>
            <Button variant="outline" size="sm" className="shrink-0" onClick={() => { setError(""); setOpen(true); }} data-testid="button-logout-all">
              <LogOut className="h-3.5 w-3.5 mr-1.5" />Sign out everywhere
            </Button>
          </div>
        ) : (
          <div className="space-y-3 rounded-md border p-3" data-testid="confirm-logout-all">
            {error && <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3" data-testid="text-logout-all-error">{error}</div>}
            <p className="text-sm">Sign out everywhere? You'll be signed out of this page too and will need your password again.</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={signOutAll} disabled={busy} data-testid="button-logout-all-confirm">
                {busy && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}Sign out everywhere
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => { setOpen(false); setError(""); }}>Cancel</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Article 15 and article 17, as two buttons: take a copy of everything, or
 * close the account. Deleting asks for the password again (and a code, with
 * 2FA on) because a borrowed tab must not be able to do this.
 */
function YourData({ mfaEnabled }: { mfaEnabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState("");
  const [keepPosts, setKeepPosts] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const deleteAccount = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    postJson("/api/account/delete", { password, code, confirm, keepPosts })
      .then(() => { window.location.href = "/"; })
      .catch((err: any) => { setError(err.message); setBusy(false); });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Your data</CardTitle>
        <CardDescription>Take a copy of everything on this account, or close it for good.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Download my data</p>
            <p className="text-sm text-muted-foreground">A JSON file: your account, profile, projects, posts and everything else keyed to you.</p>
          </div>
          {/* A plain link, so the browser saves the file rather than the page holding it in memory. */}
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <a href="/api/account/export" download data-testid="link-export-data"><Download className="h-3.5 w-3.5 mr-1.5" />Export</a>
          </Button>
        </div>

        <div className="border-t pt-4 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Delete my account</p>
              <p className="text-sm text-muted-foreground">
                This can't be undone. Projects with other members are handed to another member; projects nobody else is on are deleted with everything in them.
              </p>
              {/* Said here because it is the question a paying member has, and until now the answer was "you keep being charged". */}
              <p className="text-sm text-muted-foreground" data-testid="text-delete-billing">
                A paid plan is cancelled at the same moment, so you won't be charged again.
              </p>
            </div>
            {!open && (
              <Button variant="outline" size="sm" className="shrink-0 text-destructive border-destructive/40 hover:bg-destructive/10" onClick={() => setOpen(true)} data-testid="button-delete-account">
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />Delete
              </Button>
            )}
          </div>

          {open && (
            <form onSubmit={deleteAccount} className="space-y-3 rounded-md border border-destructive/30 p-3" data-testid="form-delete-account">
              {error && <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3" data-testid="text-delete-error">{error}</div>}
              <div className="space-y-1.5">
                <Label htmlFor="delete-password">Your password</Label>
                <Input id="delete-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="input-delete-password" />
                <p className="text-xs text-muted-foreground">Signed in with Google and never set one? Type <span className="font-mono">delete my account</span> below instead.</p>
                <Input placeholder="delete my account" value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="input-delete-confirm" />
              </div>
              {mfaEnabled && (
                <div className="space-y-1.5">
                  <Label htmlFor="delete-code">Authenticator code</Label>
                  <Input id="delete-code" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} data-testid="input-delete-code" />
                </div>
              )}
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={keepPosts} onCheckedChange={(v) => setKeepPosts(v === true)} data-testid="checkbox-keep-posts" />
                <span>
                  Leave my posts and comments up, shown as "Deleted account".
                  <span className="block text-xs text-muted-foreground">Unticked, they're deleted too — replies other people wrote will lose what they were answering.</span>
                </span>
              </label>
              <div className="flex gap-2">
                <Button type="submit" variant="destructive" size="sm" disabled={busy} data-testid="button-delete-confirm">
                  {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}Delete my account
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => { setOpen(false); setError(""); setPassword(""); setCode(""); setConfirm(""); }}>Cancel</Button>
              </div>
            </form>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
