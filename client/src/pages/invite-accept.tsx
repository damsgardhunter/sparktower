import { useState } from "react";
import { useRoute } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, UserPlus } from "lucide-react";
import { PENDING_INVITE_KEY } from "@shared/invites";

interface InviteView {
  status: "pending" | "accepted" | "revoked" | "expired";
  role: string;
  expiresAt: string;
  project: { id: string; title: string; oneLiner: string | null; logoUrl: string | null };
  invitedBy: string;
  forEmail: string | null;
  viewerMatches: boolean | null;
}

const UNUSABLE: Record<Exclude<InviteView["status"], "pending">, string> = {
  accepted: "This invite has already been used.",
  revoked: "This invite was cancelled by the project owner.",
  expired: "This invite has expired. Ask whoever sent it for a new one.",
};

/**
 * Where an invite link lands — signed in or not. Signed out, it says who's
 * inviting you to what, and keeps the invite in this browser through sign up
 * and onboarding, which bring you back here to accept.
 */
export default function InviteAcceptPage() {
  const [, params] = useRoute("/invite/:token");
  const token = params?.token ?? "";
  const { user, isLoading: authLoading } = useAuth();
  const [joinError, setJoinError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<InviteView>({
    queryKey: ["/api/invites", token],
    queryFn: async () => {
      const res = await fetch(`/api/invites/${encodeURIComponent(token)}`, { credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message ?? "This invite link isn't valid.");
      return body;
    },
    enabled: !!token && !authLoading,
    retry: false,
  });

  const accept = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/invites/${encodeURIComponent(token)}/accept`)).json() as Promise<{ projectId: string }>,
    onSuccess: ({ projectId }) => {
      try { localStorage.removeItem(PENDING_INVITE_KEY); } catch { /* nothing to clear */ }
      window.location.href = `/projects/${projectId}/manage?tab=team`;
    },
    onError: (e) => setJoinError(errorText(e)),
  });

  const holdAndGo = (to: string) => {
    try { localStorage.setItem(PENDING_INVITE_KEY, token); } catch { /* they'll need the link again after signing in */ }
    window.location.href = to;
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md" data-testid="invite-accept">
        <CardContent className="p-6 space-y-4">
          <a href="/" className="block text-center font-bold text-xs tracking-widest uppercase">SparkTower</a>
          {isLoading || authLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : error || !data ? (
            <p className="text-center text-sm text-muted-foreground" data-testid="invite-invalid">{(error as Error)?.message ?? "This invite link isn't valid."}</p>
          ) : (
            <>
              <div className="flex flex-col items-center text-center gap-2">
                {data.project.logoUrl
                  ? <img src={data.project.logoUrl} alt="" className="h-14 w-14 rounded-lg object-contain" />
                  : <span className="h-14 w-14 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><UserPlus className="h-6 w-6" /></span>}
                <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">{data.invitedBy}</span> invited you to join</p>
                <h1 className="text-xl font-bold" data-testid="invite-project-title">{data.project.title}</h1>
                {data.project.oneLiner && <p className="text-sm text-muted-foreground">{data.project.oneLiner}</p>}
                <p className="text-sm">as <span className="font-medium" data-testid="invite-role">{data.role}</span></p>
                {data.forEmail && <p className="text-xs text-muted-foreground">For {data.forEmail}</p>}
              </div>

              {data.status !== "pending" ? (
                <p className="text-center text-sm text-muted-foreground" data-testid="invite-unusable">{UNUSABLE[data.status]}</p>
              ) : !user ? (
                <div className="space-y-2">
                  <Button className="w-full" onClick={() => holdAndGo("/?signup=1")} data-testid="button-invite-signup">Sign up to accept</Button>
                  <Button variant="outline" className="w-full" onClick={() => holdAndGo("/?login=1")} data-testid="button-invite-login">I have an account — log in</Button>
                </div>
              ) : data.viewerMatches === false ? (
                <p className="text-center text-sm text-amber-700 dark:text-amber-400" data-testid="invite-wrong-account">
                  This invite is for {data.forEmail}, and you're signed in as {user.email}. Sign in with that account to accept it.
                </p>
              ) : (
                <div className="space-y-2">
                  <Button className="w-full" disabled={accept.isPending} onClick={() => accept.mutate()} data-testid="button-accept-invite">
                    {accept.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}Join {data.project.title}
                  </Button>
                  {joinError && <p className="text-center text-sm text-destructive" data-testid="invite-accept-error">{joinError}</p>}
                </div>
              )}
              <p className="text-center text-[11px] text-muted-foreground">Expires {new Date(data.expiresAt).toLocaleDateString()}</p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
