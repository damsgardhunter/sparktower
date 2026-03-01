import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Send, MessageSquare, Search, Check, CheckCheck } from "lucide-react";
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
  const filtered = conversations.filter((c) => {
    if (!searchQuery) return true;
    const name = `${c.user.firstName || ""} ${c.user.lastName || ""}`.toLowerCase();
    return name.includes(searchQuery.toLowerCase());
  });

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <h2 className="text-lg font-semibold mb-3" data-testid="text-messages-title">Messages</h2>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9"
            data-testid="input-search-conversations"
          />
        </div>
      </div>
      <ScrollArea className="flex-1">
        {isLoading ? (
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
            <p className="text-xs text-muted-foreground mt-1">
              Start a conversation from a user's profile
            </p>
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
}: {
  userId: string;
  currentUserId: string;
}) {
  const [message, setMessage] = useState("");
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
      const res = await apiRequest("POST", `/api/messages/${userId}`, { content });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages", userId] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages/conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages/unread-count"] });
      setMessage("");
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
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
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
          <ChatPanel userId={selectedUserId} currentUserId={user.id} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <MessageSquare className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-1" data-testid="text-no-chat-selected">Select a conversation</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Choose a conversation from the list or start a new one from a user's profile page
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
