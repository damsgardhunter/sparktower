/**
 * Confirming the address someone signed up with.
 *
 * The banner sits under the header until it's done, because until then nothing
 * this account writes reaches another person — posts, comments, messages,
 * invites and reports are refused server-side (server/email-verification.ts).
 * It says that plainly rather than nagging, and the way out is one button.
 */
import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { errorText } from "@/lib/api-error";
import { Button } from "@/components/ui/button";
import { MailCheck, MailWarning, Loader2 } from "lucide-react";

function useResend() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/auth/verify-email/send")).json(),
    onSuccess: (r: any) => toast({
      title: r?.alreadyVerified ? "Already confirmed" : "Link sent",
      description: r?.alreadyVerified ? "Your address is confirmed — you're all set." : `Check ${r?.sentTo ?? "your inbox"}, and the spam folder.`,
    }),
    onError: (e) => toast({ title: "Couldn't send that", description: errorText(e), variant: "destructive" }),
  });
}

export function VerifyEmailNotice() {
  const { user } = useAuth();
  const resend = useResend();
  if (!user || (user as any).emailVerifiedAt) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm bg-amber-100 text-amber-950 dark:bg-amber-950/60 dark:text-amber-100 border-b border-amber-300/60" data-testid="verify-email-notice">
      <MailWarning className="h-4 w-4 shrink-0" />
      <span className="flex-1">Confirm your email to post, comment, message and invite people. We sent a link to {user.email}.</span>
      <Button size="sm" variant="outline" className="h-7 bg-transparent" disabled={resend.isPending} onClick={() => resend.mutate()} data-testid="button-resend-verification">
        {resend.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Send it again"}
      </Button>
    </div>
  );
}

/** Where the emailed link lands. Works signed in or out: the link is the credential. */
export default function VerifyEmailPage() {
  const search = useSearch();
  const token = new URLSearchParams(search).get("token") ?? "";
  const [state, setState] = useState<{ status: "working" | "done" | "failed"; message?: string }>({ status: "working" });
  const resend = useResend();
  const { user } = useAuth();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) return setState({ status: "failed", message: "That link is missing its code. Open the link from the email itself." });
      try {
        await apiRequest("POST", "/api/auth/verify-email", { token });
        if (cancelled) return;
        // The signed-in user's own record has changed if it was their link.
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        setState({ status: "done" });
      } catch (e) {
        if (!cancelled) setState({ status: "failed", message: errorText(e, "That link didn't work.") });
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center space-y-4" data-testid="verify-email-page">
      {state.status === "working" && <><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /><p className="text-sm text-muted-foreground">Confirming your address…</p></>}
      {state.status === "done" && (
        <>
          <MailCheck className="h-8 w-8 mx-auto text-emerald-500" />
          <h1 className="text-lg font-semibold">Email confirmed</h1>
          <p className="text-sm text-muted-foreground">You can post, comment, message and invite people now.</p>
          <Button asChild data-testid="link-verified-home"><Link href="/">Go to your feed</Link></Button>
        </>
      )}
      {state.status === "failed" && (
        <>
          <MailWarning className="h-8 w-8 mx-auto text-amber-500" />
          <h1 className="text-lg font-semibold">That link didn't work</h1>
          <p className="text-sm text-muted-foreground" data-testid="text-verify-error">{state.message}</p>
          {user && !(user as any).emailVerifiedAt && (
            <Button variant="outline" disabled={resend.isPending} onClick={() => resend.mutate()} data-testid="button-verify-page-resend">Send a new link</Button>
          )}
          <p className="text-xs text-muted-foreground"><Link href="/" className="underline">Back to SparkTower</Link></p>
        </>
      )}
    </div>
  );
}
