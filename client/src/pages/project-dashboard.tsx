import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserAvatar } from "@/components/user-avatar";
import { SkillBadge } from "@/components/skill-badge";
import { DonationButton } from "@/components/donation-button";
import { MediaGallery } from "@/components/media-gallery";
import { StoryboardSlideshow } from "@/components/storyboard-slideshow";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2, Users, Eye, Calendar, ExternalLink, Github, Share2, Heart, HeartOff,
  MessageSquare, Video, Sparkles, Briefcase, Zap, Laugh, Palette, Send,
  CheckCircle, XCircle, Clock, FileText, Settings, Upload, ChevronRight,
} from "lucide-react";
import type { Project, ProjectMember, UserProfile, User, ProjectApplication } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useUpload } from "@/hooks/use-upload";

type StyleOption = "professional" | "futuristic" | "funny" | "cartoon";

const STYLE_OPTIONS: { value: StyleOption; label: string; description: string; icon: typeof Briefcase; gradient: string }[] = [
  { value: "professional", label: "Professional", description: "Clean, corporate, modern", icon: Briefcase, gradient: "from-slate-700 to-blue-900" },
  { value: "futuristic", label: "Futuristic", description: "Cyberpunk, neon, sci-fi", icon: Zap, gradient: "from-purple-800 to-cyan-900" },
  { value: "funny", label: "Funny", description: "Playful, bright, comic", icon: Laugh, gradient: "from-yellow-500 to-pink-500" },
  { value: "cartoon", label: "Cartoon", description: "Illustrated, colorful", icon: Palette, gradient: "from-green-400 to-purple-500" },
];

const PRE_PROMPTED_QUESTIONS = [
  "Why are you interested in joining this project?",
  "What relevant experience do you have?",
  "How many hours per week can you dedicate?",
  "What is your preferred role on this project?",
  "Share a link to a relevant past project or portfolio piece.",
  "What timezone are you in?",
  "Do you have any specific skills related to this project?",
  "What motivates you about this project's mission?",
];

interface SceneData {
  prompt: string;
  caption: string;
  imageUrl: string;
}

export default function ProjectDashboard() {
  const [, params] = useRoute("/projects/:id");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const projectId = params?.id;
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [videoPrompt, setVideoPrompt] = useState("");
  const [selectedStyle, setSelectedStyle] = useState<StyleOption>("professional");
  const [generationStatus, setGenerationStatus] = useState("");
  const [slideshowData, setSlideshowData] = useState<{ scenes: SceneData[]; storyboard: string; style: string } | null>(null);
  const [slideshowOpen, setSlideshowOpen] = useState(false);
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [applyMessage, setApplyMessage] = useState("");
  const [applyResumeUrl, setApplyResumeUrl] = useState("");
  const [applyAnswers, setApplyAnswers] = useState<Record<string, string>>({});
  const [questionsModalOpen, setQuestionsModalOpen] = useState(false);
  const [editingQuestions, setEditingQuestions] = useState<{ id: string; question: string; required: boolean }[]>([]);
  const [newCustomQuestion, setNewCustomQuestion] = useState("");
  const resumeInputRef = useRef<HTMLInputElement>(null);

  const { uploadFile, isUploading: isUploadingResume } = useUpload({
    onSuccess: (response) => {
      setApplyResumeUrl(`/objects/${response.objectPath}`);
      toast({ title: "Resume uploaded" });
    },
    onError: (error) => toast({ title: "Upload failed", description: error.message, variant: "destructive" }),
  });

  const { data: project, isLoading: projectLoading } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
    enabled: !!projectId,
  });

  const { data: members, isLoading: membersLoading } = useQuery<(ProjectMember & { user: User; profile?: UserProfile })[]>({
    queryKey: ["/api/projects", projectId, "members"],
    enabled: !!projectId,
  });

  const { data: followStatus } = useQuery<{ following: boolean; count: number }>({
    queryKey: ["/api/projects", projectId, "follow-status"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/follow-status`, { credentials: "include" });
      if (!res.ok) return { following: false, count: 0 };
      return res.json();
    },
    enabled: !!projectId && !!user,
  });

  const { data: applications } = useQuery<(ProjectApplication & { user: User; profile?: UserProfile })[]>({
    queryKey: ["/api/projects", projectId, "applications"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/applications`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectId && project?.ownerId === user?.id,
  });

  const { data: myApplications } = useQuery<(ProjectApplication & { project: Project })[]>({
    queryKey: ["/api/user/applications"],
    enabled: !!user,
  });

  const followMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/projects/${projectId}/follow`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "follow-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/followed-projects"] });
    },
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      const answers = Object.entries(applyAnswers).map(([questionId, answer]) => {
        const q = (project?.applicationQuestions as any[])?.find((q: any) => q.id === questionId);
        return { questionId, question: q?.question || "", answer };
      });
      await apiRequest("POST", `/api/projects/${projectId}/apply`, {
        resumeUrl: applyResumeUrl || undefined,
        answers,
        message: applyMessage || undefined,
      });
    },
    onSuccess: () => {
      toast({ title: "Application submitted!", description: "The project owner will review your application." });
      setApplyModalOpen(false);
      setApplyMessage("");
      setApplyResumeUrl("");
      setApplyAnswers({});
      queryClient.invalidateQueries({ queryKey: ["/api/user/applications"] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const acceptMutation = useMutation({
    mutationFn: async (appId: string) => {
      await apiRequest("POST", `/api/applications/${appId}/accept`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "applications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "members"] });
      toast({ title: "Application accepted" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (appId: string) => {
      await apiRequest("POST", `/api/applications/${appId}/reject`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "applications"] });
      toast({ title: "Application rejected" });
    },
  });

  const saveQuestionsMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/projects/${projectId}/application-questions`, { questions: editingQuestions });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      setQuestionsModalOpen(false);
      toast({ title: "Application questions saved" });
    },
  });

  const videoMutation = useMutation({
    mutationFn: async ({ prompt, style }: { prompt: string; style: string }) => {
      setGenerationStatus("Generating storyboard...");
      const res = await apiRequest("POST", `/api/projects/${projectId}/generate-video`, { prompt, style });
      setGenerationStatus("Processing scenes...");
      return res.json();
    },
    onSuccess: (data) => {
      setSlideshowData({ scenes: data.scenes || [], storyboard: data.storyboard || "", style: data.style || selectedStyle });
      setVideoModalOpen(false);
      setSlideshowOpen(true);
      setGenerationStatus("");
      const savedCount = data.savedMediaPaths?.length || 0;
      toast({ title: "Storyboard Generated", description: `${data.scenes?.length || 0} scenes created.${savedCount > 0 ? ` ${savedCount} images saved.` : ""}` });
      if (savedCount > 0) queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
    },
    onError: (error: any) => {
      setGenerationStatus("");
      if (error.message?.includes("403") || error.message?.includes("Insufficient")) {
        toast({ title: "Insufficient credits", description: "Video generation costs 5 credits.", variant: "destructive" });
      } else {
        toast({ title: "Generation failed", variant: "destructive" });
      }
    },
  });

  const handleResumeUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = [".pdf", ".doc", ".docx"];
    const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
    if (!allowed.includes(ext)) {
      toast({ title: "Invalid file type", description: "Please upload a PDF, DOC, or DOCX.", variant: "destructive" });
      return;
    }
    uploadFile(file);
  };

  if (projectLoading || membersLoading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }
  if (!project) return <div className="flex items-center justify-center h-full text-muted-foreground">Project not found</div>;

  const isMember = members?.some((m) => m.userId === user?.id);
  const isOwner = project.ownerId === user?.id;
  const hasApplied = myApplications?.some(a => a.projectId === projectId && a.status === "pending");
  const appQuestions = (project.applicationQuestions as any[]) || [];
  const pendingApps = applications?.filter(a => a.status === "pending") || [];

  return (
    <div className="h-full overflow-y-auto pb-20">
      <div className="relative min-h-[12rem] bg-muted border-b border-border flex items-end">
        <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent opacity-60" />
        <div className="relative p-6 w-full max-w-5xl mx-auto flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4">
          <div className="space-y-2 min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Badge variant={project.status === "active" ? "default" : "secondary"}>{project.status}</Badge>
              <span className="text-sm text-secondary font-medium">{project.category}</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight break-words" data-testid="text-project-title">{project.title}</h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant={followStatus?.following ? "default" : "outline"}
              size="sm"
              className="gap-2"
              onClick={() => followMutation.mutate()}
              disabled={followMutation.isPending}
              data-testid="button-follow-project"
            >
              {followStatus?.following ? <Heart className="h-4 w-4 fill-current" /> : <Heart className="h-4 w-4" />}
              {followStatus?.following ? "Following" : "Follow"}
              {followStatus && followStatus.count > 0 && <span className="text-xs">({followStatus.count})</span>}
            </Button>
            <DonationButton projectId={project.id} projectTitle={project.title} />
            {!isMember && !isOwner && !hasApplied && (
              <Button onClick={() => setApplyModalOpen(true)} data-testid="button-apply-project">
                <Send className="h-4 w-4 mr-2" /> Apply
              </Button>
            )}
            {hasApplied && (
              <Badge variant="secondary" className="gap-1 py-1.5 px-3"><Clock className="h-3 w-3" /> Applied</Badge>
            )}
            {(isOwner || isMember) && (
              <Button variant="outline" size="sm" className="gap-2" onClick={() => setLocation(`/projects/${projectId}/manage`)} data-testid="button-manage-project">
                <Settings className="h-4 w-4" /> Manage
              </Button>
            )}
            <Button variant="ghost" size="icon" data-testid="button-share-project"><Share2 className="h-4 w-4" /></Button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">About this project</h2>
            <p className="text-secondary leading-relaxed">{project.description}</p>
          </section>

          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Media Gallery</h2>
              <div className="flex items-center gap-2">
                {slideshowData && (
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => setSlideshowOpen(true)} data-testid="button-view-storyboard">
                    <Sparkles className="h-4 w-4" /> View Storyboard
                  </Button>
                )}
                {isOwner && (
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => { setVideoPrompt(`Create a showcase video for "${project.title}": ${project.description}`); setVideoModalOpen(true); }} data-testid="button-generate-video">
                    <Video className="h-4 w-4" /> Generate AI Video
                  </Button>
                )}
              </div>
            </div>
            <MediaGallery projectId={project.id} mediaUrls={project.mediaUrls || []} isOwner={isOwner} />
          </section>

          {project.rolesNeeded && project.rolesNeeded.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-xl font-semibold">Roles Needed</h2>
              <div className="flex flex-wrap gap-2">{project.rolesNeeded.map((role) => <SkillBadge key={role} skill={role} variant="outline" />)}</div>
            </section>
          )}

          {project.techStack && project.techStack.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-xl font-semibold">Tech Stack</h2>
              <div className="flex flex-wrap gap-2">
                {project.techStack.map((tech) => (
                  <Badge key={tech} variant="outline" className="border-purple-500/30 text-purple-600 dark:text-purple-400" data-testid={`badge-dashboard-tech-${tech}`}>{tech}</Badge>
                ))}
              </div>
            </section>
          )}

          <div className="flex flex-wrap gap-4">
            {project.repoUrl && <Button variant="outline" asChild className="gap-2" data-testid="link-repo"><a href={project.repoUrl} target="_blank" rel="noopener noreferrer"><Github className="h-4 w-4" /> Repository</a></Button>}
            {project.liveUrl && <Button variant="outline" asChild className="gap-2" data-testid="link-live"><a href={project.liveUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" /> Live Demo</a></Button>}
          </div>

          {isOwner && pendingApps.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  Applications <Badge variant="destructive" className="text-xs">{pendingApps.length}</Badge>
                </h2>
                {isOwner && (
                  <Button variant="ghost" size="sm" className="gap-1" onClick={() => { setEditingQuestions(appQuestions.length > 0 ? appQuestions : []); setQuestionsModalOpen(true); }} data-testid="button-edit-questions">
                    <Settings className="h-4 w-4" /> Questions
                  </Button>
                )}
              </div>
              <div className="space-y-3">
                {pendingApps.map((app) => (
                  <Card key={app.id} className="border-border/50" data-testid={`application-${app.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <UserAvatar src={app.profile?.avatarUrl} name={app.profile?.displayName || app.user.firstName || "Applicant"} className="h-10 w-10 mt-0.5" />
                          <div className="min-w-0 space-y-1">
                            <p className="font-medium text-sm cursor-pointer hover:underline" onClick={() => setLocation(`/profile/${app.userId}`)}>{app.profile?.displayName || app.user.firstName || "Applicant"}</p>
                            {app.profile?.headline && <p className="text-xs text-muted-foreground">{app.profile.headline}</p>}
                            {app.message && <p className="text-sm text-muted-foreground mt-1">{app.message}</p>}
                            {app.resumeUrl && (
                              <a href={app.resumeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1">
                                <FileText className="h-3 w-3" /> View Resume
                              </a>
                            )}
                            {(app.answers as any[])?.length > 0 && (
                              <div className="mt-2 space-y-1">
                                {(app.answers as any[]).map((a: any, i: number) => (
                                  <div key={i} className="text-xs">
                                    <span className="font-medium">{a.question}:</span>{" "}
                                    <span className="text-muted-foreground">{a.answer}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <Button size="sm" onClick={() => acceptMutation.mutate(app.id)} disabled={acceptMutation.isPending} data-testid={`button-accept-app-${app.id}`}>
                            <CheckCircle className="h-4 w-4 mr-1" /> Accept
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => rejectMutation.mutate(app.id)} disabled={rejectMutation.isPending} data-testid={`button-reject-app-${app.id}`}>
                            <XCircle className="h-4 w-4 mr-1" /> Reject
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-lg">Project Stats</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-secondary"><Eye className="h-4 w-4" /><span>Views</span></div>
                <span className="font-semibold">{project.views}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-secondary"><Users className="h-4 w-4" /><span>Team Size</span></div>
                <span className="font-semibold">{members?.length || 0} / {project.teamSize}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-secondary"><Calendar className="h-4 w-4" /><span>Timeline</span></div>
                <span className="font-semibold">{project.estimatedWeeks} weeks</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-secondary"><Heart className="h-4 w-4" /><span>Followers</span></div>
                <span className="font-semibold">{followStatus?.count || 0}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0">
              <CardTitle className="text-lg">Team Members</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {members?.map((member) => (
                  <div key={member.id} className="flex items-center gap-3 cursor-pointer" onClick={() => setLocation(`/profile/${member.userId}`)}>
                    <UserAvatar src={member.profile?.avatarUrl} name={member.profile?.displayName || member.user.firstName || member.user.email || "Anonymous"} className="h-8 w-8" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{member.profile?.displayName || member.user.firstName || member.user.email || "Anonymous"}</p>
                      <p className="text-xs text-tertiary capitalize">{member.role}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {isOwner && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center justify-between">
                  Application Questions
                  <Button variant="ghost" size="sm" onClick={() => { setEditingQuestions(appQuestions.length > 0 ? appQuestions : []); setQuestionsModalOpen(true); }} data-testid="button-setup-questions">
                    <Settings className="h-4 w-4" />
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {appQuestions.length > 0 ? (
                  <div className="space-y-2">
                    {appQuestions.map((q: any, i: number) => (
                      <div key={q.id || i} className="flex items-start gap-2 text-sm">
                        <span className="text-muted-foreground shrink-0">{i + 1}.</span>
                        <span>{q.question}</span>
                        {q.required && <Badge variant="outline" className="text-[10px] px-1">Required</Badge>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No application questions set. Click the gear icon to add some.</p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Apply Dialog */}
      <Dialog open={applyModalOpen} onOpenChange={setApplyModalOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Apply to {project.title}</DialogTitle>
            <DialogDescription>Submit your application. The project owner will review it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Message (optional)</Label>
              <Textarea value={applyMessage} onChange={e => setApplyMessage(e.target.value)} placeholder="Tell the project owner why you'd be a great fit..." className="min-h-[80px]" data-testid="textarea-apply-message" />
            </div>

            {appQuestions.map((q: any) => (
              <div key={q.id} className="space-y-2">
                <Label>{q.question} {q.required && <span className="text-destructive">*</span>}</Label>
                <Input value={applyAnswers[q.id] || ""} onChange={e => setApplyAnswers(prev => ({ ...prev, [q.id]: e.target.value }))} placeholder="Your answer..." data-testid={`input-question-${q.id}`} />
              </div>
            ))}

            <div className="space-y-2">
              <Label>Resume (optional)</Label>
              <div className="flex items-center gap-3">
                {applyResumeUrl ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <FileText className="h-4 w-4" /> <span>Resume attached</span> <CheckCircle className="h-4 w-4 text-green-500" />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Attach your resume</p>
                )}
                <Button type="button" variant="outline" size="sm" onClick={() => resumeInputRef.current?.click()} disabled={isUploadingResume} data-testid="button-upload-apply-resume">
                  {isUploadingResume ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1" />}
                  {applyResumeUrl ? "Replace" : "Upload"}
                </Button>
                <input ref={resumeInputRef} type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={handleResumeUpload} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setApplyModalOpen(false)}>Cancel</Button>
            <Button onClick={() => applyMutation.mutate()} disabled={applyMutation.isPending} data-testid="button-submit-application">
              {applyMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Submit Application
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Application Questions Setup Dialog */}
      <Dialog open={questionsModalOpen} onOpenChange={setQuestionsModalOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Application Questions</DialogTitle>
            <DialogDescription>Configure questions applicants must answer when applying to your project.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Pre-made Questions</Label>
              <div className="flex flex-wrap gap-2">
                {PRE_PROMPTED_QUESTIONS.filter(q => !editingQuestions.some(eq => eq.question === q)).map(q => (
                  <Button key={q} variant="outline" size="sm" className="text-xs h-auto py-1.5" onClick={() => setEditingQuestions(prev => [...prev, { id: crypto.randomUUID(), question: q, required: false }])} data-testid={`button-add-premade-${q.substring(0, 20)}`}>
                    + {q.length > 40 ? q.substring(0, 40) + "..." : q}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Custom Question</Label>
              <div className="flex gap-2">
                <Input value={newCustomQuestion} onChange={e => setNewCustomQuestion(e.target.value)} placeholder="Type a custom question..." data-testid="input-custom-question" />
                <Button size="sm" disabled={!newCustomQuestion.trim()} onClick={() => { setEditingQuestions(prev => [...prev, { id: crypto.randomUUID(), question: newCustomQuestion.trim(), required: false }]); setNewCustomQuestion(""); }} data-testid="button-add-custom-question">Add</Button>
              </div>
            </div>

            {editingQuestions.length > 0 && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Your Questions</Label>
                {editingQuestions.map((q, i) => (
                  <div key={q.id} className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                    <span className="text-xs text-muted-foreground w-5">{i + 1}.</span>
                    <span className="text-sm flex-1">{q.question}</span>
                    <Button variant="ghost" size="sm" className={`text-xs ${q.required ? "text-destructive" : "text-muted-foreground"}`} onClick={() => setEditingQuestions(prev => prev.map(eq => eq.id === q.id ? { ...eq, required: !eq.required } : eq))}>
                      {q.required ? "Required" : "Optional"}
                    </Button>
                    <Button variant="ghost" size="sm" className="text-destructive h-6 w-6 p-0" onClick={() => setEditingQuestions(prev => prev.filter(eq => eq.id !== q.id))}>×</Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setQuestionsModalOpen(false)}>Cancel</Button>
            <Button onClick={() => saveQuestionsMutation.mutate()} disabled={saveQuestionsMutation.isPending} data-testid="button-save-questions">
              {saveQuestionsMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Save Questions
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Video Generation Dialog */}
      <Dialog open={videoModalOpen} onOpenChange={setVideoModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /> Generate AI Showcase Video</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <div className="space-y-3">
              <label className="text-sm font-medium">Choose a visual style</label>
              <div className="grid grid-cols-2 gap-3">
                {STYLE_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const isSelected = selectedStyle === opt.value;
                  return (
                    <button key={opt.value} onClick={() => setSelectedStyle(opt.value)} className={`relative flex flex-col items-center gap-2 p-4 rounded-md border-2 transition-all text-left ${isSelected ? "border-primary bg-primary/5 shadow-sm" : "border-border hover:border-primary/40 bg-background"}`} data-testid={`button-style-${opt.value}`}>
                      <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${opt.gradient} flex items-center justify-center`}><Icon className="h-5 w-5 text-white" /></div>
                      <div className="text-center"><p className="text-sm font-medium">{opt.label}</p><p className="text-xs text-muted-foreground">{opt.description}</p></div>
                      {isSelected && <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary" />}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Describe your video</label>
              <Textarea value={videoPrompt} onChange={(e) => setVideoPrompt(e.target.value)} placeholder="Describe the showcase video you'd like to create..." className="min-h-[100px]" data-testid="textarea-video-prompt" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVideoModalOpen(false)}>Cancel</Button>
            <Button onClick={() => videoMutation.mutate({ prompt: videoPrompt, style: selectedStyle })} disabled={videoMutation.isPending || !videoPrompt.trim()} data-testid="button-submit-video">
              {videoMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />{generationStatus || "Generating..."}</> : <><Video className="h-4 w-4 mr-2" />Generate Storyboard</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {slideshowOpen && slideshowData && (
        <StoryboardSlideshow scenes={slideshowData.scenes} title={project.title} style={slideshowData.style} storyboard={slideshowData.storyboard} onClose={() => setSlideshowOpen(false)} />
      )}
    </div>
  );
}
