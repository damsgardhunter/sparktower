import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, Sparkles } from "lucide-react";
import type { Project } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function ProjectCreate() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Hi! I'm your SparkTower AI assistant. I'll help you define your project. What's the main idea behind your project?",
    },
  ]);
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

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Chat Panel */}
      <div className="flex-1 flex flex-col border-r border-border bg-muted/30">
        <header className="p-4 border-b border-border bg-background flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">AI Project Assistant</h2>
        </header>
        <ScrollArea ref={scrollRef} className="flex-1 p-4">
          <div className="space-y-4">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[80%] rounded-lg p-3 ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-card text-card-foreground border border-border"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {chatMutation.isPending && (
              <div className="flex justify-start">
                <div className="bg-card border border-border rounded-lg p-3">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
        <div className="p-4 bg-background border-t border-border">
          <div className="flex gap-2">
            <Input
              placeholder="Tell me about your project..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              data-testid="input-chat-project"
            />
            <Button size="icon" onClick={handleSend} disabled={chatMutation.isPending} data-testid="button-send-chat">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Preview Panel */}
      <div className="w-[400px] flex flex-col bg-background">
        <header className="p-4 border-b border-border font-semibold">Project Details</header>
        <div className="flex-1 p-6 space-y-6 overflow-y-auto">
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-tertiary uppercase tracking-wider">Project Title</label>
              <Input
                value={projectData.title}
                onChange={(e) => setProjectData({ ...projectData, title: e.target.value })}
                placeholder="My Awesome Project"
                className="mt-1"
                data-testid="input-project-title"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-tertiary uppercase tracking-wider">Description</label>
              <Textarea
                value={projectData.description}
                onChange={(e) => setProjectData({ ...projectData, description: e.target.value })}
                placeholder="What are you building?"
                className="mt-1 min-h-[100px]"
                data-testid="textarea-project-description"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-tertiary uppercase tracking-wider">Category</label>
                <Input
                  value={projectData.category}
                  onChange={(e) => setProjectData({ ...projectData, category: e.target.value })}
                  placeholder="Web App"
                  className="mt-1"
                  data-testid="input-project-category"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-tertiary uppercase tracking-wider">Team Size</label>
                <Input
                  type="number"
                  value={projectData.teamSize ?? ""}
                  onChange={(e) => setProjectData({ ...projectData, teamSize: e.target.value ? parseInt(e.target.value) : 1 })}
                  className="mt-1"
                  data-testid="input-project-teamsize"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-tertiary uppercase tracking-wider">Tech Stack</label>
              <div className="flex flex-wrap gap-1 mt-1">
                {projectData.techStack?.map((tech) => (
                  <Badge key={tech} variant="secondary">
                    {tech}
                  </Badge>
                ))}
                {(!projectData.techStack || projectData.techStack.length === 0) && (
                  <span className="text-sm text-tertiary italic">Not defined yet</span>
                )}
              </div>
            </div>
          </div>

          <Button
            className="w-full"
            onClick={() => createMutation.mutate(projectData)}
            disabled={!projectData.title || !projectData.description || createMutation.isPending}
            data-testid="button-create-project"
          >
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Create Project
          </Button>
        </div>
      </div>
    </div>
  );
}
