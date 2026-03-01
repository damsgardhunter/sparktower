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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  ArrowLeft,
  Users,
  Kanban,
  LayoutDashboard,
  Plus,
  Sparkles,
  Trash2,
  Calendar,
  GripVertical,
  Upload,
  FileText,
  UserPlus,
  ChevronDown,
  Clock,
  AlertCircle,
  CheckCircle2,
  Circle,
  RotateCcw,
} from "lucide-react";
import type { Project, ProjectMember, UserProfile, User, ProjectKanbanTask, ProjectPersona } from "@shared/schema";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useUpload } from "@/hooks/use-upload";

type TabId = "overview" | "kanban" | "personas";

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

interface ApplicationQuestion {
  id: string;
  question: string;
  required: boolean;
}

export default function ProjectManager() {
  const [, params] = useRoute("/projects/:id/manage");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const projectId = params?.id;

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ProjectKanbanTask | null>(null);
  const [taskForm, setTaskForm] = useState({
    title: "",
    description: "",
    status: "todo" as string,
    priority: "medium" as string,
    assigneeId: "" as string,
    dueDate: "",
  });

  const { uploadFile, isUploading: isUploadingPlan } = useUpload({
    onSuccess: (response) => {
      businessPlanMutation.mutate(response.objectPath);
    },
    onError: () => {
      toast({ title: "Upload failed", description: "Could not upload business plan.", variant: "destructive" });
    },
  });

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
    enabled: !!projectId && activeTab === "overview" && project?.ownerId === user?.id,
  });

  const { data: personas, isLoading: personasLoading } = useQuery<ProjectPersona[]>({
    queryKey: ["/api/projects", projectId, "personas"],
    enabled: !!projectId && activeTab === "personas",
  });

  const businessPlanMutation = useMutation({
    mutationFn: async (url: string) => {
      await apiRequest("POST", `/api/projects/${projectId}/business-plan`, { businessPlanUrl: url });
    },
    onSuccess: () => {
      toast({ title: "Business plan uploaded" });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
    },
  });

  const createTaskMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/kanban`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Task created" });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "kanban"] });
      closeTaskDialog();
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ taskId, data }: { taskId: string; data: any }) => {
      const res = await apiRequest("PATCH", `/api/kanban/${taskId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "kanban"] });
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (taskId: string) => {
      await apiRequest("DELETE", `/api/kanban/${taskId}`);
    },
    onSuccess: () => {
      toast({ title: "Task deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "kanban"] });
    },
  });

  const aiGenerateTasksMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/kanban/ai-generate`);
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Tasks generated", description: `Nova created ${data.length} tasks for your project.` });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "kanban"] });
    },
    onError: (error: any) => {
      const msg = error.message || "";
      if (msg.includes("403") || msg.includes("Insufficient")) {
        toast({ title: "Insufficient credits", description: "AI task generation costs 1 credit.", variant: "destructive" });
      } else {
        toast({ title: "Generation failed", variant: "destructive" });
      }
    },
  });

  const [personaDialogOpen, setPersonaDialogOpen] = useState(false);
  const [personaForm, setPersonaForm] = useState({
    name: "", age: "", occupation: "", bio: "",
    goals: "" as string, painPoints: "" as string, quote: "",
  });

  const createPersonaMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/personas`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Persona created" });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "personas"] });
      setPersonaDialogOpen(false);
      setPersonaForm({ name: "", age: "", occupation: "", bio: "", goals: "", painPoints: "", quote: "" });
    },
  });

  const deletePersonaMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/personas/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Persona deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "personas"] });
    },
  });

  const aiGeneratePersonaMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/personas/generate`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Persona generated by Nova AI" });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "personas"] });
    },
    onError: (error: any) => {
      const msg = error.message || "";
      if (msg.includes("403") || msg.includes("Insufficient")) {
        toast({ title: "Insufficient credits", description: "AI persona generation costs 1 credit.", variant: "destructive" });
      } else {
        toast({ title: "Generation failed", variant: "destructive" });
      }
    },
  });

  const recommendPeopleMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/recommend-people`);
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Recommendations ready", description: `Found ${data.recommendations?.length || 0} potential team members.` });
    },
    onError: (error: any) => {
      const msg = error.message || "";
      if (msg.includes("403") || msg.includes("Insufficient")) {
        toast({ title: "Insufficient credits", variant: "destructive" });
      } else {
        toast({ title: "Recommendation failed", variant: "destructive" });
      }
    },
  });

  const updateProjectMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/projects/${projectId}`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Project updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
    },
    onError: () => {
      toast({ title: "Failed to update project", variant: "destructive" });
    },
  });

  function openNewTaskDialog(status: string = "todo") {
    setEditingTask(null);
    setTaskForm({ title: "", description: "", status, priority: "medium", assigneeId: "", dueDate: "" });
    setTaskDialogOpen(true);
  }

  function openEditTaskDialog(task: ProjectKanbanTask) {
    setEditingTask(task);
    setTaskForm({
      title: task.title,
      description: task.description || "",
      status: task.status,
      priority: task.priority,
      assigneeId: task.assigneeId || "",
      dueDate: task.dueDate ? new Date(task.dueDate).toISOString().split("T")[0] : "",
    });
    setTaskDialogOpen(true);
  }

  function closeTaskDialog() {
    setTaskDialogOpen(false);
    setEditingTask(null);
    setTaskForm({ title: "", description: "", status: "todo", priority: "medium", assigneeId: "", dueDate: "" });
  }

  function handleTaskSubmit() {
    const data = {
      title: taskForm.title,
      description: taskForm.description || null,
      status: taskForm.status,
      priority: taskForm.priority,
      assigneeId: taskForm.assigneeId || null,
      dueDate: taskForm.dueDate || null,
    };
    if (editingTask) {
      updateTaskMutation.mutate({ taskId: editingTask.id, data });
      closeTaskDialog();
    } else {
      createTaskMutation.mutate(data);
    }
  }

  function handleStatusChange(taskId: string, newStatus: string) {
    updateTaskMutation.mutate({ taskId, data: { status: newStatus } });
  }

  if (projectLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-secondary">Project not found</p>
        <Button variant="outline" onClick={() => setLocation("/projects")} data-testid="button-back-projects">
          Back to Projects
        </Button>
      </div>
    );
  }

  const isOwner = project.ownerId === user?.id;
  const isMember = members?.some((m) => m.userId === user?.id);

  if (!isOwner && !isMember) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-secondary">You don't have access to this project's management dashboard.</p>
        <Button variant="outline" onClick={() => setLocation(`/projects/${projectId}`)} data-testid="button-back-project">
          Back to Project
        </Button>
      </div>
    );
  }

  const questions: ApplicationQuestion[] = (project.applicationQuestions as ApplicationQuestion[]) || [];

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
          <div className="flex gap-1">
            {([
              { id: "overview" as TabId, label: "Overview", icon: LayoutDashboard },
              { id: "kanban" as TabId, label: "Kanban", icon: Kanban },
              { id: "personas" as TabId, label: "Personas", icon: Users },
            ]).map((tab) => (
              <Button
                key={tab.id}
                variant={activeTab === tab.id ? "default" : "ghost"}
                size="sm"
                className="gap-2"
                onClick={() => setActiveTab(tab.id)}
                data-testid={`tab-${tab.id}`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {activeTab === "overview" && (
          <OverviewTab
            project={project}
            members={members}
            applications={applications}
            questions={questions}
            isOwner={isOwner}
            isUploadingPlan={isUploadingPlan}
            onUploadPlan={(file) => uploadFile(file)}
            onUpdateQuestions={(qs) => updateProjectMutation.mutate({ applicationQuestions: qs })}
            onRecommendPeople={() => recommendPeopleMutation.mutate()}
            recommendPending={recommendPeopleMutation.isPending}
            recommendData={recommendPeopleMutation.data}
          />
        )}
        {activeTab === "kanban" && (
          <KanbanTab
            tasks={kanbanTasks || []}
            members={members || []}
            isLoading={tasksLoading}
            onNewTask={openNewTaskDialog}
            onEditTask={openEditTaskDialog}
            onDeleteTask={(id) => deleteTaskMutation.mutate(id)}
            onStatusChange={handleStatusChange}
            onAiGenerate={() => aiGenerateTasksMutation.mutate()}
            aiPending={aiGenerateTasksMutation.isPending}
          />
        )}
        {activeTab === "personas" && (
          <PersonasTab
            personas={personas || []}
            isLoading={personasLoading}
            onCreateManual={() => setPersonaDialogOpen(true)}
            onAiGenerate={() => aiGeneratePersonaMutation.mutate()}
            onDelete={(id) => deletePersonaMutation.mutate(id)}
            aiPending={aiGeneratePersonaMutation.isPending}
            projectDescription={project.description}
          />
        )}
      </div>

      <Dialog open={taskDialogOpen} onOpenChange={setTaskDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingTask ? "Edit Task" : "New Task"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Title</label>
              <Input
                value={taskForm.title}
                onChange={(e) => setTaskForm((p) => ({ ...p, title: e.target.value }))}
                placeholder="Task title"
                data-testid="input-task-title"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Textarea
                value={taskForm.description}
                onChange={(e) => setTaskForm((p) => ({ ...p, description: e.target.value }))}
                placeholder="Task description (optional)"
                data-testid="input-task-description"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Status</label>
                <Select value={taskForm.status} onValueChange={(v) => setTaskForm((p) => ({ ...p, status: v }))}>
                  <SelectTrigger data-testid="select-task-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KANBAN_COLUMNS.map((col) => (
                      <SelectItem key={col.id} value={col.id}>{col.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Priority</label>
                <Select value={taskForm.priority} onValueChange={(v) => setTaskForm((p) => ({ ...p, priority: v }))}>
                  <SelectTrigger data-testid="select-task-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Assignee</label>
              <Select value={taskForm.assigneeId || "unassigned"} onValueChange={(v) => setTaskForm((p) => ({ ...p, assigneeId: v === "unassigned" ? "" : v }))}>
                <SelectTrigger data-testid="select-task-assignee">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {members?.map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.profile?.displayName || m.user.firstName || m.user.email || "Member"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Due Date</label>
              <Input
                type="date"
                value={taskForm.dueDate}
                onChange={(e) => setTaskForm((p) => ({ ...p, dueDate: e.target.value }))}
                data-testid="input-task-due-date"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeTaskDialog} data-testid="button-cancel-task">Cancel</Button>
            <Button
              onClick={handleTaskSubmit}
              disabled={!taskForm.title.trim() || createTaskMutation.isPending || updateTaskMutation.isPending}
              data-testid="button-submit-task"
            >
              {(createTaskMutation.isPending || updateTaskMutation.isPending) && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editingTask ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={personaDialogOpen} onOpenChange={setPersonaDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Persona</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Name *</Label>
                <Input value={personaForm.name} onChange={(e) => setPersonaForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Sarah Chen" data-testid="input-persona-name" />
              </div>
              <div className="space-y-2">
                <Label>Age</Label>
                <Input type="number" value={personaForm.age} onChange={(e) => setPersonaForm(p => ({ ...p, age: e.target.value }))} placeholder="32" data-testid="input-persona-age" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Occupation</Label>
              <Input value={personaForm.occupation} onChange={(e) => setPersonaForm(p => ({ ...p, occupation: e.target.value }))} placeholder="Product Manager at a SaaS startup" data-testid="input-persona-occupation" />
            </div>
            <div className="space-y-2">
              <Label>Bio</Label>
              <Textarea value={personaForm.bio} onChange={(e) => setPersonaForm(p => ({ ...p, bio: e.target.value }))} placeholder="Brief description of who this person is..." className="min-h-[60px]" data-testid="textarea-persona-bio" />
            </div>
            <div className="space-y-2">
              <Label>Goals (comma-separated)</Label>
              <Input value={personaForm.goals} onChange={(e) => setPersonaForm(p => ({ ...p, goals: e.target.value }))} placeholder="Save time, Reduce costs, Scale team" data-testid="input-persona-goals" />
            </div>
            <div className="space-y-2">
              <Label>Pain Points (comma-separated)</Label>
              <Input value={personaForm.painPoints} onChange={(e) => setPersonaForm(p => ({ ...p, painPoints: e.target.value }))} placeholder="Too many tools, Lack of visibility" data-testid="input-persona-pain-points" />
            </div>
            <div className="space-y-2">
              <Label>Quote</Label>
              <Input value={personaForm.quote} onChange={(e) => setPersonaForm(p => ({ ...p, quote: e.target.value }))} placeholder="I just want something that works." data-testid="input-persona-quote" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPersonaDialogOpen(false)}>Cancel</Button>
            <Button disabled={!personaForm.name.trim() || createPersonaMutation.isPending} onClick={() => {
              createPersonaMutation.mutate({
                name: personaForm.name,
                age: personaForm.age ? parseInt(personaForm.age) : undefined,
                occupation: personaForm.occupation || undefined,
                bio: personaForm.bio || undefined,
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

function PersonasTab({
  personas,
  isLoading,
  onCreateManual,
  onAiGenerate,
  onDelete,
  aiPending,
  projectDescription,
}: {
  personas: ProjectPersona[];
  isLoading: boolean;
  onCreateManual: () => void;
  onAiGenerate: () => void;
  onDelete: (id: string) => void;
  aiPending: boolean;
  projectDescription: string;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Customer Personas</h2>
          <p className="text-sm text-muted-foreground">Define your target audience with AI-generated or manual personas.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={onAiGenerate} disabled={aiPending} data-testid="button-ai-generate-persona">
            {aiPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            AI Generate
          </Button>
          <Button size="sm" className="gap-2" onClick={onCreateManual} data-testid="button-create-persona">
            <Plus className="h-4 w-4" /> Create Manually
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : personas.length === 0 ? (
        <div className="border-2 border-dashed border-border rounded-lg p-12 text-center">
          <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h3 className="text-lg font-medium mb-2">No personas yet</h3>
          <p className="text-sm text-muted-foreground mb-4">Create customer personas to better understand your target audience.</p>
          <div className="flex items-center justify-center gap-3">
            <Button variant="outline" onClick={onAiGenerate} disabled={aiPending} data-testid="button-ai-generate-persona-empty">
              <Sparkles className="h-4 w-4 mr-2" /> Generate with Nova AI
            </Button>
            <Button onClick={onCreateManual}>
              <Plus className="h-4 w-4 mr-2" /> Create Manually
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {personas.map((persona) => (
            <Card key={persona.id} className="border-border/50 relative group" data-testid={`persona-card-${persona.id}`}>
              <Button variant="ghost" size="icon" className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7 text-destructive hover:text-destructive" onClick={() => onDelete(persona.id)} data-testid={`button-delete-persona-${persona.id}`}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="h-12 w-12 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center text-lg font-bold text-primary shrink-0">
                    {persona.name.charAt(0)}
                  </div>
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
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wide">Goals</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(persona.goals as string[]).map((g, i) => (
                        <Badge key={i} variant="secondary" className="text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">{g}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {persona.painPoints && (persona.painPoints as string[]).length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wide">Pain Points</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(persona.painPoints as string[]).map((p, i) => (
                        <Badge key={i} variant="secondary" className="text-xs bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">{p}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {persona.quote && (
                  <blockquote className="border-l-2 border-primary/30 pl-3 italic text-sm text-muted-foreground">
                    "{persona.quote}"
                  </blockquote>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function OverviewTab({
  project,
  members,
  applications,
  questions,
  isOwner,
  isUploadingPlan,
  onUploadPlan,
  onUpdateQuestions,
  onRecommendPeople,
  recommendPending,
  recommendData,
}: {
  project: Project;
  members: any[] | undefined;
  applications: any[] | undefined;
  questions: ApplicationQuestion[];
  isOwner: boolean;
  isUploadingPlan: boolean;
  onUploadPlan: (file: File) => void;
  onUpdateQuestions: (qs: ApplicationQuestion[]) => void;
  onRecommendPeople: () => void;
  recommendPending: boolean;
  recommendData: any;
}) {
  const [newQuestion, setNewQuestion] = useState("");

  function addQuestion(question: string) {
    if (!question.trim()) return;
    const updated = [...questions, { id: crypto.randomUUID(), question: question.trim(), required: false }];
    onUpdateQuestions(updated);
    setNewQuestion("");
  }

  function removeQuestion(id: string) {
    onUpdateQuestions(questions.filter((q) => q.id !== id));
  }

  function toggleRequired(id: string) {
    onUpdateQuestions(questions.map((q) => q.id === id ? { ...q, required: !q.required } : q));
  }

  const pendingApps = applications?.filter((a) => a.status === "pending") || [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Project Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <span className="text-sm text-secondary">Status</span>
            <div className="mt-1">
              <Badge variant={project.status === "active" ? "default" : "secondary"} data-testid="badge-project-status">
                {project.status}
              </Badge>
            </div>
          </div>
          <div>
            <span className="text-sm text-secondary">Category</span>
            <p className="font-medium">{project.category}</p>
          </div>
          <div>
            <span className="text-sm text-secondary">Description</span>
            <p className="text-sm leading-relaxed mt-1">{project.description}</p>
          </div>
          <div className="flex flex-wrap gap-4">
            <div>
              <span className="text-sm text-secondary">Team Size</span>
              <p className="font-medium">{project.teamSize}</p>
            </div>
            <div>
              <span className="text-sm text-secondary">Timeline</span>
              <p className="font-medium">{project.estimatedWeeks} weeks</p>
            </div>
            <div>
              <span className="text-sm text-secondary">Views</span>
              <p className="font-medium">{project.views}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Business Plan
          </CardTitle>
        </CardHeader>
        <CardContent>
          {project.businessPlanUrl ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 rounded-md bg-muted/50">
                <FileText className="h-5 w-5 text-primary" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">Business Plan</p>
                  <p className="text-xs text-secondary truncate">{project.businessPlanUrl}</p>
                </div>
                <Button variant="outline" size="sm" asChild data-testid="link-business-plan">
                  <a href={project.businessPlanUrl} target="_blank" rel="noopener noreferrer">View</a>
                </Button>
              </div>
              {isOwner && (
                <label className="cursor-pointer">
                  <input
                    type="file"
                    className="hidden"
                    accept=".pdf,.doc,.docx,.ppt,.pptx"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadPlan(f); }}
                    data-testid="input-replace-plan"
                  />
                  <Button variant="ghost" size="sm" className="gap-2" asChild>
                    <span>
                      <RotateCcw className="h-3 w-3" />
                      Replace
                    </span>
                  </Button>
                </label>
              )}
            </div>
          ) : isOwner ? (
            <label className="cursor-pointer">
              <input
                type="file"
                className="hidden"
                accept=".pdf,.doc,.docx,.ppt,.pptx"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadPlan(f); }}
                data-testid="input-upload-plan"
              />
              <div className="border-2 border-dashed border-border rounded-md p-8 text-center hover-elevate transition-colors">
                {isUploadingPlan ? (
                  <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                ) : (
                  <>
                    <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
                    <p className="text-sm font-medium">Upload Business Plan</p>
                    <p className="text-xs text-secondary mt-1">PDF, DOC, DOCX, PPT, PPTX</p>
                  </>
                )}
              </div>
            </label>
          ) : (
            <p className="text-sm text-secondary">No business plan uploaded yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0">
          <CardTitle className="text-lg">Team Members</CardTitle>
          <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate">{members?.length || 0}</Badge>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {members?.map((member) => (
              <div key={member.id} className="flex items-center gap-3" data-testid={`member-${member.userId}`}>
                <UserAvatar
                  src={member.profile?.avatarUrl}
                  name={member.profile?.displayName || member.user.firstName || member.user.email || "Member"}
                  className="h-8 w-8"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {member.profile?.displayName || member.user.firstName || member.user.email || "Member"}
                  </p>
                  <p className="text-xs text-tertiary capitalize">{member.role}</p>
                </div>
                {member.userId === project.ownerId && (
                  <Badge variant="outline" className="no-default-hover-elevate no-default-active-elevate text-xs">Owner</Badge>
                )}
              </div>
            ))}
            {(!members || members.length === 0) && (
              <p className="text-sm text-secondary">No team members yet.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {isOwner && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0">
            <CardTitle className="text-lg">Pending Applications</CardTitle>
            {pendingApps.length > 0 && (
              <Badge variant="default" className="no-default-hover-elevate no-default-active-elevate">{pendingApps.length}</Badge>
            )}
          </CardHeader>
          <CardContent>
            {pendingApps.length > 0 ? (
              <div className="space-y-3">
                {pendingApps.map((app: any) => (
                  <div key={app.id} className="flex items-center gap-3 p-2 rounded-md bg-muted/30" data-testid={`application-${app.id}`}>
                    <UserAvatar src={null} name={app.userId} className="h-8 w-8" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{app.message || "No message"}</p>
                      <p className="text-xs text-tertiary">{new Date(app.createdAt).toLocaleDateString()}</p>
                    </div>
                    <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate text-xs">Pending</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-secondary">No pending applications.</p>
            )}
          </CardContent>
        </Card>
      )}

      {isOwner && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Application Questions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {questions.length > 0 && (
              <div className="space-y-2">
                {questions.map((q) => (
                  <div key={q.id} className="flex items-center gap-2 p-2 rounded-md bg-muted/30" data-testid={`question-${q.id}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">{q.question}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={q.required ? "text-primary" : "text-muted-foreground"}
                      onClick={() => toggleRequired(q.id)}
                      data-testid={`toggle-required-${q.id}`}
                    >
                      {q.required ? "Required" : "Optional"}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => removeQuestion(q.id)} data-testid={`delete-question-${q.id}`}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-2">
              <p className="text-xs text-secondary font-medium">Suggested questions</p>
              <div className="flex flex-wrap gap-1">
                {SUGGESTED_QUESTIONS.filter((sq) => !questions.some((q) => q.question === sq)).slice(0, 4).map((sq) => (
                  <Button key={sq} variant="outline" size="sm" className="text-xs" onClick={() => addQuestion(sq)} data-testid={`suggest-question`}>
                    <Plus className="h-3 w-3 mr-1" />
                    {sq.length > 40 ? sq.slice(0, 40) + "..." : sq}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Input
                value={newQuestion}
                onChange={(e) => setNewQuestion(e.target.value)}
                placeholder="Add a custom question..."
                className="flex-1"
                onKeyDown={(e) => { if (e.key === "Enter") addQuestion(newQuestion); }}
                data-testid="input-custom-question"
              />
              <Button size="icon" onClick={() => addQuestion(newQuestion)} disabled={!newQuestion.trim()} data-testid="button-add-question">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <UserPlus className="h-4 w-4" />
            AI People Recommendations
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-secondary">
            Let Nova AI analyze your project and recommend ideal team members from the community.
          </p>
          <Button
            onClick={onRecommendPeople}
            disabled={recommendPending}
            className="gap-2"
            data-testid="button-recommend-people"
          >
            {recommendPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {recommendPending ? "Finding matches..." : "Find Team Members"}
          </Button>
          {recommendData?.recommendations && recommendData.recommendations.length > 0 && (
            <div className="space-y-2 mt-4">
              {recommendData.recommendations.map((rec: any, i: number) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-md bg-muted/30" data-testid={`recommendation-${i}`}>
                  <UserAvatar src={rec.avatarUrl} name={rec.displayName || rec.username} className="h-8 w-8" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{rec.displayName || rec.username || "User"}</p>
                    <p className="text-xs text-secondary">{rec.reason || rec.matchReason}</p>
                  </div>
                  {rec.score && <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate text-xs">{rec.score}%</Badge>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KanbanTab({
  tasks,
  members,
  isLoading,
  onNewTask,
  onEditTask,
  onDeleteTask,
  onStatusChange,
  onAiGenerate,
  aiPending,
}: {
  tasks: ProjectKanbanTask[];
  members: (ProjectMember & { user: User; profile?: UserProfile })[];
  isLoading: boolean;
  onNewTask: (status: string) => void;
  onEditTask: (task: ProjectKanbanTask) => void;
  onDeleteTask: (id: string) => void;
  onStatusChange: (taskId: string, newStatus: string) => void;
  onAiGenerate: () => void;
  aiPending: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  function getMemberName(userId: string | null) {
    if (!userId) return null;
    const member = members.find((m) => m.userId === userId);
    return member?.profile?.displayName || member?.user.firstName || member?.user.email || null;
  }

  function getMemberAvatar(userId: string | null) {
    if (!userId) return null;
    const member = members.find((m) => m.userId === userId);
    return member?.profile?.avatarUrl || null;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Kanban Board</h2>
          <p className="text-sm text-secondary">{tasks.length} tasks total</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2" onClick={onAiGenerate} disabled={aiPending} data-testid="button-ai-generate-tasks">
            {aiPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            AI Generate Tasks
          </Button>
          <Button className="gap-2" onClick={() => onNewTask("todo")} data-testid="button-new-task">
            <Plus className="h-4 w-4" />
            New Task
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {KANBAN_COLUMNS.map((col) => {
          const ColIcon = col.icon;
          const columnTasks = tasks
            .filter((t) => t.status === col.id)
            .sort((a, b) => a.order - b.order);

          return (
            <div key={col.id} className="space-y-3" data-testid={`kanban-column-${col.id}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ColIcon className={`h-4 w-4 ${col.color}`} />
                  <span className="text-sm font-medium">{col.label}</span>
                  <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate text-xs">{columnTasks.length}</Badge>
                </div>
                <Button variant="ghost" size="icon" onClick={() => onNewTask(col.id)} data-testid={`button-add-task-${col.id}`}>
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="space-y-2 min-h-[8rem]">
                {columnTasks.map((task) => (
                  <Card
                    key={task.id}
                    className="hover-elevate cursor-pointer"
                    onClick={() => onEditTask(task)}
                    data-testid={`task-card-${task.id}`}
                  >
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium leading-tight flex-1">{task.title}</p>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
                          onClick={(e) => { e.stopPropagation(); onDeleteTask(task.id); }}
                          data-testid={`button-delete-task-${task.id}`}
                          style={{ visibility: "visible" }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                      {task.description && (
                        <p className="text-xs text-secondary line-clamp-2">{task.description}</p>
                      )}
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <Badge
                          variant="secondary"
                          className={`no-default-hover-elevate no-default-active-elevate text-xs ${PRIORITY_COLORS[task.priority]}`}
                          data-testid={`badge-priority-${task.id}`}
                        >
                          {task.priority}
                        </Badge>
                        <div className="flex items-center gap-2">
                          {task.dueDate && (
                            <span className="text-xs text-tertiary flex items-center gap-1" data-testid={`text-due-${task.id}`}>
                              <Calendar className="h-3 w-3" />
                              {new Date(task.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                            </span>
                          )}
                          {task.assigneeId && (
                            <UserAvatar
                              src={getMemberAvatar(task.assigneeId)}
                              name={getMemberName(task.assigneeId) || ""}
                              className="h-5 w-5"
                            />
                          )}
                        </div>
                      </div>
                      <Select
                        value={task.status}
                        onValueChange={(v) => { onStatusChange(task.id, v); }}
                      >
                        <SelectTrigger
                          className="h-7 text-xs"
                          onClick={(e) => e.stopPropagation()}
                          data-testid={`select-status-${task.id}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {KANBAN_COLUMNS.map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </CardContent>
                  </Card>
                ))}
                {columnTasks.length === 0 && (
                  <div className="border-2 border-dashed border-border rounded-md p-6 text-center">
                    <p className="text-xs text-muted-foreground">No tasks</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
