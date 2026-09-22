import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Ban, Loader2 } from "lucide-react";

/**
 * Blocking somebody, from wherever you are when you decide to.
 *
 * Reporting and blocking answer different questions. A report asks someone
 * else to look; a block is the thing the person can do *now*, without waiting
 * for anyone. So this sits next to the report button rather than inside it,
 * and it is one click plus a confirm — the confirm exists because blocking
 * deletes the connection between the two, and losing a connection you meant to
 * keep is worth a sentence of warning.
 *
 * The dialog says exactly what happens, including the part people always ask:
 * no, they aren't told. That matters to somebody deciding whether it's safe to
 * block a person they have to see at work on Monday.
 */
export function BlockButton({
  userId, name, className, variant = "action", onBlocked,
}: {
  userId: string;
  name?: string | null;
  className?: string;
  variant?: "icon" | "action";
  /** Called after a successful block — for screens that should navigate away from the person. */
  onBlocked?: () => void;
}) {
  const { isAuthenticated, user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const isSelf = (user as any)?.id === userId;

  const { data: state } = useQuery<{ blocked: boolean }>({
    queryKey: [`/api/blocks/${userId}`],
    enabled: !!isAuthenticated && !!userId && !isSelf,
  });
  const blocked = !!state?.blocked;

  /*
   * A block changes what half the app is allowed to show, so the caches that
   * could still be holding the blocked person are dropped rather than
   * selectively patched: their profile, the conversation list and its badge,
   * matches, search, connections and the bell.
   */
  const refreshEverythingAboutThem = () => {
    for (const key of [
      `/api/blocks/${userId}`, "/api/blocks", "/api/messages/conversations", "/api/messages/unread-count",
      "/api/matches", "/api/connections", "/api/connections/sent", "/api/connections/requests",
      "/api/notifications", "/api/notifications/unread-count", `/api/users/${userId}`,
      `/api/connections/status/${userId}`,
    ]) queryClient.invalidateQueries({ queryKey: [key] });
  };

  const block = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/blocks", { userId })).json(),
    onSuccess: () => {
      refreshEverythingAboutThem();
      setOpen(false);
      toast({
        title: `${name || "They"} can't reach you now`,
        description: "They aren't told. You can undo this in Settings → Security.",
      });
      onBlocked?.();
    },
    onError: () => toast({ title: "Couldn't block them", description: "Try again.", variant: "destructive" }),
  });

  const unblock = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/blocks/${userId}`)).json(),
    onSuccess: () => {
      refreshEverythingAboutThem();
      toast({ title: "Unblocked", description: "You'll need to connect again if you want to message." });
    },
    onError: () => toast({ title: "Couldn't unblock them", description: "Try again.", variant: "destructive" }),
  });

  if (!isAuthenticated || !userId || isSelf) return null;

  if (blocked) {
    return (
      <Button
        variant="outline"
        size="sm"
        className={`gap-1.5 h-8 text-xs ${className || ""}`}
        onClick={() => unblock.mutate()}
        disabled={unblock.isPending}
        data-testid={`button-unblock-${userId}`}
      >
        {unblock.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
        Unblock
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className={variant === "action"
          ? `gap-1.5 h-8 text-xs text-muted-foreground ${className || ""}`
          : `h-6 px-1.5 text-muted-foreground/60 hover:text-foreground ${className || ""}`}
        onClick={() => setOpen(true)}
        title={`Block ${name || "this person"}`}
        data-testid={`button-block-${userId}`}
      >
        <Ban className={variant === "action" ? "h-4 w-4" : "h-3 w-3"} />
        {variant === "action" ? "Block" : null}
      </Button>

      <Dialog open={open} onOpenChange={(v) => !block.isPending && setOpen(v)}>
        <DialogContent data-testid="dialog-block-confirm">
          <DialogHeader>
            <DialogTitle>Block {name || "this person"}?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>They won't be able to message you, send you a connection request, or see your profile — and you won't see theirs.</p>
                <p>Any connection between you is removed, so reconnecting later means asking again.</p>
                <p className="text-foreground">They are not told that you blocked them.</p>
                <p>You can undo this any time in Settings → Security.</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={block.isPending} data-testid="button-block-cancel">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => block.mutate()}
              disabled={block.isPending}
              data-testid="button-block-confirm"
            >
              {block.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Block
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
