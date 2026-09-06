import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Cpu, Send, X, Loader2, CheckCircle2, ListTodo, Milestone, FileEdit, Sparkles, ChevronDown, MessageSquare, Pencil } from "lucide-react";

interface NovaMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  actionsTaken?: any[];
  createdAt: string;
}

interface NovaAction {
  type: string;
  data: any;
}

interface NovaGuideProps {
  projectId: string;
  currentTab: string;
  project: any;
  onProjectUpdate?: () => void;
}

const TAB_SUGGESTIONS: Record<string, string[]> = {
  setup: ["Help me write my project brief", "Define my target customer", "What should my one-liner be?"],
  kanban: ["Create starter tasks for my project", "What should I work on first?", "Help me prioritize my backlog"],
  milestones: ["Help me plan my roadmap", "What milestones should I set?", "Break down my timeline"],
  team: ["What roles do I need to hire?", "Help me write a job description", "How should I structure my team?"],
  files: ["What documents should I create?", "Help me organize my files"],
  activity: ["Summarize recent activity", "What decisions need to be made?"],
  personas: ["Help me create user personas", "Who is my ideal customer?"],
  research: ["Plan my user interviews", "Design an experiment to test my idea"],
  strategy: ["Help me set pricing", "What legal docs do I need?", "Review my business model"],
  launch: ["Create my launch checklist", "Write landing page copy", "Plan my go-to-market strategy"],
  analytics: ["What metrics should I track?", "Help me define KPIs", "Set up activation events"],
  support: ["Set up my support workflow", "What FAQs should I prepare?"],
  chat: ["How can I improve team communication?"],
};

const WELCOME_MESSAGE = `🚀 **Starting a new business or project can be scary, but you are now not alone!**

I'm **Nova**, your AI project partner, and I'm here to walk you through everything you need to bring your idea to life. ✨

I can help you:
- 📝 **Define your vision** — one-liner, value proposition, target customer
- 🎯 **Plan your project** — scope, tasks, milestones, and roadmap
- 💼 **Build your business profile** — strategy, pricing, legal basics
- 🚀 **Prepare for launch** — checklist, landing page, go-to-market plan

Let's start by getting to know your project better. **What would you like to focus on first?**`;

const QUICK_REPLIES = [
  { label: "📝 Build my project brief", message: "Help me build out my project brief — one-liner, value proposition, target customer, and problem statement." },
  { label: "🎯 Create a business plan", message: "Help me create a business plan for my project. Walk me through the key sections." },
  { label: "📋 Set up starter tasks", message: "Create some starter tasks to help me get going on my project." },
  { label: "🚀 Help me get started", message: "I'm new to this. Walk me through everything I need to get started step by step." },
];

function ActionCard({ action }: { action: NovaAction }) {
  const icons: Record<string, any> = {
    update_project: FileEdit,
    update_scope: FileEdit,
    create_tasks: ListTodo,
    create_milestones: Milestone,
    edit_project: Pencil,
    complete_onboarding: CheckCircle2,
  };
  const labels: Record<string, string> = {
    update_project: "Updated Project",
    update_scope: "Updated Scope",
    create_tasks: "Created Tasks",
    create_milestones: "Created Milestones",
    edit_project: "Edited Your Project",
    complete_onboarding: "Setup Complete",
  };
  const Icon = icons[action.type] || Sparkles;
  const label = labels[action.type] || action.type;

  let details = "";
  if (action.type === "update_project") {
    details = Object.keys(action.data).join(", ");
  } else if (action.type === "create_tasks") {
    details = `${action.data.count} tasks: ${(action.data.tasks || []).join(", ")}`;
  } else if (action.type === "create_milestones") {
    if (action.data.error) {
      details = "Premium required";
    } else {
      details = `${action.data.count} milestones: ${(action.data.milestones || []).join(", ")}`;
    }
  } else if (action.type === "edit_project") {
    // Nova returns a sentence per change; showing them is the only way the
    // user can tell what it actually touched.
    details = (action.data.changes || []).map((c: any) => c.description).join(" · ");
  } else if (action.type === "update_scope") {
    const mvp = action.data.mvp?.length || 0;
    const nth = action.data.niceToHave?.length || 0;
    details = `${mvp} MVP features, ${nth} nice-to-haves`;
  }

  return (
    <div className="flex items-start gap-2 bg-primary/10 border border-primary/20 rounded-lg p-2.5 my-2" data-testid={`nova-action-${action.type}`}>
      <Icon className="h-4 w-4 text-primary mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-primary">{label}</p>
        {details && <p className="text-xs text-muted-foreground truncate">{details}</p>}
      </div>
    </div>
  );
}

function formatMessage(content: string): string {
  return content
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n- /g, '\n• ')
    .replace(/\n/g, '<br/>');
}

function ChatMessages({ messages, isLoading }: { messages: NovaMessage[]; isLoading: boolean }) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.map((msg) => (
        <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
          {msg.role === "assistant" && (
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Cpu className="h-4 w-4 text-primary" />
            </div>
          )}
          <div className={`max-w-[80%] ${msg.role === "user" ? "order-first" : ""}`}>
            <div
              className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-md"
                  : "bg-muted rounded-bl-md"
              }`}
              dangerouslySetInnerHTML={{ __html: formatMessage(msg.content) }}
              data-testid={`nova-message-${msg.role}`}
            />
            {msg.role === "assistant" && msg.actionsTaken && msg.actionsTaken.length > 0 && (
              <div className="mt-1 space-y-1">
                {msg.actionsTaken.map((action: NovaAction, i: number) => (
                  <ActionCard key={i} action={action} />
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
      {isLoading && (
        <div className="flex gap-3 justify-start">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Cpu className="h-4 w-4 text-primary" />
          </div>
          <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Nova is thinking...
            </div>
          </div>
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}

export function NovaGuide({ projectId, currentTab, project, onProjectUpdate }: NovaGuideProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [isWidgetOpen, setIsWidgetOpen] = useState(false);
  const [localMessages, setLocalMessages] = useState<NovaMessage[]>([]);
  const [hasInitialized, setHasInitialized] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onboardingComplete = project?.novaOnboardingComplete ?? false;

  const { data: serverMessages, isLoading: messagesLoading } = useQuery<NovaMessage[]>({
    queryKey: ["/api/projects", projectId, "nova-guide"],
    enabled: !!projectId,
  });

  useEffect(() => {
    if (serverMessages === undefined) return;
    if (hasInitialized) {
      if (serverMessages.length > 0) {
        setLocalMessages(serverMessages);
      }
      return;
    }

    if (serverMessages.length === 0 && !onboardingComplete) {
      setIsOnboarding(true);
      const welcomeMsg: NovaMessage = {
        id: "welcome",
        role: "assistant",
        content: WELCOME_MESSAGE,
        actionsTaken: [],
        createdAt: new Date().toISOString(),
      };
      setLocalMessages([welcomeMsg]);
    } else if (serverMessages.length > 0 && !onboardingComplete) {
      setIsOnboarding(true);
      setLocalMessages(serverMessages);
    } else {
      setLocalMessages(serverMessages);
    }
    setHasInitialized(true);
  }, [serverMessages, hasInitialized, onboardingComplete]);

  const sendMutation = useMutation({
    mutationFn: async (message: string) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/nova-guide`, {
        message,
        currentTab,
      });
      return res.json();
    },
    onSuccess: (data) => {
      const assistantMsg: NovaMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: data.reply,
        actionsTaken: data.actionsTaken,
        createdAt: new Date().toISOString(),
      };
      setLocalMessages(prev => [...prev, assistantMsg]);
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "nova-guide"] });
      if (data.actionsTaken?.length > 0) {
        onProjectUpdate?.();
        queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
        for (const action of data.actionsTaken) {
          if (action.type === "create_tasks") {
            queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "kanban"] });
          }
          if (action.type === "create_milestones") {
            queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "milestones"] });
          }
          if (action.type === "edit_project") {
            // An edit can span tasks, milestones and the roadmap in one go, so
            // refresh all three rather than inferring from the change list.
            for (const key of ["kanban", "milestones", "roadmap", "activity"]) {
              queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, key] });
            }
          }
          if (action.type === "complete_onboarding") {
            setIsOnboarding(false);
          }
        }
        toast({ title: "Nova updated your project", description: `${data.actionsTaken.length} action(s) taken` });
      }
    },
    onError: (error: any) => {
      const errMsg = error?.message || "Failed to get Nova's response";
      if (errMsg.includes("Insufficient credits")) {
        toast({ title: "Out of AI credits", description: "Upgrade your plan for more credits", variant: "destructive" });
      } else {
        toast({ title: "Nova couldn't respond", description: errMsg, variant: "destructive" });
      }
    },
  });

  const handleSend = useCallback((messageText?: string) => {
    const text = (messageText || input).trim();
    if (!text || sendMutation.isPending) return;

    const userMsg: NovaMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
      actionsTaken: [],
      createdAt: new Date().toISOString(),
    };
    setLocalMessages(prev => [...prev, userMsg]);
    setInput("");
    sendMutation.mutate(text);
  }, [input, sendMutation]);

  const handleCompleteOnboarding = async () => {
    try {
      await apiRequest("POST", `/api/projects/${projectId}/nova-guide/complete-onboarding`);
      setIsOnboarding(false);
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      toast({ title: "Onboarding complete!", description: "Nova is now available as a widget anytime you need help." });
    } catch {
      toast({ title: "Failed to complete onboarding", variant: "destructive" });
    }
  };

  const suggestions = TAB_SUGGESTIONS[currentTab] || TAB_SUGGESTIONS.setup;
  const showQuickReplies = localMessages.length <= 1 && isOnboarding;

  if (isOnboarding) {
    return (
      <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4" data-testid="nova-onboarding-overlay">
        <div className="w-full max-w-2xl h-[80vh] bg-background border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-primary/5">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                <Cpu className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Nova AI Guide</h3>
                <p className="text-xs text-muted-foreground">Your project partner</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCompleteOnboarding}
                data-testid="btn-skip-onboarding"
              >
                Skip Setup
              </Button>
            </div>
          </div>

          <ChatMessages messages={localMessages} isLoading={sendMutation.isPending} />

          {showQuickReplies && (
            <div className="px-4 pb-2 flex flex-wrap gap-2">
              {QUICK_REPLIES.map((qr, i) => (
                <Button
                  key={i}
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => handleSend(qr.message)}
                  disabled={sendMutation.isPending}
                  data-testid={`quick-reply-${i}`}
                >
                  {qr.label}
                </Button>
              ))}
            </div>
          )}

          <div className="px-4 pb-4 pt-2 border-t border-border">
            <form
              onSubmit={(e) => { e.preventDefault(); handleSend(); }}
              className="flex gap-2"
            >
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask Nova anything about your project..."
                disabled={sendMutation.isPending}
                data-testid="input-nova-message"
                className="flex-1"
              />
              <Button
                type="submit"
                size="icon"
                disabled={!input.trim() || sendMutation.isPending}
                data-testid="btn-send-nova"
              >
                {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </form>
            <div className="flex items-center justify-between mt-2">
              <p className="text-[10px] text-muted-foreground">1 credit per message</p>
              <Button variant="link" size="sm" className="text-[10px] h-auto p-0" onClick={handleCompleteOnboarding} data-testid="btn-complete-onboarding">
                I'm done, let me explore on my own →
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {!isWidgetOpen && (
        <button
          onClick={() => setIsWidgetOpen(true)}
          className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl transition-all hover:scale-105 flex items-center justify-center group"
          data-testid="btn-nova-widget"
        >
          <Cpu className="h-6 w-6" />
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-background" />
        </button>
      )}

      {isWidgetOpen && (
        <div className="fixed bottom-6 right-6 z-50 w-[400px] h-[560px] bg-background border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden" data-testid="nova-widget-panel">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-primary/5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Cpu className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Nova</h3>
                <p className="text-[10px] text-muted-foreground capitalize">Helping with: {currentTab}</p>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsWidgetOpen(false)} data-testid="btn-close-widget">
              <ChevronDown className="h-4 w-4" />
            </Button>
          </div>

          <ChatMessages messages={localMessages} isLoading={sendMutation.isPending} />

          {localMessages.length <= 1 && (
            <div className="px-3 pb-2 flex flex-wrap gap-1.5">
              {suggestions.map((s, i) => (
                <Button
                  key={i}
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => handleSend(s)}
                  disabled={sendMutation.isPending}
                  data-testid={`widget-suggestion-${i}`}
                >
                  {s}
                </Button>
              ))}
            </div>
          )}

          <div className="px-3 pb-3 pt-2 border-t border-border">
            <form
              onSubmit={(e) => { e.preventDefault(); handleSend(); }}
              className="flex gap-2"
            >
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask Nova..."
                disabled={sendMutation.isPending}
                data-testid="input-nova-widget"
                className="flex-1 h-9 text-sm"
              />
              <Button
                type="submit"
                size="icon"
                className="h-9 w-9"
                disabled={!input.trim() || sendMutation.isPending}
                data-testid="btn-send-widget"
              >
                {sendMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              </Button>
            </form>
            <p className="text-[10px] text-muted-foreground mt-1.5 text-center">1 credit per message • Nova can update your project</p>
          </div>
        </div>
      )}
    </>
  );
}
