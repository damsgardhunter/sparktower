import { Badge } from "@/components/ui/badge";

interface SkillBadgeProps {
  skill: string;
  variant?: "default" | "secondary" | "outline";
}

export function SkillBadge({ skill, variant = "secondary" }: SkillBadgeProps) {
  return (
    <Badge
      variant={variant}
      /*
       * Badges are nowrap by default, but skills come from résumés and can be
       * long — "Ensemble modeling (stacked XGBoost + Quantile RF)" was running
       * past the edge of its card. Let the text wrap inside the badge instead.
       */
      className="no-default-active-elevate whitespace-normal break-words text-left max-w-full leading-snug py-1"
      data-testid={`badge-skill-${skill}`}
    >
      {skill}
    </Badge>
  );
}
