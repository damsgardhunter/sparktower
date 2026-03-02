import { useState } from "react";
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
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
} from "lucide-react";
import type {
  Project, ProjectMember, UserProfile, User, ProjectKanbanTask,
  ProjectPersona, ProjectMilestone, ProjectFile, ProjectLink,
  ProjectDecision, ProjectCheckIn, ProjectActivityLog,
} from "@shared/schema";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useUpload } from "@/hooks/use-upload";

type TabId = "setup" | "kanban" | "milestones" | "team" | "files" | "activity" | "personas" | "chat";

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

  const [activeTab, setActiveTab] = useState<TabId>("setup");
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ProjectKanbanTask | null>(null);
  const [taskForm, setTaskForm] = useState({
    title: "", description: "", status: "todo" as string, priority: "medium" as string,
    assigneeId: "" as string, dueDate: "", tags: [] as string[], estimateHours: "",
    blockedByTaskId: "" as string, subtasks: [] as Subtask[],
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
    enabled: !!projectId && (activeTab === "milestones" || activeTab === "setup"),
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
    onSuccess: () => { toast({ title: "Task created" }); queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "kanban"] }); closeTaskDialog(); },
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ taskId, data }: { taskId: string; data: any }) => { const res = await apiRequest("PATCH", `/api/kanban/${taskId}`, data); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "kanban"] }); },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (taskId: string) => { await apiRequest("DELETE", `/api/kanban/${taskId}`); },
    onSuccess: () => { toast({ title: "Task deleted" }); queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "kanban"] }); },
  });

  const aiGenerateTasksMutation = useMutation({
    mutationFn: async () => { const res = await apiRequest("POST", `/api/projects/${projectId}/kanban/ai-generate`); return res.json(); },
    onSuccess: (data) => { toast({ title: "Tasks generated", description: `Nova created ${data.length} tasks.` }); queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "kanban"] }); },
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
    setTaskForm({ title: "", description: "", status, priority: "medium", assigneeId: "", dueDate: "", tags: [], estimateHours: "", blockedByTaskId: "", subtasks: [] });
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
    });
    setTaskDialogOpen(true);
  }

  function closeTaskDialog() {
    setTaskDialogOpen(false);
    setEditingTask(null);
    setTaskForm({ title: "", description: "", status: "todo", priority: "medium", assigneeId: "", dueDate: "", tags: [], estimateHours: "", blockedByTaskId: "", subtasks: [] });
  }

  function handleTaskSubmit() {
    const data = {
      title: taskForm.title, description: taskForm.description || null,
      status: taskForm.status, priority: taskForm.priority,
      assigneeId: taskForm.assigneeId || null, dueDate: taskForm.dueDate || null,
      tags: taskForm.tags, estimateHours: taskForm.estimateHours ? parseInt(taskForm.estimateHours) : null,
      blockedByTaskId: taskForm.blockedByTaskId || null, subtasks: taskForm.subtasks,
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
    { id: "setup", label: "Setup", icon: LayoutDashboard },
    { id: "kanban", label: "Tasks", icon: ListChecks },
    { id: "milestones", label: "Milestones", icon: Flag },
    { id: "team", label: "Team", icon: Users },
    { id: "files", label: "Files", icon: FolderOpen },
    { id: "activity", label: "Activity", icon: Activity },
    { id: "personas", label: "Personas", icon: Target },
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
          <div className="flex gap-1 overflow-x-auto">
            {tabs.map((tab) => (
              <Button key={tab.id} variant={activeTab === tab.id ? "default" : "ghost"} size="sm" className="gap-2 shrink-0" onClick={() => setActiveTab(tab.id)} data-testid={`tab-${tab.id}`}>
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
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
        {activeTab === "kanban" && (
          <KanbanTab
            tasks={kanbanTasks || []} members={members || []} isLoading={tasksLoading}
            onNewTask={openNewTaskDialog} onEditTask={openEditTaskDialog}
            onDeleteTask={(id) => deleteTaskMutation.mutate(id)}
            onStatusChange={handleStatusChange}
            onAiGenerate={() => aiGenerateTasksMutation.mutate()}
            aiPending={aiGenerateTasksMutation.isPending}
          />
        )}
        {activeTab === "milestones" && (
          <MilestonesTab
            milestones={milestones || []} isLoading={milestonesLoading}
            onCreate={(data) => createMilestoneMutation.mutate(data)}
            onUpdate={(id, data) => updateMilestoneMutation.mutate({ id, data })}
            onDelete={(id) => deleteMilestoneMutation.mutate(id)}
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
        {activeTab === "files" && (
          <FilesTab
            files={projectFiles || []} isUploading={isUploadingFile}
            uploadFolder={uploadFolder} setUploadFolder={setUploadFolder}
            onUpload={(file) => uploadProjectFile(file)}
            onDelete={(id) => deleteFileMutation.mutate(id)}
          />
        )}
        {activeTab === "activity" && (
          <ActivityTab
            activity={activityLog || []} decisions={decisions || []}
            checkIns={checkIns || []} projectId={projectId!}
            onCreateDecision={(data) => createDecisionMutation.mutate(data)}
            onUpdateDecision={(id, data) => updateDecisionMutation.mutate({ id, data })}
            onDeleteDecision={(id) => deleteDecisionMutation.mutate(id)}
            onCreateCheckIn={(data) => createCheckInMutation.mutate(data)}
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
        {activeTab === "chat" && projectId && (
          <LiveChatTab projectId={projectId} />
        )}
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
  });
  const [scopeItem, setScopeItem] = useState("");
  const [scopeType, setScopeType] = useState<"mvp" | "niceToHave">("mvp");
  const [newLink, setNewLink] = useState({ label: "", url: "", category: "other" });
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [newQuestion, setNewQuestion] = useState("");
  const scope = (project.scope as { mvp?: string[]; niceToHave?: string[] }) || { mvp: [], niceToHave: [] };
  const questions: ApplicationQuestion[] = (project.applicationQuestions as ApplicationQuestion[]) || [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card className="lg:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-lg flex items-center gap-2"><Target className="h-4 w-4" /> Project Brief</CardTitle>
          {isOwner && !editingBrief && <Button variant="outline" size="sm" onClick={() => setEditingBrief(true)} data-testid="button-edit-brief">Edit</Button>}
        </CardHeader>
        <CardContent>
          {editingBrief ? (
            <div className="space-y-4">
              <div className="space-y-2"><Label>Problem Statement</Label><Textarea value={briefForm.problemStatement} onChange={e => setBriefForm(p => ({ ...p, problemStatement: e.target.value }))} placeholder="What problem does this project solve?" data-testid="textarea-problem" /></div>
              <div className="space-y-2"><Label>Target User</Label><Input value={briefForm.targetUser} onChange={e => setBriefForm(p => ({ ...p, targetUser: e.target.value }))} placeholder="Who is the target user?" data-testid="input-target-user" /></div>
              <div className="space-y-2"><Label>Success Metrics</Label><Textarea value={briefForm.successMetrics} onChange={e => setBriefForm(p => ({ ...p, successMetrics: e.target.value }))} placeholder="How do you define success?" data-testid="textarea-success" /></div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => { onUpdateProject(briefForm); setEditingBrief(false); }} data-testid="button-save-brief">Save</Button>
                <Button size="sm" variant="outline" onClick={() => setEditingBrief(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
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
          }) : <p className="text-sm text-muted-foreground">No links added yet.</p>}
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
    </div>
  );
}

function KanbanTab({ tasks, members, isLoading, onNewTask, onEditTask, onDeleteTask, onStatusChange, onAiGenerate, aiPending }: {
  tasks: ProjectKanbanTask[]; members: (ProjectMember & { user: User; profile?: UserProfile })[];
  isLoading: boolean; onNewTask: (status: string) => void; onEditTask: (task: ProjectKanbanTask) => void;
  onDeleteTask: (id: string) => void; onStatusChange: (taskId: string, newStatus: string) => void;
  onAiGenerate: () => void; aiPending: boolean;
}) {
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
        <div><h2 className="text-lg font-semibold">Task Board</h2><p className="text-sm text-secondary">{tasks.length} tasks total</p></div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2" onClick={onAiGenerate} disabled={aiPending} data-testid="button-ai-generate-tasks">
            {aiPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} AI Generate Tasks
          </Button>
          <Button className="gap-2" onClick={() => onNewTask("todo")} data-testid="button-new-task"><Plus className="h-4 w-4" /> New Task</Button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {KANBAN_COLUMNS.map((col) => {
          const ColIcon = col.icon;
          const columnTasks = tasks.filter(t => t.status === col.id).sort((a, b) => a.order - b.order);
          return (
            <div key={col.id} className="space-y-3" data-testid={`kanban-column-${col.id}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ColIcon className={`h-4 w-4 ${col.color}`} />
                  <span className="text-sm font-medium">{col.label}</span>
                  <Badge variant="secondary" className="text-xs">{columnTasks.length}</Badge>
                </div>
                <Button variant="ghost" size="icon" onClick={() => onNewTask(col.id)} data-testid={`button-add-task-${col.id}`}><Plus className="h-3 w-3" /></Button>
              </div>
              <div className="space-y-2 min-h-[8rem]">
                {columnTasks.map((task) => {
                  const subtasks = (task.subtasks as Subtask[]) || [];
                  const doneSubtasks = subtasks.filter(s => s.done).length;
                  const blockerTask = task.blockedByTaskId ? tasks.find(t => t.id === task.blockedByTaskId) : null;
                  return (
                    <Card key={task.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => onEditTask(task)} data-testid={`task-card-${task.id}`}>
                      <CardContent className="p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium leading-tight flex-1">{task.title}</p>
                          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={(e) => { e.stopPropagation(); onDeleteTask(task.id); }} data-testid={`button-delete-task-${task.id}`} style={{ visibility: "visible" }}><Trash2 className="h-3 w-3" /></Button>
                        </div>
                        {task.description && <p className="text-xs text-secondary line-clamp-2">{task.description}</p>}
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
                        <Select value={task.status} onValueChange={(v) => onStatusChange(task.id, v)}>
                          <SelectTrigger className="h-7 text-xs" onClick={(e) => e.stopPropagation()} data-testid={`select-status-${task.id}`}><SelectValue /></SelectTrigger>
                          <SelectContent>{KANBAN_COLUMNS.map(c => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent>
                        </Select>
                      </CardContent>
                    </Card>
                  );
                })}
                {columnTasks.length === 0 && <div className="border-2 border-dashed border-border rounded-md p-6 text-center"><p className="text-xs text-muted-foreground">No tasks</p></div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MilestonesTab({ milestones, isLoading, onCreate, onUpdate, onDelete }: {
  milestones: ProjectMilestone[]; isLoading: boolean;
  onCreate: (data: any) => void; onUpdate: (id: string, data: any) => void; onDelete: (id: string) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", targetDate: "", status: "planned" });

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
        <Button className="gap-2" onClick={() => setShowForm(true)} data-testid="button-new-milestone"><Plus className="h-4 w-4" /> New Milestone</Button>
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
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-sm">{m.title}</h3>
                          <Badge variant="secondary" className={`text-xs ${statusColors[m.status]}`}>{m.status}</Badge>
                        </div>
                        {m.description && <p className="text-xs text-secondary mb-2">{m.description}</p>}
                        {m.targetDate && <p className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" /> Target: {new Date(m.targetDate).toLocaleDateString()}</p>}
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Select value={m.status} onValueChange={v => onUpdate(m.id, { status: v })}>
                          <SelectTrigger className="h-7 text-xs w-[110px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="planned">Planned</SelectItem>
                            <SelectItem value="in-progress">In Progress</SelectItem>
                            <SelectItem value="completed">Completed</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onDelete(m.id)}><Trash2 className="h-3 w-3" /></Button>
                      </div>
                    </div>
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

  function getTaskStats(userId: string) {
    const userTasks = tasks.filter(t => t.assigneeId === userId);
    return { total: userTasks.length, done: userTasks.filter(t => t.status === "done").length, inProgress: userTasks.filter(t => t.status === "in-progress").length };
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-semibold">Team</h2><p className="text-sm text-secondary">{members.length} members</p></div>
      </div>

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

      {isOwner && pendingApps.length > 0 && (
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
    </div>
  );
}

function FilesTab({ files, isUploading, uploadFolder, setUploadFolder, onUpload, onDelete }: {
  files: (ProjectFile & { uploader: User })[]; isUploading: boolean;
  uploadFolder: string; setUploadFolder: (f: string) => void;
  onUpload: (file: File) => void; onDelete: (id: string) => void;
}) {
  const [filterFolder, setFilterFolder] = useState<string>("all");
  const filtered = filterFolder === "all" ? files : files.filter(f => f.folder === filterFolder);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div><h2 className="text-lg font-semibold">Files & Assets</h2><p className="text-sm text-secondary">{files.length} files</p></div>
        <div className="flex items-center gap-2">
          <Select value={uploadFolder} onValueChange={setUploadFolder}>
            <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
            <SelectContent>{FILE_FOLDERS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
          </Select>
          <label className="cursor-pointer">
            <input type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); }} data-testid="input-upload-file" />
            <Button asChild className="gap-2"><span>{isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload</span></Button>
          </label>
        </div>
      </div>

      <div className="flex gap-1 flex-wrap">
        <Button variant={filterFolder === "all" ? "default" : "ghost"} size="sm" onClick={() => setFilterFolder("all")} data-testid="filter-all">All</Button>
        {FILE_FOLDERS.map(f => (
          <Button key={f} variant={filterFolder === f ? "default" : "ghost"} size="sm" onClick={() => setFilterFolder(f)} data-testid={`filter-${f}`}>{f}</Button>
        ))}
      </div>

      {filtered.length > 0 ? (
        <div className="space-y-2">
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
          <p className="text-sm text-muted-foreground">Upload files to share with your team.</p>
        </div>
      )}
    </div>
  );
}

function ActivityTab({ activity, decisions, checkIns, projectId, onCreateDecision, onUpdateDecision, onDeleteDecision, onCreateCheckIn }: {
  activity: (ProjectActivityLog & { user?: User })[]; decisions: (ProjectDecision & { user: User })[];
  checkIns: (ProjectCheckIn & { user: User; profile?: UserProfile })[]; projectId: string;
  onCreateDecision: (data: any) => void; onUpdateDecision: (id: string, data: any) => void;
  onDeleteDecision: (id: string) => void; onCreateCheckIn: (data: any) => void;
}) {
  const [activeSection, setActiveSection] = useState<"feed" | "decisions" | "checkins">("feed");
  const [showDecisionForm, setShowDecisionForm] = useState(false);
  const [decisionForm, setDecisionForm] = useState({ title: "", decision: "", context: "" });
  const [showCheckInForm, setShowCheckInForm] = useState(false);
  const [checkInForm, setCheckInForm] = useState({ did: "", doing: "", blockers: "" });

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
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Weekly Check-ins</h2>
            <Button size="sm" className="gap-2" onClick={() => setShowCheckInForm(true)} data-testid="button-new-checkin"><Plus className="h-4 w-4" /> Submit Check-in</Button>
          </div>
          {showCheckInForm && (
            <Card><CardContent className="p-4 space-y-3">
              <div className="space-y-2"><Label>What I did</Label><Textarea value={checkInForm.did} onChange={e => setCheckInForm(p => ({ ...p, did: e.target.value }))} placeholder="Completed tasks, progress made..." data-testid="textarea-checkin-did" /></div>
              <div className="space-y-2"><Label>What I'm doing next</Label><Textarea value={checkInForm.doing} onChange={e => setCheckInForm(p => ({ ...p, doing: e.target.value }))} placeholder="Focus areas, upcoming work..." data-testid="textarea-checkin-doing" /></div>
              <div className="space-y-2"><Label>Blockers</Label><Textarea value={checkInForm.blockers} onChange={e => setCheckInForm(p => ({ ...p, blockers: e.target.value }))} placeholder="Any blockers or help needed? (optional)" data-testid="textarea-checkin-blockers" /></div>
              <div className="flex gap-2">
                <Button size="sm" disabled={!checkInForm.did.trim() || !checkInForm.doing.trim()} onClick={() => { onCreateCheckIn(checkInForm); setCheckInForm({ did: "", doing: "", blockers: "" }); setShowCheckInForm(false); }} data-testid="button-save-checkin">Submit</Button>
                <Button size="sm" variant="outline" onClick={() => setShowCheckInForm(false)}>Cancel</Button>
              </div>
            </CardContent></Card>
          )}
          {checkIns.length > 0 ? checkIns.map(ci => (
            <Card key={ci.id} data-testid={`checkin-${ci.id}`}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <UserAvatar src={ci.profile?.avatarUrl} name={ci.user?.firstName || ci.user?.email || ""} className="h-6 w-6" />
                  <span className="text-sm font-medium">{ci.user?.firstName || ci.user?.email}</span>
                  <span className="text-xs text-muted-foreground">{new Date(ci.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div><p className="text-xs font-medium text-green-600 dark:text-green-400 uppercase tracking-wide mb-1">Done</p><p className="text-sm">{ci.did}</p></div>
                  <div><p className="text-xs font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wide mb-1">Doing</p><p className="text-sm">{ci.doing}</p></div>
                  <div><p className="text-xs font-medium text-red-600 dark:text-red-400 uppercase tracking-wide mb-1">Blockers</p><p className="text-sm">{ci.blockers || "None"}</p></div>
                </div>
              </CardContent>
            </Card>
          )) : !showCheckInForm && <p className="text-sm text-muted-foreground">No check-ins yet. Team members can share what they did, what's next, and any blockers.</p>}
        </div>
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
