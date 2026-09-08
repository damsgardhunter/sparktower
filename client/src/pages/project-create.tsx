import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation, Link } from "wouter";
import { useEntitlements } from "@/hooks/use-entitlements";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ChatComposer } from "@/components/chat-composer";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Send,
  Sparkles,
  Cpu,
  Users,
  Clock,
  FolderOpen,
  Globe,
  Upload,
  X,
  ImageIcon,
  UserPlus,
  Target,
  Rocket,
  Lock,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { SiGithub } from "react-icons/si";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import type { Project } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { useUpload } from "@/hooks/use-upload";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const CATEGORIES = [
  "Web App",
  "Mobile App",
  "AI/ML",
  "SaaS",
  "Fintech",
  "Sustainability",
  "IoT",
  "Design",
  "Data Analytics",
  "Marketing",
  "E-Commerce",
  "Education",
  "Healthcare",
  "Social Media",
  "Gaming",
  "Blockchain",
  "Content Creation",
  "DevOps",
  "Research",
  "Nonprofit",
  "Other",
];

const AVAILABLE_ROLES = [
  "Frontend Developer",
  "Backend Developer",
  "Full Stack Developer",
  "UI/UX Designer",
  "Graphic Designer",
  "Product Manager",
  "Project Manager",
  "Data Analyst",
  "Data Scientist",
  "ML Engineer",
  "DevOps Engineer",
  "QA Tester",
  "Technical Writer",
  "Content Creator",
  "Marketing Specialist",
  "Business Analyst",
  "Community Manager",
  "Mobile Developer",
  "Game Developer",
  "Security Engineer",
  "Cloud Architect",
  "Video Editor",
  "Illustrator",
  "Copywriter",
  "SEO Specialist",
  "Growth Hacker",
  "Researcher",
  "Legal Advisor",
  "Financial Analyst",
];

function NovaAvatar({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizeMap = { sm: "h-8 w-8", md: "h-10 w-10", lg: "h-16 w-16" };
  return (
    <div className={`relative ${sizeMap[size]} rounded-lg flex items-center justify-center`}>
      <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-green-400 via-emerald-500 to-purple-500 animate-pulse opacity-60 blur-sm" />
      <div className="relative rounded-lg bg-gradient-to-br from-green-400 via-emerald-500 to-purple-500 flex items-center justify-center w-full h-full">
        <Cpu className={size === "lg" ? "h-7 w-7 text-white" : "h-4 w-4 text-white"} />
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

function FormattedMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        ul: ({ children }) => <ul className="list-disc ml-4 mb-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal ml-4 mb-1">{children}</ol>,
        li: ({ children }) => <li className="mb-0.5">{children}</li>,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline">
            {children}
          </a>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function ReadinessItem({ label, done }: { label: string; done: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <div className={`h-4 w-4 rounded-full flex items-center justify-center ${done ? "bg-emerald-500 text-white" : "border border-muted-foreground/30"}`}>
        {done && <Target className="h-2.5 w-2.5" />}
      </div>
      <span className={done ? "text-foreground" : "text-muted-foreground"}>{label}</span>
    </div>
  );
}

export default function ProjectCreate() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { canCreatePrivateProject, privateProjectLimit } = useEntitlements();
  const [showIntro, setShowIntro] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [roleSelectKey, setRoleSelectKey] = useState(0);
  const [uploadedImages, setUploadedImages] = useState<{ path: string; preview: string }[]>([]);
  const [projectData, setProjectData] = useState<Partial<Project>>({
    title: "",
    description: "",
    category: "",
    rolesNeeded: [],
    techStack: [],
    teamSize: 1,
    estimatedWeeks: 4,
    status: "planning",
    repoUrl: "",
    liveUrl: "",
    soloMode: false,
  });

  const soloMode = !!projectData.soloMode;

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { uploadFile, isUploading } = useUpload({
    onSuccess: (response) => {
      const publicUrl = response.objectPath;
      setUploadedImages((prev) => [...prev, { path: response.objectPath, preview: publicUrl }]);
      toast({ title: "Image uploaded" });
    },
    onError: (error) => {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
  });

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
            "Hey! I'm Nova, your AI project partner. \u{1F680} I'm here to help you shape your idea into a real project plan.\n\nWhat kind of project are you thinking about building?",
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
        setProjectData((prev) => {
          const updates = { ...data.projectUpdates };
          // Nova doesn't know about Solo Builder Mode, so don't let it
          // reintroduce roles or a bigger team behind the user's back.
          if (prev.soloMode) {
            delete updates.rolesNeeded;
            delete updates.teamSize;
          }
          return { ...prev, ...updates };
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
    },
    onError: (error: any) => {
      const errorMsg = error.message || "";
      if (errorMsg.includes("403") || errorMsg.includes("Insufficient credits")) {
        toast({
          title: "Out of AI credits",
          description: "You've used all your AI credits for this month. Upgrade your plan for more!",
          variant: "destructive",
        });
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "It looks like you've run out of AI credits for this month. Head to the **Pricing** page to upgrade your plan and continue our conversation! 🚀" },
        ]);
      } else {
        toast({ title: "Chat error", description: "Failed to send message. Please try again.", variant: "destructive" });
      }
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: Partial<Project>) => {
      const payload = {
        ...data,
        mediaUrls: uploadedImages.map((img) => img.preview),
      };
      const res = await apiRequest("POST", "/api/projects", payload);
      return res.json();
    },
    onSuccess: (project) => {
      toast({
        title: "Project created!",
        description: "Your project has been successfully created.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setLocation(`/projects/${project.id}/manage`);
    },
  });

  const handleSend = () => {
    if (!input.trim() || chatMutation.isPending) return;
    const userMsg = input.trim();
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setInput("");
    chatMutation.mutate(userMsg);
  };

  /**
   * Solo Builder Mode is mutually exclusive with recruiting: turning it on
   * clears any roles already picked and forces the team back down to just the
   * owner. Uses a functional update so it can't be clobbered by a Nova reply
   * landing at the same time (see chatMutation.onSuccess).
   */
  const handleSoloModeChange = (checked: boolean) => {
    setProjectData((prev) => ({
      ...prev,
      soloMode: checked,
      ...(checked ? { teamSize: 1, rolesNeeded: [] } : {}),
    }));
    // The role Select is keyed; bump it so a stale selection doesn't linger.
    if (checked) setRoleSelectKey((k) => k + 1);
  };

  const handleAddRole = (role: string) => {
    if (projectData.rolesNeeded?.includes(role)) return;
    setProjectData((prev) => ({
      ...prev,
      rolesNeeded: [...(prev.rolesNeeded || []), role],
    }));
    setRoleSelectKey((k) => k + 1);
  };

  const handleRemoveRole = (role: string) => {
    setProjectData((prev) => ({
      ...prev,
      rolesNeeded: (prev.rolesNeeded || []).filter((r) => r !== role),
    }));
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) {
        toast({ title: "Only images are supported", variant: "destructive" });
        continue;
      }
      await uploadFile(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleRemoveImage = (index: number) => {
    setUploadedImages((prev) => prev.filter((_, i) => i !== index));
  };

  const filledFields = [
    projectData.title,
    projectData.description,
    projectData.category,
    // Solo builders never fill roles, so the counter would be stuck at 4/5.
    soloMode || (projectData.rolesNeeded && projectData.rolesNeeded.length > 0),
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
                    <FormattedMessage content={msg.content} />
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
          {/* items-end so the send button stays level with the last line as
              the composer grows, rather than floating in the middle. */}
          <div className="flex gap-2 items-end">
            <ChatComposer
              placeholder="Tell Nova about your project idea..."
              value={input}
              onChange={setInput}
              onSubmit={handleSend}
              disabled={showIntro}
              testId="input-chat-project"
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
          <p className="text-[11px] text-muted-foreground mt-1.5 px-1">
            Enter to send · Shift+Enter for a new line
          </p>
        </div>
      </div>

      <div className="w-[420px] flex flex-col bg-background">
        <header className="p-4 border-b border-border flex items-center justify-between">
          <span className="font-semibold">Project Preview</span>
          <span className="text-xs text-muted-foreground">{filledFields}/5 fields</span>
        </header>
        <div className="flex-1 p-5 space-y-4 overflow-y-auto">
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
                  <Select
                    value={projectData.category || ""}
                    onValueChange={(val) => setProjectData({ ...projectData, category: val })}
                  >
                    <SelectTrigger className="mt-1" data-testid="select-project-category">
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((cat) => (
                        <SelectItem key={cat} value={cat} data-testid={`select-category-${cat.toLowerCase().replace(/[/ ]/g, "-")}`}>
                          {cat}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1 mb-2">
                    <Rocket className="h-3 w-3" /> Solo Builder Mode
                  </label>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={soloMode}
                      onCheckedChange={handleSoloModeChange}
                      data-testid="switch-solo-mode"
                    />
                    <span className="text-xs text-muted-foreground">
                      {soloMode ? "Building solo" : "Team project"}
                    </span>
                    {soloMode && (
                      <Badge variant="outline" className="text-xs border-primary/30 text-primary">Solo Builder</Badge>
                    )}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1 mb-2">
                    <Lock className="h-3 w-3" /> Private Project
                  </label>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={!!(projectData as any).isPrivate}
                      disabled={!canCreatePrivateProject && !(projectData as any).isPrivate}
                      onCheckedChange={(checked) => setProjectData({ ...projectData, isPrivate: checked } as any)}
                      data-testid="switch-private-project"
                    />
                    <span className="text-xs text-muted-foreground">
                      {(projectData as any).isPrivate ? "Hidden from Discover" : "Visible to everyone"}
                    </span>
                  </div>
                  {!canCreatePrivateProject && !(projectData as any).isPrivate && (
                    <p className="text-xs text-muted-foreground mt-1.5">
                      {privateProjectLimit === 0 ? (
                        <>Private projects are on <Link href="/pricing" className="text-primary hover:underline">Starter and above</Link>.</>
                      ) : (
                        <>You've used all {privateProjectLimit} private projects. <Link href="/pricing" className="text-primary hover:underline">Builder</Link> makes them unlimited.</>
                      )}
                    </p>
                  )}
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
                    disabled={soloMode}
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
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                  <UserPlus className="h-3 w-3" /> Roles Needed
                </label>
                {soloMode ? (
                  <p className="text-xs text-muted-foreground mt-1.5" data-testid="text-solo-roles-note">
                    You're in Solo Builder Mode — no roles needed. Turn it off to recruit teammates.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-1 mt-1 min-h-[28px]">
                      {projectData.rolesNeeded?.map((role) => (
                        <Badge key={role} variant="outline" className="text-xs flex items-center gap-1 border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
                          {role}
                          <button
                            onClick={() => handleRemoveRole(role)}
                            className="ml-0.5"
                            data-testid={`button-remove-role-${role.replace(/\s/g, "-")}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                    <Select
                      key={roleSelectKey}
                      onValueChange={(val) => handleAddRole(val)}
                    >
                      <SelectTrigger className="mt-2 text-xs h-8" data-testid="select-roles-needed">
                        <SelectValue placeholder="Select a role to add..." />
                      </SelectTrigger>
                      <SelectContent>
                        {AVAILABLE_ROLES.filter((r) => !projectData.rolesNeeded?.includes(r)).map((role) => (
                          <SelectItem key={role} value={role} data-testid={`select-role-${role.replace(/\s/g, "-").toLowerCase()}`}>
                            {role}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                  <Sparkles className="h-3 w-3" /> Tech Stack
                </label>
                <div className="flex flex-wrap gap-1 mt-1 min-h-[28px]">
                  {(projectData.techStack || []).map((tech) => (
                    <Badge key={tech} variant="outline" className="text-xs flex items-center gap-1 border-purple-500/30 text-purple-600 dark:text-purple-400" data-testid={`badge-tech-${tech}`}>
                      {tech}
                      <button
                        onClick={() => setProjectData((prev) => ({
                          ...prev,
                          techStack: (prev.techStack || []).filter((t) => t !== tech),
                        }))}
                        className="ml-0.5"
                        data-testid={`button-remove-tech-${tech}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
                <Input
                  placeholder="Type a technology and press Enter..."
                  className="mt-2 text-xs h-8"
                  data-testid="input-tech-stack"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const val = e.currentTarget.value.trim();
                      if (val && !(projectData.techStack || []).includes(val)) {
                        setProjectData((prev) => ({
                          ...prev,
                          techStack: [...(prev.techStack || []), val],
                        }));
                        e.currentTarget.value = "";
                      }
                    }
                  }}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border overflow-hidden">
            <CardContent className="p-4 space-y-3">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <ImageIcon className="h-3 w-3" /> Project Images
              </label>
              {uploadedImages.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {uploadedImages.map((img, i) => (
                    <div key={i} className="relative group aspect-square rounded-lg overflow-hidden border border-border">
                      <img src={img.preview} alt="" className="w-full h-full object-cover" />
                      <button
                        onClick={() => handleRemoveImage(i)}
                        className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                        data-testid={`button-remove-image-${i}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="w-full border-2 border-dashed border-border rounded-lg p-4 flex flex-col items-center gap-2 text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors cursor-pointer disabled:opacity-50"
                data-testid="button-upload-image"
              >
                {isUploading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Upload className="h-5 w-5" />
                )}
                <span className="text-xs">{isUploading ? "Uploading..." : "Click to upload images"}</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
            </CardContent>
          </Card>

          <Card className="border-border overflow-hidden">
            <CardContent className="p-4 space-y-3">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Integrations</label>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <SiGithub className="h-4 w-4 text-muted-foreground shrink-0" />
                  <Input
                    value={projectData.repoUrl || ""}
                    onChange={(e) => setProjectData({ ...projectData, repoUrl: e.target.value })}
                    placeholder="https://github.com/user/repo"
                    className="text-xs h-8"
                    data-testid="input-github-url"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                  <Input
                    value={projectData.liveUrl || ""}
                    onChange={(e) => setProjectData({ ...projectData, liveUrl: e.target.value })}
                    placeholder="Live demo, Replit, or Colab link"
                    className="text-xs h-8"
                    data-testid="input-live-url"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {projectData.title && projectData.description && (
            <Card className="border-emerald-500/20 bg-emerald-500/5 overflow-hidden">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Rocket className="h-4 w-4 text-emerald-500" />
                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Project Readiness</span>
                </div>
                <div className="space-y-2">
                  <ReadinessItem label="Title & Description" done={!!(projectData.title && projectData.description)} />
                  <ReadinessItem label="Category Selected" done={!!projectData.category} />
                  {/* Solo Builder Mode is itself an answer to "what roles do
                      you need?" — nobody. Counts as done. */}
                  <ReadinessItem
                    label={soloMode ? "Roles Identified (solo)" : "Roles Identified"}
                    done={soloMode || !!(projectData.rolesNeeded && projectData.rolesNeeded.length > 0)}
                  />
                  <ReadinessItem label="Timeline Estimated" done={!!(projectData.estimatedWeeks && projectData.estimatedWeeks > 0)} />
                  <ReadinessItem label="Tech Stack" done={!!(projectData.techStack && projectData.techStack.length > 0)} />
                  <ReadinessItem label="Links Added" done={!!(projectData.repoUrl || projectData.liveUrl)} />
                </div>
                <p className="text-xs text-muted-foreground italic mt-2" data-testid="text-motivation">
                  Every great product started as an idea. You're already ahead by planning it out.
                </p>
              </CardContent>
            </Card>
          )}

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
