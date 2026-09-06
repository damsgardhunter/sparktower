import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useEntitlements } from "@/hooks/use-entitlements";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import {
  Loader2, Presentation, Gauge, MessageSquareWarning, Mic, Send,
  CheckCircle2, AlertTriangle, Quote, ArrowRight, Trophy, X,
} from "lucide-react";
import { CREDIT_COSTS } from "@shared/plans";
import type { InvestorArtifact, MockInterview, MockInterviewTurn } from "@shared/schema";

type Tool = "deck" | "score" | "critique" | "interview";

const TOOLS: { id: Tool; label: string; icon: typeof Gauge; cost: string; blurb: string }[] = [
  { id: "score", label: "Readiness Score", icon: Gauge, cost: `${CREDIT_COSTS.investorReadinessScore}`, blurb: "How ready are you to raise, scored honestly across six categories." },
  { id: "deck", label: "Pitch Deck Outline", icon: Presentation, cost: `${CREDIT_COSTS.pitchDeckOutline}`, blurb: "Slide-by-slide outline with the actual headlines and speaker notes." },
  { id: "critique", label: "Pitch Critique", icon: MessageSquareWarning, cost: `${CREDIT_COSTS.pitchCritique}`, blurb: "Paste your pitch and get it torn apart constructively, line by line." },
  { id: "interview", label: "Mock Interview", icon: Mic, cost: `${CREDIT_COSTS.mockInterviewQuestion}–${CREDIT_COSTS.mockInterviewGrading}/answer`, blurb: "Nova plays an investor, asks hard questions, and grades every answer." },
];

const VERDICT_STYLES: Record<string, string> = {
  "not-ready": "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30",
  early: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  "getting-close": "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  ready: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
};

/** Pulls the server's message out of an apiRequest error string. */
function errorMessage(err: any, fallback: string): string {
  const raw = err?.message || "";
  const start = raw.indexOf("{");
  if (start >= 0) {
    try { return JSON.parse(raw.slice(start)).message || fallback; } catch { /* fall through */ }
  }
  return fallback;
}

export function InvestorTools({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const { can, creditsRemaining, isUnlimited } = useEntitlements();
  const [tool, setTool] = useState<Tool>("score");
  const [pitch, setPitch] = useState("");
  const [persona, setPersona] = useState("seed_generalist");
  const [difficulty, setDifficulty] = useState("skeptical");
  const [answer, setAnswer] = useState("");
  const [activeInterviewId, setActiveInterviewId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{
    artifacts: InvestorArtifact[];
    interviews: MockInterview[];
  }>({
    queryKey: ["/api/projects", projectId, "investor-artifacts"],
    enabled: !!projectId,
  });

  const { data: interviewData } = useQuery<{
    interview: MockInterview & { turns: MockInterviewTurn[] };
    persona: { label: string } | null;
  }>({
    queryKey: ["/api/mock-interviews", activeInterviewId],
    enabled: !!activeInterviewId,
  });

  const { data: personas } = useQuery<{
    personas: { id: string; label: string; brief: string }[];
    difficulties: { id: string; brief: string }[];
  }>({ queryKey: ["/api/investor-personas"], enabled: tool === "interview" });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "investor-artifacts"] });
    queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
  };

  const runTool = useMutation({
    mutationFn: async (which: Tool) => {
      const path = which === "deck" ? "pitch-deck" : which === "score" ? "readiness-score" : "pitch-critique";
      const res = await apiRequest("POST", `/api/projects/${projectId}/${path}`,
        which === "critique" ? { pitch } : undefined);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Nova's done" });
      setPitch("");
      refresh();
    },
    onError: (err) => toast({ title: "Couldn't run that", description: errorMessage(err, "Please try again."), variant: "destructive" }),
  });

  const startInterview = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/mock-interview`, { persona, difficulty });
      return res.json();
    },
    onSuccess: (result) => {
      setActiveInterviewId(result.interview.id);
      refresh();
    },
    onError: (err) => toast({ title: "Couldn't start the interview", description: errorMessage(err, "Please try again."), variant: "destructive" }),
  });

  const submitAnswer = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/mock-interviews/${activeInterviewId}/answer`, { answer });
      return res.json();
    },
    onSuccess: () => {
      setAnswer("");
      queryClient.invalidateQueries({ queryKey: ["/api/mock-interviews", activeInterviewId] });
      queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
    },
    onError: (err) => toast({ title: "Couldn't grade that", description: errorMessage(err, "Please try again."), variant: "destructive" }),
  });

  const finishInterview = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/mock-interviews/${activeInterviewId}/finish`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mock-interviews", activeInterviewId] });
      refresh();
    },
  });

  if (!can("aiRoadmap")) {
    return (
      <UpgradePrompt
        feature="aiRoadmap"
        title="Get investor-ready"
        description="Score your readiness, outline a deck, have your pitch pulled apart, and sit a mock investor interview that grades every answer."
      />
    );
  }

  const latest = (kind: string) => data?.artifacts?.find((a) => a.kind === kind);
  const cost = tool === "deck" ? CREDIT_COSTS.pitchDeckOutline
    : tool === "score" ? CREDIT_COSTS.investorReadinessScore
    : tool === "critique" ? CREDIT_COSTS.pitchCritique
    : CREDIT_COSTS.mockInterviewQuestion;
  const cantAfford = !isUnlimited && creditsRemaining < cost;

  return (
    <div className="space-y-4" data-testid="investor-tools">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {TOOLS.map((t) => {
          const Icon = t.icon;
          const active = tool === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              className={`text-left p-3 rounded-lg border-2 transition-all ${
                active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
              }`}
              data-testid={`button-tool-${t.id}`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className={`h-4 w-4 ${active ? "text-primary" : "text-muted-foreground"}`} />
                <span className="text-sm font-medium">{t.label}</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug">{t.blurb}</p>
              <Badge variant="secondary" className="mt-1.5 text-[10px]">{t.cost} credits</Badge>
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : tool === "interview" ? (
        <MockInterviewPanel
          personas={personas}
          persona={persona} setPersona={setPersona}
          difficulty={difficulty} setDifficulty={setDifficulty}
          interviews={data?.interviews || []}
          activeInterviewId={activeInterviewId}
          setActiveInterviewId={setActiveInterviewId}
          interviewData={interviewData}
          answer={answer} setAnswer={setAnswer}
          onStart={() => startInterview.mutate()}
          onSubmit={() => submitAnswer.mutate()}
          onFinish={() => finishInterview.mutate()}
          starting={startInterview.isPending}
          submitting={submitAnswer.isPending}
          finishing={finishInterview.isPending}
        />
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 gap-3">
            <CardTitle className="text-base">{TOOLS.find((t) => t.id === tool)?.label}</CardTitle>
            <Button
              size="sm"
              className="gap-2 shrink-0"
              disabled={runTool.isPending || cantAfford || (tool === "critique" && !pitch.trim())}
              onClick={() => runTool.mutate(tool)}
              data-testid="button-run-tool"
            >
              {runTool.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {latest(tool === "deck" ? "deck_outline" : tool === "score" ? "readiness_score" : "pitch_critique") ? "Run again" : "Run"} ({cost})
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {cantAfford && (
              <p className="text-xs text-destructive">
                This costs {cost} credits and you have {creditsRemaining}.
              </p>
            )}

            {tool === "critique" && (
              <div className="space-y-2">
                <Label>Paste your pitch</Label>
                <Textarea
                  value={pitch}
                  onChange={(e) => setPitch(e.target.value)}
                  placeholder="Your elevator pitch, cold email, or the script you'd read in a meeting…"
                  className="min-h-[140px]"
                  data-testid="textarea-pitch"
                />
                <p className="text-xs text-muted-foreground">
                  Nova quotes your own words back when something doesn't land.
                </p>
              </div>
            )}

            {tool === "score" && <ReadinessResult artifact={latest("readiness_score")} />}
            {tool === "deck" && <DeckResult artifact={latest("deck_outline")} />}
            {tool === "critique" && <CritiqueResult artifact={latest("pitch_critique")} />}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ReadinessResult({ artifact }: { artifact?: InvestorArtifact }) {
  if (!artifact) {
    return <p className="text-sm text-muted-foreground">No score yet. Run it to see where you stand.</p>;
  }
  const content = artifact.content as any;
  return (
    <div className="space-y-4" data-testid="result-readiness">
      <div className="flex items-center gap-4">
        <div className="shrink-0 text-center">
          <p className="text-4xl font-bold" data-testid="text-readiness-score">{artifact.score}</p>
          <p className="text-xs text-muted-foreground">out of 100</p>
        </div>
        <div className="flex-1 space-y-2 min-w-0">
          <Badge variant="outline" className={VERDICT_STYLES[content.verdict] || ""} data-testid="badge-readiness-verdict">
            {String(content.verdict || "").replace(/-/g, " ")}
          </Badge>
          <p className="text-sm text-secondary leading-relaxed">{artifact.summary}</p>
        </div>
      </div>

      {(content.blockers || []).length > 0 && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3 space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" /> Would sink a real meeting
          </p>
          {content.blockers.map((b: string, i: number) => (
            <p key={i} className="text-sm">· {b}</p>
          ))}
        </div>
      )}

      <div className="space-y-2.5">
        {(content.categories || []).map((c: any, i: number) => (
          <div key={i} className="space-y-1.5" data-testid={`category-${i}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{c.name}</span>
              <span className="text-sm text-muted-foreground">{c.score}</span>
            </div>
            <Progress value={c.score} className="h-1.5" />
            <p className="text-xs text-muted-foreground">{c.finding}</p>
            <p className="text-xs"><span className="text-muted-foreground">Fix first:</span> {c.toImprove}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Scored {new Date(artifact.createdAt).toLocaleString()}</p>
    </div>
  );
}

function DeckResult({ artifact }: { artifact?: InvestorArtifact }) {
  if (!artifact) {
    return <p className="text-sm text-muted-foreground">No outline yet. Run it to get a slide-by-slide plan.</p>;
  }
  const slides = ((artifact.content as any)?.slides || []) as any[];
  return (
    <div className="space-y-3" data-testid="result-deck">
      {artifact.summary && <p className="text-sm text-secondary leading-relaxed">{artifact.summary}</p>}
      {slides.map((s, i) => (
        <div key={i} className="rounded-md border border-border/60 p-3 space-y-2" data-testid={`slide-${i}`}>
          <div className="flex items-start gap-2">
            <div className="h-6 w-6 rounded bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
              {s.number}
            </div>
            <div className="min-w-0 space-y-0.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{s.purpose}</p>
              <p className="font-medium text-sm leading-snug">{s.headline}</p>
            </div>
          </div>
          {(s.bullets || []).length > 0 && (
            <ul className="space-y-0.5 pl-8">
              {s.bullets.map((b: string, j: number) => (
                <li key={j} className="text-xs text-muted-foreground">· {b}</li>
              ))}
            </ul>
          )}
          {s.speakerNote && (
            <p className="text-xs italic text-muted-foreground pl-8">Say: {s.speakerNote}</p>
          )}
          {s.missingData && (
            <p className="text-xs text-amber-600 dark:text-amber-400 pl-8 flex items-start gap-1">
              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /> You need: {s.missingData}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function CritiqueResult({ artifact }: { artifact?: InvestorArtifact }) {
  if (!artifact) {
    return <p className="text-sm text-muted-foreground">No critique yet. Paste a pitch above and run it.</p>;
  }
  const c = artifact.content as any;
  return (
    <div className="space-y-4" data-testid="result-critique">
      <div className="flex items-center gap-3">
        <p className="text-3xl font-bold">{artifact.score}</p>
        <p className="text-sm text-secondary leading-relaxed flex-1">{artifact.summary}</p>
      </div>

      {(c.worksWell || []).length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" /> This lands
          </p>
          {c.worksWell.map((w: string, i: number) => <p key={i} className="text-sm">· {w}</p>)}
        </div>
      )}

      {(c.problems || []).length > 0 && (
        <div className="space-y-2.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What doesn't</p>
          {c.problems.map((p: any, i: number) => (
            <div key={i} className="rounded-md border-l-2 border-rose-500/50 bg-muted/40 p-3 space-y-1" data-testid={`problem-${i}`}>
              <p className="text-sm italic flex items-start gap-1.5">
                <Quote className="h-3 w-3 mt-1 shrink-0 text-muted-foreground" />"{p.quote}"
              </p>
              <p className="text-xs text-muted-foreground">{p.issue}</p>
              <p className="text-xs"><span className="text-muted-foreground">Instead:</span> {p.fix}</p>
            </div>
          ))}
        </div>
      )}

      {(c.questionsTheyWillAsk || []).length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">They'll ask you this</p>
          {c.questionsTheyWillAsk.map((q: string, i: number) => <p key={i} className="text-sm">· {q}</p>)}
        </div>
      )}

      {c.rewrittenOpener && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Try opening with this</p>
          <p className="text-sm leading-relaxed">{c.rewrittenOpener}</p>
        </div>
      )}
    </div>
  );
}

function MockInterviewPanel({
  personas, persona, setPersona, difficulty, setDifficulty,
  interviews, activeInterviewId, setActiveInterviewId, interviewData,
  answer, setAnswer, onStart, onSubmit, onFinish, starting, submitting, finishing,
}: any) {
  const interview = interviewData?.interview;
  const pending = interview?.turns?.find((t: MockInterviewTurn) => !t.answer);
  const graded = (interview?.turns || []).filter((t: MockInterviewTurn) => t.score != null);

  if (!activeInterviewId) {
    return (
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-base flex items-center gap-2">
            <Mic className="h-4 w-4 text-primary" /> Mock investor interview
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Nova plays an investor, asks progressively harder questions, and grades each answer out of 100.
            {" "}{CREDIT_COSTS.mockInterviewQuestion} credit per question, {CREDIT_COSTS.mockInterviewGrading} to grade your answer.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Who's across the table?</Label>
              <Select value={persona} onValueChange={setPersona}>
                <SelectTrigger data-testid="select-investor-persona"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(personas?.personas || []).map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">How hard should they push?</Label>
              <Select value={difficulty} onValueChange={setDifficulty}>
                <SelectTrigger data-testid="select-investor-difficulty"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="friendly">Friendly — encouraging</SelectItem>
                  <SelectItem value="skeptical">Skeptical — probes weak answers</SelectItem>
                  <SelectItem value="brutal">Brutal — no mercy</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {personas?.personas?.find((p: any) => p.id === persona) && (
            <p className="text-xs text-muted-foreground">
              {personas.personas.find((p: any) => p.id === persona).brief}
            </p>
          )}
          <Button className="w-full gap-2" disabled={starting} onClick={onStart} data-testid="button-start-interview">
            {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
            Start the interview
          </Button>

          {interviews.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-border/50">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Past sessions</p>
              {interviews.map((iv: MockInterview) => (
                <button
                  key={iv.id}
                  onClick={() => setActiveInterviewId(iv.id)}
                  className="w-full flex items-center justify-between gap-2 text-left rounded-md border border-border/60 p-2.5 hover:border-primary/40"
                  data-testid={`interview-row-${iv.id}`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium capitalize">{iv.persona.replace(/_/g, " ")} · {iv.difficulty}</p>
                    <p className="text-xs text-muted-foreground">{new Date(iv.createdAt).toLocaleString()}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {iv.averageScore != null && <Badge variant="secondary">{iv.averageScore}/100</Badge>}
                    <Badge variant="outline" className="text-[10px]">{iv.status}</Badge>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="card-active-interview">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-3">
        <div className="space-y-1 min-w-0">
          <CardTitle className="text-base flex items-center gap-2">
            <Mic className="h-4 w-4 text-primary" />
            {interviewData?.persona?.label || "Investor"}
          </CardTitle>
          <p className="text-xs text-muted-foreground capitalize">
            {interview?.difficulty} · {graded.length} of {8} answered
            {interview?.averageScore != null && ` · averaging ${interview.averageScore}/100`}
          </p>
        </div>
        <Button variant="ghost" size="sm" className="h-7 px-2 shrink-0" onClick={() => setActiveInterviewId(null)} data-testid="button-close-interview">
          <X className="h-3.5 w-3.5" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {graded.map((turn: MockInterviewTurn, i: number) => {
          const fb = turn.feedback as any;
          return (
            <div key={turn.id} className="space-y-2 pb-4 border-b border-border/50 last:border-0" data-testid={`turn-${i}`}>
              <p className="text-sm font-medium">Q{i + 1}. {turn.question}</p>
              <p className="text-sm text-muted-foreground italic pl-3 border-l-2 border-border">{turn.answer}</p>
              <div className="flex items-center gap-2">
                <Badge variant={turn.score! >= 70 ? "default" : turn.score! >= 45 ? "secondary" : "destructive"}>
                  {turn.score}/100
                </Badge>
                {fb?.verdict && <p className="text-xs text-muted-foreground">{fb.verdict}</p>}
              </div>
              {(fb?.strong || []).length > 0 && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400">+ {fb.strong.join(" · ")}</p>
              )}
              {(fb?.weak || []).length > 0 && (
                <p className="text-xs text-rose-600 dark:text-rose-400">− {fb.weak.join(" · ")}</p>
              )}
              {fb?.wouldPushOn && (
                <p className="text-xs"><span className="text-muted-foreground">They'd follow up:</span> {fb.wouldPushOn}</p>
              )}
            </div>
          );
        })}

        {interview?.status === "completed" ? (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-4 space-y-2" data-testid="interview-verdict">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary flex items-center gap-1.5">
              <Trophy className="h-3.5 w-3.5" /> Their verdict
            </p>
            <p className="text-sm leading-relaxed">{interview.verdict}</p>
            {interview.averageScore != null && (
              <p className="text-xs text-muted-foreground">Averaged {interview.averageScore}/100 across {graded.length} answers.</p>
            )}
          </div>
        ) : pending ? (
          <div className="space-y-3">
            <div className="rounded-md bg-muted/50 border border-border/60 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                Question {graded.length + 1}
              </p>
              <p className="text-sm font-medium leading-relaxed" data-testid="text-current-question">{pending.question}</p>
            </div>
            <Textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Answer like you're in the room…"
              className="min-h-[100px]"
              data-testid="textarea-interview-answer"
            />
            <div className="flex gap-2">
              <Button
                className="flex-1 gap-2"
                disabled={!answer.trim() || submitting}
                onClick={onSubmit}
                data-testid="button-submit-answer"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Answer ({CREDIT_COSTS.mockInterviewGrading + CREDIT_COSTS.mockInterviewQuestion} credits)
              </Button>
              <Button variant="outline" disabled={finishing} onClick={onFinish} data-testid="button-finish-interview">
                {finishing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                End & get verdict
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" className="w-full" disabled={finishing} onClick={onFinish} data-testid="button-finish-interview">
            {finishing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trophy className="h-4 w-4 mr-2" />}
            Get their verdict
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
