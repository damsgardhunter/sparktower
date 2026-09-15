import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UserAvatar } from "@/components/user-avatar";
import { Bell, Loader2 } from "lucide-react";

export interface NotificationItem {
  id: string;
  kind: string;
  createdAt: string;
  read: boolean;
  actor: { id: string; name: string; avatarUrl: string | null };
  project: { id: string; title: string | null } | null;
  excerpt: string | null;
  text: string;
  href: string;
}

export const NOTIFICATION_COUNT_KEY = ["/api/notifications/unread-count"];

function ago(date: string) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The unread count, polled — the thing that tells someone there's a reason to come back. */
export function useNotificationCounts() {
  return useQuery<{ count: number; followedPosts: number }>({ queryKey: NOTIFICATION_COUNT_KEY, refetchInterval: 30_000 });
}

export function refreshNotifications() {
  queryClient.invalidateQueries({ queryKey: NOTIFICATION_COUNT_KEY });
  queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
}

/**
 * The bell in the header: what happened while you were away — progress from
 * people you follow, replies, reactions, follows, connections. Opening one
 * takes you there and marks it read.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();
  const { data: counts } = useNotificationCounts();
  const { data, isLoading } = useQuery<{ items: NotificationItem[] }>({ queryKey: ["/api/notifications"], enabled: open });

  const read = useMutation({
    mutationFn: (body: { ids?: string[]; all?: boolean }) => apiRequest("POST", "/api/notifications/read", body),
    onSuccess: refreshNotifications,
  });

  const unread = counts?.count ?? 0;
  const items = data?.items ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9" aria-label={unread ? `${unread} unread notifications` : "Notifications"} data-testid="button-notifications">
          <Bell className="h-4.5 w-4.5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold flex items-center justify-center" data-testid="notifications-unread">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] p-0" data-testid="notifications-panel">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 && (
            <button className="text-xs text-primary hover:underline" disabled={read.isPending} onClick={() => read.mutate({ all: true })} data-testid="button-read-all">
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-[26rem] overflow-y-auto">
          {isLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-primary" /></div>
          ) : !items.length ? (
            <p className="text-xs text-muted-foreground px-4 py-6 text-center">
              Nothing yet. Follow builders and projects, and their progress shows up here — along with replies and reactions to what you post.
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    className={`w-full text-left flex items-start gap-2.5 px-3 py-2.5 hover:bg-accent/60 ${n.read ? "" : "bg-primary/5"}`}
                    onClick={() => {
                      if (!n.read) read.mutate({ ids: [n.id] });
                      setOpen(false);
                      setLocation(n.href);
                    }}
                    data-testid={`notification-${n.id}`}
                  >
                    <UserAvatar src={n.actor.avatarUrl} name={n.actor.name} className="h-8 w-8 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] leading-snug">{n.text}</span>
                      {n.excerpt && <span className="block text-xs text-muted-foreground truncate">"{n.excerpt}"</span>}
                      <span className="block text-[11px] text-muted-foreground">{ago(n.createdAt)}</span>
                    </span>
                    {!n.read && <span className="h-2 w-2 rounded-full bg-primary mt-1.5 shrink-0" aria-hidden />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
