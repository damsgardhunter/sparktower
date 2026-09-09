import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/user-avatar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Loader2, ArrowLeft, Users, LayoutDashboard, Plus, Sparkles,
  Trash2, Calendar, Upload, FileText, UserPlus, Clock, AlertCircle,
  CheckCircle2, Circle, RotateCcw, Tag, Lock, ListChecks,
  Milestone as MilestoneIcon, Activity, MessageSquare, FolderOpen,
  Link2, ExternalLink, Flag, Target, Lightbulb, ChevronRight,
  GitBranch, Palette, BookOpen, HardDrive, StickyNote, Globe,
  BarChart3, AlertTriangle, CheckSquare, Square, X,
  Beaker, DollarSign, Shield, Rocket, Headphones, Crosshair,
  Eye, EyeOff, Map, Stethoscope, CalendarDays, CircleDot, Share2, Pencil, ListOrdered, ScanSearch,
  Image as ImageIcon,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { RoadmapTab } from "@/components/roadmap-tab";
import { NovaDashboard } from "@/components/nova-dashboard";
import { HealthCheckPanel } from "@/components/health-check-panel";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { useEntitlements } from "@/hooks/use-entitlements";
import {
  PROJECT_SECTIONS, sectionHasContent, isSectionEnabled,
  type ProjectSectionKey, type ProjectSectionDef,
} from "@shared/project-sections";
import { ResearchTab, StrategyTab, LaunchTab, AnalyticsTab, SupportTab } from "./pm-extended-tabs";
import { NovaGuide } from "@/components/nova-guide";
import { ProjectCalendar, TASK_DRAG_TYPE } from "@/components/project-calendar";
import { NovaTaskPlanner } from "@/components/nova-task-planner";
import { DocumentStartDialog, looksLikeDocumentTask } from "@/components/document-start-dialog";
import { CodebaseTab } from "@/components/codebase-tab";
import { NovaActionButton } from "@/components/nova-action-button";
import { NovaHandoffProvider, useNovaHandoffPending } from "@/components/nova-handoff";
import { BackingSetup } from "@/components/backing-setup";
import { CheckInList } from "@/components/check-in-list";
import { ImageUploadField } from "@/components/image-upload-field";
import { type NovaHandoff } from "@shared/nova-handoff";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type {
  Project, ProjectMember, UserProfile, User, ProjectKanbanTask,
  ProjectPersona, ProjectMilestone, ProjectFile, ProjectLink, ProjectDocument,
  ProjectDecision, ProjectCheckIn, ProjectActivityLog,
} from "@shared/schema";
import { CREDIT_COSTS } from "@shared/plans";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useUpload } from "@/hooks/use-upload";

type TabId = "nova" | "setup" | "public" | "roadmap" | "kanban" | "milestones" | "team" | "files" | "activity" | "personas" | "chat" | "research" | "strategy" | "launch" | "analytics" | "support" | "codebase";

const KANBAN_COLUMNS = [
  { id: "todo" as const, label: "To Do", icon: Circle, color: "text-muted-foreground" },
  { id: "in-progress" as const, label: "In Progress", icon: Clock, color: "text-blue-500" },
  { id: "review" as const, label: "Review", icon: AlertCircle, color: "text-yellow-500" },
  { id: "done" as const, label: "Done", icon: CheckCircle2, color: "text-green-500" },
];

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  high: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

const LINK_CATEGORIES = [
  { id: "repo", label: "Repository", icon: GitBranch },
  { id: "docs", label: "Documentation", icon: BookOpen },
  { id: "design", label: "Design", icon: Palette },
  { id: "drive", label: "Drive/Storage", icon: HardDrive },
  { id: "notes", label: "Meeting Notes", icon: StickyNote },
  { id: "other", label: "Other", icon: Globe },
];

const FILE_FOLDERS = ["general", "design", "docs", "data"];

const SUGGESTED_QUESTIONS = [
  "Why are you interested in this project?",
  "What relevant experience do you have?",
  "How many hours per week can you commit?",
  "Share a link to your portfolio or previous work.",
  "What skills will you bring to the team?",
  "Describe a challenge you solved in a similar project.",
  "What is your preferred communication style?",
  "What timezone are you in?",
];

interface ApplicationQuestion { id: string; question: string; required: boolean; }
interface Subtask { id: string; title: string; done: boolean; }

export default function ProjectManager() {
  const [, params] = useRoute("/projects/:id/manage");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const projectId = params?.id;

  const [activeTab, setActiveTab] = useState<TabId>("nova");
  /**
   * The job a Nova recommendation handed to a tab, held here because
   * navigating and handing over are one decision. The destination tab claims
   * it on arrival and clears it.
   */
  const [novaHandoff, setNovaHandoff] = useState<NovaHandoff | null>(null);
  const clearNovaHandoff = useCallback(() => setNovaHandoff(null), []);
  const novaHandoffValue = useMemo(
    () => ({ pending: novaHandoff, request: setNovaHandoff, clear: clearNovaHandoff }),
    [novaHandoff, clearNovaHandoff],
  );
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ProjectKanbanTask | null>(null);
  const [taskForm, setTaskForm] = useState({
    title: "", description: "", status: "todo" as string, priority: "medium" as string,
    assigneeId: "" as string, dueDate: "", tags: [] as string[], estimateHours: "",
    blockedByTaskId: "" as string, subtasks: [] as Subtask[], milestoneId: "" as string,
  });

  const { uploadFile, isUploading: isUploadingPlan } = useUpload({
    onSuccess: (response) => { businessPlanMutation.mutate(response.objectPath); },
    onError: () => { toast({ title: "Upload failed", variant: "destructive" }); },
  });

  const { uploadFile: uploadProjectFile, isUploading: isUploadingFile } = useUpload({
    onSuccess: (response) => {
      createFileMutation.mutate({ name: response.metadata.name, url: response.objectPath, fileType: response.metadata.contentType, size: response.metadata.size, folder: uploadFolder });
    },
    onError: () => { toast({ title: "Upload failed", variant: "destructive" }); },
  });
  const [uploadFolder, setUploadFolder] = useState("general");

  const { data: project, isLoading: projectLoading } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
    enabled: !!projectId,
  });

  const { data: members } = useQuery<(ProjectMember & { user: User; profile?: UserProfile })[]>({
    queryKey: ["/api/projects", projectId, "members"],
    enabled: !!projectId,
  });

  const { data: kanbanTasks, isLoading: tasksLoading } = useQuery<ProjectKanbanTask[]>({
    queryKey: ["/api/projects", projectId, "kanban"],
    enabled: !!projectId && activeTab === "kanban",
  });

  /**
   * Completion history, which outlives the board. Without it a cleared board
   * reads as "nothing ever finished" — to the user and to Nova.
   */
  const { data: taskHistory } = useQuery<{
    projectCompleted: number; projectOnTime: number; lastCompletedAt: string | null;
    builderCompletedAllTime: number;
    recent: { id: string; title: string; completedAt: string; onTime: boolean }[];
  }>({
    queryKey: ["/api/projects", projectId, "task-history"],
    enabled: !!projectId && activeTab === "kanban",
  });

  const { data: applications } = useQuery<any[]>({
    queryKey: ["/api/projects", projectId, "applications"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/applications`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectId && (activeTab === "team") && project?.ownerId === user?.id,
  });

  const { data: personas, isLoading: personasLoading } = useQuery<ProjectPersona[]>({
    queryKey: ["/api/projects", projectId, "personas"],
    enabled: !!projectId && activeTab === "personas",
  });

  const { data: milestones, isLoading: milestonesLoading } = useQuery<ProjectMilestone[]>({
    queryKey: ["/api/projects", projectId, "milestones"],
    // The kanban tab needs these too: task cards show which milestone they
    // serve, and the task form lets you pick one.
    enabled: !!projectId && (activeTab === "milestones" || activeTab === "setup" || activeTab === "kanban"),
  });

  const { data: activityLog } = useQuery<(ProjectActivityLog & { user?: User })[]>({
    queryKey: ["/api/projects", projectId, "activity"],
    enabled: !!projectId && activeTab === "activity",
  });

  const { data: decisions } = useQuery<(ProjectDecision & { user: User })[]>({
    queryKey: ["/api/projects", projectId, "decisions"],
    enabled: !!projectId && activeTab === "activity",
  });

  const { data: checkIns } = useQuery<(ProjectCheckIn & { user: User; profile?: UserProfile })[]>({
    queryKey: ["/api/projects", projectId, "check-ins"],
    enabled: !!projectId && activeTab === "activity",
  });

  const { data: projectFiles } = useQuery<(ProjectFile & { uploader: User })[]>({
    queryKey: ["/api/projects", projectId, "files"],
    enabled: !!projectId && activeTab === "files",
  });

  const { data: projectLinks } = useQuery<ProjectLink[]>({
    queryKey: ["/api/projects", projectId, "links"],
    enabled: !!projectId && (activeTab === "setup"),
  });

  const businessPlanMutation = useMutation({
    mutationFn: async (url: string) => { await apiRequest("POST", `/api/projects/${projectId}/business-plan`, { businessPlanUrl: url }); },
    onSuccess: () => { toast({ title: "Business plan uploaded" }); queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] }); },
  });

  const createTaskMutation = useMutation({
    mutationFn: async (data: any) => { const res = await apiRequest("POST", `/api/projects/${projectId}/kanban`, data); return res.json(); },
    onSuccess: () => { toast({ title: "Task created" }); invalidateTaskViews(); closeTaskDialog(); },
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ taskId, data }: { taskId: string; data: any }) => { const res = await apiRequest("PATCH", `/api/kanban/${taskId}`, data); return res.json(); },
    onSuccess: () => { invalidateTaskViews(); },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (taskId: string) => { await apiRequest("DELETE", `/api/kanban/${taskId}`); },
    onSuccess: () => { toast({ title: "Task deleted" }); invalidateTaskViews(); },
  });

  /**
   * The calendar is derived from tasks, so any change to the board has to
   * refresh both views — and reputation, since completing a task moves it.
   */
  function invalidateTaskViews() {
    queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "kanban"] });
    queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "calendar"] });
    queryClient.invalidateQueries({ queryKey: ["/api/reputation"] });
  }

  const clearTasksMutation = useMutation({
    mutationFn: async (onlyDone: boolean) => {
      const res = await apiRequest("DELETE", `/api/projects/${projectId}/kanban${onlyDone ? "?status=done" : ""}`);
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: `Cleared ${data.removed} task${data.removed === 1 ? "" : "s"}`,
        description: "Your execution credit was banked first — your reputation is unchanged.",
      });
      invalidateTaskViews();
    },
    onError: () => toast({ title: "Couldn't clear the board", variant: "destructive" }),
  });

  const shareTaskMutation = useMutation({
    mutationFn: async (taskTitle: string) => {
      const res = await apiRequest("POST", "/api/feed", {
        postType: "project_update",
        projectId,
        content: `Just finished: ${taskTitle} ✅`,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Shared to your feed", description: "Your win is on your profile." });
      queryClient.invalidateQueries({ queryKey: ["/api/feed"] });
    },
    onError: (err: any) => toast({ title: "Couldn't share that", description: err?.message || undefined, variant: "destructive" }),
  });

  const aiGenerateTasksMutation = useMutation({
    mutationFn: async () => { const res = await apiRequest("POST", `/api/projects/${projectId}/kanban/ai-generate`); return res.json(); },
    onSuccess: (data) => { toast({ title: "Tasks generated", description: `Nova created ${data.length} tasks.` }); invalidateTaskViews(); },
    onError: (error: any) => {
      const msg = error.message || "";
      if (msg.includes("403") || msg.includes("Insufficient")) toast({ title: "Insufficient credits", variant: "destructive" });
      else toast({ title: "Generation failed", variant: "destructive" });
    },
  });

  const [personaDialogOpen, setPersonaDialogOpen] = useState(false);
  const [personaForm, setPersonaForm] = useState({ name: "", age: "", occupation: "", bio: "", goals: "" as string, painPoints: "" as string, quote: "" });

  const createPersonaMutation = useMutation({
    mutationFn: async (data: any) => { const res = await apiRequest("POST", `/api/projects/${projectId}/personas`, data); return res.json(); },
    onSuccess: () => { toast({ title: "Persona created" }); queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "personas"] }); setPersonaDialogOpen(false); setPersonaForm({ name: "", age: "", occupation: "", bio: "", goals: "", painPoints: "", quote: "" }); },
  });

  const deletePersonaMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/personas/${id}`); },
    onSuccess: () => { toast({ title: "Persona deleted" }); queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "personas"] }); },
  });

  const aiGeneratePersonaMutation = useMutation({
    mutationFn: async () => { const res = await apiRequest("POST", `/api/projects/${projectId}/personas/generate`); return res.json(); },
    onSuccess: () => { toast({ title: "Persona generated by Nova AI" }); queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "personas"] }); },
    onError: (error: any) => {
      const msg = error.message || "";
      if (msg.includes("403") || msg.includes("Insufficient")) toast({ title: "Insufficient credits", variant: "destructive" });
      else toast({ title: "Generation failed", variant: "destructive" });
    },
  });

  const recommendPeopleMutation = useMutation({
    mutationFn: async () => { const res = await apiRequest("POST", `/api/projects/${projectId}/recommend-people`); return res.json(); },
    onSuccess: (data) => { toast({ title: "Recommendations ready", description: `Found ${data.recommendations?.length || 0} potential members.` }); },
    onError: (error: any) => {
      const msg = error.message || "";
      if (msg.includes("403") || msg.includes("Insufficient")) toast({ title: "Insufficient credits", variant: "destructive" });
      else toast({ title: "Recommendation failed", variant: "destructive" });
    },
  });

  /*
   * The hand-offs whose mutations live in this file rather than in a tab
   * component. Each tab already renders its own pending state — the kanban
   * board's generate button, the personas spinner, the team panel — so the
   * builder lands on the work in progress rather than on a finished toast.
   */
  useEffect(() => {
    if (!novaHandoff) return;
    const run: Partial<Record<NovaHandoff, () => void>> = {
      "kanban.generate": () => aiGenerateTasksMutation.mutate(),
      "personas.generate": () => aiGeneratePersonaMutation.mutate(),
      "team.recommendPeople": () => recommendPeopleMutation.mutate(),
    };
    const job = run[novaHandoff];
    if (!job) return;
    setNovaHandoff(null);
    job();
    // Only the pending job should re-trigger this; the mutations are stable.
  }, [novaHandoff]);

  const updateProjectMutation = useMutation({
    mutationFn: async (data: any) => { const res = await apiRequest("PATCH", `/api/projects/${projectId}`, data); return res.json(); },
    onSuccess: () => { toast({ title: "Project updated" }); queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] }); },
    onError: () => { toast({ title: "Failed to update", variant: "destructive" }); },
  });

  const createMilestoneMutation = useMutation({
    mutationFn: async (data: any) => { const res = await apiRequest("POST", `/api/projects/${projectId}/milestones`, data); return res.json(); },
    onSuccess: () => { toast({ title: "Milestone created" }); queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "milestones"] }); },
  });

  const updateMilestoneMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => { const res = await apiRequest("PATCH", `/api/milestones/${id}`, data); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "milestones"] }); },
  });

  const deleteMilestoneMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/milestones/${id}`); },
    onSuccess: () => { toast({ title: "Milestone deleted" }); queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "milestones"] }); },
  });

  const createDecisionMutation = useMutation({
    mutationFn: async (data: any) => { const res = await apiRequest("POST", `/api/projects/${projectId}/decisions`, data); return res.json(); },
    onSuccess: () => { toast({ title: "Decision logged" }); queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "decisions"] }); },
  });

  const updateDecisionMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => { const res = await apiRequest("PATCH", `/api/decisions/${id}`, data); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "decisions"] }); },
  });

  const deleteDecisionMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/decisions/${id}`); },
    onSuccess: () => { toast({ title: "Decision deleted" }); queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "decisions"] }); },
  });

  const createCheckInMutation = useMutation({
    mutationFn: async (data: any) => { const res = await apiRequest("POST", `/api/projects/${projectId}/check-ins`, data); return res.json(); },
    onSuccess: () => { toast({ title: "Check-in submitted" }); queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "check-ins"] }); },
  });

  const createFileMutation = useMutation({
    mutationFn: async (data: any) => { const res = await apiRequest("POST", `/api/projects/${projectId}/files`, data); return res.json(); },
    onSuccess: () => { toast({ title: "File uploaded" }); queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "files"] }); },
  });

  const deleteFileMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/files/${id}`); },
    onSuccess: () => { toast({ title: "File deleted" }); queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "files"] }); },
  });

  const createLinkMutation = useMutation({
    mutationFn: async (data: any) => { const res = await apiRequest("POST", `/api/projects/${projectId}/links`, data); return res.json(); },
    onSuccess: () => { toast({ title: "Link added" }); queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "links"] }); },
  });

  const deleteLinkMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/links/${id}`); },
    onSuccess: () => { toast({ title: "Link removed" }); queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "links"] }); },
  });

  const updateMemberMutation = useMutation({
    mutationFn: async ({ userId, data }: { userId: string; data: any }) => { const res = await apiRequest("PATCH", `/api/projects/${projectId}/members/${userId}`, data); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "members"] }); },
  });

  const aiSummarizeMutation = useMutation({
    mutationFn: async () => { const res = await apiRequest("POST", `/api/projects/${projectId}/ai/summarize-progress`); return res.json(); },
    onError: (error: any) => {
      const msg = error.message || "";
      if (msg.includes("403")) toast({ title: "Insufficient credits", variant: "destructive" });
      else toast({ title: "Summary failed", variant: "destructive" });
    },
  });

  const aiDetectGapsMutation = useMutation({
    mutationFn: async () => { const res = await apiRequest("POST", `/api/projects/${projectId}/ai/detect-gaps`); return res.json(); },
    onError: (error: any) => {
      const msg = error.message || "";
      if (msg.includes("403")) toast({ title: "Insufficient credits", variant: "destructive" });
      else toast({ title: "Gap detection failed", variant: "destructive" });
    },
  });

  function openNewTaskDialog(status: string = "todo") {
    setEditingTask(null);
    setTaskForm({ title: "", description: "", status, priority: "medium", assigneeId: "", dueDate: "", tags: [], estimateHours: "", blockedByTaskId: "", subtasks: [], milestoneId: "" });
    setTaskDialogOpen(true);
  }

  function openEditTaskDialog(task: ProjectKanbanTask) {
    setEditingTask(task);
    setTaskForm({
      title: task.title, description: task.description || "", status: task.status,
      priority: task.priority, assigneeId: task.assigneeId || "",
      dueDate: task.dueDate ? new Date(task.dueDate).toISOString().split("T")[0] : "",
      tags: (task.tags as string[]) || [], estimateHours: task.estimateHours?.toString() || "",
      blockedByTaskId: task.blockedByTaskId || "",
      subtasks: (task.subtasks as Subtask[]) || [],
      milestoneId: (task as any).milestoneId || "",
    });
    setTaskDialogOpen(true);
  }

  function closeTaskDialog() {
    setTaskDialogOpen(false);
    setEditingTask(null);
    setTaskForm({ title: "", description: "", status: "todo", priority: "medium", assigneeId: "", dueDate: "", tags: [], estimateHours: "", blockedByTaskId: "", subtasks: [], milestoneId: "" });
  }

  function handleTaskSubmit() {
    const data = {
      title: taskForm.title, description: taskForm.description || null,
      status: taskForm.status, priority: taskForm.priority,
      assigneeId: taskForm.assigneeId || null, dueDate: taskForm.dueDate || null,
      tags: taskForm.tags, estimateHours: taskForm.estimateHours ? parseInt(taskForm.estimateHours) : null,
      blockedByTaskId: taskForm.blockedByTaskId || null, subtasks: taskForm.subtasks,
      milestoneId: taskForm.milestoneId || null,
    };
    if (editingTask) { updateTaskMutation.mutate({ taskId: editingTask.id, data }); closeTaskDialog(); }
    else createTaskMutation.mutate(data);
  }

  function handleStatusChange(taskId: string, newStatus: string) {
    updateTaskMutation.mutate({ taskId, data: { status: newStatus } });
  }

  if (projectLoading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-secondary">Project not found</p>
        <Button variant="outline" onClick={() => setLocation("/projects")} data-testid="button-back-projects">Back to Projects</Button>
      </div>
    );
  }

  const isOwner = project.ownerId === user?.id;
  const isMember = members?.some((m) => m.userId === user?.id);

  if (!isOwner && !isMember) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-secondary">You don't have access to this project's management dashboard.</p>
        <Button variant="outline" onClick={() => setLocation(`/projects/${projectId}`)} data-testid="button-back-project">Back to Project</Button>
      </div>
    );
  }

  const tabs: { id: TabId; label: string; icon: any }[] = [
    { id: "nova", label: "Dashboard", icon: Sparkles },
    { id: "setup", label: "Setup", icon: LayoutDashboard },
    { id: "public", label: "Public Page", icon: Eye },
    { id: "roadmap", label: "Roadmap", icon: Map },
    { id: "kanban", label: "Tasks", icon: ListChecks },
    { id: "milestones", label: "Milestones", icon: Flag },
    { id: "team", label: "Team", icon: Users },
    { id: "files", label: "Files", icon: FolderOpen },
    { id: "codebase", label: "Codebase", icon: ScanSearch },
    { id: "activity", label: "Activity", icon: Activity },
    { id: "personas", label: "Personas", icon: Target },
    { id: "research", label: "Research", icon: Beaker },
    { id: "strategy", label: "Strategy", icon: Crosshair },
    { id: "launch", label: "Launch", icon: Rocket },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "support", label: "Support", icon: Headphones },
    { id: "chat", label: "Chat", icon: MessageSquare },
  ];

  return (
    <div className="h-full overflow-y-auto pb-20">
      <div className="border-b border-border bg-background/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center gap-4 mb-4 flex-wrap">
            <Button variant="ghost" size="icon" onClick={() => setLocation(`/projects/${projectId}`)} data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold truncate" data-testid="text-manager-title">{project.title}</h1>
              <p className="text-sm text-secondary">Project Manager</p>
            </div>
          </div>
          {/* Tabs wrap into as many rows as the viewport needs rather than
              scrolling sideways, so every tab is reachable without dragging.
              A wide screen shows one or two rows; a narrow one stacks more. */}
          <div className="flex flex-wrap gap-1">
            {tabs.map((tab) => (
              <Button key={tab.id} variant={activeTab === tab.id ? "default" : "ghost"} size="sm" className="gap-2" onClick={() => setActiveTab(tab.id)} data-testid={`tab-${tab.id}`}>
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        <NovaHandoffProvider value={novaHandoffValue}>
        {activeTab === "nova" && projectId && (
          <NovaDashboard projectId={projectId} onNavigate={(tab) => setActiveTab(tab as TabId)} />
        )}
        {activeTab === "setup" && (
          <SetupTab
            project={project} isOwner={isOwner} links={projectLinks || []}
            isUploadingPlan={isUploadingPlan}
            onUploadPlan={(file) => uploadFile(file)}
            onUpdateProject={(data) => updateProjectMutation.mutate(data)}
            onCreateLink={(data) => createLinkMutation.mutate(data)}
            onDeleteLink={(id) => deleteLinkMutation.mutate(id)}
            aiSummary={aiSummarizeMutation} aiGaps={aiDetectGapsMutation}
          />
        )}
        {activeTab === "public" && (
          <PublicPageTab
            project={project} isOwner={isOwner}
            onUpdateProject={(data) => updateProjectMutation.mutate(data)}
            onViewPublicPage={() => setLocation(`/projects/${projectId}`)}
            onEditBrief={() => setActiveTab("setup")}
          />
        )}
        {activeTab === "roadmap" && projectId && (
          <RoadmapTab projectId={projectId} isOwner={isOwner} />
        )}
        {activeTab === "kanban" && (
          <KanbanTab
            tasks={kanbanTasks || []} members={members || []} isLoading={tasksLoading}
            onNewTask={openNewTaskDialog} onEditTask={openEditTaskDialog}
            onDeleteTask={(id) => deleteTaskMutation.mutate(id)}
            onStatusChange={handleStatusChange}
            onAiGenerate={() => aiGenerateTasksMutation.mutate()}
            aiPending={aiGenerateTasksMutation.isPending}
            projectId={projectId!} projectTitle={project.title} isOwner={isOwner}
            onClearTasks={(onlyDone) => clearTasksMutation.mutate(onlyDone)}
            clearPending={clearTasksMutation.isPending}
            onShareTask={(title) => shareTaskMutation.mutate(title)}
            history={taskHistory}
            milestones={milestones || []}
          />
        )}
        {activeTab === "milestones" && (
          <MilestonesTab
            milestones={milestones || []} isLoading={milestonesLoading}
            onCreate={(data) => createMilestoneMutation.mutate(data)}
            onUpdate={(id, data) => updateMilestoneMutation.mutate({ id, data })}
            onDelete={(id) => deleteMilestoneMutation.mutate(id)}
            projectId={projectId!}
          />
        )}
        {activeTab === "team" && (
          <TeamTab
            project={project} members={members || []} applications={applications}
            isOwner={isOwner} tasks={kanbanTasks || []}
            onUpdateMember={(userId, data) => updateMemberMutation.mutate({ userId, data })}
            onRecommendPeople={() => recommendPeopleMutation.mutate()}
            recommendPending={recommendPeopleMutation.isPending}
            recommendData={recommendPeopleMutation.data}
          />
        )}
        {activeTab === "codebase" && projectId && (
          <CodebaseTab projectId={projectId} repoUrl={project.repoUrl} />
        )}
        {activeTab === "files" && (
          <FilesTab
            files={projectFiles || []} isUploading={isUploadingFile}
            uploadFolder={uploadFolder} setUploadFolder={setUploadFolder}
            onUpload={(file) => uploadProjectFile(file)}
            onDelete={(id) => deleteFileMutation.mutate(id)}
            projectId={projectId!}
          />
        )}
        {activeTab === "activity" && (
          <ActivityTab
            activity={activityLog || []} decisions={decisions || []}
            projectId={projectId!} projectTitle={project.title}
            onCreateDecision={(data) => createDecisionMutation.mutate(data)}
            onUpdateDecision={(id, data) => updateDecisionMutation.mutate({ id, data })}
            onDeleteDecision={(id) => deleteDecisionMutation.mutate(id)}
          />
        )}
        {activeTab === "personas" && (
          <PersonasTab
            personas={personas || []} isLoading={personasLoading}
            onCreateManual={() => setPersonaDialogOpen(true)}
            onAiGenerate={() => aiGeneratePersonaMutation.mutate()}
            onDelete={(id) => deletePersonaMutation.mutate(id)}
            aiPending={aiGeneratePersonaMutation.isPending}
          />
        )}
        {activeTab === "research" && projectId && (
          <ResearchTab projectId={projectId} />
        )}
        {activeTab === "strategy" && projectId && (
          <StrategyTab projectId={projectId} />
        )}
        {activeTab === "launch" && projectId && project && (
          <LaunchTab projectId={projectId} project={project} />
        )}
        {activeTab === "analytics" && projectId && (
          <AnalyticsTab projectId={projectId} />
        )}
        {activeTab === "support" && projectId && (
          <SupportTab projectId={projectId} />
        )}
        {activeTab === "chat" && projectId && (
          <LiveChatTab projectId={projectId} />
        )}
        </NovaHandoffProvider>
      </div>

      <Dialog open={taskDialogOpen} onOpenChange={setTaskDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingTask ? "Edit Task" : "New Task"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Title</label>
              <Input value={taskForm.title} onChange={(e) => setTaskForm((p) => ({ ...p, title: e.target.value }))} placeholder="Task title" data-testid="input-task-title" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Textarea value={taskForm.description} onChange={(e) => setTaskForm((p) => ({ ...p, description: e.target.value }))} placeholder="Task description (optional)" data-testid="input-task-description" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Status</label>
                <Select value={taskForm.status} onValueChange={(v) => setTaskForm((p) => ({ ...p, status: v }))}>
                  <SelectTrigger data-testid="select-task-status"><SelectValue /></SelectTrigger>
                  <SelectContent>{KANBAN_COLUMNS.map((col) => (<SelectItem key={col.id} value={col.id}>{col.label}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Priority</label>
                <Select value={taskForm.priority} onValueChange={(v) => setTaskForm((p) => ({ ...p, priority: v }))}>
                  <SelectTrigger data-testid="select-task-priority"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Assignee</label>
                <Select value={taskForm.assigneeId || "unassigned"} onValueChange={(v) => setTaskForm((p) => ({ ...p, assigneeId: v === "unassigned" ? "" : v }))}>
                  <SelectTrigger data-testid="select-task-assignee"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {members?.map((m) => (<SelectItem key={m.userId} value={m.userId}>{m.profile?.displayName || m.user.firstName || m.user.email || "Member"}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Due Date</label>
                <Input type="date" value={taskForm.dueDate} onChange={(e) => setTaskForm((p) => ({ ...p, dueDate: e.target.value }))} data-testid="input-task-due-date" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Estimate (hours)</label>
                <Input type="number" value={taskForm.estimateHours} onChange={(e) => setTaskForm((p) => ({ ...p, estimateHours: e.target.value }))} placeholder="e.g. 4" data-testid="input-task-estimate" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Blocked By</label>
                <Select value={taskForm.blockedByTaskId || "none"} onValueChange={(v) => setTaskForm((p) => ({ ...p, blockedByTaskId: v === "none" ? "" : v }))}>
                  <SelectTrigger data-testid="select-task-blocked"><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {(kanbanTasks || []).filter(t => t.id !== editingTask?.id).map((t) => (<SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Milestone</label>
              <Select value={taskForm.milestoneId || "none"} onValueChange={(v) => setTaskForm((p) => ({ ...p, milestoneId: v === "none" ? "" : v }))}>
                <SelectTrigger data-testid="select-task-milestone"><SelectValue placeholder="Not linked" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not linked to a milestone</SelectItem>
                  {(milestones || []).map((m) => (<SelectItem key={m.id} value={m.id}>{m.title}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Tags</label>
              <TagInput tags={taskForm.tags} onChange={(tags) => setTaskForm(p => ({ ...p, tags }))} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Subtasks</label>
              <SubtaskEditor subtasks={taskForm.subtasks} onChange={(subtasks) => setTaskForm(p => ({ ...p, subtasks }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeTaskDialog} data-testid="button-cancel-task">Cancel</Button>
            <Button onClick={handleTaskSubmit} disabled={!taskForm.title.trim() || createTaskMutation.isPending || updateTaskMutation.isPending} data-testid="button-submit-task">
              {(createTaskMutation.isPending || updateTaskMutation.isPending) && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editingTask ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={personaDialogOpen} onOpenChange={setPersonaDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Create Persona</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Name *</Label><Input value={personaForm.name} onChange={(e) => setPersonaForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Sarah Chen" data-testid="input-persona-name" /></div>
              <div className="space-y-2"><Label>Age</Label><Input type="number" value={personaForm.age} onChange={(e) => setPersonaForm(p => ({ ...p, age: e.target.value }))} placeholder="32" data-testid="input-persona-age" /></div>
            </div>
            <div className="space-y-2"><Label>Occupation</Label><Input value={personaForm.occupation} onChange={(e) => setPersonaForm(p => ({ ...p, occupation: e.target.value }))} placeholder="Product Manager" data-testid="input-persona-occupation" /></div>
            <div className="space-y-2"><Label>Bio</Label><Textarea value={personaForm.bio} onChange={(e) => setPersonaForm(p => ({ ...p, bio: e.target.value }))} placeholder="Brief description..." className="min-h-[60px]" data-testid="textarea-persona-bio" /></div>
            <div className="space-y-2"><Label>Goals (comma-separated)</Label><Input value={personaForm.goals} onChange={(e) => setPersonaForm(p => ({ ...p, goals: e.target.value }))} placeholder="Save time, Reduce costs" data-testid="input-persona-goals" /></div>
            <div className="space-y-2"><Label>Pain Points (comma-separated)</Label><Input value={personaForm.painPoints} onChange={(e) => setPersonaForm(p => ({ ...p, painPoints: e.target.value }))} placeholder="Too many tools" data-testid="input-persona-pain-points" /></div>
            <div className="space-y-2"><Label>Quote</Label><Input value={personaForm.quote} onChange={(e) => setPersonaForm(p => ({ ...p, quote: e.target.value }))} placeholder="I just want something that works." data-testid="input-persona-quote" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPersonaDialogOpen(false)}>Cancel</Button>
            <Button disabled={!personaForm.name.trim() || createPersonaMutation.isPending} onClick={() => {
              createPersonaMutation.mutate({
                name: personaForm.name, age: personaForm.age ? parseInt(personaForm.age) : undefined,
                occupation: personaForm.occupation || undefined, bio: personaForm.bio || undefined,
                goals: personaForm.goals ? personaForm.goals.split(",").map((s: string) => s.trim()).filter(Boolean) : [],
                painPoints: personaForm.painPoints ? personaForm.painPoints.split(",").map((s: string) => s.trim()).filter(Boolean) : [],
                quote: personaForm.quote || undefined,
              });
            }} data-testid="button-submit-persona">
              {createPersonaMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Create Persona
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {projectId && project && (
        <NovaGuide
          projectId={projectId}
          currentTab={activeTab}
          project={project}
          onProjectUpdate={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
          }}
        />
      )}
    </div>
  );
}

function TagInput({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [input, setInput] = useState("");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {tags.map((tag, i) => (
          <Badge key={i} variant="secondary" className="gap-1 text-xs">
            {tag}
            <button onClick={() => onChange(tags.filter((_, j) => j !== i))} className="ml-1 hover:text-destructive"><X className="h-3 w-3" /></button>
          </Badge>
        ))}
      </div>
      <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Add tag and press Enter"
        onKeyDown={(e) => { if (e.key === "Enter" && input.trim()) { e.preventDefault(); onChange([...tags, input.trim()]); setInput(""); } }}
        data-testid="input-tag" />
    </div>
  );
}

function SubtaskEditor({ subtasks, onChange }: { subtasks: Subtask[]; onChange: (s: Subtask[]) => void }) {
  const [input, setInput] = useState("");
  return (
    <div className="space-y-2">
      {subtasks.map((st) => (
        <div key={st.id} className="flex items-center gap-2">
          <button onClick={() => onChange(subtasks.map(s => s.id === st.id ? { ...s, done: !s.done } : s))} data-testid={`subtask-toggle-${st.id}`}>
            {st.done ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4 text-muted-foreground" />}
          </button>
          <span className={`text-sm flex-1 ${st.done ? "line-through text-muted-foreground" : ""}`}>{st.title}</span>
          <button onClick={() => onChange(subtasks.filter(s => s.id !== st.id))} className="text-muted-foreground hover:text-destructive"><X className="h-3 w-3" /></button>
        </div>
      ))}
      <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Add subtask and press Enter"
        onKeyDown={(e) => { if (e.key === "Enter" && input.trim()) { e.preventDefault(); onChange([...subtasks, { id: crypto.randomUUID(), title: input.trim(), done: false }]); setInput(""); } }}
        data-testid="input-subtask" />
    </div>
  );
}

/**
 * Private-project control. The quota is a paid entitlement, so this surfaces
 * how many are left and pitches the right plan when the cap is hit.
 */
function PrivacyCard({ project, isOwner, onUpdateProject }: {
  project: Project; isOwner: boolean; onUpdateProject: (data: any) => void;
}) {
  const { entitlements, privateProjectsUsed, canCreatePrivateProject } = useEntitlements();
  const isPrivate = (project as any).isPrivate === true;
  const limit = entitlements.privateProjects;
  const unlimited = limit === -1;
  // Turning privacy off is always allowed; turning it on needs quota.
  const blocked = !isPrivate && !canCreatePrivateProject;

  return (
    <Card data-testid="card-project-privacy">
      <CardHeader className="space-y-1">
        <CardTitle className="text-lg flex items-center gap-2">
          {isPrivate ? <Lock className="h-4 w-4" /> : <Globe className="h-4 w-4" />} Project visibility
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {isPrivate
            ? "Only you and your team can see this project. It's hidden from Discover and search."
            : "Anyone can find this project in Discover and view its public page."}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Make this project private</p>
            <p className="text-xs text-muted-foreground">
              {unlimited
                ? "Unlimited private projects on your plan"
                : limit === 0
                  ? "Private projects need a paid plan"
                  : `${privateProjectsUsed} of ${limit} private projects used`}
            </p>
          </div>
          <Switch
            checked={isPrivate}
            disabled={!isOwner || blocked}
            onCheckedChange={(v) => onUpdateProject({ isPrivate: v })}
            aria-label="Make this project private"
            data-testid="switch-project-private"
          />
        </div>
        {blocked && (
          <UpgradePrompt
            variant="inline"
            requiredTier={limit === 0 ? "starter" : "builder"}
            title={limit === 0 ? "Keep work private until you're ready" : "You've used all your private projects"}
            description={limit === 0
              ? "Starter includes 3 private projects. Builder makes them unlimited."
              : "Builder includes unlimited private projects."}
          />
        )}
      </CardContent>
    </Card>
  );
}

const SECTION_GROUP_LABELS: Record<ProjectSectionDef["group"], { title: string; blurb: string }> = {
  hero: { title: "Top of the page", blurb: "The first thing a visitor reads" },
  brief: { title: "Project brief", blurb: "Cards explaining the what and why" },
  detail: { title: "Details", blurb: "Roadmap, stack, and roles" },
  sidebar: { title: "Sidebar", blurb: "Stats, team, and links" },
};

function PublicPageTab({ project, isOwner, onUpdateProject, onViewPublicPage, onEditBrief }: {
  project: Project; isOwner: boolean;
  onUpdateProject: (data: any) => void;
  onViewPublicPage: () => void;
  onEditBrief: () => void;
}) {
  // Local mirror so the toggles feel instant while the PATCH is in flight.
  const [overrides, setOverrides] = useState<Partial<Record<ProjectSectionKey, boolean>>>(
    ((project as any).publicSections as Partial<Record<ProjectSectionKey, boolean>>) || {}
  );

  const enabled = (key: ProjectSectionKey) =>
    overrides[key] ?? isSectionEnabled(project, key);

  const toggle = (key: ProjectSectionKey, value: boolean) => {
    const next = { ...overrides, [key]: value };
    setOverrides(next);
    onUpdateProject({ publicSections: next });
  };

  const visibleCount = PROJECT_SECTIONS.filter(s => enabled(s.key) && sectionHasContent(project, s.key)).length;
  const emptyCount = PROJECT_SECTIONS.filter(s => !sectionHasContent(project, s.key)).length;

  const groups = (["hero", "brief", "detail", "sidebar"] as const).map(group => ({
    group,
    sections: PROJECT_SECTIONS.filter(s => s.group === group),
  }));

  return (
    <div className="space-y-6 max-w-3xl">
      <PrivacyCard project={project} isOwner={isOwner} onUpdateProject={onUpdateProject} />

      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-4">
          <div className="space-y-1">
            <CardTitle className="text-lg flex items-center gap-2"><Eye className="h-4 w-4" /> What visitors see</CardTitle>
            <p className="text-sm text-muted-foreground">
              Sections appear automatically once they have content. Turn any of them off to keep them private.
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-2 shrink-0" onClick={onViewPublicPage} data-testid="button-view-public-page">
            <ExternalLink className="h-3.5 w-3.5" /> View page
          </Button>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge variant="default" className="gap-1" data-testid="badge-visible-count">
              <Eye className="h-3 w-3" /> {visibleCount} live
            </Badge>
            {emptyCount > 0 && (
              <>
                <Badge variant="secondary" className="gap-1" data-testid="badge-empty-count">
                  {emptyCount} awaiting content
                </Badge>
                <button className="text-primary text-xs hover:underline" onClick={onEditBrief} data-testid="link-edit-brief">
                  Fill in your brief →
                </button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {groups.map(({ group, sections }) => (
        <Card key={group}>
          <CardHeader className="space-y-1">
            <CardTitle className="text-base">{SECTION_GROUP_LABELS[group].title}</CardTitle>
            <p className="text-xs text-muted-foreground">{SECTION_GROUP_LABELS[group].blurb}</p>
          </CardHeader>
          <CardContent className="space-y-1">
            {sections.map(section => {
              const hasContent = sectionHasContent(project, section.key);
              const isOn = enabled(section.key);
              return (
                <div
                  key={section.key}
                  className="flex items-center justify-between gap-4 py-2.5 border-b border-border/40 last:border-0"
                  data-testid={`row-section-${section.key}`}
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <p className={`text-sm font-medium ${!hasContent ? "text-muted-foreground" : ""}`}>{section.label}</p>
                      {!hasContent && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 font-normal">
                          <EyeOff className="h-2.5 w-2.5" /> No content yet
                        </Badge>
                      )}
                      {hasContent && !isOn && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 font-normal">
                          <EyeOff className="h-2.5 w-2.5" /> Hidden
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{section.hint}</p>
                  </div>
                  <Switch
                    checked={isOn}
                    disabled={!isOwner}
                    onCheckedChange={(v) => toggle(section.key, v)}
                    aria-label={`Show ${section.label} on the public page`}
                    data-testid={`switch-section-${section.key}`}
                  />
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function SetupTab({ project, isOwner, links, isUploadingPlan, onUploadPlan, onUpdateProject, onCreateLink, onDeleteLink, aiSummary, aiGaps }: {
  project: Project; isOwner: boolean; links: ProjectLink[];
  isUploadingPlan: boolean; onUploadPlan: (file: File) => void;
  onUpdateProject: (data: any) => void;
  onCreateLink: (data: any) => void; onDeleteLink: (id: string) => void;
  aiSummary: any; aiGaps: any;
}) {
  const [editingBrief, setEditingBrief] = useState(false);
  const [briefForm, setBriefForm] = useState({
    problemStatement: project.problemStatement || "",
    targetUser: project.targetUser || "",
    successMetrics: project.successMetrics || "",
    oneLiner: (project as any).oneLiner || "",
    mission: (project as any).mission || "",
    valueProposition: (project as any).valueProposition || "",
    targetCustomerProfile: (project as any).targetCustomerProfile || "",
  });
  /*
   * Keep the edit form in step with the project.
   *
   * `briefForm` seeds from `project` once on mount, so anything written after
   * that — most often Nova filling in Target User / Success Metrics — left the
   * form holding stale values. Opening Edit then showed those fields blank,
   * and saving wrote the blanks back over Nova's work. Re-sync whenever the
   * project changes while the form is closed; skip it mid-edit so we never
   * clobber what the user is typing.
   */
  useEffect(() => {
    if (editingBrief) return;
    setBriefForm({
      problemStatement: project.problemStatement || "",
      targetUser: project.targetUser || "",
      successMetrics: project.successMetrics || "",
      oneLiner: (project as any).oneLiner || "",
      mission: (project as any).mission || "",
      valueProposition: (project as any).valueProposition || "",
      targetCustomerProfile: (project as any).targetCustomerProfile || "",
    });
  }, [
    editingBrief, project.problemStatement, project.targetUser, project.successMetrics,
    (project as any).oneLiner, (project as any).mission,
    (project as any).valueProposition, (project as any).targetCustomerProfile,
  ]);

  const [scopeItem, setScopeItem] = useState("");
  const [scopeType, setScopeType] = useState<"mvp" | "niceToHave">("mvp");
  const [newLink, setNewLink] = useState({ label: "", url: "", category: "other" });
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [newQuestion, setNewQuestion] = useState("");
  const scope = (project.scope as { mvp?: string[]; niceToHave?: string[] }) || { mvp: [], niceToHave: [] };
  const questions: ApplicationQuestion[] = (project.applicationQuestions as ApplicationQuestion[]) || [];

  /*
   * The repo and live URLs captured on the project-creation page live on the
   * project itself, not in the project_links table, so the Links Hub never
   * showed them. Surface them here as first-class entries. They're edited on
   * the project's own fields rather than deleted like a normal link, so they
   * render with an Edit affordance pointing at the brief instead of a trash
   * can — dropping one means clearing the field.
   */
  const integrationLinks = [
    { key: "repoUrl", label: "Repository", url: project.repoUrl, icon: GitBranch },
    { key: "liveUrl", label: "Live Demo", url: project.liveUrl, icon: Globe },
  ].filter((l): l is typeof l & { url: string } => !!l.url?.trim());

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/*
        * Identity sits above the brief because it's the first thing a visitor
        * sees on the public page, and because the logo feeds the backer merch
        * and the AI badge — getting it set early makes everything downstream
        * work.
        */}
      <Card className="lg:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <ImageIcon className="h-4 w-4" /> Logo &amp; cover
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Your logo also goes on backer merch and the badges backers display, so a square
            transparent PNG travels furthest.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <ImageUploadField
            label="Project logo"
            value={project.logoUrl}
            onChange={(p) => onUpdateProject({ logoUrl: p })}
            hint="Square. Transparent PNG prints best."
            testId="upload-project-logo"
          />
          <ImageUploadField
            label="Cover image"
            value={project.coverUrl}
            onChange={(p) => onUpdateProject({ coverUrl: p })}
            aspect="wide"
            hint="Wide banner across the top of your public page."
            testId="upload-project-cover"
          />
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-lg flex items-center gap-2"><Target className="h-4 w-4" /> Project Brief</CardTitle>
          {isOwner && !editingBrief && <Button variant="outline" size="sm" onClick={() => setEditingBrief(true)} data-testid="button-edit-brief">Edit</Button>}
        </CardHeader>
        <CardContent>
          {editingBrief ? (
            <div className="space-y-4">
              <div className="space-y-2"><Label>One-Liner Positioning</Label><Input value={briefForm.oneLiner} onChange={e => setBriefForm(p => ({ ...p, oneLiner: e.target.value }))} placeholder="We help [who] do [what] by [how]" data-testid="input-one-liner" /></div>
              <div className="space-y-2"><Label>Mission</Label><Textarea value={briefForm.mission} onChange={e => setBriefForm(p => ({ ...p, mission: e.target.value }))} placeholder="Why does this project exist? What is it working toward?" data-testid="textarea-mission" /></div>
              <div className="space-y-2"><Label>Value Proposition</Label><Textarea value={briefForm.valueProposition} onChange={e => setBriefForm(p => ({ ...p, valueProposition: e.target.value }))} placeholder="What unique value do you provide?" data-testid="textarea-value-prop" /></div>
              <div className="space-y-2"><Label>Target Customer Profile</Label><Textarea value={briefForm.targetCustomerProfile} onChange={e => setBriefForm(p => ({ ...p, targetCustomerProfile: e.target.value }))} placeholder="Demographics, behaviors, pain points..." data-testid="textarea-customer-profile" /></div>
              <div className="space-y-2"><Label>Problem Statement</Label><Textarea value={briefForm.problemStatement} onChange={e => setBriefForm(p => ({ ...p, problemStatement: e.target.value }))} placeholder="What problem does this project solve?" data-testid="textarea-problem" /></div>
              <div className="space-y-2"><Label>Target User</Label><Input value={briefForm.targetUser} onChange={e => setBriefForm(p => ({ ...p, targetUser: e.target.value }))} placeholder="Who is the target user?" data-testid="input-target-user" /></div>
              <div className="space-y-2"><Label>Success Metrics</Label><Textarea value={briefForm.successMetrics} onChange={e => setBriefForm(p => ({ ...p, successMetrics: e.target.value }))} placeholder="How do you define success?" data-testid="textarea-success" /></div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => { onUpdateProject(briefForm); setEditingBrief(false); }} data-testid="button-save-brief">Save</Button>
                <Button size="sm" variant="outline" onClick={() => setEditingBrief(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/*
                * One-Liner and Mission always render, even when empty.
                *
                * They used to be hidden until filled, which made an incomplete
                * brief look finished: Nova's "brief is missing mission" nudge
                * pointed at a field that wasn't on the page at all. Problem /
                * Target User / Success Metrics already showed "Not defined
                * yet" for the same reason.
                */}
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">One-Liner</p>
                <p className="text-base font-medium" data-testid="text-one-liner">
                  {(project as any).oneLiner || <span className="text-sm font-normal text-muted-foreground italic">Not defined yet</span>}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Mission</p>
                <p className="text-sm whitespace-pre-line" data-testid="text-mission">
                  {(project as any).mission || <span className="text-muted-foreground italic">Not defined yet</span>}
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Problem</p>
                  <p className="text-sm" data-testid="text-problem">{project.problemStatement || <span className="text-muted-foreground italic">Not defined yet</span>}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Target User</p>
                  <p className="text-sm" data-testid="text-target-user">{project.targetUser || <span className="text-muted-foreground italic">Not defined yet</span>}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Success Metrics</p>
                  <p className="text-sm" data-testid="text-success">{project.successMetrics || <span className="text-muted-foreground italic">Not defined yet</span>}</p>
                </div>
              </div>
              {((project as any).valueProposition || (project as any).targetCustomerProfile) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {(project as any).valueProposition && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Value Proposition</p>
                      <p className="text-sm" data-testid="text-value-prop">{(project as any).valueProposition}</p>
                    </div>
                  )}
                  {(project as any).targetCustomerProfile && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Target Customer</p>
                      <p className="text-sm" data-testid="text-customer-profile">{(project as any).targetCustomerProfile}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Scope</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">MVP (Must Have)</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {(scope.mvp || []).map((item, i) => (
                <Badge key={i} variant="default" className="gap-1">{item}
                  {isOwner && <button onClick={() => onUpdateProject({ scope: { ...scope, mvp: (scope.mvp || []).filter((_, j) => j !== i) } })} className="ml-1 hover:text-destructive"><X className="h-3 w-3" /></button>}
                </Badge>
              ))}
              {(scope.mvp || []).length === 0 && <span className="text-xs text-muted-foreground italic">No MVP items yet</span>}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Nice to Have</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {(scope.niceToHave || []).map((item, i) => (
                <Badge key={i} variant="secondary" className="gap-1">{item}
                  {isOwner && <button onClick={() => onUpdateProject({ scope: { ...scope, niceToHave: (scope.niceToHave || []).filter((_, j) => j !== i) } })} className="ml-1 hover:text-destructive"><X className="h-3 w-3" /></button>}
                </Badge>
              ))}
              {(scope.niceToHave || []).length === 0 && <span className="text-xs text-muted-foreground italic">No items yet</span>}
            </div>
          </div>
          {isOwner && (
            <div className="flex gap-2">
              <Select value={scopeType} onValueChange={(v: any) => setScopeType(v)}>
                <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mvp">MVP</SelectItem>
                  <SelectItem value="niceToHave">Nice to Have</SelectItem>
                </SelectContent>
              </Select>
              <Input value={scopeItem} onChange={e => setScopeItem(e.target.value)} placeholder="Add scope item" className="flex-1" onKeyDown={e => {
                if (e.key === "Enter" && scopeItem.trim()) {
                  onUpdateProject({ scope: { ...scope, [scopeType]: [...(scope[scopeType] || []), scopeItem.trim()] } });
                  setScopeItem("");
                }
              }} data-testid="input-scope-item" />
              <Button size="icon" disabled={!scopeItem.trim()} onClick={() => {
                onUpdateProject({ scope: { ...scope, [scopeType]: [...(scope[scopeType] || []), scopeItem.trim()] } });
                setScopeItem("");
              }} data-testid="button-add-scope"><Plus className="h-4 w-4" /></Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-lg flex items-center gap-2"><Link2 className="h-4 w-4" /> Links Hub</CardTitle>
          {isOwner && <Button variant="outline" size="sm" onClick={() => setShowLinkForm(!showLinkForm)} data-testid="button-add-link"><Plus className="h-3 w-3 mr-1" /> Add</Button>}
        </CardHeader>
        <CardContent className="space-y-3">
          {showLinkForm && (
            <div className="space-y-2 p-3 rounded-md bg-muted/30">
              <Input value={newLink.label} onChange={e => setNewLink(p => ({ ...p, label: e.target.value }))} placeholder="Label (e.g. GitHub Repo)" data-testid="input-link-label" />
              <Input value={newLink.url} onChange={e => setNewLink(p => ({ ...p, url: e.target.value }))} placeholder="https://..." data-testid="input-link-url" />
              <Select value={newLink.category} onValueChange={v => setNewLink(p => ({ ...p, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{LINK_CATEGORIES.map(c => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
              <Button size="sm" disabled={!newLink.label.trim() || !newLink.url.trim()} onClick={() => { onCreateLink(newLink); setNewLink({ label: "", url: "", category: "other" }); setShowLinkForm(false); }} data-testid="button-save-link">Save Link</Button>
            </div>
          )}
          {integrationLinks.map(link => {
            const Icon = link.icon;
            return (
              <div key={link.key} className="flex items-center gap-3 p-2 rounded-md bg-muted/30 group" data-testid={`integration-link-${link.key}`}>
                <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium truncate">{link.label}</p>
                    <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">Integration</Badge>
                  </div>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-muted-foreground truncate hover:text-primary hover:underline block"
                    data-testid={`integration-link-url-${link.key}`}
                  >
                    {link.url}
                  </a>
                </div>
                <a href={link.url} target="_blank" rel="noopener noreferrer" data-testid={`integration-link-open-${link.key}`}>
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-primary" />
                </a>
                {isOwner && (
                  <button
                    onClick={() => onUpdateProject({ [link.key]: "" })}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                    title={`Remove ${link.label} link`}
                    data-testid={`integration-link-remove-${link.key}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
          {links.length > 0 ? links.map(link => {
            const cat = LINK_CATEGORIES.find(c => c.id === link.category);
            const Icon = cat?.icon || Globe;
            return (
              <div key={link.id} className="flex items-center gap-3 p-2 rounded-md bg-muted/30 group" data-testid={`link-${link.id}`}>
                <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{link.label}</p>
                  <p className="text-xs text-muted-foreground truncate">{link.url}</p>
                </div>
                <a href={link.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-primary" /></a>
                {isOwner && <button onClick={() => onDeleteLink(link.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>}
              </div>
            );
          }) : integrationLinks.length === 0 && <p className="text-sm text-muted-foreground">No links added yet.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg flex items-center gap-2"><FileText className="h-4 w-4" /> Business Plan</CardTitle></CardHeader>
        <CardContent>
          {project.businessPlanUrl ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 rounded-md bg-muted/50">
                <FileText className="h-5 w-5 text-primary" />
                <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">Business Plan</p></div>
                <Button variant="outline" size="sm" asChild data-testid="link-business-plan"><a href={project.businessPlanUrl} target="_blank" rel="noopener noreferrer">View</a></Button>
              </div>
              {isOwner && (
                <label className="cursor-pointer"><input type="file" className="hidden" accept=".pdf,.doc,.docx,.ppt,.pptx" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadPlan(f); }} />
                  <Button variant="ghost" size="sm" className="gap-2" asChild><span><RotateCcw className="h-3 w-3" /> Replace</span></Button>
                </label>
              )}
            </div>
          ) : isOwner ? (
            <label className="cursor-pointer"><input type="file" className="hidden" accept=".pdf,.doc,.docx,.ppt,.pptx" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadPlan(f); }} data-testid="input-upload-plan" />
              <div className="border-2 border-dashed border-border rounded-md p-8 text-center hover:border-primary/50 transition-colors">
                {isUploadingPlan ? <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" /> : (
                  <><Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" /><p className="text-sm font-medium">Upload Business Plan</p><p className="text-xs text-secondary mt-1">PDF, DOC, DOCX, PPT, PPTX</p></>
                )}
              </div>
            </label>
          ) : <p className="text-sm text-secondary">No business plan uploaded yet.</p>}
        </CardContent>
      </Card>

      {isOwner && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Application Questions</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {questions.length > 0 && (
              <div className="space-y-2">
                {questions.map((q) => (
                  <div key={q.id} className="flex items-center gap-2 p-2 rounded-md bg-muted/30" data-testid={`question-${q.id}`}>
                    <div className="flex-1 min-w-0"><p className="text-sm">{q.question}</p></div>
                    <Button variant="ghost" size="sm" className={q.required ? "text-primary" : "text-muted-foreground"} onClick={() => onUpdateProject({ applicationQuestions: questions.map(qx => qx.id === q.id ? { ...qx, required: !qx.required } : qx) })}>{q.required ? "Required" : "Optional"}</Button>
                    <Button variant="ghost" size="icon" onClick={() => onUpdateProject({ applicationQuestions: questions.filter(qx => qx.id !== q.id) })}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-2">
              <p className="text-xs text-secondary font-medium">Suggested questions</p>
              <div className="flex flex-wrap gap-1">
                {SUGGESTED_QUESTIONS.filter(sq => !questions.some(q => q.question === sq)).slice(0, 4).map(sq => (
                  <Button key={sq} variant="outline" size="sm" className="text-xs" onClick={() => onUpdateProject({ applicationQuestions: [...questions, { id: crypto.randomUUID(), question: sq, required: false }] })} data-testid="suggest-question"><Plus className="h-3 w-3 mr-1" />{sq.length > 40 ? sq.slice(0, 40) + "..." : sq}</Button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Input value={newQuestion} onChange={e => setNewQuestion(e.target.value)} placeholder="Add a custom question..." className="flex-1" onKeyDown={e => { if (e.key === "Enter" && newQuestion.trim()) { onUpdateProject({ applicationQuestions: [...questions, { id: crypto.randomUUID(), question: newQuestion.trim(), required: false }] }); setNewQuestion(""); } }} data-testid="input-custom-question" />
              <Button size="icon" disabled={!newQuestion.trim()} onClick={() => { onUpdateProject({ applicationQuestions: [...questions, { id: crypto.randomUUID(), question: newQuestion.trim(), required: false }] }); setNewQuestion(""); }} data-testid="button-add-question"><Plus className="h-4 w-4" /></Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="lg:col-span-2">
        <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Sparkles className="h-4 w-4" /> Nova AI Insights</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3 flex-wrap">
            <Button variant="outline" className="gap-2" onClick={() => aiSummary.mutate()} disabled={aiSummary.isPending} data-testid="button-ai-summarize">
              {aiSummary.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />} Summarize Progress
            </Button>
            <Button variant="outline" className="gap-2" onClick={() => aiGaps.mutate()} disabled={aiGaps.isPending} data-testid="button-ai-gaps">
              {aiGaps.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />} Detect Gaps
            </Button>
          </div>
          {aiSummary.data?.summary && (
            <Card className="bg-muted/30"><CardContent className="p-4"><p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Progress Summary</p><div className="text-sm prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap" data-testid="text-ai-summary">{aiSummary.data.summary}</div></CardContent></Card>
          )}
          {aiGaps.data?.gaps && aiGaps.data.gaps.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Detected Gaps</p>
              {aiGaps.data.gaps.map((gap: any, i: number) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-md bg-muted/30" data-testid={`gap-${i}`}>
                  <div className={`shrink-0 mt-0.5 ${gap.severity === "high" ? "text-red-500" : gap.severity === "medium" ? "text-yellow-500" : "text-blue-500"}`}>
                    {gap.category === "risk" ? <AlertTriangle className="h-4 w-4" /> : gap.category === "suggestion" ? <Lightbulb className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                  </div>
                  <div><p className="text-sm font-medium">{gap.title}</p><p className="text-xs text-muted-foreground">{gap.description}</p></div>
                  <Badge variant="outline" className="shrink-0 text-xs">{gap.severity}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Backing lives at the bottom of Setup: it only makes sense once the
          brief above it says what the project actually is, and it's the one
          block here that takes other people's money. Owner-only — a member
          must not be able to open a campaign on someone else's project. */}
      {isOwner && (
        <div className="lg:col-span-2">
          <BackingSetup projectId={project.id} projectTitle={project.title} />
        </div>
      )}
    </div>
  );
}

interface SequenceResult {
  rationale: string;
  startHere: string | null;
  sequence: { id: string; title: string; position: number; reason: string; blockedByTaskId: string | null }[];
  dependenciesFound: { id: string; title: string; blockerTitle: string; why?: string }[];
  cyclesBroken: { id: string; title: string; blockerTitle: string }[];
}

interface TaskHistory {
  projectCompleted: number;
  projectOnTime: number;
  lastCompletedAt: string | null;
  builderCompletedAllTime: number;
  recent: { id: string; title: string; completedAt: string; onTime: boolean }[];
}

function KanbanTab({
  tasks, members, isLoading, onNewTask, onEditTask, onDeleteTask, onStatusChange,
  onAiGenerate, aiPending, projectId, projectTitle, isOwner, onClearTasks, clearPending, onShareTask,
  history, milestones,
}: {
  tasks: ProjectKanbanTask[]; members: (ProjectMember & { user: User; profile?: UserProfile })[];
  isLoading: boolean; onNewTask: (status: string) => void; onEditTask: (task: ProjectKanbanTask) => void;
  onDeleteTask: (id: string) => void; onStatusChange: (taskId: string, newStatus: string) => void;
  onAiGenerate: () => void; aiPending: boolean;
  projectId: string; projectTitle: string; isOwner: boolean;
  onClearTasks: (onlyDone: boolean) => void; clearPending: boolean;
  onShareTask: (title: string) => void;
  history?: TaskHistory;
  milestones: ProjectMilestone[];
}) {
  const [view, setView] = useState<"board" | "calendar">("board");
  const [clearOpen, setClearOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  /** Nova's explanation of the last re-order, shown until dismissed. */
  const [sequenceResult, setSequenceResult] = useState<SequenceResult | null>(null);
  /** null = closed; a task = opened from that card; "board" = opened from the header. */
  const [plannerFor, setPlannerFor] = useState<ProjectKanbanTask | "board" | null>(null);
  /** Seeds the document builder. null = closed. */
  const [docStart, setDocStart] = useState<{ title: string; description: string; taskId?: string } | null>(null);
  /** The task open in the read-first detail view. */
  const [viewingTask, setViewingTask] = useState<ProjectKanbanTask | null>(null);
  const doneCount = tasks.filter((t) => t.status === "done").length;
  // The board's done column only shows what hasn't been cleared yet.
  const completedAllTime = Math.max(doneCount, history?.projectCompleted ?? 0);
  const clearedCount = Math.max(0, completedAllTime - doneCount);
  const { toast } = useToast();

  /** The task being dragged, and where it would land if dropped now. */
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ status: string; index: number } | null>(null);

  /**
   * Persists a drag.
   *
   * A status change goes through PATCH so the completion stamping, feed post
   * and execution archive stay in one place; the new positions then go in a
   * single reorder call rather than one request per card.
   */
  const dragMutation = useMutation({
    mutationFn: async ({ items, movedId, newStatus }: {
      items: { id: string; order: number }[];
      movedId: string;
      newStatus: string | null;
    }) => {
      if (newStatus) await apiRequest("PATCH", `/api/kanban/${movedId}`, { status: newStatus });
      await apiRequest("POST", `/api/projects/${projectId}/kanban/reorder`, { items });
    },
    // Settled rather than success: a failed drag has to snap back to the truth,
    // and the optimistic update has already moved the card.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "kanban"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "task-history"] });
    },
    onError: (err: any) => {
      const raw = err?.message || "";
      const jsonStart = raw.indexOf("{");
      let description = "The board has been put back.";
      if (jsonStart >= 0) {
        try { description = JSON.parse(raw.slice(jsonStart)).message || description; } catch { /* keep */ }
      }
      toast({ title: "Couldn't move that task", description, variant: "destructive" });
    },
  });

  /**
   * Works out the whole board's new order from one drop.
   *
   * Renumbers column by column so every task keeps a unique position — the
   * calendar orders a day's entries by this same number, and per-column
   * numbering would leave it full of ties.
   */
  function handleDrop(status: string, index: number) {
    const movedId = dragTaskId;
    setDragTaskId(null);
    setDropAt(null);
    if (!movedId) return;

    const moved = tasks.find((t) => t.id === movedId);
    if (!moved) return;

    // Plain object, not a Map — `Map` in this file is the lucide icon.
    const columns: Record<string, ProjectKanbanTask[]> = {};
    for (const c of KANBAN_COLUMNS) {
      columns[c.id] = tasks
        .filter((t) => t.status === c.id && t.id !== movedId)
        .sort((a, b) => a.order - b.order);
    }
    const target = columns[status];
    if (!target) return;
    target.splice(Math.max(0, Math.min(index, target.length)), 0, { ...moved, status } as ProjectKanbanTask);

    const items: { id: string; order: number }[] = [];
    let n = 0;
    for (const c of KANBAN_COLUMNS) {
      for (const t of columns[c.id] || []) items.push({ id: t.id, order: n++ });
    }

    // Nothing actually moved — don't spend a round trip on it.
    const sameColumn = moved.status === status;
    const unchanged = sameColumn && items.every((i) => tasks.find((t) => t.id === i.id)?.order === i.order);
    if (unchanged) return;

    const orderById: Record<string, number> = {};
    for (const i of items) orderById[i.id] = i.order;
    queryClient.setQueryData<ProjectKanbanTask[]>(
      ["/api/projects", projectId, "kanban"],
      (old) => (old || []).map((t) => ({
        ...t,
        order: orderById[t.id] ?? t.order,
        status: t.id === movedId ? (status as ProjectKanbanTask["status"]) : t.status,
      })),
    );

    dragMutation.mutate({ items, movedId, newStatus: sameColumn ? null : status });
  }

  const sequenceMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/kanban/sequence`);
      return res.json() as Promise<SequenceResult>;
    },
    onSuccess: (result) => {
      setSequenceResult(result);
      toast({
        title: "Board re-ordered",
        description: result.dependenciesFound.length
          ? `Nova also found ${result.dependenciesFound.length} dependenc${result.dependenciesFound.length === 1 ? "y" : "ies"}.`
          : undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "kanban"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
    },
    onError: (err: any) => {
      const raw = err?.message || "";
      const jsonStart = raw.indexOf("{");
      let description = "Couldn't re-order the board.";
      if (jsonStart >= 0) {
        try { description = JSON.parse(raw.slice(jsonStart)).message || description; } catch { /* keep */ }
      }
      toast({ title: "Nova couldn't do that", description, variant: "destructive" });
    },
  });

  if (isLoading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  function getMemberName(userId: string | null) {
    if (!userId) return null;
    const m = members.find(m => m.userId === userId);
    return m?.profile?.displayName || m?.user.firstName || m?.user.email || null;
  }
  function getMemberAvatar(userId: string | null) {
    if (!userId) return null;
    return members.find(m => m.userId === userId)?.profile?.avatarUrl || null;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-lg font-semibold">{view === "board" ? "Task Board" : "Task Calendar"}</h2>
            <p className="text-sm text-secondary" data-testid="text-task-counts">
              {tasks.length} on the board{doneCount > 0 && ` · ${doneCount} done`}
              {completedAllTime > 0 && (
                <>
                  {" · "}
                  <button
                    type="button"
                    className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                    onClick={() => setHistoryOpen(true)}
                    data-testid="button-open-task-history"
                  >
                    {completedAllTime} completed all time
                  </button>
                </>
              )}
            </p>
          </div>
          {/* Small symbol buttons to swap between the simple board and the calendar. */}
          <div className="flex items-center rounded-md border border-border overflow-hidden">
            <button
              onClick={() => setView("board")}
              title="Board view"
              aria-label="Board view"
              aria-pressed={view === "board"}
              className={`p-2 transition-colors ${view === "board" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
              data-testid="button-view-board"
            >
              <LayoutDashboard className="h-4 w-4" />
            </button>
            <button
              onClick={() => setView("calendar")}
              title="Calendar view"
              aria-label="Calendar view"
              aria-pressed={view === "calendar"}
              className={`p-2 transition-colors ${view === "calendar" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
              data-testid="button-view-calendar"
            >
              <CalendarDays className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            className="gap-2"
            onClick={() => setPlannerFor("board")}
            data-testid="button-nova-task-help"
          >
            <Sparkles className="h-4 w-4" /> Nova, help me
          </Button>
          <Button variant="outline" className="gap-2" onClick={onAiGenerate} disabled={aiPending} data-testid="button-ai-generate-tasks">
            {aiPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} AI Generate Tasks
          </Button>
          {tasks.filter((t) => t.status !== "done").length > 1 && (
            <Button
              variant="outline"
              className="gap-2"
              title="Nova puts the board in an order you can work straight down, prerequisites first"
              disabled={sequenceMutation.isPending}
              onClick={() => sequenceMutation.mutate()}
              data-testid="button-sequence-tasks"
            >
              {sequenceMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListOrdered className="h-4 w-4" />}
              {sequenceMutation.isPending ? "Nova is sequencing…" : `Order my tasks (${CREDIT_COSTS.taskSequencing})`}
            </Button>
          )}
          {isOwner && tasks.length > 0 && (
            <Button variant="outline" className="gap-2" onClick={() => setClearOpen(true)} disabled={clearPending} data-testid="button-clear-tasks">
              {clearPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Clear
            </Button>
          )}
          <Button className="gap-2" onClick={() => onNewTask("todo")} data-testid="button-new-task"><Plus className="h-4 w-4" /> New Task</Button>
        </div>
      </div>

      {/* Why the board looks the way it does now, and what to pick up first. */}
      {sequenceResult && (
        <Card className="border-primary/40 bg-primary/5" data-testid="card-sequence-result">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2 min-w-0">
                <ListOrdered className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-semibold">Nova re-ordered your board</p>
                  {sequenceResult.rationale && (
                    <p className="text-sm text-secondary leading-relaxed">{sequenceResult.rationale}</p>
                  )}
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setSequenceResult(null)} data-testid="button-dismiss-sequence">
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>

            {sequenceResult.sequence[0] && (
              <button
                type="button"
                className="w-full text-left rounded-md border border-primary/40 bg-background/70 p-3 hover:border-primary transition-colors"
                onClick={() => {
                  const first = tasks.find((t) => t.id === sequenceResult.sequence[0].id);
                  if (first) setViewingTask(first);
                }}
                data-testid="button-start-here"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">Start here</p>
                <p className="text-sm font-medium">{sequenceResult.sequence[0].title}</p>
                {sequenceResult.sequence[0].reason && (
                  <p className="text-xs text-muted-foreground">{sequenceResult.sequence[0].reason}</p>
                )}
              </button>
            )}

            {sequenceResult.cyclesBroken?.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Deadlocks Nova cleared
                </p>
                {sequenceResult.cyclesBroken.map((c) => (
                  <p key={c.id} className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0 text-amber-500" />
                    <span>
                      <strong className="text-foreground">{c.title}</strong> and{" "}
                      <strong className="text-foreground">{c.blockerTitle}</strong> were waiting on each other,
                      so neither could start. Removed the blocker on {c.title}.
                    </span>
                  </p>
                ))}
              </div>
            )}

            {sequenceResult.dependenciesFound.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Dependencies Nova spotted
                </p>
                {sequenceResult.dependenciesFound.map((d) => (
                  <p key={d.id} className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <Lock className="h-3 w-3 mt-0.5 shrink-0 text-orange-500" />
                    <span><strong className="text-foreground">{d.title}</strong> now waits on <strong className="text-foreground">{d.blockerTitle}</strong>{d.why ? ` — ${d.why}` : ""}</span>
                  </p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear tasks from this board?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  This permanently deletes the task cards. It <strong>won't</strong> affect your builder
                  reputation — execution credit for every finished task is banked first, so your
                  completed count keeps going up.
                </p>
                <p className="text-xs">
                  Tasks removed here also disappear from the calendar, since the calendar is built
                  from the tasks themselves. This can't be undone.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel data-testid="button-clear-cancel">Cancel</AlertDialogCancel>
            {doneCount > 0 && (
              <AlertDialogAction
                onClick={() => { onClearTasks(true); setClearOpen(false); }}
                data-testid="button-clear-done"
              >
                Clear {doneCount} finished
              </AlertDialogAction>
            )}
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { onClearTasks(false); setClearOpen(false); }}
              data-testid="button-clear-all"
            >
              Clear all {tasks.length}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {view === "calendar" ? (
        <ProjectCalendar
          projectId={projectId}
          projectTitle={projectTitle}
          onShareTask={(e) => onShareTask(e.title)}
          // Tasks cleared off the board still show on the calendar, so a
          // missing match just means there's nothing left to open.
          onOpenTask={(taskId) => {
            const task = tasks.find((t) => t.id === taskId);
            if (task) setViewingTask(task);
            else toast({ title: "That task no longer exists", description: "It was deleted or cleared from the board." });
          }}
        />
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {KANBAN_COLUMNS.map((col) => {
          const ColIcon = col.icon;
          const columnTasks = tasks.filter(t => t.status === col.id).sort((a, b) => a.order - b.order);
          return (
            <div
              key={col.id}
              className={`space-y-3 rounded-md transition-colors ${
                dropAt?.status === col.id ? "bg-primary/5 ring-1 ring-primary/40" : ""
              }`}
              onDragOver={(ev) => {
                if (!ev.dataTransfer.types.includes(TASK_DRAG_TYPE)) return;
                ev.preventDefault();
                ev.dataTransfer.dropEffect = "move";
                // Landing on the column body rather than a card means "last".
                setDropAt({ status: col.id, index: columnTasks.length });
              }}
              onDrop={(ev) => {
                if (!ev.dataTransfer.types.includes(TASK_DRAG_TYPE)) return;
                ev.preventDefault();
                handleDrop(col.id, dropAt?.status === col.id ? dropAt.index : columnTasks.length);
              }}
              data-testid={`kanban-column-${col.id}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ColIcon className={`h-4 w-4 ${col.color}`} />
                  <span className="text-sm font-medium">{col.label}</span>
                  <Badge variant="secondary" className="text-xs">{columnTasks.length}</Badge>
                  {/* Finished work that's been cleared still counts. Without
                      this the Done column reads as the whole record. */}
                  {col.id === "done" && clearedCount > 0 && (
                    <button
                      type="button"
                      className="text-[10px] text-muted-foreground hover:text-foreground underline decoration-dotted underline-offset-2"
                      title="Tasks finished on this project and since cleared off the board"
                      onClick={() => setHistoryOpen(true)}
                      data-testid="text-done-all-time"
                    >
                      +{clearedCount} cleared
                    </button>
                  )}
                </div>
                <Button variant="ghost" size="icon" onClick={() => onNewTask(col.id)} data-testid={`button-add-task-${col.id}`}><Plus className="h-3 w-3" /></Button>
              </div>
              <div className="space-y-2 min-h-[8rem] px-0.5">
                {columnTasks.map((task, taskIndex) => {
                  const subtasks = (task.subtasks as Subtask[]) || [];
                  const doneSubtasks = subtasks.filter(s => s.done).length;
                  // A finished prerequisite is no longer a blocker. New completions
                  // clear the link outright; this covers rows saved before that.
                  const blockerRaw = task.blockedByTaskId ? tasks.find(t => t.id === task.blockedByTaskId) : null;
                  const blockerTask = blockerRaw && blockerRaw.status !== "done" ? blockerRaw : null;
                  const taskMilestone = (task as any).milestoneId
                    ? milestones.find((m) => m.id === (task as any).milestoneId)
                    : null;
                  const isDragging = dragTaskId === task.id;
                  const showIndicator = dropAt?.status === col.id && dropAt.index === taskIndex && !isDragging;
                  return (
                    <div key={task.id}>
                      {/* Where the card would land if dropped right now. */}
                      {showIndicator && <div className="h-0.5 bg-primary rounded-full mb-2" data-testid={`drop-indicator-${col.id}-${taskIndex}`} />}
                    <Card
                      className={`hover:shadow-md transition-shadow cursor-pointer ${isDragging ? "opacity-40" : ""}`}
                      onClick={() => setViewingTask(task)}
                      draggable
                      onDragStart={(ev) => {
                        ev.dataTransfer.setData(TASK_DRAG_TYPE, task.id);
                        ev.dataTransfer.effectAllowed = "move";
                        setDragTaskId(task.id);
                      }}
                      onDragEnd={() => { setDragTaskId(null); setDropAt(null); }}
                      onDragOver={(ev) => {
                        if (!ev.dataTransfer.types.includes(TASK_DRAG_TYPE)) return;
                        ev.preventDefault();
                        ev.stopPropagation();
                        // Past the halfway line means "after this card".
                        const box = ev.currentTarget.getBoundingClientRect();
                        const after = ev.clientY > box.top + box.height / 2;
                        setDropAt({ status: col.id, index: taskIndex + (after ? 1 : 0) });
                      }}
                      onDrop={(ev) => {
                        if (!ev.dataTransfer.types.includes(TASK_DRAG_TYPE)) return;
                        ev.preventDefault();
                        ev.stopPropagation();
                        const box = ev.currentTarget.getBoundingClientRect();
                        const after = ev.clientY > box.top + box.height / 2;
                        handleDrop(col.id, taskIndex + (after ? 1 : 0));
                      }}
                      data-testid={`task-card-${task.id}`}
                    >
                      <CardContent className="p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium leading-tight flex-1">{task.title}</p>
                          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={(e) => { e.stopPropagation(); onDeleteTask(task.id); }} data-testid={`button-delete-task-${task.id}`} style={{ visibility: "visible" }}><Trash2 className="h-3 w-3" /></Button>
                        </div>
                        {task.description && <p className="text-xs text-secondary line-clamp-2">{task.description}</p>}
                        {/* Which milestone this is work toward — the readable
                            half of a milestone → tasks plan. */}
                        {looksLikeDocumentTask(task.title, task.description) && task.status !== "done" && (
                          <button
                            type="button"
                            className="flex items-center gap-1 text-xs text-primary hover:underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDocStart({ title: task.title, description: task.description || "", taskId: task.id });
                            }}
                            data-testid={`task-build-doc-${task.id}`}
                          >
                            <FileText className="h-3 w-3 shrink-0" />
                            <span>Build with Nova</span>
                          </button>
                        )}
                        {taskMilestone && (
                          <div className="flex items-center gap-1 text-xs text-purple-500">
                            <Flag className="h-3 w-3 shrink-0" />
                            <span className="truncate">{taskMilestone.title}</span>
                          </div>
                        )}
                        {blockerTask && (
                          <div className="flex items-center gap-1 text-xs text-orange-500"><Lock className="h-3 w-3" /><span className="truncate">Blocked by: {blockerTask.title}</span></div>
                        )}
                        {((task.tags as string[]) || []).length > 0 && (
                          <div className="flex flex-wrap gap-1">{((task.tags as string[]) || []).map((tag, i) => <Badge key={i} variant="outline" className="text-[10px] px-1.5 py-0"><Tag className="h-2.5 w-2.5 mr-0.5" />{tag}</Badge>)}</div>
                        )}
                        {subtasks.length > 0 && (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 bg-muted rounded-full overflow-hidden"><div className="h-full bg-primary rounded-full transition-all" style={{ width: `${(doneSubtasks / subtasks.length) * 100}%` }} /></div>
                            <span className="text-[10px] text-muted-foreground">{doneSubtasks}/{subtasks.length}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-1.5">
                            <Badge variant="secondary" className={`text-xs ${PRIORITY_COLORS[task.priority]}`} data-testid={`badge-priority-${task.id}`}>{task.priority}</Badge>
                            {task.estimateHours && <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5"><Clock className="h-2.5 w-2.5" />{task.estimateHours}h</Badge>}
                          </div>
                          <div className="flex items-center gap-2">
                            {task.dueDate && <span className="text-xs text-tertiary flex items-center gap-1"><Calendar className="h-3 w-3" />{new Date(task.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
                            {task.assigneeId && <UserAvatar src={getMemberAvatar(task.assigneeId)} name={getMemberName(task.assigneeId) || ""} className="h-5 w-5" />}
                          </div>
                        </div>
                        {/* Who actually moved the card, which is not always who it's assigned to. */}
                        {task.status === "in-progress" && (task as any).startedById && (
                          <div className="flex items-center gap-1.5 text-xs text-blue-500" data-testid={`attribution-progress-${task.id}`}>
                            <CircleDot className="h-3 w-3 shrink-0" />
                            <UserAvatar src={getMemberAvatar((task as any).startedById)} name={getMemberName((task as any).startedById) || ""} className="h-4 w-4" />
                            <span className="truncate">{getMemberName((task as any).startedById) || "Someone"} is on it</span>
                          </div>
                        )}
                        {task.status === "done" && (task as any).completedById && (
                          <div className="flex items-center gap-1.5 text-xs text-emerald-500" data-testid={`attribution-done-${task.id}`}>
                            <CheckCircle2 className="h-3 w-3 shrink-0" />
                            <UserAvatar src={getMemberAvatar((task as any).completedById)} name={getMemberName((task as any).completedById) || ""} className="h-4 w-4" />
                            <span className="truncate">
                              {getMemberName((task as any).completedById) || "Someone"} finished
                              {(task as any).completedAt && ` ${new Date((task as any).completedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
                            </span>
                          </div>
                        )}
                        <div className="flex items-center gap-1">
                          <Select value={task.status} onValueChange={(v) => onStatusChange(task.id, v)}>
                            <SelectTrigger className="h-7 text-xs" onClick={(e) => e.stopPropagation()} data-testid={`select-status-${task.id}`}><SelectValue /></SelectTrigger>
                            <SelectContent>{KANBAN_COLUMNS.map(c => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent>
                          </Select>
                          {task.status === "done" && (
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                              title="Share this win to your feed"
                              onClick={(e) => { e.stopPropagation(); onShareTask(task.title); }}
                              data-testid={`button-share-done-${task.id}`}
                            >
                              <Share2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                    </div>
                  );
                })}
                {dropAt?.status === col.id && dropAt.index >= columnTasks.length && columnTasks.some((t) => t.id !== dragTaskId) && (
                  <div className="h-0.5 bg-primary rounded-full" data-testid={`drop-indicator-${col.id}-end`} />
                )}
                {columnTasks.length === 0 && (
                  <div className={`border-2 border-dashed rounded-md p-6 text-center transition-colors ${
                    dropAt?.status === col.id ? "border-primary bg-primary/5" : "border-border"
                  }`}>
                    <p className="text-xs text-muted-foreground">
                      {dropAt?.status === col.id ? `Drop here to move to ${col.label}` : "No tasks"}
                    </p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* The project's execution record, board or no board. */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Completed work
            </DialogTitle>
            <DialogDescription>
              Everything finished on this project, including cards you've since cleared off the
              board. Nova reads this too, so clearing up doesn't cost you credit for shipping.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-md border border-border/60 bg-muted/40 p-3">
                <p className="text-xl font-bold">{completedAllTime}</p>
                <p className="text-[11px] text-muted-foreground leading-tight">completed on this project</p>
              </div>
              <div className="rounded-md border border-border/60 bg-muted/40 p-3">
                <p className="text-xl font-bold">{history?.projectOnTime ?? 0}</p>
                <p className="text-[11px] text-muted-foreground leading-tight">hit their due date</p>
              </div>
              <div className="rounded-md border border-border/60 bg-muted/40 p-3">
                <p className="text-xl font-bold">{history?.builderCompletedAllTime ?? 0}</p>
                <p className="text-[11px] text-muted-foreground leading-tight">your total across all projects</p>
              </div>
            </div>
            {history?.recent?.length ? (
              <div className="space-y-1.5 max-h-[18rem] overflow-y-auto">
                {history.recent.map((c) => (
                  <div key={c.id} className="flex items-start gap-2 text-sm" data-testid={`history-item-${c.id}`}>
                    <CheckCircle2 className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${c.onTime ? "text-emerald-500" : "text-amber-500"}`} />
                    <span className="flex-1 min-w-0">{c.title}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {new Date(c.completedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nothing recorded yet. Completions are archived from the moment a task moves to Done.
              </p>
            )}
            {(history?.builderCompletedAllTime ?? 0) > completedAllTime && (
              <p className="text-xs text-muted-foreground">
                Your all-time total is higher than this project's list — it includes other projects,
                and work finished before per-project history was kept.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {plannerFor && (
        <NovaTaskPlanner
          projectId={projectId}
          selectedTask={plannerFor === "board" ? null : plannerFor}
          onClose={() => setPlannerFor(null)}
        />
      )}

      <DocumentStartDialog
        projectId={projectId}
        open={!!docStart}
        onOpenChange={(open) => !open && setDocStart(null)}
        initialTitle={docStart?.title || ""}
        initialDescription={docStart?.description || ""}
        sourceTaskId={docStart?.taskId}
      />

      {/* Read first, edit second: clicking a card shows the whole task rather
          than dropping straight into a form. */}
      <Dialog open={!!viewingTask} onOpenChange={(open) => !open && setViewingTask(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          {viewingTask && (() => {
            const subtasks = (viewingTask.subtasks as Subtask[]) || [];
            const doneSubtasks = subtasks.filter((s) => s.done).length;
            const tags = (viewingTask.tags as string[]) || [];
            const blockerCandidate = viewingTask.blockedByTaskId
              ? tasks.find((t) => t.id === viewingTask.blockedByTaskId)
              : null;
            // Same rule as the card: a done prerequisite isn't a blocker.
            const blocker = blockerCandidate && blockerCandidate.status !== "done" ? blockerCandidate : null;
            const col = KANBAN_COLUMNS.find((c) => c.id === viewingTask.status);
            const started = (viewingTask as any).startedById as string | null;
            const finishedBy = (viewingTask as any).completedById as string | null;
            const finishedAt = (viewingTask as any).completedAt as string | null;

            return (
              <>
                <DialogHeader>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary" className="text-xs">{col?.label || viewingTask.status}</Badge>
                    <Badge variant="secondary" className={`text-xs ${PRIORITY_COLORS[viewingTask.priority]}`}>
                      {viewingTask.priority} priority
                    </Badge>
                    {viewingTask.estimateHours && (
                      <Badge variant="outline" className="text-xs gap-1">
                        <Clock className="h-3 w-3" />{viewingTask.estimateHours}h estimate
                      </Badge>
                    )}
                  </div>
                  <DialogTitle className="text-left pt-1" data-testid="text-task-detail-title">
                    {viewingTask.title}
                  </DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-1 text-sm">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Description</p>
                    <p className="whitespace-pre-wrap leading-relaxed" data-testid="text-task-detail-description">
                      {viewingTask.description || <span className="text-muted-foreground">No description.</span>}
                    </p>
                  </div>

                  {blocker && (
                    <div className="flex items-center gap-1.5 text-orange-500">
                      <Lock className="h-3.5 w-3.5 shrink-0" />
                      <span>Blocked by <strong>{blocker.title}</strong></span>
                    </div>
                  )}

                  {tags.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Tags</p>
                      <div className="flex flex-wrap gap-1">
                        {tags.map((tag, i) => (
                          <Badge key={i} variant="outline" className="text-[10px]"><Tag className="h-2.5 w-2.5 mr-0.5" />{tag}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {subtasks.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                        Subtasks ({doneSubtasks}/{subtasks.length})
                      </p>
                      <div className="space-y-1">
                        {subtasks.map((s, i) => (
                          <div key={i} className="flex items-start gap-2">
                            {s.done
                              ? <CheckSquare className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-500" />
                              : <Square className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />}
                            <span className={s.done ? "line-through text-muted-foreground" : ""}>{s.title}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3 pt-1 border-t border-border/50">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Assignee</p>
                      {viewingTask.assigneeId ? (
                        <div className="flex items-center gap-1.5">
                          <UserAvatar src={getMemberAvatar(viewingTask.assigneeId)} name={getMemberName(viewingTask.assigneeId) || ""} className="h-5 w-5" />
                          <span>{getMemberName(viewingTask.assigneeId) || "Unknown"}</span>
                        </div>
                      ) : <span className="text-muted-foreground">Unassigned</span>}
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Due</p>
                      {viewingTask.dueDate
                        ? <span>{new Date(viewingTask.dueDate).toLocaleDateString()}</span>
                        : <span className="text-muted-foreground">No due date</span>}
                    </div>
                    <div className="col-span-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Milestone</p>
                      {(() => {
                        const m = milestones.find((x) => x.id === (viewingTask as any).milestoneId);
                        return m
                          ? <span className="flex items-center gap-1.5"><Flag className="h-3.5 w-3.5 text-purple-500" />{m.title}</span>
                          : <span className="text-muted-foreground">Not linked to a milestone</span>;
                      })()}
                    </div>
                  </div>

                  {/* Who did what, which the card only hints at. */}
                  {(started || finishedBy) && (
                    <div className="space-y-1 pt-1 border-t border-border/50">
                      {started && (
                        <p className="text-xs text-muted-foreground">
                          Started by {getMemberName(started) || "someone"}
                          {(viewingTask as any).startedAt && ` on ${new Date((viewingTask as any).startedAt).toLocaleDateString()}`}
                        </p>
                      )}
                      {finishedBy && (
                        <p className="text-xs text-muted-foreground">
                          Finished by {getMemberName(finishedBy) || "someone"}
                          {finishedAt && ` on ${new Date(finishedAt).toLocaleDateString()}`}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <DialogFooter className="gap-2 sm:gap-2">
                  {viewingTask.status === "done" ? (
                    <Button
                      variant="ghost" className="gap-2 mr-auto"
                      onClick={() => onShareTask(viewingTask.title)}
                      data-testid="button-task-detail-share"
                    >
                      <Share2 className="h-4 w-4" /> Share this win
                    </Button>
                  ) : looksLikeDocumentTask(viewingTask.title, viewingTask.description) ? (
                    /* This task's deliverable is a document, so the most useful
                       thing on offer is building it rather than planning it. */
                    <Button
                      variant="ghost" className="gap-2 mr-auto"
                      onClick={() => {
                        const t = viewingTask;
                        setViewingTask(null);
                        setDocStart({ title: t.title, description: t.description || "", taskId: t.id });
                      }}
                      data-testid="button-task-detail-document"
                    >
                      <FileText className="h-4 w-4 text-primary" /> Build this document with Nova
                    </Button>
                  ) : (
                    <Button
                      variant="ghost" className="gap-2 mr-auto"
                      onClick={() => { const t = viewingTask; setViewingTask(null); setPlannerFor(t); }}
                      data-testid="button-task-detail-nova"
                    >
                      <Sparkles className="h-4 w-4" /> Nova, help with this
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => setViewingTask(null)}>Close</Button>
                  <Button
                    className="gap-2"
                    onClick={() => { const t = viewingTask; setViewingTask(null); onEditTask(t); }}
                    data-testid="button-task-detail-edit"
                  >
                    <Pencil className="h-4 w-4" /> Edit task
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MilestonesTab({ milestones, isLoading, onCreate, onUpdate, onDelete, projectId }: {
  milestones: ProjectMilestone[]; isLoading: boolean;
  onCreate: (data: any) => void; onUpdate: (id: string, data: any) => void; onDelete: (id: string) => void;
  projectId: string;
}) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", targetDate: "", status: "planned" });
  /**
   * The milestone being edited by hand, held as a draft. A milestone whose
   * wording is frozen the moment it's created is one the plan outgrows.
   */
  const [editing, setEditing] = useState<{ id: string; title: string; description: string; targetDate: string } | null>(null);

  if (isLoading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  const statusColors: Record<string, string> = {
    planned: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    "in-progress": "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  };

  const sorted = [...milestones].sort((a, b) => {
    if (a.targetDate && b.targetDate) return new Date(a.targetDate).getTime() - new Date(b.targetDate).getTime();
    return a.order - b.order;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-semibold">Milestones & Roadmap</h2><p className="text-sm text-secondary">{milestones.length} milestones</p></div>
        <div className="flex items-center gap-2">
          <NovaActionButton projectId={projectId} surface="milestones" />
          <Button className="gap-2" onClick={() => setShowForm(true)} data-testid="button-new-milestone"><Plus className="h-4 w-4" /> New Milestone</Button>
        </div>
      </div>

      {sorted.length > 0 && (
        <div className="relative">
          <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />
          <div className="space-y-6 relative">
            {sorted.map((m, i) => (
              <div key={m.id} className="flex gap-4 ml-0" data-testid={`milestone-${m.id}`}>
                <div className={`relative z-10 h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${m.status === "completed" ? "bg-green-500 text-white" : m.status === "in-progress" ? "bg-yellow-500 text-white" : "bg-muted text-muted-foreground"}`}>
                  {m.status === "completed" ? <CheckCircle2 className="h-4 w-4" /> : <Flag className="h-4 w-4" />}
                </div>
                <Card className="flex-1 group">
                  <CardContent className="p-4">
                    {editing?.id === m.id ? (
                      <div className="space-y-3" data-testid={`form-edit-milestone-${m.id}`}>
                        <Input
                          value={editing.title}
                          onChange={e => setEditing(p => p && ({ ...p, title: e.target.value }))}
                          placeholder="Milestone title"
                          data-testid="input-edit-milestone-title"
                        />
                        <Textarea
                          value={editing.description}
                          onChange={e => setEditing(p => p && ({ ...p, description: e.target.value }))}
                          placeholder="Description (optional)"
                          data-testid="textarea-edit-milestone-desc"
                        />
                        <Input
                          type="date"
                          value={editing.targetDate}
                          onChange={e => setEditing(p => p && ({ ...p, targetDate: e.target.value }))}
                          data-testid="input-edit-milestone-date"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={!editing.title.trim()}
                            onClick={() => {
                              onUpdate(m.id, {
                                title: editing.title,
                                description: editing.description,
                                targetDate: editing.targetDate || null,
                              });
                              setEditing(null);
                            }}
                            data-testid="button-save-edit-milestone"
                          >Save</Button>
                          <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                    <div className="flex items-start justify-between gap-2">
                      {/* Click the milestone itself to edit it — the pencil is
                          a hint, not the only way in. */}
                      <button
                        type="button"
                        className="flex-1 text-left"
                        onClick={() => setEditing({
                          id: m.id,
                          title: m.title,
                          description: m.description || "",
                          targetDate: m.targetDate ? new Date(m.targetDate).toISOString().slice(0, 10) : "",
                        })}
                        data-testid={`button-open-edit-milestone-${m.id}`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-sm">{m.title}</h3>
                          <Badge variant="secondary" className={`text-xs ${statusColors[m.status]}`}>{m.status}</Badge>
                        </div>
                        {m.description && <p className="text-xs text-secondary mb-2">{m.description}</p>}
                        {m.targetDate && <p className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" /> Target: {new Date(m.targetDate).toLocaleDateString()}</p>}
                      </button>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Select value={m.status} onValueChange={v => onUpdate(m.id, { status: v })}>
                          <SelectTrigger className="h-7 text-xs w-[110px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="planned">Planned</SelectItem>
                            <SelectItem value="in-progress">In Progress</SelectItem>
                            <SelectItem value="completed">Completed</SelectItem>
                          </SelectContent>
                        </Select>
                        <NovaActionButton
                          projectId={projectId}
                          surface="milestones"
                          entityId={m.id}
                          entityLabel={m.title}
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                        />
                        <Button
                          variant="ghost" size="icon" className="h-7 w-7"
                          onClick={() => setEditing({
                            id: m.id,
                            title: m.title,
                            description: m.description || "",
                            targetDate: m.targetDate ? new Date(m.targetDate).toISOString().slice(0, 10) : "",
                          })}
                          data-testid={`button-edit-milestone-${m.id}`}
                        ><Pencil className="h-3 w-3" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onDelete(m.id)}><Trash2 className="h-3 w-3" /></Button>
                      </div>
                    </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>
        </div>
      )}

      {milestones.length === 0 && !showForm && (
        <div className="border-2 border-dashed border-border rounded-lg p-12 text-center">
          <Flag className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h3 className="text-lg font-medium mb-2">No milestones yet</h3>
          <p className="text-sm text-muted-foreground mb-4">Create milestones to track your project's progress toward key goals.</p>
          <Button onClick={() => setShowForm(true)} data-testid="button-new-milestone-empty"><Plus className="h-4 w-4 mr-2" /> Create First Milestone</Button>
        </div>
      )}

      {showForm && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <h3 className="font-medium">New Milestone</h3>
            <Input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Milestone title (e.g. MVP Launch)" data-testid="input-milestone-title" />
            <Textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Description (optional)" data-testid="textarea-milestone-desc" />
            <Input type="date" value={form.targetDate} onChange={e => setForm(p => ({ ...p, targetDate: e.target.value }))} data-testid="input-milestone-date" />
            <div className="flex gap-2">
              <Button size="sm" disabled={!form.title.trim()} onClick={() => { onCreate({ title: form.title, description: form.description || null, targetDate: form.targetDate || null, order: milestones.length }); setForm({ title: "", description: "", targetDate: "", status: "planned" }); setShowForm(false); }} data-testid="button-save-milestone">Create</Button>
              <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TeamTab({ project, members, applications, isOwner, tasks, onUpdateMember, onRecommendPeople, recommendPending, recommendData }: {
  project: Project; members: (ProjectMember & { user: User; profile?: UserProfile })[];
  applications: any[] | undefined; isOwner: boolean; tasks: ProjectKanbanTask[];
  onUpdateMember: (userId: string, data: any) => void;
  onRecommendPeople: () => void; recommendPending: boolean; recommendData: any;
}) {
  const [editingMember, setEditingMember] = useState<string | null>(null);
  const [memberForm, setMemberForm] = useState({ timezone: "", availability: "", hoursPerWeek: "", skills: "" });
  const pendingApps = applications?.filter(a => a.status === "pending") || [];
  // Solo Builder Mode is fixed at creation time, so recruiting is off the
  // table for the life of the project.
  const soloMode = !!(project as any).soloMode;

  function getTaskStats(userId: string) {
    const userTasks = tasks.filter(t => t.assigneeId === userId);
    return { total: userTasks.length, done: userTasks.filter(t => t.status === "done").length, inProgress: userTasks.filter(t => t.status === "in-progress").length };
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            Team
            {soloMode && <Badge variant="outline" className="text-xs border-primary/30 text-primary">Solo Builder</Badge>}
          </h2>
          <p className="text-sm text-secondary">{members.length} members</p>
        </div>
      </div>

      {soloMode && (
        <Card className="border-primary/20 bg-primary/5" data-testid="card-solo-mode-notice">
          <CardContent className="p-4 flex items-start gap-3">
            <Rocket className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium">You're building this one solo</p>
              <p className="text-sm text-muted-foreground">
                This project was created in Solo Builder Mode, so teammates can't be
                invited and applications are turned off. It's just you and Nova.
              </p>
              <p className="text-sm text-muted-foreground">
                Solo Builder Mode is locked in at creation. To build with a team,
                create a new project with Solo Builder Mode off and delete this one.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {members.map(member => {
          const stats = getTaskStats(member.userId);
          const isEditing = editingMember === member.userId;
          return (
            <Card key={member.id} className="group" data-testid={`member-card-${member.userId}`}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <UserAvatar src={member.profile?.avatarUrl} name={member.profile?.displayName || member.user.firstName || member.user.email || "Member"} className="h-10 w-10" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">{member.profile?.displayName || member.user.firstName || member.user.email || "Member"}</p>
                      {member.userId === project.ownerId && <Badge variant="outline" className="text-xs">Owner</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground capitalize">{member.role}</p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {member.timezone && <Badge variant="secondary" className="text-[10px]">{member.timezone}</Badge>}
                      {member.availability && <Badge variant="secondary" className="text-[10px]">{member.availability}</Badge>}
                      {member.hoursPerWeek && <Badge variant="secondary" className="text-[10px]">{member.hoursPerWeek}h/week</Badge>}
                    </div>
                    {(member.skills as string[] || []).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">{((member.skills as string[]) || []).map((s, i) => <Badge key={i} variant="outline" className="text-[10px] px-1.5 py-0">{s}</Badge>)}</div>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                      <span>{stats.done} done</span>
                      <span>{stats.inProgress} in progress</span>
                      <span>{stats.total} total tasks</span>
                    </div>
                  </div>
                  {isOwner && (
                    <Button variant="ghost" size="sm" className="text-xs opacity-0 group-hover:opacity-100" onClick={() => {
                      if (isEditing) setEditingMember(null);
                      else {
                        setEditingMember(member.userId);
                        setMemberForm({ timezone: member.timezone || "", availability: member.availability || "", hoursPerWeek: member.hoursPerWeek?.toString() || "", skills: ((member.skills as string[]) || []).join(", ") });
                      }
                    }}>Edit</Button>
                  )}
                </div>
                {isEditing && (
                  <div className="mt-3 space-y-2 pt-3 border-t border-border">
                    <div className="grid grid-cols-3 gap-2">
                      <Input value={memberForm.timezone} onChange={e => setMemberForm(p => ({ ...p, timezone: e.target.value }))} placeholder="Timezone" className="text-xs" />
                      <Select value={memberForm.availability || "none"} onValueChange={v => setMemberForm(p => ({ ...p, availability: v === "none" ? "" : v }))}>
                        <SelectTrigger className="text-xs"><SelectValue placeholder="Availability" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Not set</SelectItem>
                          <SelectItem value="full-time">Full-time</SelectItem>
                          <SelectItem value="part-time">Part-time</SelectItem>
                          <SelectItem value="occasional">Occasional</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input value={memberForm.hoursPerWeek} onChange={e => setMemberForm(p => ({ ...p, hoursPerWeek: e.target.value }))} placeholder="hrs/wk" type="number" className="text-xs" />
                    </div>
                    <Input value={memberForm.skills} onChange={e => setMemberForm(p => ({ ...p, skills: e.target.value }))} placeholder="Skills (comma-separated)" className="text-xs" />
                    <Button size="sm" className="text-xs" onClick={() => {
                      onUpdateMember(member.userId, {
                        timezone: memberForm.timezone || null, availability: memberForm.availability || null,
                        hoursPerWeek: memberForm.hoursPerWeek ? parseInt(memberForm.hoursPerWeek) : null,
                        skills: memberForm.skills ? memberForm.skills.split(",").map(s => s.trim()).filter(Boolean) : null,
                      });
                      setEditingMember(null);
                    }}>Save</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {isOwner && !soloMode && pendingApps.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-lg flex items-center gap-2">Pending Applications <Badge>{pendingApps.length}</Badge></CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {pendingApps.map((app: any) => (
                <div key={app.id} className="flex items-center gap-3 p-2 rounded-md bg-muted/30" data-testid={`application-${app.id}`}>
                  <UserAvatar src={null} name={app.userId} className="h-8 w-8" />
                  <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{app.message || "No message"}</p><p className="text-xs text-tertiary">{new Date(app.createdAt).toLocaleDateString()}</p></div>
                  <Badge variant="secondary" className="text-xs">Pending</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {!soloMode && (
      <Card>
        <CardHeader><CardTitle className="text-lg flex items-center gap-2"><UserPlus className="h-4 w-4" /> AI People Recommendations</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-secondary">Let Nova AI recommend ideal team members from the community.</p>
          <Button onClick={onRecommendPeople} disabled={recommendPending} className="gap-2" data-testid="button-recommend-people">
            {recommendPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {recommendPending ? "Finding matches..." : "Find Team Members"}
          </Button>
          {recommendData?.recommendations && recommendData.recommendations.length > 0 && (
            <div className="space-y-2 mt-4">
              {recommendData.recommendations.map((rec: any, i: number) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-md bg-muted/30" data-testid={`recommendation-${i}`}>
                  <UserAvatar src={rec.avatarUrl} name={rec.displayName || rec.username} className="h-8 w-8" />
                  <div className="flex-1 min-w-0"><p className="text-sm font-medium">{rec.displayName || rec.username || "User"}</p><p className="text-xs text-secondary">{rec.reason || rec.matchReason}</p></div>
                  {rec.score && <Badge variant="secondary" className="text-xs">{rec.score}%</Badge>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      )}
    </div>
  );
}

function FilesTab({ files, isUploading, uploadFolder, setUploadFolder, onUpload, onDelete, projectId }: {
  files: (ProjectFile & { uploader: User })[]; isUploading: boolean;
  uploadFolder: string; setUploadFolder: (f: string) => void;
  onUpload: (file: File) => void; onDelete: (id: string) => void;
  projectId: string;
}) {
  const [, navigate] = useLocation();
  const [filterFolder, setFilterFolder] = useState<string>("all");
  const [docStartOpen, setDocStartOpen] = useState(false);

  /** Nova documents, which live alongside uploads but stay editable. */
  const { data: documents } = useQuery<(ProjectDocument & { pageCount: number })[]>({
    queryKey: ["/api/projects", projectId, "documents"],
    enabled: !!projectId,
  });

  /*
   * Folders are free text — a published document can create one — so the
   * filter is built from what's actually in use rather than a fixed list.
   */
  const folders = Array.from(new Set([...FILE_FOLDERS, ...files.map((f) => f.folder || "general")]));
  const filtered = filterFolder === "all" ? files : files.filter(f => f.folder === filterFolder);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-lg font-semibold">Files & Assets</h2>
          <p className="text-sm text-secondary">
            {files.length} file{files.length === 1 ? "" : "s"}
            {(documents?.length || 0) > 0 && ` · ${documents!.length} Nova document${documents!.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button className="gap-2" onClick={() => setDocStartOpen(true)} data-testid="button-new-document">
            <FileText className="h-4 w-4" /> New document with Nova
          </Button>
          <Select value={uploadFolder} onValueChange={setUploadFolder}>
            <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
            <SelectContent>{folders.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
          </Select>
          <label className="cursor-pointer">
            <input type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); }} data-testid="input-upload-file" />
            <Button asChild className="gap-2"><span>{isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload</span></Button>
          </label>
        </div>
      </div>

      <div className="flex gap-1 flex-wrap">
        <Button variant={filterFolder === "all" ? "default" : "ghost"} size="sm" onClick={() => setFilterFolder("all")} data-testid="filter-all">All</Button>
        {folders.map(f => (
          <Button key={f} variant={filterFolder === f ? "default" : "ghost"} size="sm" onClick={() => setFilterFolder(f)} data-testid={`filter-${f}`}>{f}</Button>
        ))}
      </div>

      {/* Nova documents first: they're still being worked on, and reopening one
          is a different action from downloading a finished upload. */}
      {(documents?.length || 0) > 0 && filterFolder === "all" && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Nova documents
          </p>
          {documents!.map((d) => (
            <div key={d.id} className="flex items-center gap-3 p-3 rounded-md bg-primary/5 border border-primary/20 group" data-testid={`document-${d.id}`}>
              <FileText className="h-5 w-5 text-primary shrink-0" />
              <button
                type="button"
                className="flex-1 min-w-0 text-left"
                onClick={() => navigate(`/projects/${projectId}/documents/${d.id}`)}
                data-testid={`open-document-${d.id}`}
              >
                <p className="text-sm font-medium truncate">{d.title}</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary" className="text-[9px] px-1.5 py-0">{d.status}</Badge>
                  <span>{d.pageCount} page{d.pageCount === 1 ? "" : "s"}</span>
                  <span>·</span>
                  <span>edited {new Date(d.updatedAt).toLocaleDateString()}</span>
                </div>
              </button>
              <a
                href={`/api/documents/${d.id}/pdf`} target="_blank" rel="noopener noreferrer"
                title="Open the PDF"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-primary" />
              </a>
            </div>
          ))}
        </div>
      )}

      {filtered.length > 0 ? (
        <div className="space-y-2">
          {(documents?.length || 0) > 0 && filterFolder === "all" && (
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground pt-2">
              Uploads
            </p>
          )}
          {filtered.map(file => (
            <div key={file.id} className="flex items-center gap-3 p-3 rounded-md bg-muted/30 group" data-testid={`file-${file.id}`}>
              <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{file.name}</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{file.folder}</span>
                  <span>·</span>
                  <span>{file.uploader?.firstName || file.uploader?.email || "Unknown"}</span>
                  <span>·</span>
                  <span>{new Date(file.createdAt).toLocaleDateString()}</span>
                  {file.size && <><span>·</span><span>{(file.size / 1024).toFixed(0)}KB</span></>}
                </div>
              </div>
              <a href={file.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-primary" /></a>
              <button onClick={() => onDelete(file.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      ) : (
        <div className="border-2 border-dashed border-border rounded-lg p-12 text-center">
          <FolderOpen className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h3 className="text-lg font-medium mb-2">No files yet</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Upload files to share with your team, or have Nova build a document from scratch.
          </p>
          <Button variant="outline" className="gap-2" onClick={() => setDocStartOpen(true)} data-testid="button-new-document-empty">
            <FileText className="h-4 w-4" /> New document with Nova
          </Button>
        </div>
      )}

      <DocumentStartDialog
        projectId={projectId}
        open={docStartOpen}
        onOpenChange={setDocStartOpen}
      />
    </div>
  );
}

function ActivityTab({ activity, decisions, projectId, projectTitle, onCreateDecision, onUpdateDecision, onDeleteDecision }: {
  activity: (ProjectActivityLog & { user?: User })[]; decisions: (ProjectDecision & { user: User })[];
  projectId: string; projectTitle: string;
  onCreateDecision: (data: any) => void; onUpdateDecision: (id: string, data: any) => void;
  onDeleteDecision: (id: string) => void;
}) {
  const [activeSection, setActiveSection] = useState<"feed" | "decisions" | "checkins">("feed");

  /*
   * Land on Check-ins when the dashboard sent us here to write one — otherwise
   * the handoff opens a composer behind the Feed tab, which reads as the page
   * having ignored the click.
   */
  const pendingHandoff = useNovaHandoffPending();
  useEffect(() => {
    if (pendingHandoff === "activity.checkIn") setActiveSection("checkins");
  }, [pendingHandoff]);
  const [showDecisionForm, setShowDecisionForm] = useState(false);
  const [decisionForm, setDecisionForm] = useState({ title: "", decision: "", context: "" });

  const statusColors: Record<string, string> = {
    proposed: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    accepted: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    revisited: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-1 flex-wrap">
        {([
          { id: "feed" as const, label: "Activity Feed", icon: Activity },
          { id: "decisions" as const, label: "Decision Log", icon: MessageSquare },
          { id: "checkins" as const, label: "Check-ins", icon: CheckCircle2 },
        ]).map(s => (
          <Button key={s.id} variant={activeSection === s.id ? "default" : "ghost"} size="sm" className="gap-2" onClick={() => setActiveSection(s.id)} data-testid={`section-${s.id}`}>
            <s.icon className="h-4 w-4" /> {s.label}
          </Button>
        ))}
      </div>

      {activeSection === "feed" && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Activity Feed</h2>
          {activity.length > 0 ? activity.map(entry => (
            <div key={entry.id} className="flex items-start gap-3 p-3 rounded-md bg-muted/30" data-testid={`activity-${entry.id}`}>
              <UserAvatar src={null} name={entry.user?.firstName || entry.user?.email || "System"} className="h-7 w-7" />
              <div className="flex-1 min-w-0">
                <p className="text-sm"><span className="font-medium">{entry.user?.firstName || entry.user?.email || "System"}</span> {entry.action}</p>
                <p className="text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</p>
              </div>
            </div>
          )) : <p className="text-sm text-muted-foreground">No activity yet. Actions like creating tasks, milestones, and decisions will appear here.</p>}
        </div>
      )}

      {activeSection === "decisions" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Decision Log</h2>
            <Button size="sm" className="gap-2" onClick={() => setShowDecisionForm(true)} data-testid="button-new-decision"><Plus className="h-4 w-4" /> Log Decision</Button>
          </div>
          {showDecisionForm && (
            <Card><CardContent className="p-4 space-y-3">
              <Input value={decisionForm.title} onChange={e => setDecisionForm(p => ({ ...p, title: e.target.value }))} placeholder="Decision title" data-testid="input-decision-title" />
              <Textarea value={decisionForm.decision} onChange={e => setDecisionForm(p => ({ ...p, decision: e.target.value }))} placeholder="What was decided?" data-testid="textarea-decision" />
              <Textarea value={decisionForm.context} onChange={e => setDecisionForm(p => ({ ...p, context: e.target.value }))} placeholder="Context / why this was decided (optional)" data-testid="textarea-decision-context" />
              <div className="flex gap-2">
                <Button size="sm" disabled={!decisionForm.title.trim() || !decisionForm.decision.trim()} onClick={() => { onCreateDecision(decisionForm); setDecisionForm({ title: "", decision: "", context: "" }); setShowDecisionForm(false); }} data-testid="button-save-decision">Save</Button>
                <Button size="sm" variant="outline" onClick={() => setShowDecisionForm(false)}>Cancel</Button>
              </div>
            </CardContent></Card>
          )}
          {decisions.length > 0 ? decisions.map(d => (
            <Card key={d.id} className="group" data-testid={`decision-${d.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium text-sm">{d.title}</h3>
                      <Badge variant="secondary" className={`text-xs ${statusColors[d.status]}`}>{d.status}</Badge>
                    </div>
                    <p className="text-sm mb-1">{d.decision}</p>
                    {d.context && <p className="text-xs text-muted-foreground">{d.context}</p>}
                    <p className="text-xs text-muted-foreground mt-2">by {d.user?.firstName || d.user?.email} · {new Date(d.createdAt).toLocaleDateString()}</p>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                    <Select value={d.status} onValueChange={v => onUpdateDecision(d.id, { status: v })}>
                      <SelectTrigger className="h-7 text-xs w-[100px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="proposed">Proposed</SelectItem>
                        <SelectItem value="accepted">Accepted</SelectItem>
                        <SelectItem value="revisited">Revisited</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onDeleteDecision(d.id)}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )) : !showDecisionForm && <p className="text-sm text-muted-foreground">No decisions logged yet. Document important choices so the team doesn't re-argue old decisions.</p>}
        </div>
      )}

      {activeSection === "checkins" && (
        <CheckInList projectId={projectId} projectTitle={projectTitle} />
      )}
    </div>
  );
}

function PersonasTab({ personas, isLoading, onCreateManual, onAiGenerate, onDelete, aiPending }: {
  personas: ProjectPersona[]; isLoading: boolean; onCreateManual: () => void;
  onAiGenerate: () => void; onDelete: (id: string) => void; aiPending: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-bold">Customer Personas</h2><p className="text-sm text-muted-foreground">Define your target audience with AI-generated or manual personas.</p></div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={onAiGenerate} disabled={aiPending} data-testid="button-ai-generate-persona">
            {aiPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} AI Generate
          </Button>
          <Button size="sm" className="gap-2" onClick={onCreateManual} data-testid="button-create-persona"><Plus className="h-4 w-4" /> Create Manually</Button>
        </div>
      </div>
      {isLoading ? <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div> :
      personas.length === 0 ? (
        <div className="border-2 border-dashed border-border rounded-lg p-12 text-center">
          <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h3 className="text-lg font-medium mb-2">No personas yet</h3>
          <p className="text-sm text-muted-foreground mb-4">Create customer personas to better understand your target audience.</p>
          <div className="flex items-center justify-center gap-3">
            <Button variant="outline" onClick={onAiGenerate} disabled={aiPending} data-testid="button-ai-generate-persona-empty"><Sparkles className="h-4 w-4 mr-2" /> Generate with Nova AI</Button>
            <Button onClick={onCreateManual}><Plus className="h-4 w-4 mr-2" /> Create Manually</Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {personas.map(persona => (
            <Card key={persona.id} className="border-border/50 relative group" data-testid={`persona-card-${persona.id}`}>
              <Button variant="ghost" size="icon" className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7 text-destructive hover:text-destructive" onClick={() => onDelete(persona.id)} data-testid={`button-delete-persona-${persona.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="h-12 w-12 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center text-lg font-bold text-primary shrink-0">{persona.name.charAt(0)}</div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm">{persona.name}</h3>
                      {persona.age && <span className="text-xs text-muted-foreground">Age {persona.age}</span>}
                      {persona.isAiGenerated && <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1"><Sparkles className="h-2.5 w-2.5" />AI</Badge>}
                    </div>
                    {persona.occupation && <p className="text-xs text-muted-foreground">{persona.occupation}</p>}
                  </div>
                </div>
                {persona.bio && <p className="text-sm text-secondary leading-relaxed">{persona.bio}</p>}
                {persona.goals && (persona.goals as string[]).length > 0 && (
                  <div><p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wide">Goals</p><div className="flex flex-wrap gap-1.5">{(persona.goals as string[]).map((g, i) => <Badge key={i} variant="secondary" className="text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">{g}</Badge>)}</div></div>
                )}
                {persona.painPoints && (persona.painPoints as string[]).length > 0 && (
                  <div><p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wide">Pain Points</p><div className="flex flex-wrap gap-1.5">{(persona.painPoints as string[]).map((p, i) => <Badge key={i} variant="secondary" className="text-xs bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">{p}</Badge>)}</div></div>
                )}
                {persona.quote && <blockquote className="border-l-2 border-primary/30 pl-3 italic text-sm text-muted-foreground">"{persona.quote}"</blockquote>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function LiveChatTab({ projectId }: { projectId: string }) {
  const [message, setMessage] = useState("");
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: messages, isLoading } = useQuery<any[]>({
    queryKey: ["/api/projects", projectId, "live-chat"],
    refetchInterval: 3000,
  });

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/live-chat`, { content });
      return res.json();
    },
    onSuccess: () => {
      setMessage("");
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "live-chat"] });
    },
    onError: () => toast({ title: "Failed to send message", variant: "destructive" }),
  });

  const handleSend = () => {
    if (!message.trim()) return;
    sendMutation.mutate(message.trim());
  };

  return (
    <div className="space-y-4" data-testid="live-chat-tab">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Team Chat</h3>
        <Badge variant="secondary" className="text-xs">{messages?.length || 0} messages</Badge>
      </div>
      <Card className="h-[500px] flex flex-col">
        <CardContent className="flex-1 overflow-y-auto p-4 space-y-3" data-testid="chat-messages">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !messages?.length ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <MessageSquare className="h-12 w-12 mb-3 opacity-30" />
              <p className="text-sm">No messages yet. Start the conversation!</p>
            </div>
          ) : (
            messages.map((msg: any) => {
              const isMe = msg.userId === user?.id;
              return (
                <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`} data-testid={`chat-message-${msg.id}`}>
                  <div className={`flex gap-2 max-w-[75%] ${isMe ? "flex-row-reverse" : ""}`}>
                    <UserAvatar user={msg.user} size="sm" />
                    <div>
                      <div className={`flex items-center gap-2 mb-0.5 ${isMe ? "justify-end" : ""}`}>
                        <span className="text-xs font-medium">{msg.user?.firstName || "User"}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <div className={`rounded-lg px-3 py-2 text-sm ${isMe ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                        {msg.content}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
        <div className="border-t p-3 flex gap-2">
          <Input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type a message..."
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            disabled={sendMutation.isPending}
            data-testid="input-chat-message"
          />
          <Button onClick={handleSend} disabled={!message.trim() || sendMutation.isPending} data-testid="button-send-chat">
            {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
