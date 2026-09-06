import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Briefcase, GraduationCap, FolderGit2, Wrench, ExternalLink, Sparkles } from "lucide-react";
import type {
  ProfileEducation, ProfileExperience, ProfilePortfolioProject,
} from "@shared/schema";

/**
 * Résumé-derived credentials for the profile's left column: Nova's read,
 * experience, education, portfolio projects, and skills.
 *
 * Each section hides itself when empty, so a first-day builder with only
 * skills sees a tidy column rather than four empty cards — the profile has to
 * look intentional at every stage.
 */
export function ProfileCredentials({
  novaSummary, experience, education, portfolioProjects, skills, resumeParsedAt,
}: {
  novaSummary?: string | null;
  experience?: ProfileExperience[] | null;
  education?: ProfileEducation[] | null;
  portfolioProjects?: ProfilePortfolioProject[] | null;
  skills?: string[] | null;
  resumeParsedAt?: string | Date | null;
}) {
  const exp = experience || [];
  const edu = education || [];
  const projects = portfolioProjects || [];
  const skillList = skills || [];

  return (
    <>
      {novaSummary && (
        <Card className="border-primary/30 bg-primary/5" data-testid="card-nova-summary">
          <CardContent className="p-4 space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary flex items-center gap-1.5">
              <Sparkles className="h-3 w-3" /> Nova's read
            </p>
            <p className="text-sm leading-relaxed">{novaSummary}</p>
          </CardContent>
        </Card>
      )}

      {skillList.length > 0 && (
        <Card className="border-border/50" data-testid="card-skills">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase text-muted-foreground flex items-center gap-1.5">
              <Wrench className="h-3.5 w-3.5" /> Skills
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Badges are nowrap by default, but résumé skills can be long
                ("Ensemble modeling (stacked XGBoost + Quantile RF)") and were
                overflowing the card. Allow them to wrap inside the badge. */}
            <div className="flex flex-wrap gap-1.5">
              {skillList.map((s) => (
                <Badge
                  key={s}
                  variant="secondary"
                  className="text-xs whitespace-normal break-words text-left max-w-full leading-snug py-1"
                  data-testid={`skill-${s}`}
                >
                  {s}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {exp.length > 0 && (
        <Card className="border-border/50" data-testid="card-experience">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase text-muted-foreground flex items-center gap-1.5">
              <Briefcase className="h-3.5 w-3.5" /> Experience
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {exp.map((e, i) => (
              <div
                key={i}
                className="relative pl-4 border-l-2 border-border/60 last:pb-0"
                data-testid={`experience-${i}`}
              >
                <div className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-primary" />
                <p className="text-sm font-medium leading-tight">{e.title}</p>
                {e.company && <p className="text-sm text-secondary">{e.company}</p>}
                <p className="text-xs text-muted-foreground">
                  {[e.startDate, e.current ? "Present" : e.endDate].filter(Boolean).join(" – ") || "—"}
                  {e.location && ` · ${e.location}`}
                </p>
                {e.description && (
                  <p className="text-xs mt-1 leading-relaxed text-muted-foreground">{e.description}</p>
                )}
                {(e.skills?.length || 0) > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {e.skills!.map((s) => (
                      <Badge key={s} variant="outline" className="text-[10px] font-normal whitespace-normal break-words text-left max-w-full leading-snug">{s}</Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {edu.length > 0 && (
        <Card className="border-border/50" data-testid="card-education">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase text-muted-foreground flex items-center gap-1.5">
              <GraduationCap className="h-3.5 w-3.5" /> Education
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {edu.map((e, i) => (
              <div key={i} data-testid={`education-${i}`}>
                <p className="text-sm font-medium leading-tight">{e.school}</p>
                {(e.degree || e.field) && (
                  <p className="text-sm text-secondary">{[e.degree, e.field].filter(Boolean).join(", ")}</p>
                )}
                {(e.startYear || e.endYear) && (
                  <p className="text-xs text-muted-foreground">
                    {[e.startYear, e.endYear].filter(Boolean).join(" – ")}
                  </p>
                )}
                {e.description && (
                  <p className="text-xs mt-1 leading-relaxed text-muted-foreground">{e.description}</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {projects.length > 0 && (
        <Card className="border-border/50" data-testid="card-portfolio">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase text-muted-foreground flex items-center gap-1.5">
              <FolderGit2 className="h-3.5 w-3.5" /> Other work
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {projects.map((p, i) => (
              <div key={i} data-testid={`portfolio-${i}`}>
                <div className="flex items-start gap-1.5">
                  <p className="text-sm font-medium leading-tight">{p.name}</p>
                  {p.url && (
                    <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground shrink-0 mt-0.5">
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                {p.role && <p className="text-xs text-secondary">{p.role}</p>}
                {p.description && (
                  <p className="text-xs mt-0.5 leading-relaxed text-muted-foreground">{p.description}</p>
                )}
                {(p.technologies?.length || 0) > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {p.technologies!.map((t) => (
                      <Badge key={t} variant="outline" className="text-[10px] font-normal whitespace-normal break-words text-left max-w-full leading-snug">{t}</Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {resumeParsedAt && (
        <p className="text-[10px] text-muted-foreground px-1">
          Profile built from résumé {new Date(resumeParsedAt).toLocaleDateString()}
        </p>
      )}
    </>
  );
}
