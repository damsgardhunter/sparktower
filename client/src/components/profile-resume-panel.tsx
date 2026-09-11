import { errorText } from "@/lib/api-error";
import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useEntitlements } from "@/hooks/use-entitlements";
import { useUpload } from "@/hooks/use-upload";
import {
  Loader2, Sparkles, Wand2, Briefcase, GraduationCap, FolderGit2, Check, FileText, Upload,
} from "lucide-react";
import { CREDIT_COSTS } from "@shared/plans";

interface ResumeDraft {
  headline: string;
  novaSummary: string;
  skills: string[];
  interests: string[];
  experienceLevel: string;
  experience: { title: string; company: string; startDate?: string | null; endDate?: string | null; current?: boolean; description?: string | null; skills?: string[] }[];
  education: { school: string; degree?: string | null; field?: string | null; startYear?: string | null; endYear?: string | null }[];
  portfolioProjects: { name: string; role?: string | null; description?: string | null; technologies?: string[] }[];
}

/**
 * "Let Nova build my profile" — paste a résumé, review what Nova extracted,
 * then apply it.
 *
 * Previews before saving because this writes over experience, education, and
 * skills; getting it wrong silently would be worse than an extra click.
 */
export function ProfileResumePanel({ hasProfileContent }: { hasProfileContent: boolean }) {
  const { toast } = useToast();
  const { creditsRemaining, isUnlimited } = useEntitlements();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ResumeDraft | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: resumeStatus, refetch: refetchStatus } = useQuery<{
    hasResume: boolean;
    readable: boolean;
    fileName?: string;
    note?: string | null;
  }>({
    queryKey: ["/api/profile/resume-status"],
  });

  /** Saves a freshly uploaded file onto the profile so Nova can read it. */
  const attachResume = useMutation({
    mutationFn: async (objectPath: string) => {
      const res = await apiRequest("POST", "/api/profile/attach-resume", { resumeUrl: objectPath });
      return res.json();
    },
    onSuccess: async (result) => {
      await refetchStatus();
      queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
      if (result?.readable) {
        toast({ title: "Résumé uploaded", description: "Nova can read it — hit Evaluate." });
      } else {
        toast({
          title: "Uploaded, but unreadable",
          description: result?.note || "Try exporting it as a PDF.",
          variant: "destructive",
        });
      }
    },
    onError: (err) => surface(err, "Couldn't save that file."),
  });

  const { uploadFile, isUploading } = useUpload({
    onSuccess: (response) => attachResume.mutate(response.objectPath),
    onError: (error) => toast({ title: "Upload failed", description: errorText(error), variant: "destructive" }),
  });

  const canRead = !!resumeStatus?.hasResume && resumeStatus.readable;
  const cantAfford = !isUnlimited && creditsRemaining < CREDIT_COSTS.resumeEvaluation;
  const busy = isUploading || attachResume.isPending;

  const surface = (err: any, fallback: string) => {
    const raw = err?.message || "";
    const start = raw.indexOf("{");
    let description = fallback;
    if (start >= 0) {
      try { description = JSON.parse(raw.slice(start)).message || fallback; } catch { /* keep */ }
    }
    toast({ title: "Couldn't do that", description, variant: "destructive" });
  };

  const evaluate = useMutation({
    mutationFn: async () => {
      // apply: false returns a preview rather than overwriting immediately.
      const res = await apiRequest("POST", "/api/profile/evaluate-resume", { apply: false });
      return res.json();
    },
    onSuccess: (result) => {
      setDraft(result.draft);
      queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
    },
    onError: (err) => {
      surface(err, "Nova couldn't read that.");
      // Re-check status so the dialog reflects an unreadable/missing file.
      refetchStatus();
    },
  });

  const apply = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/profile/apply-resume-draft", { draft });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Profile updated", description: "Nova filled in your experience, education, and skills." });
      setOpen(false);
      setDraft(null);
      queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
    },
    onError: (err) => surface(err, "Couldn't save your profile."),
  });

  return (
    <>
      <Card className="border-dashed border-primary/40 bg-primary/5" data-testid="card-resume-panel">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
              <Wand2 className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="font-medium text-sm">
                {hasProfileContent ? "Refresh your profile with Nova" : "Let Nova build your profile"}
              </p>
              <p className="text-xs text-muted-foreground">
                {resumeStatus?.hasResume && resumeStatus.readable
                  ? "Nova reads the résumé on your profile and fills in your experience, education, projects, and skills."
                  : "Upload your résumé and Nova fills in your experience, education, projects, and skills."}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            className="w-full gap-2"
            disabled={cantAfford}
            onClick={() => setOpen(true)}
            data-testid="button-open-resume-eval"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {hasProfileContent ? "Re-run" : "Build my profile"}
            <Badge variant="secondary" className="ml-0.5 text-[10px]">{CREDIT_COSTS.resumeEvaluation}</Badge>
          </Button>
          {cantAfford && (
            <p className="text-xs text-destructive">
              Needs {CREDIT_COSTS.resumeEvaluation} credits, you have {creditsRemaining}.
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setDraft(null); }}>
        <DialogContent className="max-w-2xl max-h-[88vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-primary" /> Build your profile
            </DialogTitle>
            <DialogDescription>
              {draft
                ? "Here's what Nova found. Review it, then save."
                : canRead
                  ? "Nova will read the résumé on your profile."
                  : "Upload your résumé and Nova will read it."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto -mx-6 px-6 py-2 space-y-4">
            {!draft ? (
              <>
                {/* Upload-only. A résumé is a file, so asking someone to
                    paste 40 lines of text was the wrong interaction. */}
                {canRead ? (
                  <div className="flex items-center gap-3 rounded-md border border-border/60 bg-muted/40 p-3">
                    <FileText className="h-9 w-9 text-primary shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">Résumé ready</p>
                      <p className="text-xs text-muted-foreground truncate">
                        Nova will read this. Upload a different file to replace it.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 shrink-0"
                      disabled={busy}
                      onClick={() => fileRef.current?.click()}
                      data-testid="button-replace-resume"
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                      Replace
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => fileRef.current?.click()}
                    className="w-full rounded-lg border-2 border-dashed border-border hover:border-primary/50 hover:bg-accent/40 transition-colors p-8 flex flex-col items-center gap-2 disabled:opacity-60"
                    data-testid="button-upload-resume"
                  >
                    {busy ? (
                      <>
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <p className="text-sm font-medium">Uploading…</p>
                      </>
                    ) : (
                      <>
                        <Upload className="h-8 w-8 text-primary" />
                        <p className="text-sm font-medium">Upload your résumé</p>
                        <p className="text-xs text-muted-foreground">PDF works best · max 10MB</p>
                      </>
                    )}
                  </button>
                )}

                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.txt,.md,application/pdf,text/plain"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadFile(file);
                    e.target.value = "";
                  }}
                />

                {resumeStatus?.hasResume && !resumeStatus.readable && resumeStatus.note && (
                  <p className="text-xs text-amber-600 dark:text-amber-400" data-testid="text-resume-note">
                    {resumeStatus.note}
                  </p>
                )}

                <p className="text-xs text-muted-foreground">
                  Nova only uses what's actually in the file — it won't invent employers, dates, or skills.
                </p>
              </>
            ) : (
              <div className="space-y-4">
                {draft.novaSummary && (
                  <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-primary mb-1">Nova's read</p>
                    <p className="text-sm leading-relaxed">{draft.novaSummary}</p>
                  </div>
                )}

                {draft.headline && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Headline</p>
                    <p className="text-sm font-medium">{draft.headline}</p>
                  </div>
                )}

                {draft.experience.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                      <Briefcase className="h-3.5 w-3.5" /> Experience ({draft.experience.length})
                    </p>
                    {draft.experience.map((e, i) => (
                      <div key={i} className="rounded-md border border-border/60 p-2.5" data-testid={`draft-exp-${i}`}>
                        <p className="text-sm font-medium">{e.title}{e.company && ` · ${e.company}`}</p>
                        <p className="text-xs text-muted-foreground">
                          {e.startDate || "?"} – {e.current ? "Present" : e.endDate || "?"}
                        </p>
                        {e.description && <p className="text-xs mt-1 leading-relaxed">{e.description}</p>}
                      </div>
                    ))}
                  </div>
                )}

                {draft.education.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                      <GraduationCap className="h-3.5 w-3.5" /> Education ({draft.education.length})
                    </p>
                    {draft.education.map((e, i) => (
                      <div key={i} className="rounded-md border border-border/60 p-2.5" data-testid={`draft-edu-${i}`}>
                        <p className="text-sm font-medium">{e.school}</p>
                        <p className="text-xs text-muted-foreground">
                          {[e.degree, e.field].filter(Boolean).join(", ")}
                          {e.endYear && ` · ${e.startYear || ""}–${e.endYear}`}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {draft.portfolioProjects.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                      <FolderGit2 className="h-3.5 w-3.5" /> Projects ({draft.portfolioProjects.length})
                    </p>
                    {draft.portfolioProjects.map((p, i) => (
                      <div key={i} className="rounded-md border border-border/60 p-2.5" data-testid={`draft-proj-${i}`}>
                        <p className="text-sm font-medium">{p.name}</p>
                        {p.description && <p className="text-xs mt-0.5 leading-relaxed">{p.description}</p>}
                        {(p.technologies?.length || 0) > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {p.technologies!.map((t) => (
                              <Badge key={t} variant="outline" className="text-[10px] font-normal whitespace-normal break-words text-left max-w-full leading-snug">{t}</Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {draft.skills.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Skills ({draft.skills.length})
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {draft.skills.map((s) => (
                        <Badge key={s} variant="secondary" className="text-xs whitespace-normal break-words text-left max-w-full leading-snug">{s}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {hasProfileContent && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Saving replaces your current experience, education, projects, and skills.
                  </p>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="shrink-0">
            {draft ? (
              <>
                <Button variant="outline" onClick={() => setDraft(null)}>Back</Button>
                <Button disabled={apply.isPending} onClick={() => apply.mutate()} data-testid="button-apply-draft">
                  {apply.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                  Save to my profile
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button
                  disabled={!canRead || evaluate.isPending || busy}
                  onClick={() => evaluate.mutate()}
                  data-testid="button-evaluate-resume"
                >
                  {evaluate.isPending
                    ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Nova is reading your résumé…</>
                    : <><Sparkles className="h-4 w-4 mr-2" /> Evaluate ({CREDIT_COSTS.resumeEvaluation} credits)</>}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
