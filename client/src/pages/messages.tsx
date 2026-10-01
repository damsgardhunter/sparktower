import { exploreContext } from "@/lib/explore";
import { useMemo, useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { errorText } from "@/lib/api-error";
import { UserAvatar } from "@/components/user-avatar";
import { BlockButton } from "@/components/block-button";
import { ReportButton } from "@/components/report-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Send, MessageSquare, Search, Check, CheckCheck, MessageSquarePlus, X, Users } from "lucide-react";
import type { User } from "@shared/models/auth";
import type { UserProfile, DirectMessage } from "@shared/schema";

interface Conversation {
  userId: string;
  user: User;
  profile?: UserProfile;
  lastMessage: DirectMessage;
  unreadCount: number;
}

function formatTime(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else if (days === 1) {
    return "Yesterday";
  } else if (days < 7) {
    return date.toLocaleDateString([], { weekday: "short" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatMessageTime(dateStr: string) {
  const date = new Date(dateStr);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateHeader(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

/** An accepted connection, as `GET /api/connections` returns it. */
interface ConnectionRow {
  id: string;
  user: User;
  profile?: UserProfile;
}

/**
 * What to call a connection, in the order the rest of the app does.
 *
 * The display name is the one they chose, then the first and last they signed up
 * with. The email is a last resort that normally is not there at all:
 * `stripOthersAccountFields` redacts it from anybody else's account on every
 * payload, so it only survives for a reviewer or an admin. Kept because it costs
 * nothing and reads better than "User" when it does, not relied on.
 */
export function connectionName(c: ConnectionRow): string {
  return c.profile?.displayName
    || `${c.user.firstName || ""} ${c.user.lastName || ""}`.trim()
    || c.user.email
    || "User";
}

/**
 * The connections matching what was typed, in a predictable order.
 *
 * Matched on more than the display name, because half of knowing who somebody is
 * on this product is their handle or what they say they do: searching "design"
 * to find the designer you met should find them. Sorted by name rather than by
 * when the connection was made — a picker you search is one you scan, and
 * recency is not an order you can scan for a name you already have in mind.
 *
 * Not matched on the email, though a first version was. `stripOthersAccountFields`
 * redacts `email` from anybody else's account before it leaves the server, so
 * for everyone but a reviewer or an admin that was a search over a field that is
 * never present — which is worse than not offering it, because it fails by
 * returning nothing and "no match" reads as "not connected to you".
 *
 * Pure, and exported, because this is the half that fails silently: a search
 * that quietly stops matching usernames looks exactly like a person who has not
 * connected with you yet.
 */
export function searchConnections(connections: ConnectionRow[], query: string): ConnectionRow[] {
  const rows = [...connections].sort((a, b) => connectionName(a).localeCompare(connectionName(b)));
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((c) => [
    connectionName(c), c.profile?.username, c.profile?.headline,
  ].some((field) => field?.toLowerCase().includes(q)));
}

/**
 * Pick somebody to write to, out of the people you are allowed to write to.
 *
 * Before this the only way to start a conversation was to find the person's
 * profile and press Message there — which the empty inbox said out loud, and
 * which means the Messages tab could tell you that you had no messages without
 * offering any way to send one. If you could not remember who you had connected
 * with, there was nowhere here to look.
 *
 * Connections are the right list rather than every account, because
 * `POST /api/messages/:userId` refuses anyone you are not connected to — it
 * answers 403 "You can only message connected users". A picker over all users
 * would spend most of its results on people the next screen would refuse.
 */
function ConnectionPicker({
  query,
  withConversation,
  onPick,
}: {
  query: string;
  /** Who you already have a thread with, so the list can say so. */
  withConversation: Set<string>;
  onPick: (userId: string) => void;
}) {
  const { data: connections = [], isLoading } = useQuery<ConnectionRow[]>({
    queryKey: ["/api/connections"],
  });

  const filtered = useMemo(() => searchConnections(connections, query), [connections, query]);

  if (isLoading) {
    return (
      <div className="space-y-2 p-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 p-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  /* No connections at all is a different problem from no match, and needs a way out. */
  if (connections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center" data-testid="empty-no-connections">
        <Users className="h-10 w-10 text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">You have no connections yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Messages only go to people you are connected with.
        </p>
        <Button asChild size="sm" variant="outline" className="mt-3" data-testid="link-find-builders">
          <Link href="/discover">Find builders</Link>
        </Button>
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center" data-testid="empty-no-connection-match">
        <Search className="h-10 w-10 text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">No connection matches "{query.trim()}"</p>
      </div>
    );
  }

  return (
    <div className="p-2 space-y-1" data-testid="list-connections">
      {filtered.map((c) => {
        const name = connectionName(c);
        return (
          <button
            key={c.user.id}
            onClick={() => onPick(c.user.id)}
            className="w-full flex items-center gap-3 p-3 rounded-md text-left transition-colors hover-elevate"
            data-testid={`button-connection-${c.user.id}`}
          >
            <UserAvatar src={c.profile?.avatarUrl ?? c.user.profileImageUrl} name={name} className="h-10 w-10" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium truncate">{name}</span>
                {withConversation.has(c.user.id) && (
                  <span className="text-[10px] text-muted-foreground flex-shrink-0">Open thread</span>
                )}
              </div>
              {c.profile?.headline && (
                <p className="text-xs text-muted-foreground truncate mt-0.5">{c.profile.headline}</p>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ConversationList({
  conversations,
  isLoading,
  selectedUserId,
  onSelect,
  searchQuery,
  onSearchChange,
}: {
  conversations: Conversation[];
  isLoading: boolean;
  selectedUserId: string | null;
  onSelect: (userId: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}) {
  /* Which of the two lists the panel is showing. Local: nothing outside cares. */
  const [composing, setComposing] = useState(false);

  const filtered = conversations.filter((c) => {
    if (!searchQuery) return true;
    const name = `${c.user.firstName || ""} ${c.user.lastName || ""}`.toLowerCase();
    return name.includes(searchQuery.toLowerCase());
  });

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 className="text-lg font-semibold" data-testid="text-messages-title">
            {composing ? "New message" : "Messages"}
          </h2>
          {/*
            * One button, both ways. The search box below it is shared, so the
            * query is cleared on the way in and out — a name typed while looking
            * for a connection is not a sensible filter over your threads, and
            * leaving it behind makes the list look empty for no stated reason.
            */}
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 flex-shrink-0"
            onClick={() => { setComposing(!composing); onSearchChange(""); }}
            title={composing ? "Back to your messages" : "Message a connection"}
            aria-label={composing ? "Back to your messages" : "Message a connection"}
            data-testid="button-toggle-new-message"
          >
            {composing ? <X className="h-4 w-4" /> : <MessageSquarePlus className="h-4 w-4" />}
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={composing ? "Search your connections..." : "Search conversations..."}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9"
            data-testid={composing ? "input-search-connections" : "input-search-conversations"}
          />
        </div>
      </div>
      <ScrollArea className="flex-1">
        {composing ? (
          <ConnectionPicker
            query={searchQuery}
            withConversation={new Set(conversations.map((c) => c.userId))}
            onPick={(userId) => {
              onSelect(userId);
              /* Straight back to the thread list, now showing the one just opened. */
              setComposing(false);
              onSearchChange("");
            }}
          />
        ) : isLoading ? (
          <div className="space-y-2 p-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 p-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-40" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <MessageSquare className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              {searchQuery ? "No conversations found" : "No messages yet"}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3 gap-1.5"
              onClick={() => { setComposing(true); onSearchChange(""); }}
              data-testid="button-start-first-message"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" /> Message a connection
            </Button>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {filtered.map((conv) => {
              const displayName = conv.user.firstName
                ? `${conv.user.firstName} ${conv.user.lastName || ""}`.trim()
                : conv.user.email || "User";
              const isSelected = selectedUserId === conv.userId;

              return (
                <button
                  key={conv.userId}
                  onClick={() => onSelect(conv.userId)}
                  className={`w-full flex items-center gap-3 p-3 rounded-md text-left transition-colors hover-elevate ${
                    isSelected ? "bg-accent" : ""
                  }`}
                  data-testid={`button-conversation-${conv.userId}`}
                >
                  <UserAvatar
                    src={conv.user.profileImageUrl}
                    name={displayName}
                    className="h-10 w-10"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">{displayName}</span>
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        {formatTime(conv.lastMessage.createdAt as unknown as string)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <p className="text-xs text-muted-foreground truncate">
                        {conv.lastMessage.content}
                      </p>
                      {conv.unreadCount > 0 && (
                        <Badge variant="default" className="text-xs flex-shrink-0" data-testid={`badge-unread-${conv.userId}`}>
                          {conv.unreadCount}
                        </Badge>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function ChatPanel({
  userId,
  currentUserId,
  onBlocked,
}: {
  userId: string;
  currentUserId: string;
  /** Blocking severs the connection, so the thread closes: the page goes back to the list. */
  onBlocked?: () => void;
}) {
  const [message, setMessage] = useState("");
  const { toast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const { data: otherUser } = useQuery<{ id: string; firstName?: string; lastName?: string; email?: string; profileImageUrl?: string; profile?: UserProfile }>({
    queryKey: ["/api/users", userId],
  });

  const { data: messages = [], isLoading } = useQuery<DirectMessage[]>({
    queryKey: ["/api/messages", userId],
    refetchInterval: 3000,
  });

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await apiRequest("POST", `/api/messages/${userId}`, { content, explore: exploreContext("messages") });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages", userId] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages/conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages/unread-count"] });
      setMessage("");
    },
    // A refused send (rate limit, a blocked or missing recipient) used to just
    // stop the spinner, which reads as "sent". The draft is only cleared on
    // success, so it's still in the box to retry — the toast says why it didn't go.
    onError: (error) => {
      toast({ title: "Message not sent", description: errorText(error), variant: "destructive" });
    },
  });

  const markReadMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/messages/${userId}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages/unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages/conversations"] });
    },
  });

  useEffect(() => {
    if (messages.length > 0) {
      const hasUnread = messages.some(
        (m) => m.receiverId === currentUserId && !m.read
      );
      if (hasUnread) {
        markReadMutation.mutate();
      }
    }
  }, [messages, currentUserId, userId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    if (!message.trim() || sendMutation.isPending) return;
    sendMutation.mutate(message.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const displayName = otherUser?.firstName
    ? `${otherUser.firstName} ${otherUser.lastName || ""}`.trim()
    : otherUser?.email || "User";

  const sortedMessages = [...messages].sort(
    (a, b) => new Date(a.createdAt as unknown as string).getTime() - new Date(b.createdAt as unknown as string).getTime()
  );

  let lastDateStr = "";

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 p-4 border-b border-border">
        <UserAvatar
          src={otherUser?.profileImageUrl}
          name={displayName}
          className="h-9 w-9"
        />
        <div>
          <p className="text-sm font-semibold" data-testid="text-chat-user-name">{displayName}</p>
          {otherUser?.profile?.headline && (
            <p className="text-xs text-muted-foreground">{otherUser.profile.headline}</p>
          )}
        </div>
        {/*
          * Block, in the conversation header.
          *
          * The profile is where you find out who someone is; the thread is
          * where the thing you want to stop is actually happening. Making
          * somebody navigate to a profile to get away from a message is a
          * detour at the worst possible moment, so the same control is here.
          * Blocking removes the connection, which closes this thread — hence
          * the jump back to the list.
          */}
        <div className="ml-auto">
          <BlockButton userId={userId} name={displayName} onBlocked={onBlocked} />
        </div>
      </div>

      <ScrollArea className="flex-1 p-4" ref={scrollAreaRef}>
        {isLoading ? (
          <div className="space-y-4 p-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className={`flex ${i % 2 === 0 ? "justify-end" : "justify-start"}`}>
                <Skeleton className="h-10 w-48 rounded-md" />
              </div>
            ))}
          </div>
        ) : sortedMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <MessageSquare className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">No messages yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Send a message to start the conversation
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {sortedMessages.map((msg) => {
              const isMine = msg.senderId === currentUserId;
              const msgDate = new Date(msg.createdAt as unknown as string).toDateString();
              let showDateHeader = false;
              if (msgDate !== lastDateStr) {
                showDateHeader = true;
                lastDateStr = msgDate;
              }

              return (
                <div key={msg.id}>
                  {showDateHeader && (
                    <div className="flex items-center justify-center my-4">
                      <span className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full">
                        {formatDateHeader(msg.createdAt as unknown as string)}
                      </span>
                    </div>
                  )}
                  <div
                    className={`flex ${isMine ? "justify-end" : "justify-start"} mb-1`}
                    data-testid={`message-bubble-${msg.id}`}
                  >
                    <div
                      className={`max-w-[75%] px-3 py-2 rounded-md text-sm ${
                        isMine
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                      {/*
                        * Reporting what was said, not just who said it. Until
                        * now the only reportable thing about a private
                        * conversation was the person, so a threat in an inbox
                        * reached a reviewer as "this account is abusive" with
                        * nothing attached. Only on their messages: reporting
                        * your own is refused by the server anyway.
                        */}
                      {!isMine && (
                        <ReportButton targetType="message" targetId={msg.id} className="mt-1 -ml-1" />
                      )}
                      <div
                        className={`flex items-center gap-1 mt-1 ${
                          isMine ? "justify-end" : "justify-start"
                        }`}
                      >
                        <span className={`text-[10px] ${isMine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                          {formatMessageTime(msg.createdAt as unknown as string)}
                        </span>
                        {isMine && (
                          msg.read ? (
                            <CheckCheck className={`h-3 w-3 text-primary-foreground/70`} />
                          ) : (
                            <Check className={`h-3 w-3 text-primary-foreground/70`} />
                          )
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-2">
          <Input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            disabled={sendMutation.isPending}
            data-testid="input-message"
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!message.trim() || sendMutation.isPending}
            data-testid="button-send-message"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function MessagesPage() {
  const { user } = useAuth();
  // `?with=<userId>` opens straight to that conversation — where "Sent" in a
  // toast links to. `?user=` too: the profile page's Message button has always
  // linked that way, and until now it opened an empty inbox.
  const [selectedUserId, setSelectedUserId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    return params.get("with") ?? params.get("user");
  });
  const [searchQuery, setSearchQuery] = useState("");

  const { data: conversations = [], isLoading } = useQuery<Conversation[]>({
    queryKey: ["/api/messages/conversations"],
    refetchInterval: 5000,
  });

  if (!user) return null;

  return (
    <div className="flex h-full" data-testid="page-messages">
      <div className="w-80 flex-shrink-0 border-r border-border bg-background">
        <ConversationList
          conversations={conversations}
          isLoading={isLoading}
          selectedUserId={selectedUserId}
          onSelect={setSelectedUserId}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />
      </div>

      <div className="flex-1 bg-background">
        {selectedUserId ? (
          // Keyed by the person: the draft and scroll state belong to one
          // conversation, and without a remount switching people carried a
          // half-typed message over to someone else, one Enter from being sent.
          <ChatPanel key={selectedUserId} userId={selectedUserId} currentUserId={user.id} onBlocked={() => setSelectedUserId(null)} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <MessageSquare className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-1" data-testid="text-no-chat-selected">Select a conversation</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Choose a conversation from the list, or start a new one with anybody you're
              connected to.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
