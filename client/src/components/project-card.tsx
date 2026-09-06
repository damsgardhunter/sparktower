import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { SkillBadge } from "@/components/skill-badge";
import { useLocation } from "wouter";
import { Eye, DollarSign, Rocket } from "lucide-react";
import type { Project, User, UserProfile } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { PrivateBadge } from "@/components/private-badge";

interface ProjectCardProps {
  project: Project & { owner?: User; profile?: UserProfile };
}

export function ProjectCard({ project }: ProjectCardProps) {
  const [, setLocation] = useLocation();
  const ownerName = project.owner?.firstName || project.owner?.email || "Anonymous";
  const ownerAvatar = project.profile?.avatarUrl;
  const soloMode = !!(project as any).soloMode;

  return (
    <Card
      className="hover-elevate cursor-pointer overflow-visible"
      onClick={() => setLocation(`/projects/${project.id}`)}
      data-testid={`card-project-${project.id}`}
    >
      <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
        <CardTitle className="text-xl font-bold line-clamp-1 flex items-center gap-1.5 min-w-0">
          {project.isPrivate && <PrivateBadge variant="icon" className="shrink-0" />}
          <span className="truncate">{project.title}</span>
        </CardTitle>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant={project.status === "active" ? "default" : "secondary"}>
            {project.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-secondary line-clamp-2 min-h-[3rem] mb-4">
          {project.description}
        </p>
        <div className="flex flex-wrap gap-1 mb-4">
          {/* Solo builders aren't recruiting, so show the mode instead of
              roles — a solo project can still carry a stale rolesNeeded list. */}
          {soloMode ? (
            <Badge variant="outline" className="gap-1 border-primary/30 text-primary" data-testid="badge-solo-builder">
              <Rocket className="h-3 w-3" /> Solo Builder
            </Badge>
          ) : (
            <>
              {project.rolesNeeded?.slice(0, 3).map((role) => (
                <SkillBadge key={role} skill={role} />
              ))}
              {project.rolesNeeded && project.rolesNeeded.length > 3 && (
                <span className="text-xs text-tertiary">
                  +{project.rolesNeeded.length - 3} more
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserAvatar src={ownerAvatar} name={ownerName} className="h-6 w-6" />
            <span className="text-sm text-secondary">{ownerName}</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-tertiary">
            <div className="flex items-center gap-1">
              <Eye className="h-4 w-4" />
              <span>{project.views}</span>
            </div>
            <div className="flex items-center gap-1">
              <DollarSign className="h-4 w-4" />
              <span>{project.totalDonations / 100}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
