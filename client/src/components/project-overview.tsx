import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Compass, Quote, Target, Users2, Sparkles, UserSearch, TrendingUp,
  CircleDot, ListChecks, Settings2,
} from "lucide-react";
import {
  isSectionVisible, getProjectScope, PROJECT_SECTIONS_BY_KEY,
  type ProjectSectionKey,
} from "@shared/project-sections";
import type { Project } from "@shared/schema";

/** Brief fields rendered as a card grid, in display order. */
const BRIEF_CARDS: { key: ProjectSectionKey; icon: typeof Target; accent: string }[] = [
  { key: "problemStatement", icon: Target, accent: "text-rose-500" },
  { key: "targetUser", icon: Users2, accent: "text-blue-500" },
  { key: "valueProposition", icon: Sparkles, accent: "text-amber-500" },
  { key: "targetCustomerProfile", icon: UserSearch, accent: "text-violet-500" },
  { key: "successMetrics", icon: TrendingUp, accent: "text-emerald-500" },
];

interface ProjectOverviewProps {
  project: Project;
  isOwner: boolean;
  onManage: () => void;
}

export function ProjectOverview({ project, isOwner, onManage }: ProjectOverviewProps) {
  const show = (key: ProjectSectionKey) => isSectionVisible(project, key);
  const scope = getProjectScope(project);

  const briefCards = BRIEF_CARDS.filter((c) => show(c.key));
  const hasHero = show("oneLiner") || show("mission") || show("description");
  const hasAnything = hasHero || briefCards.length > 0 || show("scope");

  // A brand-new project has a description but no brief yet. Rather than render
  // an empty band, nudge the owner toward Manage where they fill it in.
  if (!hasAnything) {
    return isOwner ? (
      <Card className="border-dashed" data-testid="card-overview-empty">
        <CardContent className="p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="flex-1 space-y-1">
            <p className="font-medium flex items-center gap-2">
              <Compass className="h-4 w-4 text-primary" /> Bring this page to life
            </p>
            <p className="text-sm text-muted-foreground">
              Add a one-liner, mission, and project brief so visitors instantly understand what you're building.
            </p>
          </div>
          <Button size="sm" className="gap-2 shrink-0" onClick={onManage} data-testid="button-overview-setup">
            <Settings2 className="h-4 w-4" /> Set up your brief
          </Button>
        </CardContent>
      </Card>
    ) : null;
  }

  return (
    <div className="space-y-6" data-testid="section-project-overview">
      {show("oneLiner") && (
        <div className="relative rounded-xl border border-primary/20 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-6">
          <Quote className="absolute top-4 right-4 h-8 w-8 text-primary/15" aria-hidden />
          <p className="text-xs font-medium uppercase tracking-wide text-primary/80 mb-2">
            {PROJECT_SECTIONS_BY_KEY.oneLiner.label}
          </p>
          <p className="text-xl sm:text-2xl font-semibold leading-snug pr-10" data-testid="text-overview-one-liner">
            {project.oneLiner}
          </p>
        </div>
      )}

      {show("mission") && (
        <section className="space-y-3" data-testid="section-overview-mission">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Compass className="h-5 w-5 text-primary" /> {PROJECT_SECTIONS_BY_KEY.mission.label}
          </h2>
          <p className="text-secondary leading-relaxed whitespace-pre-line" data-testid="text-overview-mission">
            {project.mission}
          </p>
        </section>
      )}

      {show("description") && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{PROJECT_SECTIONS_BY_KEY.description.label} this project</h2>
          <p className="text-secondary leading-relaxed whitespace-pre-line" data-testid="text-project-description">
            {project.description}
          </p>
        </section>
      )}

      {briefCards.length > 0 && (
        <section className="space-y-3" data-testid="section-overview-brief">
          <h2 className="text-xl font-semibold">Project Brief</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {briefCards.map(({ key, icon: Icon, accent }, i) => (
              <Card
                key={key}
                // A lone trailing card would leave an awkward gap in a 2-up grid.
                className={`bg-muted/30 border-border/60 ${
                  briefCards.length % 2 === 1 && i === briefCards.length - 1 ? "sm:col-span-2" : ""
                }`}
                data-testid={`card-brief-${key}`}
              >
                <CardContent className="p-4 space-y-1.5">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                    <Icon className={`h-3.5 w-3.5 ${accent}`} /> {PROJECT_SECTIONS_BY_KEY[key].label}
                  </p>
                  <p className="text-sm leading-relaxed whitespace-pre-line" data-testid={`text-brief-${key}`}>
                    {(project as any)[key]}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {show("scope") && (
        <section className="space-y-3" data-testid="section-overview-scope">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-primary" /> {PROJECT_SECTIONS_BY_KEY.scope.label}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(scope.mvp?.length || 0) > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Building now (MVP)</p>
                <ul className="space-y-1.5">
                  {scope.mvp!.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm" data-testid={`item-scope-mvp-${i}`}>
                      <CircleDot className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" aria-hidden />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(scope.niceToHave?.length || 0) > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Exploring next</p>
                <div className="flex flex-wrap gap-1.5">
                  {scope.niceToHave!.map((item, i) => (
                    <Badge key={i} variant="secondary" className="font-normal" data-testid={`item-scope-nice-${i}`}>
                      {item}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
