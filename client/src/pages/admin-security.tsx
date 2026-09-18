/**
 * The security console.
 *
 * Two controls that used to be a shell and a production database URL — taking
 * somebody's second factor off after they lost their phone, and ending every
 * session an account holds — and the three things worth seeing before you use
 * either: who holds power, whether their own sign-in is protected, and what the
 * limits have been refusing.
 *
 * Both controls ask for a reason before they will run. It is not paperwork: the
 * reason goes into the moderation log, which the database refuses to update or
 * delete, and an administrative action nobody can reconstruct afterwards is
 * indistinguishable from an intrusion.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";
import NotFound from "@/pages/not-found";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, ShieldAlert, ShieldCheck, KeyRound, LogOut, Ban } from "lucide-react";

interface Privileged {
  id: string; email: string; firstName: string | null; role: string | null;
  mfaEnabledAt: string | null; suspendedAt: string | null; emailVerifiedAt: string | null; createdAt: string | null;
  twoFactor: "on" | "OFF";
}
interface Overview {
  privileged: Privileged[];
  refusalsLastDay: { action: string; n: number; subjects: number }[];
  suspended: { id: string; email: string; suspendedAt: string | null; reason: string | null }[];
  recentActions: { id: string; action: string; actorId: string | null; targetUserId: string | null; reason: string | null; createdAt: string }[];
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

export default function AdminSecurity() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState<{ id: string; kind: "reset-mfa" | "sign-out" } | null>(null);
  const [reason, setReason] = useState("");

  const { data, isLoading, error } = useQuery<Overview>({
    queryKey: ["/api/admin/security/overview"],
    retry: false,
  });

  const act = useMutation({
    mutationFn: async ({ id, kind, reason }: { id: string; kind: string; reason: string }) =>
      (await apiRequest("POST", `/api/admin/security/users/${id}/${kind}`, { reason })).json(),
    onSuccess: (result: any, variables) => {
      toast({
        title: variables.kind === "reset-mfa" ? "Two-factor turned off" : "Signed out everywhere",
        description: `${result.sessions ?? 0} session${result.sessions === 1 ? "" : "s"} and ${result.devices ?? 0} device${result.devices === 1 ? "" : "s"} ended. It's in the log.`,
      });
      setAsking(null);
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/security/overview"] });
    },
    onError: (err) => toast({ title: "Didn't run", description: errorText(err), variant: "destructive" }),
  });

  // A 404 is what this console says to anyone who shouldn't know it exists.
  if (error) return <NotFound />;
  if (isLoading || !data) {
    return <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const exposed = data.privileged.filter((p) => p.twoFactor === "OFF");

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6" data-testid="page-admin-security">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" /> Security
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Who can get in, what's being refused, and the two things you'd need at three in the morning.
        </p>
      </div>

      {exposed.length > 0 && (
        <Card className="border-destructive/40 bg-destructive/5" data-testid="card-exposed-admins">
          <CardContent className="pt-6 flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold">
                {exposed.length} account{exposed.length === 1 ? "" : "s"} with a role and no second factor
              </p>
              <p className="text-muted-foreground mt-1">
                A reviewer or admin without 2FA is one leaked password away from being someone else. Privileged
                routes already refuse a session that hasn't passed a code, so these accounts can't use their
                own permissions until they set it up.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Who holds power</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {data.privileged.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2 justify-between border rounded-md p-3" data-testid={`row-privileged-${p.id}`}>
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {p.firstName || "(no name)"}
                  <Badge variant={p.role === "admin" ? "default" : "secondary"}>{p.role}</Badge>
                  {p.twoFactor === "on"
                    ? <Badge variant="outline" className="text-green-600 border-green-600/40">2FA on</Badge>
                    : <Badge variant="destructive" data-testid={`badge-no-2fa-${p.id}`}>2FA OFF</Badge>}
                  {p.suspendedAt && <Badge variant="destructive"><Ban className="h-3 w-3 mr-1" />suspended</Badge>}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{p.email} · since {when(p.createdAt)}</div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => { setAsking({ id: p.id, kind: "reset-mfa" }); setReason(""); }} data-testid={`button-reset-mfa-${p.id}`}>
                  <KeyRound className="h-3.5 w-3.5 mr-1.5" /> Reset 2FA
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setAsking({ id: p.id, kind: "sign-out" }); setReason(""); }} data-testid={`button-sign-out-${p.id}`}>
                  <LogOut className="h-3.5 w-3.5 mr-1.5" /> Sign out everywhere
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {asking && (
        <Card className="border-primary/40" data-testid="card-confirm-action">
          <CardHeader>
            <CardTitle className="text-base">
              {asking.kind === "reset-mfa" ? "Turn off two-factor for this account" : "End every session this account holds"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {asking.kind === "reset-mfa"
                ? "Confirm who they are some other way first — a call, a video, something only they would know. This signs them out everywhere at the same time, so a reset can't be used to keep access rather than restore it."
                : "Their browser sessions and phone tokens all stop working. They can sign in again with their password."}
            </p>
            <div>
              <label className="text-sm font-medium" htmlFor="reason">How you confirmed it, or why</label>
              <Input
                id="reason" value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="Called them, confirmed the project they own and the card on file"
                data-testid="input-action-reason"
              />
              <p className="text-xs text-muted-foreground mt-1">Goes into the moderation log, which can't be edited or deleted afterwards.</p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => act.mutate({ id: asking.id, kind: asking.kind, reason })}
                disabled={reason.trim().length < 8 || act.isPending}
                data-testid="button-confirm-action"
              >
                {act.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {asking.kind === "reset-mfa" ? "Turn it off" : "Sign them out"}
              </Button>
              <Button variant="ghost" onClick={() => { setAsking(null); setReason(""); }} data-testid="button-cancel-action">Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">What the limits refused, last 24 hours</CardTitle></CardHeader>
        <CardContent>
          {data.refusalsLastDay.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing was refused. Either it's quiet, or nobody is trying.</p>
          ) : (
            <div className="space-y-1.5">
              {data.refusalsLastDay.map((r) => (
                <div key={r.action} className="flex items-center justify-between text-sm" data-testid={`row-refusal-${r.action}`}>
                  <span className="font-mono text-xs">{r.action}</span>
                  <span className="text-muted-foreground">
                    {r.n} refused{r.subjects > 1 ? `, across ${r.subjects}` : ""}
                  </span>
                </div>
              ))}
              <p className="text-xs text-muted-foreground pt-2">
                A lot of <span className="font-mono">loginAccount</span> against one account is somebody working through a
                password list. A lot of <span className="font-mono">mfaCode</span> is somebody guessing at six digits.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">What's been done recently</CardTitle></CardHeader>
        <CardContent>
          {data.recentActions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            <div className="space-y-1.5 text-sm">
              {data.recentActions.map((a) => (
                <div key={a.id} className="flex flex-wrap gap-x-2 items-baseline" data-testid={`row-action-${a.id}`}>
                  <span className="font-mono text-xs">{a.action}</span>
                  <span className="text-muted-foreground text-xs">{when(a.createdAt)}</span>
                  {a.reason && <span className="text-muted-foreground">— {a.reason}</span>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
