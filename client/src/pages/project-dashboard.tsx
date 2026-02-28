import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserAvatar } from "@/components/user-avatar";
import { SkillBadge } from "@/components/skill-badge";
import { DonationButton } from "@/components/donation-button";
import { CodeDisplay } from "@/components/code-display";
import {
  Loader2,
  Users,
  Eye,
  Calendar,
  ExternalLink,
  Github,
  Share2,
  MessageSquare,
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

          {project.codeSnippet && (
            <section className="space-y-4">
              <h2 className="text-xl font-semibold">Code Preview</h2>
              <CodeDisplay code={project.codeSnippet} />
            </section>
          )}

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Tech Stack</h2>
            <div className="flex flex-wrap gap-2">
              {project.techStack?.map((tech) => (
                <SkillBadge key={tech} skill={tech} variant="outline" />
              ))}
            </div>
          </section>

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
    </div>
  );
}
