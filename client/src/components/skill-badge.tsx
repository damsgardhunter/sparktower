import { Badge } from "@/components/ui/badge";

interface SkillBadgeProps {
  skill: string;
  variant?: "default" | "secondary" | "outline";
}

export function SkillBadge({ skill, variant = "secondary" }: SkillBadgeProps) {
  return (
    <Badge variant={variant} className="no-default-active-elevate" data-testid={`badge-skill-${skill}`}>
      {skill}
    </Badge>
  );
}
