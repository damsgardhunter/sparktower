import { useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2,
  Users,
  Eye,
  Calendar,
  ExternalLink,
  Github,
  Share2,
  MessageSquare,
  Video,
  Sparkles,
} from "lucide-react";
import type { Project, ProjectMember, UserProfile, User } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

export default function ProjectDashboard() {
  const [, params] = useRoute("/projects/:id");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const projectId = params?.id;
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [videoPrompt, setVideoPrompt] = useState("");

  const { data: project, isLoading: projectLoading } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
    enabled: !!projectId,
  });

  const { data: members, isLoading: membersLoading } = useQuery<(ProjectMember & { user: User; profile?: UserProfile })[]>({
    queryKey: ["/api/projects", projectId, "members"],
    enabled: !!projectId,
  });

  const joinMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/projects/${projectId}/join`, { role: "member" });
    },
    onSuccess: () => {
      toast({ title: "Joined project!", description: "You are now a member of this project." });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "members"] });
    },
  });

  const videoMutation = useMutation({
    mutationFn: async (prompt: string) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/generate-video`, { prompt });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Storyboard Generated", description: "AI video storyboard has been created." });
      setVideoModalOpen(false);
    },
    onError: () => {
      toast({ title: "Generation failed", description: "Could not generate video storyboard.", variant: "destructive" });
    },
  });

  if (projectLoading || membersLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!project) return <div>Project not found</div>;

  const isMember = members?.some((m) => m.userId === user?.id);
  const isOwner = project.ownerId === user?.id;

  return (
    <div className="h-full overflow-y-auto pb-20">
      <div className="relative h-48 bg-muted border-b border-border flex items-end">
        <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent opacity-60" />
        <div className="relative p-6 w-full max-w-5xl mx-auto flex items-end justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant={project.status === "active" ? "default" : "secondary"}>
                {project.status}
              </Badge>
              <span className="text-sm text-secondary font-medium">{project.category}</span>
            </div>
            <h1 className="text-4xl font-bold tracking-tight">{project.title}</h1>
          </div>
          <div className="flex items-center gap-2 mb-1">
            <DonationButton projectId={project.id} projectTitle={project.title} />
            {!isMember && !isOwner && (
              <Button variant="outline" onClick={() => joinMutation.mutate()} disabled={joinMutation.isPending} data-testid="button-join-project">
                Join Project
              </Button>
            )}
            <Button variant="ghost" size="icon" data-testid="button-share-project">
              <Share2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">About this project</h2>
            <p className="text-secondary leading-relaxed">
              {project.description}
            </p>
          </section>

          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Media Gallery</h2>
              {isOwner && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => {
                    setVideoPrompt(
                      `Create a showcase video for "${project.title}": ${project.description}`
                    );
                    setVideoModalOpen(true);
                  }}
                  data-testid="button-generate-video"
                >
                  <Video className="h-4 w-4" />
                  Generate AI Video
                </Button>
              )}
            </div>
            <MediaGallery
              projectId={project.id}
              mediaUrls={project.mediaUrls || []}
              isOwner={isOwner}
            />
          </section>

          {project.rolesNeeded && project.rolesNeeded.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-xl font-semibold">Roles Needed</h2>
              <div className="flex flex-wrap gap-2">
                {project.rolesNeeded.map((role) => (
                  <SkillBadge key={role} skill={role} variant="outline" />
                ))}
              </div>
            </section>
          )}

          {project.techStack && project.techStack.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-xl font-semibold">Tech Stack</h2>
              <div className="flex flex-wrap gap-2">
                {project.techStack.map((tech) => (
                  <Badge key={tech} variant="outline" className="border-purple-500/30 text-purple-600 dark:text-purple-400" data-testid={`badge-dashboard-tech-${tech}`}>
                    {tech}
                  </Badge>
                ))}
              </div>
            </section>
          )}

          <div className="flex flex-wrap gap-4">
            {project.repoUrl && (
              <Button variant="outline" asChild className="gap-2" data-testid="link-repo">
                <a href={project.repoUrl} target="_blank" rel="noopener noreferrer">
                  <Github className="h-4 w-4" />
                  Repository
                </a>
              </Button>
            )}
            {project.liveUrl && (
              <Button variant="outline" asChild className="gap-2" data-testid="link-live">
                <a href={project.liveUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  Live Demo
                </a>
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Project Stats</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-secondary">
                  <Eye className="h-4 w-4" />
                  <span>Views</span>
                </div>
                <span className="font-semibold">{project.views}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-secondary">
                  <Users className="h-4 w-4" />
                  <span>Team Size</span>
                </div>
                <span className="font-semibold">{project.teamSize} members</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-secondary">
                  <Calendar className="h-4 w-4" />
                  <span>Timeline</span>
                </div>
                <span className="font-semibold">{project.estimatedWeeks} weeks</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0">
              <CardTitle className="text-lg">Team Members</CardTitle>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MessageSquare className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {members?.map((member) => (
                  <div key={member.id} className="flex items-center gap-3">
                    <UserAvatar
                      src={member.profile?.avatarUrl}
                      name={member.user.firstName || member.user.email || "Anonymous"}
                      className="h-8 w-8"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{member.user.firstName || member.user.email || "Anonymous"}</p>
                      <p className="text-xs text-tertiary capitalize">{member.role}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={videoModalOpen} onOpenChange={setVideoModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Generate AI Showcase Video
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Describe the showcase video you'd like to create for your project. Nova will generate a detailed storyboard.
            </p>
            <Textarea
              value={videoPrompt}
              onChange={(e) => setVideoPrompt(e.target.value)}
              placeholder="Describe your video..."
              className="min-h-[120px]"
              data-testid="textarea-video-prompt"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVideoModalOpen(false)} data-testid="button-cancel-video">
              Cancel
            </Button>
            <Button
              onClick={() => videoMutation.mutate(videoPrompt)}
              disabled={videoMutation.isPending || !videoPrompt.trim()}
              data-testid="button-submit-video"
            >
              {videoMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Generating...
                </>
              ) : (
                <>
                  <Video className="h-4 w-4 mr-2" />
                  Generate Storyboard
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
