import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/user-avatar";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import type {
  CofounderSprint, SprintResponse, SprintKanbanTask,
  SprintMessage, SprintDeliverable, SprintRating,
  SprintDecision, SprintCompatibilityReport, User,
} from "@shared/schema";
import {
  Loader2, CheckCircle2, Circle, Clock, ArrowRight,
  Send, MessageSquare, ChevronDown, ChevronUp,
  Users, Timer, Sparkles, Lightbulb, Target,
  FileText, LayoutList, User as UserIcon,
  Star, ThumbsUp, ThumbsDown, AlertTriangle,
  Shield, TrendingUp, Rocket, Mail, Share2,
  HelpCircle, Camera, Handshake, PenLine, Cpu, Dice5,
} from "lucide-react";

const SPRINT_PHASES = ["setup", "ideation", "alignment", "building", "validation", "review", "completed"] as const;

const PHASE_LABELS: Record<string, string> = {
  setup: "Setup",
  ideation: "Ideation",
  alignment: "Alignment",
  building: "Building",
  validation: "Validation",
  review: "Review",
  completed: "Completed",
};

const PHASE_ICONS: Record<string, any> = {
  setup: Sparkles,
  ideation: Lightbulb,
  alignment: Target,
  building: LayoutList,
  validation: FileText,
  review: Users,
  completed: CheckCircle2,
};

const IDEATION_QUESTIONS = [
  { key: "real_problem", label: "What real problem does this product solve?", placeholder: "Describe the core problem you see..." },
  { key: "target_user", label: "Who is the target user?", placeholder: "Describe the ideal user persona..." },
  { key: "riskiest_assumption", label: "What is the riskiest assumption?", placeholder: "What could make this fail?" },
  { key: "success_criteria", label: "What does success look like?", placeholder: "Define measurable success criteria..." },
];

const KANBAN_COLUMNS = [
  { id: "todo" as const, label: "To Do", icon: Circle },
  { id: "in-progress" as const, label: "In Progress", icon: Clock },
  { id: "done" as const, label: "Done", icon: CheckCircle2 },
];

type SprintWithUsers = CofounderSprint & { user1?: User; user2?: User };

export default function SprintDashboard() {
  const [, params] = useRoute("/sprints/:id");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const sprintId = params?.id;

  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const [ideationAnswers, setIdeationAnswers] = useState<Record<string, string>>({});
  const [alignmentForm, setAlignmentForm] = useState({
    agreedProblem: "", agreedIcp: "", agreedValueProp: "", validationQuestions: ["", "", ""],
  });
  const [ratingForm, setRatingForm] = useState({
    communicationClarity: 3, reliability: 3, wouldBuildLongTerm: false, stressLevel: 3,
  });
  const [decisionForm, setDecisionForm] = useState({ decision: "" as string, reason: "" });
  const [validationForm, setValidationForm] = useState({
    outreachEmail: "", socialPosts: "", interviewQuestions: "", evidence: "",
  });
  const chatEndRef = useRef<HTMLDivElement>(null);

  const { data: sprint, isLoading: sprintLoading } = useQuery<SprintWithUsers>({
    queryKey: ["/api/sprints", sprintId],
    enabled: !!sprintId,
    refetchInterval: 5000,
  });

  const { data: responses } = useQuery<SprintResponse[]>({
    queryKey: ["/api/sprints", sprintId, "responses"],
    enabled: !!sprintId && !!sprint && ["ideation", "alignment", "building", "validation", "review", "completed"].includes(sprint.status),
    refetchInterval: 5000,
  });

  const { data: tasks } = useQuery<SprintKanbanTask[]>({
    queryKey: ["/api/sprints", sprintId, "tasks"],
    enabled: !!sprintId && !!sprint && ["building", "validation", "review", "completed"].includes(sprint.status),
    refetchInterval: 5000,
  });

  const { data: messages } = useQuery<(SprintMessage & { user?: User })[]>({
    queryKey: ["/api/sprints", sprintId, "messages"],
    enabled: !!sprintId && chatOpen,
    refetchInterval: 3000,
  });

  const { data: deliverables } = useQuery<SprintDeliverable[]>({
    queryKey: ["/api/sprints", sprintId, "deliverables"],
    enabled: !!sprintId && !!sprint && ["building", "validation", "review", "completed"].includes(sprint.status),
    refetchInterval: 5000,
  });

  const { data: ratings } = useQuery<SprintRating[]>({
    queryKey: ["/api/sprints", sprintId, "ratings"],
    enabled: !!sprintId && !!sprint && ["review", "completed"].includes(sprint.status),
  });

  const { data: decisions } = useQuery<SprintDecision[]>({
    queryKey: ["/api/sprints", sprintId, "decisions"],
    enabled: !!sprintId && !!sprint && ["review", "completed"].includes(sprint.status),
  });

  const { data: report } = useQuery<SprintCompatibilityReport>({
    queryKey: ["/api/sprints", sprintId, "report"],
    enabled: !!sprintId && !!sprint && sprint.status === "completed",
  });

  useEffect(() => {
    if (sprint) {
      setAlignmentForm({
        agreedProblem: sprint.agreedProblem || "",
        agreedIcp: sprint.agreedIcp || "",
        agreedValueProp: sprint.agreedValueProp || "",
        validationQuestions: (sprint.validationQuestions as string[]) || ["", "", ""],
      });
    }
  }, [sprint?.id, sprint?.agreedProblem, sprint?.agreedIcp, sprint?.agreedValueProp]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages?.length]);

  const advanceMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/sprints/${sprintId}/advance`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Sprint advanced to next phase" });
      queryClient.invalidateQueries({ queryKey: ["/api/sprints", sprintId] });
      queryClient.invalidateQueries({ queryKey: ["/api/sprints", sprintId, "tasks"] });
    },
    onError: () => { toast({ title: "Failed to advance sprint", variant: "destructive" }); },
  });

  const submitResponseMutation = useMutation({
    mutationFn: async ({ questionKey, answer }: { questionKey: string; answer: string }) => {
      const res = await apiRequest("POST", `/api/sprints/${sprintId}/responses`, { questionKey, answer });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sprints", sprintId, "responses"] });
    },
    onError: () => { toast({ title: "Failed to submit response", variant: "destructive" }); },
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await apiRequest("POST", `/api/sprints/${sprintId}/messages`, { content });
      return res.json();
    },
    onSuccess: () => {
      setChatMessage("");
      queryClient.invalidateQueries({ queryKey: ["/api/sprints", sprintId, "messages"] });
    },
  });

  const updateAlignmentMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", `/api/sprints/${sprintId}/update-alignment`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Alignment updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/sprints", sprintId] });
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ taskId, data }: { taskId: string; data: any }) => {
      const res = await apiRequest("PATCH", `/api/sprints/${sprintId}/tasks/${taskId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sprints", sprintId, "tasks"] });
    },
  });

  const submitDeliverableMutation = useMutation({
    mutationFn: async ({ type, content }: { type: string; content: any }) => {
      const res = await apiRequest("POST", `/api/sprints/${sprintId}/deliverables`, { type, content });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Deliverable submitted" });
      queryClient.invalidateQueries({ queryKey: ["/api/sprints", sprintId, "deliverables"] });
    },
  });

  const submitDecisionMutation = useMutation({
    mutationFn: async (data: { decision: string; reason: string }) => {
      const res = await apiRequest("POST", `/api/sprints/${sprintId}/decisions`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Decision submitted" });
      queryClient.invalidateQueries({ queryKey: ["/api/sprints", sprintId, "decisions"] });
    },
    onError: () => { toast({ title: "Failed to submit decision", variant: "destructive" }); },
  });

  const submitRatingMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", `/api/sprints/${sprintId}/ratings`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Rating submitted" });
      queryClient.invalidateQueries({ queryKey: ["/api/sprints", sprintId, "ratings"] });
    },
    onError: () => { toast({ title: "Failed to submit rating", variant: "destructive" }); },
  });

  const generateReportMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/sprints/${sprintId}/generate-report`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Compatibility report generated" });
      queryClient.invalidateQueries({ queryKey: ["/api/sprints", sprintId, "report"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sprints", sprintId] });
    },
    onError: () => { toast({ title: "Failed to generate report", variant: "destructive" }); },
  });

  const convertProjectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/sprints/${sprintId}/convert`);
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Sprint converted to project!" });
      setLocation(`/projects/${data.project?.id || ""}`);
    },
    onError: () => { toast({ title: "Failed to convert to project", variant: "destructive" }); },
  });

  if (sprintLoading) {
    return (
      <div className="flex items-center justify-center h-full" data-testid="loading-sprint">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!sprint) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-muted-foreground">Sprint not found</p>
        <Button variant="outline" onClick={() => setLocation("/matches")} data-testid="button-back-matches">
          Back to Matches
        </Button>
      </div>
    );
  }

  const isParticipant = sprint.user1Id === user?.id || sprint.user2Id === user?.id;
  if (!isParticipant) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-muted-foreground">You are not a participant in this sprint.</p>
        <Button variant="outline" onClick={() => setLocation("/")} data-testid="button-back-home">Go Home</Button>
      </div>
    );
  }

  const partnerId = sprint.user1Id === user?.id ? sprint.user2Id : sprint.user1Id;
  const partnerUser = sprint.user1Id === user?.id ? sprint.user2 : sprint.user1;
  const currentUser = sprint.user1Id === user?.id ? sprint.user1 : sprint.user2;
  const currentPhaseIdx = SPRINT_PHASES.indexOf(sprint.status as any);

  const myResponses = responses?.filter(r => r.userId === user?.id) || [];
  const partnerResponses = responses?.filter(r => r.userId === partnerId) || [];
  const allMyQuestionsAnswered = IDEATION_QUESTIONS.every(q => myResponses.some(r => r.questionKey === q.key));

  function handleSubmitAllResponses() {
    IDEATION_QUESTIONS.forEach(q => {
      const answer = ideationAnswers[q.key];
      if (answer && answer.trim()) {
        const existing = myResponses.find(r => r.questionKey === q.key);
        if (!existing) {
          submitResponseMutation.mutate({ questionKey: q.key, answer: answer.trim() });
        }
      }
    });
  }

  function handleSendChat() {
    if (!chatMessage.trim()) return;
    sendMessageMutation.mutate(chatMessage.trim());
  }

  const visiblePhases = sprint.duration === "24h"
    ? SPRINT_PHASES.filter(p => p !== "validation")
    : [...SPRINT_PHASES];

  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-border bg-background/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center gap-4 mb-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold truncate" data-testid="text-sprint-product-name">
                {sprint.productName || "Co-Founder Sprint"}
              </h1>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Badge variant="secondary" data-testid="badge-sprint-duration">
                  <Timer className="h-3 w-3 mr-1" />
                  {sprint.duration}
                </Badge>
                {sprint.productStyle && (
                  <Badge variant="outline" data-testid="badge-sprint-style">{sprint.productStyle}</Badge>
                )}
                <Badge variant="outline" data-testid="badge-sprint-status">{PHASE_LABELS[sprint.status]}</Badge>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <UserAvatar src={currentUser?.profileImageUrl} name={currentUser?.firstName || "You"} className="h-8 w-8" />
                <span className="text-sm font-medium" data-testid="text-user-name">{currentUser?.firstName || "You"}</span>
              </div>
              <Users className="h-4 w-4 text-muted-foreground" />
              <div className="flex items-center gap-2">
                <UserAvatar src={partnerUser?.profileImageUrl} name={partnerUser?.firstName || "Partner"} className="h-8 w-8" />
                <span className="text-sm font-medium" data-testid="text-partner-name">{partnerUser?.firstName || "Partner"}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {visiblePhases.map((phase, idx) => {
              const phaseIdx = SPRINT_PHASES.indexOf(phase);
              const isActive = sprint.status === phase;
              const isComplete = currentPhaseIdx > phaseIdx;
              const Icon = PHASE_ICONS[phase] || Circle;
              return (
                <div key={phase} className="flex items-center gap-1 shrink-0">
                  {idx > 0 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
                  <div
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                      isActive ? "bg-primary text-primary-foreground font-medium" :
                      isComplete ? "bg-muted text-foreground" :
                      "text-muted-foreground"
                    }`}
                    data-testid={`phase-step-${phase}`}
                  >
                    {isComplete ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                    <span>{PHASE_LABELS[phase]}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 py-6">
          {sprint.productDescription && (
            <p className="text-sm text-muted-foreground mb-6" data-testid="text-sprint-description">
              {sprint.productDescription}
            </p>
          )}

          {sprint.status === "setup" && (
            <SetupPhase sprint={sprint} user={user!} onAdvance={() => advanceMutation.mutate()} isPending={advanceMutation.isPending} />
          )}
          {sprint.status === "ideation" && (
            <IdeationPhase
              myResponses={myResponses}
              allMyQuestionsAnswered={allMyQuestionsAnswered}
              ideationAnswers={ideationAnswers}
              setIdeationAnswers={setIdeationAnswers}
              onSubmitAll={handleSubmitAllResponses}
              isPending={submitResponseMutation.isPending}
              onAdvance={() => advanceMutation.mutate()}
              advancePending={advanceMutation.isPending}
              partnerResponded={partnerResponses.length > 0}
            />
          )}
          {sprint.status === "alignment" && (
            <AlignmentPhase
              sprint={sprint}
              myResponses={myResponses}
              partnerResponses={partnerResponses}
              currentUser={currentUser}
              partnerUser={partnerUser}
              alignmentForm={alignmentForm}
              setAlignmentForm={setAlignmentForm}
              onSave={() => updateAlignmentMutation.mutate(alignmentForm)}
              savePending={updateAlignmentMutation.isPending}
              onAdvance={() => advanceMutation.mutate()}
              advancePending={advanceMutation.isPending}
            />
          )}
          {sprint.status === "building" && (
            <BuildingPhase
              sprint={sprint}
              tasks={tasks || []}
              deliverables={deliverables || []}
              userId={user?.id || ""}
              partnerId={partnerId}
              currentUser={currentUser}
              partnerUser={partnerUser}
              onUpdateTask={(taskId, data) => updateTaskMutation.mutate({ taskId, data })}
              onSubmitDeliverable={(type, content) => submitDeliverableMutation.mutate({ type, content })}
              deliverablePending={submitDeliverableMutation.isPending}
              onAdvance={() => advanceMutation.mutate()}
              advancePending={advanceMutation.isPending}
            />
          )}
          {sprint.status === "validation" && (
            <ValidationPhase
              sprint={sprint}
              tasks={tasks || []}
              deliverables={deliverables || []}
              validationForm={validationForm}
              setValidationForm={setValidationForm}
              userId={user?.id || ""}
              partnerId={partnerId}
              currentUser={currentUser}
              partnerUser={partnerUser}
              onUpdateTask={(taskId, data) => updateTaskMutation.mutate({ taskId, data })}
              onSubmitDeliverable={(type, content) => submitDeliverableMutation.mutate({ type, content })}
              deliverablePending={submitDeliverableMutation.isPending}
              onAdvance={() => advanceMutation.mutate()}
              advancePending={advanceMutation.isPending}
            />
          )}
          {sprint.status === "review" && (
            <ReviewPhase
              sprint={sprint}
              decisions={decisions || []}
              ratings={ratings || []}
              userId={user?.id || ""}
              decisionForm={decisionForm}
              setDecisionForm={setDecisionForm}
              ratingForm={ratingForm}
              setRatingForm={setRatingForm}
              onSubmitDecision={() => submitDecisionMutation.mutate(decisionForm)}
              decisionPending={submitDecisionMutation.isPending}
              onSubmitRating={() => submitRatingMutation.mutate({
                rateeId: partnerId,
                ...ratingForm,
              })}
              ratingPending={submitRatingMutation.isPending}
              onAdvance={() => advanceMutation.mutate()}
              advancePending={advanceMutation.isPending}
            />
          )}
          {sprint.status === "completed" && (
            <CompletedPhase
              sprint={sprint}
              report={report || null}
              decisions={decisions || []}
              ratings={ratings || []}
              userId={user?.id || ""}
              currentUser={currentUser}
              partnerUser={partnerUser}
              onGenerateReport={() => generateReportMutation.mutate()}
              reportPending={generateReportMutation.isPending}
              onConvertProject={() => convertProjectMutation.mutate()}
              convertPending={convertProjectMutation.isPending}
            />
          )}
        </div>
      </div>

      <div className={`border-t border-border bg-background transition-all ${chatOpen ? "h-80" : "h-12"}`}>
        <button
          onClick={() => setChatOpen(!chatOpen)}
          className="w-full flex items-center justify-between px-6 py-3 hover-elevate"
          data-testid="button-toggle-chat"
        >
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            <span className="text-sm font-medium">Sprint Chat</span>
            {messages && messages.length > 0 && (
              <Badge variant="secondary" className="text-xs">{messages.length}</Badge>
            )}
          </div>
          {chatOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </button>
        {chatOpen && (
          <div className="flex flex-col h-[calc(100%-3rem)]">
            <div className="flex-1 overflow-y-auto px-6 py-2 space-y-2">
              {(!messages || messages.length === 0) && (
                <p className="text-sm text-muted-foreground text-center py-4">No messages yet. Start the conversation!</p>
              )}
              {messages?.map((msg) => {
                const isMe = msg.userId === user?.id;
                return (
                  <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`} data-testid={`chat-message-${msg.id}`}>
                    <div className={`max-w-[70%] px-3 py-2 rounded-md text-sm ${isMe ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                      {!isMe && <p className="text-xs font-medium mb-0.5 opacity-70">{(msg as any).user?.firstName || "Partner"}</p>}
                      <p>{msg.content}</p>
                    </div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>
            <div className="flex items-center gap-2 px-6 py-2 border-t border-border">
              <Input
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                placeholder="Type a message..."
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendChat(); } }}
                data-testid="input-chat-message"
              />
              <Button size="icon" onClick={handleSendChat} disabled={!chatMessage.trim() || sendMessageMutation.isPending} data-testid="button-send-chat">
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SetupPhase({ sprint, user, onAdvance, isPending }: {
  sprint: SprintWithUsers;
  user: User;
  onAdvance: () => void;
  isPending: boolean;
}) {
  const { toast } = useToast();
  const isUser1 = sprint.user1Id === user.id;
  const partner = isUser1 ? sprint.user2 : sprint.user1;
  const myProposal = isUser1 ? sprint.user1ProposedName : sprint.user2ProposedName;
  const partnerProposal = isUser1 ? sprint.user2ProposedName : sprint.user1ProposedName;

  const [proposedName, setProposedName] = useState(myProposal || "");
  const [useNova, setUseNova] = useState(false);

  const proposeNameMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", `/api/sprints/${sprint.id}/propose-name`, { name });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Name proposed!" });
      queryClient.invalidateQueries({ queryKey: ["/api/sprints", sprint.id] });
    },
    onError: () => {
      toast({ title: "Failed to propose name", variant: "destructive" });
    },
  });

  const novaSuggestMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sprints/nova-suggest", {
        productStyle: sprint.productStyle,
        partnerId: partner?.id,
      });
      return res.json();
    },
    onSuccess: (data: { name: string; description: string }) => {
      setProposedName(data.name);
      toast({ title: "Nova suggested a name!", description: data.name });
    },
    onError: () => {
      toast({ title: "Failed to get Nova suggestion", variant: "destructive" });
    },
  });

  const handlePropose = () => {
    if (!proposedName.trim()) return;
    proposeNameMutation.mutate(proposedName.trim());
  };

  const productNameChosen = !!sprint.productName;

  return (
    <div className="space-y-8 max-w-2xl mx-auto py-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-2" data-testid="text-setup-title">Meet Your Sprint Partner</h2>
        <p className="text-muted-foreground">
          You've been matched for a {sprint.duration} co-founder trial sprint. Get to know your partner and propose a product name.
        </p>
      </div>

      {partner && (
        <Card data-testid="card-partner-profile">
          <CardContent className="p-6">
            <div className="flex items-center gap-4 mb-4">
              <UserAvatar src={partner.profileImageUrl} name={partner.firstName || "Partner"} className="h-14 w-14" />
              <div>
                <h3 className="text-lg font-semibold">{partner.firstName} {partner.lastName}</h3>
                {partner.headline && <p className="text-sm text-muted-foreground">{partner.headline}</p>}
              </div>
            </div>
            {partner.bio && (
              <p className="text-sm text-muted-foreground mb-3">{partner.bio}</p>
            )}
            <div className="flex flex-wrap gap-2">
              {(partner.skills as string[] | null)?.slice(0, 6).map((skill, i) => (
                <Badge key={i} variant="secondary">{skill}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {!productNameChosen ? (
        <Card data-testid="card-name-proposal">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <PenLine className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">Propose a Product Name</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Each partner proposes a name independently. Once both have proposed, one will be randomly selected as your sprint project.
            </p>

            {myProposal ? (
              <div className="bg-muted rounded-md p-4 text-center">
                <CheckCircle2 className="h-5 w-5 text-green-500 mx-auto mb-2" />
                <p className="text-sm font-medium" data-testid="text-my-proposal">Your proposal: <strong>{myProposal}</strong></p>
                {!partnerProposal && (
                  <p className="text-xs text-muted-foreground mt-1">Waiting for your partner to propose...</p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Button
                    variant={!useNova ? "default" : "outline"}
                    size="sm"
                    onClick={() => setUseNova(false)}
                    data-testid="button-name-custom"
                  >
                    <PenLine className="h-3.5 w-3.5 mr-1" />
                    My Own Name
                  </Button>
                  <Button
                    variant={useNova ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setUseNova(true);
                      if (!proposedName) novaSuggestMutation.mutate();
                    }}
                    disabled={novaSuggestMutation.isPending}
                    data-testid="button-name-nova"
                  >
                    {novaSuggestMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <Cpu className="h-3.5 w-3.5 mr-1" />
                    )}
                    Ask Nova (1 credit)
                  </Button>
                </div>

                <div className="flex gap-2">
                  <Input
                    value={proposedName}
                    onChange={(e) => setProposedName(e.target.value)}
                    placeholder="Enter a product name"
                    data-testid="input-propose-name"
                  />
                  <Button
                    onClick={handlePropose}
                    disabled={!proposedName.trim() || proposeNameMutation.isPending}
                    data-testid="button-submit-proposal"
                  >
                    {proposeNameMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Propose"
                    )}
                  </Button>
                </div>
              </div>
            )}

            {partnerProposal && myProposal && (
              <div className="bg-muted rounded-md p-4 text-center">
                <p className="text-sm text-muted-foreground">Partner also proposed: <strong>{partnerProposal}</strong></p>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-primary/30 bg-primary/5" data-testid="card-name-selected">
          <CardContent className="p-6 text-center">
            <Dice5 className="h-8 w-8 text-primary mx-auto mb-3" />
            <h3 className="text-lg font-semibold mb-1" data-testid="text-chosen-name">
              {sprint.productName}
            </h3>
            <p className="text-sm text-muted-foreground">
              Randomly selected from both proposals. This is your sprint project!
            </p>
            {sprint.user1ProposedName && sprint.user2ProposedName && (
              <div className="flex items-center justify-center gap-4 mt-3 text-xs text-muted-foreground">
                <span>{isUser1 ? "You" : partner?.firstName}: {sprint.user1ProposedName}</span>
                <span>vs</span>
                <span>{isUser1 ? partner?.firstName : "You"}: {sprint.user2ProposedName}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="text-center">
        <Button
          onClick={onAdvance}
          disabled={isPending || !productNameChosen}
          size="lg"
          data-testid="button-start-sprint"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowRight className="h-4 w-4 mr-2" />}
          Start Sprint
        </Button>
        {!productNameChosen && (
          <p className="text-xs text-muted-foreground mt-2">Both partners must propose a name before you can start</p>
        )}
      </div>
    </div>
  );
}

function IdeationPhase({ myResponses, allMyQuestionsAnswered, ideationAnswers, setIdeationAnswers, onSubmitAll, isPending, onAdvance, advancePending, partnerResponded }: {
  myResponses: SprintResponse[];
  allMyQuestionsAnswered: boolean;
  ideationAnswers: Record<string, string>;
  setIdeationAnswers: (a: Record<string, string>) => void;
  onSubmitAll: () => void;
  isPending: boolean;
  onAdvance: () => void;
  advancePending: boolean;
  partnerResponded: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h2 className="text-xl font-bold mb-2" data-testid="text-ideation-title">Private Ideation</h2>
        <p className="text-muted-foreground max-w-lg mx-auto">
          Answer these questions independently. Your partner won't see your answers until the alignment phase.
        </p>
      </div>

      {allMyQuestionsAnswered ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-8">
            <CheckCircle2 className="h-12 w-12 text-green-500" />
            <h3 className="text-lg font-semibold" data-testid="text-ideation-submitted">Responses Submitted</h3>
            <p className="text-muted-foreground text-center max-w-md">
              {partnerResponded
                ? "Both you and your partner have submitted responses. You can advance to the alignment phase."
                : "Waiting for your partner to submit their responses..."}
            </p>
            <div className="flex gap-3 mt-2">
              <Button onClick={onAdvance} disabled={advancePending} data-testid="button-advance-alignment">
                {advancePending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowRight className="h-4 w-4 mr-2" />}
                Continue to Alignment
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {IDEATION_QUESTIONS.map((q) => {
            const existing = myResponses.find(r => r.questionKey === q.key);
            return (
              <Card key={q.key}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Lightbulb className="h-4 w-4 text-primary" />
                    {q.label}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {existing ? (
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                      <p className="text-sm" data-testid={`text-response-${q.key}`}>{existing.answer}</p>
                    </div>
                  ) : (
                    <Textarea
                      value={ideationAnswers[q.key] || ""}
                      onChange={(e) => setIdeationAnswers({ ...ideationAnswers, [q.key]: e.target.value })}
                      placeholder={q.placeholder}
                      className="resize-none"
                      rows={3}
                      data-testid={`input-ideation-${q.key}`}
                    />
                  )}
                </CardContent>
              </Card>
            );
          })}
          <div className="flex justify-center mt-4">
            <Button
              onClick={onSubmitAll}
              disabled={isPending || IDEATION_QUESTIONS.some(q => !myResponses.find(r => r.questionKey === q.key) && !ideationAnswers[q.key]?.trim())}
              data-testid="button-submit-responses"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              Submit All Responses
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function AlignmentPhase({ sprint, myResponses, partnerResponses, currentUser, partnerUser, alignmentForm, setAlignmentForm, onSave, savePending, onAdvance, advancePending }: {
  sprint: SprintWithUsers;
  myResponses: SprintResponse[];
  partnerResponses: SprintResponse[];
  currentUser?: User;
  partnerUser?: User;
  alignmentForm: { agreedProblem: string; agreedIcp: string; agreedValueProp: string; validationQuestions: string[] };
  setAlignmentForm: (f: any) => void;
  onSave: () => void;
  savePending: boolean;
  onAdvance: () => void;
  advancePending: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <h2 className="text-xl font-bold mb-2" data-testid="text-alignment-title">Alignment Phase</h2>
        <p className="text-muted-foreground max-w-lg mx-auto">
          Compare your independent responses and collaborate on shared definitions.
        </p>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Response Comparison</h3>
        {IDEATION_QUESTIONS.map((q) => {
          const myAnswer = myResponses.find(r => r.questionKey === q.key)?.answer;
          const partnerAnswer = partnerResponses.find(r => r.questionKey === q.key)?.answer;
          return (
            <Card key={q.key}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{q.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <UserAvatar src={currentUser?.profileImageUrl} name={currentUser?.firstName || "You"} className="h-5 w-5" />
                      <span className="text-xs font-medium text-muted-foreground">{currentUser?.firstName || "You"}</span>
                    </div>
                    <p className="text-sm bg-muted p-3 rounded-md" data-testid={`text-my-response-${q.key}`}>
                      {myAnswer || "No response"}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <UserAvatar src={partnerUser?.profileImageUrl} name={partnerUser?.firstName || "Partner"} className="h-5 w-5" />
                      <span className="text-xs font-medium text-muted-foreground">{partnerUser?.firstName || "Partner"}</span>
                    </div>
                    <p className="text-sm bg-muted p-3 rounded-md" data-testid={`text-partner-response-${q.key}`}>
                      {partnerAnswer || "No response"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="space-y-4 mt-8">
        <h3 className="text-lg font-semibold">Collaborative Alignment</h3>
        <p className="text-sm text-muted-foreground">Work together to define shared answers based on both your perspectives.</p>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Agreed Problem Statement</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              value={alignmentForm.agreedProblem}
              onChange={(e) => setAlignmentForm({ ...alignmentForm, agreedProblem: e.target.value })}
              placeholder="What is the core problem you both agree on?"
              className="resize-none"
              rows={3}
              data-testid="input-agreed-problem"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Ideal Customer Profile (ICP)</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              value={alignmentForm.agreedIcp}
              onChange={(e) => setAlignmentForm({ ...alignmentForm, agreedIcp: e.target.value })}
              placeholder="Describe your ideal customer together..."
              className="resize-none"
              rows={3}
              data-testid="input-agreed-icp"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Value Proposition</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              value={alignmentForm.agreedValueProp}
              onChange={(e) => setAlignmentForm({ ...alignmentForm, agreedValueProp: e.target.value })}
              placeholder="What unique value does your product provide?"
              className="resize-none"
              rows={3}
              data-testid="input-agreed-value-prop"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">3 Validation Questions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {alignmentForm.validationQuestions.map((q, i) => (
              <Input
                key={i}
                value={q}
                onChange={(e) => {
                  const updated = [...alignmentForm.validationQuestions];
                  updated[i] = e.target.value;
                  setAlignmentForm({ ...alignmentForm, validationQuestions: updated });
                }}
                placeholder={`Validation question ${i + 1}`}
                data-testid={`input-validation-question-${i}`}
              />
            ))}
          </CardContent>
        </Card>

        <div className="flex items-center justify-center gap-3 mt-4">
          <Button variant="outline" onClick={onSave} disabled={savePending} data-testid="button-save-alignment">
            {savePending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save Alignment
          </Button>
          <Button onClick={onAdvance} disabled={advancePending} data-testid="button-advance-building">
            {advancePending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowRight className="h-4 w-4 mr-2" />}
            Continue to Building
          </Button>
        </div>
      </div>
    </div>
  );
}

function BuildingPhase({ sprint, tasks, deliverables, userId, partnerId, currentUser, partnerUser, onUpdateTask, onSubmitDeliverable, deliverablePending, onAdvance, advancePending }: {
  sprint: SprintWithUsers;
  tasks: SprintKanbanTask[];
  deliverables: SprintDeliverable[];
  userId: string;
  partnerId: string;
  currentUser?: User;
  partnerUser?: User;
  onUpdateTask: (taskId: string, data: any) => void;
  onSubmitDeliverable: (type: string, content: any) => void;
  deliverablePending: boolean;
  onAdvance: () => void;
  advancePending: boolean;
}) {
  const [briefContent, setBriefContent] = useState("");

  const doneTasks = tasks.filter(t => t.status === "done").length;
  const totalTasks = tasks.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-bold" data-testid="text-building-title">Building Phase</h2>
          <p className="text-sm text-muted-foreground">Complete the guided tasks and submit your deliverables.</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary" data-testid="badge-task-progress">{doneTasks}/{totalTasks} tasks done</Badge>
          <Button onClick={onAdvance} disabled={advancePending} data-testid="button-advance-next">
            {advancePending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowRight className="h-4 w-4 mr-2" />}
            {sprint.duration === "24h" ? "Continue to Review" : "Continue to Validation"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {KANBAN_COLUMNS.map(col => {
          const colTasks = tasks.filter(t => t.status === col.id).sort((a, b) => a.order - b.order);
          return (
            <div key={col.id}>
              <div className="flex items-center gap-2 mb-3">
                <col.icon className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">{col.label}</h3>
                <Badge variant="secondary" className="text-xs">{colTasks.length}</Badge>
              </div>
              <div className="space-y-2">
                {colTasks.map(task => (
                  <Card key={task.id} className="p-3" data-testid={`task-card-${task.id}`}>
                    <p className="text-sm font-medium mb-1">{task.title}</p>
                    {task.description && <p className="text-xs text-muted-foreground mb-2">{task.description}</p>}
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1">
                        {task.assigneeId && (
                          <UserAvatar
                            src={task.assigneeId === userId ? currentUser?.profileImageUrl : partnerUser?.profileImageUrl}
                            name={task.assigneeId === userId ? (currentUser?.firstName || undefined) : (partnerUser?.firstName || undefined)}
                            className="h-5 w-5"
                          />
                        )}
                      </div>
                      <div className="flex gap-1">
                        {col.id !== "todo" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onUpdateTask(task.id, { status: col.id === "done" ? "in-progress" : "todo" })}
                            data-testid={`button-task-back-${task.id}`}
                          >
                            Back
                          </Button>
                        )}
                        {col.id !== "done" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onUpdateTask(task.id, { status: col.id === "todo" ? "in-progress" : "done" })}
                            data-testid={`button-task-forward-${task.id}`}
                          >
                            {col.id === "todo" ? "Start" : "Done"}
                          </Button>
                        )}
                        {!task.assigneeId && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onUpdateTask(task.id, { assigneeId: userId })}
                            data-testid={`button-task-assign-${task.id}`}
                          >
                            <UserIcon className="h-3 w-3 mr-1" />
                            Claim
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
                {colTasks.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">No tasks</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Submit Brief
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={briefContent}
            onChange={(e) => setBriefContent(e.target.value)}
            placeholder="Compile your product brief here — problem statement, ICP, value proposition, validation questions, and any other findings..."
            className="resize-none"
            rows={6}
            data-testid="input-brief-content"
          />
          <Button
            onClick={() => {
              if (briefContent.trim()) {
                onSubmitDeliverable("brief", { text: briefContent.trim() });
                setBriefContent("");
              }
            }}
            disabled={!briefContent.trim() || deliverablePending}
            data-testid="button-submit-brief"
          >
            {deliverablePending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
            Submit Brief
          </Button>
          {deliverables.filter(d => d.type === "brief").length > 0 && (
            <div className="mt-4 space-y-2">
              <h4 className="text-sm font-medium">Submitted Briefs</h4>
              {deliverables.filter(d => d.type === "brief").map(d => (
                <div key={d.id} className="bg-muted p-3 rounded-md text-sm" data-testid={`deliverable-brief-${d.id}`}>
                  {(d.content as any)?.text || JSON.stringify(d.content)}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ValidationPhase({ sprint, tasks, deliverables, validationForm, setValidationForm, userId, partnerId, currentUser, partnerUser, onUpdateTask, onSubmitDeliverable, deliverablePending, onAdvance, advancePending }: {
  sprint: SprintWithUsers; tasks: SprintKanbanTask[]; deliverables: SprintDeliverable[];
  validationForm: { outreachEmail: string; socialPosts: string; interviewQuestions: string; evidence: string };
  setValidationForm: (v: any) => void; userId: string; partnerId: string;
  currentUser?: User; partnerUser?: User;
  onUpdateTask: (taskId: string, data: any) => void;
  onSubmitDeliverable: (type: string, content: any) => void;
  deliverablePending: boolean; onAdvance: () => void; advancePending: boolean;
}) {
  const doneTasks = tasks.filter(t => t.status === "done").length;
  const totalTasks = tasks.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Validation Phase (72h)
          </h2>
          <p className="text-sm text-muted-foreground">Validate your idea with real outreach and evidence</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary" data-testid="badge-validation-progress">{doneTasks}/{totalTasks} tasks done</Badge>
          <Button onClick={onAdvance} disabled={advancePending} data-testid="button-advance-review">
            {advancePending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowRight className="h-4 w-4 mr-2" />}
            Continue to Review
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {KANBAN_COLUMNS.map(col => {
          const colTasks = tasks.filter(t => t.status === col.id).sort((a, b) => a.order - b.order);
          return (
            <div key={col.id}>
              <div className="flex items-center gap-2 mb-3">
                <col.icon className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">{col.label}</h3>
                <Badge variant="secondary" className="text-xs">{colTasks.length}</Badge>
              </div>
              <div className="space-y-2">
                {colTasks.map(task => (
                  <Card key={task.id} className="p-3" data-testid={`validation-task-${task.id}`}>
                    <p className="text-sm font-medium mb-1">{task.title}</p>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1">
                        {task.assigneeId && (
                          <UserAvatar
                            src={task.assigneeId === userId ? currentUser?.profileImageUrl : partnerUser?.profileImageUrl}
                            name={task.assigneeId === userId ? (currentUser?.firstName || undefined) : (partnerUser?.firstName || undefined)}
                            className="h-5 w-5"
                          />
                        )}
                      </div>
                      <div className="flex gap-1">
                        {col.id !== "todo" && (
                          <Button variant="ghost" size="sm" onClick={() => onUpdateTask(task.id, { status: col.id === "done" ? "in-progress" : "todo" })}>Back</Button>
                        )}
                        {col.id !== "done" && (
                          <Button variant="ghost" size="sm" onClick={() => onUpdateTask(task.id, { status: col.id === "todo" ? "in-progress" : "done" })}>{col.id === "todo" ? "Start" : "Done"}</Button>
                        )}
                        {!task.assigneeId && (
                          <Button variant="outline" size="sm" onClick={() => onUpdateTask(task.id, { assigneeId: userId })}>
                            <UserIcon className="h-3 w-3 mr-1" />Claim
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Mail className="h-4 w-4" />Outreach Email Draft</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Textarea value={validationForm.outreachEmail} onChange={(e) => setValidationForm({ ...validationForm, outreachEmail: e.target.value })} placeholder="Draft an outreach email to potential users..." rows={5} data-testid="input-outreach-email" />
            <Button size="sm" onClick={() => { if (validationForm.outreachEmail.trim()) onSubmitDeliverable("outreach_email", { text: validationForm.outreachEmail.trim() }); }} disabled={!validationForm.outreachEmail.trim() || deliverablePending} data-testid="button-submit-outreach">
              {deliverablePending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}Submit
            </Button>
            {deliverables.filter(d => d.type === "outreach_email").map(d => (
              <div key={d.id} className="bg-muted p-3 rounded-md text-sm">{(d.content as any)?.text}</div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Share2 className="h-4 w-4" />Social Media Posts</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Textarea value={validationForm.socialPosts} onChange={(e) => setValidationForm({ ...validationForm, socialPosts: e.target.value })} placeholder="Draft 2 community social media posts..." rows={5} data-testid="input-social-posts" />
            <Button size="sm" onClick={() => { if (validationForm.socialPosts.trim()) onSubmitDeliverable("social_posts", { text: validationForm.socialPosts.trim() }); }} disabled={!validationForm.socialPosts.trim() || deliverablePending} data-testid="button-submit-social">
              {deliverablePending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}Submit
            </Button>
            {deliverables.filter(d => d.type === "social_posts").map(d => (
              <div key={d.id} className="bg-muted p-3 rounded-md text-sm">{(d.content as any)?.text}</div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><HelpCircle className="h-4 w-4" />Interview Questions</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Textarea value={validationForm.interviewQuestions} onChange={(e) => setValidationForm({ ...validationForm, interviewQuestions: e.target.value })} placeholder="Write 4 interview questions (2 personal, 2 segmentation)..." rows={5} data-testid="input-interview-questions" />
            <Button size="sm" onClick={() => { if (validationForm.interviewQuestions.trim()) onSubmitDeliverable("interview_questions", { text: validationForm.interviewQuestions.trim() }); }} disabled={!validationForm.interviewQuestions.trim() || deliverablePending} data-testid="button-submit-interview">
              {deliverablePending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}Submit
            </Button>
            {deliverables.filter(d => d.type === "interview_questions").map(d => (
              <div key={d.id} className="bg-muted p-3 rounded-md text-sm">{(d.content as any)?.text}</div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Camera className="h-4 w-4" />Validation Evidence</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Textarea value={validationForm.evidence} onChange={(e) => setValidationForm({ ...validationForm, evidence: e.target.value })} placeholder="Summarize validation evidence — screenshots, interview notes, survey responses..." rows={5} data-testid="input-evidence" />
            <Button size="sm" onClick={() => { if (validationForm.evidence.trim()) onSubmitDeliverable("validation_questions", { text: validationForm.evidence.trim() }); }} disabled={!validationForm.evidence.trim() || deliverablePending} data-testid="button-submit-evidence">
              {deliverablePending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}Submit
            </Button>
            {deliverables.filter(d => d.type === "validation_questions").map(d => (
              <div key={d.id} className="bg-muted p-3 rounded-md text-sm">{(d.content as any)?.text}</div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StarRating({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}</label>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map(i => (
          <button key={i} onClick={() => onChange(i)} className="p-0.5" data-testid={`star-${label.toLowerCase().replace(/\s+/g, "-")}-${i}`}>
            <Star className={`h-5 w-5 ${i <= value ? "fill-primary text-primary" : "text-muted-foreground"}`} />
          </button>
        ))}
        <span className="text-sm text-muted-foreground ml-2">{value}/5</span>
      </div>
    </div>
  );
}

function ReviewPhase({ sprint, decisions, ratings, userId, decisionForm, setDecisionForm, ratingForm, setRatingForm, onSubmitDecision, decisionPending, onSubmitRating, ratingPending, onAdvance, advancePending }: {
  sprint: SprintWithUsers; decisions: SprintDecision[]; ratings: SprintRating[];
  userId: string; decisionForm: { decision: string; reason: string };
  setDecisionForm: (v: any) => void;
  ratingForm: { communicationClarity: number; reliability: number; wouldBuildLongTerm: boolean; stressLevel: number };
  setRatingForm: (v: any) => void;
  onSubmitDecision: () => void; decisionPending: boolean;
  onSubmitRating: () => void; ratingPending: boolean;
  onAdvance: () => void; advancePending: boolean;
}) {
  const myDecision = decisions.find(d => d.userId === userId);
  const myRating = ratings.find(r => r.raterId === userId);
  const partnerDecision = decisions.find(d => d.userId !== userId);
  const bothSubmitted = !!myDecision && !!myRating && !!partnerDecision;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Review Phase
          </h2>
          <p className="text-sm text-muted-foreground">Submit your decision and rate your partner privately</p>
        </div>
        {bothSubmitted && (
          <Button onClick={onAdvance} disabled={advancePending} data-testid="button-advance-completed">
            {advancePending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowRight className="h-4 w-4 mr-2" />}
            Complete Sprint
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4" />
              Your Decision
            </CardTitle>
          </CardHeader>
          <CardContent>
            {myDecision ? (
              <div className="space-y-3">
                <Badge variant={myDecision.decision === "proceed" ? "default" : myDecision.decision === "pivot" ? "secondary" : "destructive"} className="text-sm" data-testid="badge-my-decision">
                  {myDecision.decision === "proceed" ? "Proceed" : myDecision.decision === "pivot" ? "Pivot" : "Kill"}
                </Badge>
                <p className="text-sm text-muted-foreground">{myDecision.reason}</p>
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <CheckCircle2 className="h-4 w-4" /> Decision submitted
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: "proceed", label: "Proceed", icon: ThumbsUp, desc: "Continue building together" },
                    { value: "pivot", label: "Pivot", icon: AlertTriangle, desc: "Change direction" },
                    { value: "kill", label: "Kill", icon: ThumbsDown, desc: "Stop this project" },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setDecisionForm({ ...decisionForm, decision: opt.value })}
                      className={`p-3 border rounded-md text-center transition-colors ${decisionForm.decision === opt.value ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}
                      data-testid={`button-decision-${opt.value}`}
                    >
                      <opt.icon className={`h-5 w-5 mx-auto mb-1 ${decisionForm.decision === opt.value ? "text-primary" : "text-muted-foreground"}`} />
                      <p className="text-sm font-medium">{opt.label}</p>
                      <p className="text-xs text-muted-foreground">{opt.desc}</p>
                    </button>
                  ))}
                </div>
                <Textarea
                  value={decisionForm.reason}
                  onChange={(e) => setDecisionForm({ ...decisionForm, reason: e.target.value })}
                  placeholder="Explain your reasoning..."
                  rows={3}
                  data-testid="input-decision-reason"
                />
                <Button onClick={onSubmitDecision} disabled={!decisionForm.decision || !decisionForm.reason.trim() || decisionPending} data-testid="button-submit-decision">
                  {decisionPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                  Submit Decision
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Star className="h-4 w-4" />
              Rate Your Partner
            </CardTitle>
          </CardHeader>
          <CardContent>
            {myRating ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <CheckCircle2 className="h-4 w-4" /> Rating submitted
                </div>
                <p className="text-sm text-muted-foreground">Your rating has been recorded privately.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <StarRating label="Communication Clarity" value={ratingForm.communicationClarity} onChange={(v) => setRatingForm({ ...ratingForm, communicationClarity: v })} />
                <StarRating label="Reliability" value={ratingForm.reliability} onChange={(v) => setRatingForm({ ...ratingForm, reliability: v })} />
                <StarRating label="Stress Level" value={ratingForm.stressLevel} onChange={(v) => setRatingForm({ ...ratingForm, stressLevel: v })} />
                <div className="space-y-1">
                  <label className="text-sm font-medium">Would you build long-term with this person?</label>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setRatingForm({ ...ratingForm, wouldBuildLongTerm: true })}
                      className={`flex items-center gap-2 px-4 py-2 border rounded-md transition-colors ${ratingForm.wouldBuildLongTerm ? "border-green-500 bg-green-500/10 text-green-700" : "border-border"}`}
                      data-testid="button-would-build-yes"
                    >
                      <ThumbsUp className="h-4 w-4" /> Yes
                    </button>
                    <button
                      onClick={() => setRatingForm({ ...ratingForm, wouldBuildLongTerm: false })}
                      className={`flex items-center gap-2 px-4 py-2 border rounded-md transition-colors ${!ratingForm.wouldBuildLongTerm ? "border-red-500 bg-red-500/10 text-red-700" : "border-border"}`}
                      data-testid="button-would-build-no"
                    >
                      <ThumbsDown className="h-4 w-4" /> No
                    </button>
                  </div>
                </div>
                <Button onClick={onSubmitRating} disabled={ratingPending} data-testid="button-submit-rating">
                  {ratingPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                  Submit Rating
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {!bothSubmitted && (myDecision || myRating) && (
        <Card className="bg-muted/50">
          <CardContent className="py-6 text-center">
            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
            <p className="text-sm font-medium" data-testid="text-waiting-partner">Waiting for your partner to submit their decision and rating...</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CompletedPhase({ sprint, report, decisions, ratings, userId, currentUser, partnerUser, onGenerateReport, reportPending, onConvertProject, convertPending }: {
  sprint: SprintWithUsers; report: SprintCompatibilityReport | null;
  decisions: SprintDecision[]; ratings: SprintRating[];
  userId: string; currentUser?: User; partnerUser?: User;
  onGenerateReport: () => void; reportPending: boolean;
  onConvertProject: () => void; convertPending: boolean;
}) {
  const myDecision = decisions.find(d => d.userId === userId);
  const partnerDecision = decisions.find(d => d.userId !== userId);
  const bothProceeded = myDecision?.decision === "proceed" && partnerDecision?.decision === "proceed";

  return (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-3">
          <CheckCircle2 className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-xl font-semibold" data-testid="text-sprint-complete">Sprint Complete!</h2>
        <p className="text-sm text-muted-foreground mt-1">Here's the summary of your collaboration</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Target className="h-4 w-4" />Decisions</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {[
              { user: currentUser, decision: myDecision, label: "Your Decision" },
              { user: partnerUser, decision: partnerDecision, label: "Partner's Decision" },
            ].map(({ user: u, decision, label }) => (
              <div key={label} className="flex items-start gap-3">
                <UserAvatar src={u?.profileImageUrl} name={u?.firstName || "User"} className="h-8 w-8 mt-0.5" />
                <div>
                  <p className="text-sm font-medium">{u?.firstName || "User"} — {label}</p>
                  {decision ? (
                    <>
                      <Badge variant={decision.decision === "proceed" ? "default" : decision.decision === "pivot" ? "secondary" : "destructive"} className="mt-1" data-testid={`badge-decision-${label.toLowerCase().replace(/\s+/g, "-")}`}>
                        {decision.decision === "proceed" ? "Proceed" : decision.decision === "pivot" ? "Pivot" : "Kill"}
                      </Badge>
                      <p className="text-sm text-muted-foreground mt-1">{decision.reason}</p>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">No decision submitted</p>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Shield className="h-4 w-4" />Compatibility Report</CardTitle></CardHeader>
          <CardContent>
            {report ? (
              <div className="space-y-4">
                <div className="text-center">
                  <div className={`inline-flex items-center justify-center w-20 h-20 rounded-full border-4 ${
                    report.overallScore >= 70 ? "border-green-500" : report.overallScore >= 40 ? "border-yellow-500" : "border-red-500"
                  }`}>
                    <span className="text-2xl font-bold" data-testid="text-compatibility-score">{report.overallScore}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">Compatibility Score</p>
                </div>
                {report.strengths && Array.isArray(report.strengths) && (
                  <div>
                    <h4 className="text-sm font-medium flex items-center gap-1 mb-2"><TrendingUp className="h-3.5 w-3.5 text-green-600" />Strengths</h4>
                    <ul className="space-y-1">
                      {(report.strengths as string[]).map((s, i) => (
                        <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-600 mt-0.5 shrink-0" />{s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {report.risks && Array.isArray(report.risks) && (
                  <div>
                    <h4 className="text-sm font-medium flex items-center gap-1 mb-2"><AlertTriangle className="h-3.5 w-3.5 text-yellow-600" />Risks</h4>
                    <ul className="space-y-1">
                      {(report.risks as string[]).map((r, i) => (
                        <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                          <AlertTriangle className="h-3.5 w-3.5 text-yellow-600 mt-0.5 shrink-0" />{r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {report.recommendation && (
                  <div className="bg-muted p-3 rounded-md">
                    <h4 className="text-sm font-medium mb-1">Recommendation</h4>
                    <p className="text-sm text-muted-foreground" data-testid="text-recommendation">{report.recommendation}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-4">
                <Sparkles className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground mb-3">Generate an AI compatibility report based on your sprint data</p>
                <Button onClick={onGenerateReport} disabled={reportPending} data-testid="button-generate-report">
                  {reportPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                  Generate Report (1 Credit)
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {bothProceeded && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-full bg-primary/10">
                  <Rocket className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold" data-testid="text-both-proceeded">Both of you want to proceed!</h3>
                  <p className="text-sm text-muted-foreground">Convert this sprint into a full project and start building together</p>
                </div>
              </div>
              <div className="flex gap-3">
                <Button onClick={onConvertProject} disabled={convertPending} data-testid="button-convert-project">
                  {convertPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Handshake className="h-4 w-4 mr-2" />}
                  Convert to Real Project
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
