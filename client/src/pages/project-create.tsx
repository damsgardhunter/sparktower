import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, Sparkles, Users, Clock, FolderOpen } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { Project } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

interface Message {
  role: "user" | "assistant";
  content: string;
}

function NovaAvatar({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizeMap = { sm: "h-8 w-8", md: "h-10 w-10", lg: "h-16 w-16" };
  return (
    <div className={`relative ${sizeMap[size]} rounded-full flex items-center justify-center`}>
      <div className="absolute inset-0 rounded-full bg-gradient-to-br from-green-400 via-emerald-500 to-purple-500 animate-pulse opacity-60 blur-sm" />
      <div className="relative rounded-full bg-gradient-to-br from-green-400 via-emerald-500 to-purple-500 flex items-center justify-center w-full h-full">
        <Sparkles className={size === "lg" ? "h-7 w-7 text-white" : "h-4 w-4 text-white"} />
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-3 py-2">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="h-2 w-2 rounded-full bg-emerald-400"
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 0.6, delay: i * 0.15, repeat: Infinity }}
        />
      ))}
    </div>
  );
}

export default function ProjectCreate() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [showIntro, setShowIntro] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [projectData, setProjectData] = useState<Partial<Project>>({
    title: "",
    description: "",
    category: "",
    techStack: [],
    teamSize: 1,
    estimatedWeeks: 4,
    status: "planning",
  });

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowIntro(false);
      setMessages([
        {
          role: "assistant",
          content:
            "Hey! I'm Nova, your AI project partner. I'm here to help you shape your idea into a real project plan.\n\nWhat kind of project are you thinking about building?",
        },
      ]);
    }, 2200);
    return () => clearTimeout(timer);
  }, []);

  const chatMutation = useMutation({
    mutationFn: async (message: string) => {
      const res = await apiRequest("POST", "/api/chat", {
        message,
        history: messages,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      if (data.projectUpdates) {
        setProjectData((prev) => ({ ...prev, ...data.projectUpdates }));
      }
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: Partial<Project>) => {
      const res = await apiRequest("POST", "/api/projects", data);
      return res.json();
    },
    onSuccess: (project) => {
      toast({
        title: "Project created!",
        description: "Your project has been successfully created.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setLocation(`/projects/${project.id}`);
    },
  });

  const handleSend = () => {
    if (!input.trim() || chatMutation.isPending) return;
    const userMsg = input.trim();
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setInput("");
    chatMutation.mutate(userMsg);
  };

  const filledFields = [
    projectData.title,
    projectData.description,
    projectData.category,
    projectData.techStack && projectData.techStack.length > 0,
  ].filter(Boolean).length;

  return (
    <div className="flex h-full w-full overflow-hidden">
      <div className="flex-1 flex flex-col border-r border-border bg-muted/30">
        <header className="p-4 border-b border-border bg-background flex items-center gap-3">
          <NovaAvatar size="sm" />
          <div>
            <h2 className="font-semibold text-sm">Nova</h2>
            <p className="text-xs text-muted-foreground">AI Project Partner</p>
          </div>
        </header>

        <ScrollArea ref={scrollRef} className="flex-1 p-4">
          <div className="space-y-4">
            <AnimatePresence>
              {showIntro && (
                <motion.div
                  className="flex flex-col items-center justify-center py-16 gap-4"
                  initial={{ opacity: 1 }}
                  exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.4 } }}
                >
                  <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.2 }}
                  >
                    <div className="relative">
                      <motion.div
                        className="absolute -inset-4 rounded-full bg-gradient-to-br from-green-400/30 to-purple-500/30 blur-xl"
                        animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0.8, 0.5] }}
                        transition={{ duration: 2, repeat: Infinity }}
                      />
                      <NovaAvatar size="lg" />
                    </div>
                  </motion.div>
                  <motion.p
                    className="text-lg font-medium text-foreground"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.8 }}
                  >
                    Initializing Nova...
                  </motion.p>
                  <motion.div
                    className="flex gap-1"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 1.2 }}
                  >
                    {[0, 1, 2].map((i) => (
                      <motion.div
                        key={i}
                        className="h-2 w-2 rounded-full bg-emerald-400"
                        animate={{ y: [0, -6, 0] }}
                        transition={{ duration: 0.6, delay: i * 0.15, repeat: Infinity }}
                      />
                    ))}
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {!showIntro &&
              messages.map((msg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {msg.role === "assistant" && <NovaAvatar size="sm" />}
                  <div
                    className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-md"
                        : "bg-gradient-to-br from-card to-muted border border-border rounded-bl-md"
                    }`}
                  >
                    {msg.content}
                  </div>
                </motion.div>
              ))}

            {chatMutation.isPending && !showIntro && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex gap-3 items-center"
              >
                <NovaAvatar size="sm" />
                <div className="bg-gradient-to-br from-card to-muted border border-border rounded-2xl rounded-bl-md">
                  <TypingIndicator />
                </div>
              </motion.div>
            )}
          </div>
        </ScrollArea>

        <div className="p-4 bg-background border-t border-border">
          <div className="flex gap-2">
            <Input
              placeholder="Tell Nova about your project idea..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              disabled={showIntro}
              className="rounded-full"
              data-testid="input-chat-project"
            />
            <Button
              size="icon"
              onClick={handleSend}
              disabled={chatMutation.isPending || showIntro}
              className="rounded-full shrink-0"
              data-testid="button-send-chat"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="w-[400px] flex flex-col bg-background">
        <header className="p-4 border-b border-border flex items-center justify-between">
          <span className="font-semibold">Project Preview</span>
          <span className="text-xs text-muted-foreground">{filledFields}/4 fields</span>
        </header>
        <div className="flex-1 p-6 space-y-6 overflow-y-auto">
          <Card className="border-border overflow-hidden">
            <div className="h-2 bg-gradient-to-r from-green-400 via-emerald-500 to-purple-500" />
            <CardContent className="p-4 space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Project Title</label>
                <Input
                  value={projectData.title || ""}
                  onChange={(e) => setProjectData({ ...projectData, title: e.target.value })}
                  placeholder="My Awesome Project"
                  className="mt-1"
                  data-testid="input-project-title"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Description</label>
                <Textarea
                  value={projectData.description || ""}
                  onChange={(e) => setProjectData({ ...projectData, description: e.target.value })}
                  placeholder="What are you building?"
                  className="mt-1 min-h-[80px]"
                  data-testid="textarea-project-description"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    <FolderOpen className="h-3 w-3" /> Category
                  </label>
                  <Input
                    value={projectData.category || ""}
                    onChange={(e) => setProjectData({ ...projectData, category: e.target.value })}
                    placeholder="Web App"
                    className="mt-1"
                    data-testid="input-project-category"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    <Users className="h-3 w-3" /> Team Size
                  </label>
                  <Input
                    type="number"
                    value={projectData.teamSize ?? ""}
                    onChange={(e) =>
                      setProjectData({ ...projectData, teamSize: e.target.value ? parseInt(e.target.value) : 1 })
                    }
                    className="mt-1"
                    data-testid="input-project-teamsize"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Estimated Weeks
                </label>
                <Input
                  type="number"
                  value={projectData.estimatedWeeks ?? ""}
                  onChange={(e) =>
                    setProjectData({ ...projectData, estimatedWeeks: e.target.value ? parseInt(e.target.value) : 4 })
                  }
                  className="mt-1"
                  data-testid="input-project-weeks"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Tech Stack</label>
                <div className="flex flex-wrap gap-1 mt-1 min-h-[28px]">
                  {projectData.techStack?.map((tech) => (
                    <Badge key={tech} variant="secondary" className="text-xs">
                      {tech}
                    </Badge>
                  ))}
                  {(!projectData.techStack || projectData.techStack.length === 0) && (
                    <span className="text-xs text-muted-foreground italic">Chat with Nova to define</span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Button
            className="w-full"
            onClick={() => createMutation.mutate(projectData)}
            disabled={!projectData.title || !projectData.description || createMutation.isPending}
            data-testid="button-create-project"
          >
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Create Project
          </Button>
        </div>
      </div>
    </div>
  );
}
