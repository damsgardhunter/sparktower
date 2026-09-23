/**
 * One sponsored challenge: the brief, what a good answer looks like, the
 * prize, and the company's own terms — then the entry form, or your entry if
 * you've sent one, and the winners once they're announced.
 *
 * The terms checkbox names the company on purpose. What an entrant agrees to
 * is the company's terms, with the company; SparkTower neither holds nor pays
 * the prize, and the page says so next to the button rather than in a footer.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { ArrowLeft, Building2, CalendarClock, ChevronDown, ExternalLink, Loader2, ShieldCheck, Trophy, Users } from "lucide-react";
import { formatPrize, prizeAssurance, type PrizeState } from "@shared/challenges-money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";
import {
  CHALLENGE_DISCLAIMER, CHALLENGE_STATUS_LABEL, deadlineLabel, ENTRY_LIMITS, ENTRY_STATUS_LABEL,
  type ChallengeStatus, type EntryStatus,
} from "@shared/challenges";

interface MyEntry {
  id: string; title: string; pitch: string; link: string | null; projectId: string | null;
  status: EntryStatus; feedback: string | null; createdAt: string;
}
interface ChallengeDetail {
  id: string; title: string; brief: string; criteria: string | null; prize: string | null; terms: string | null;
  industry: string | null; deadline: string; status: ChallengeStatus; acceptingEntries: boolean;
  company: { id: string; name: string; industry: string | null; website: string | null; verifiedDomain: string | null };
  /** The safe's row: what is actually there, not what the company wrote. */
  prizeHeld: { amountCents: number; state: PrizeState } | null;
  entryCount: number; myEntry: MyEntry | null; isSponsor: boolean;
  winners: { entryId: string; title: string; entrantName: string; link: string | null; project: { id: string; title: string | null } | null }[];
}

const NO_PROJECT = "none";

export default function ChallengePage() {
  const { id } = useParams<{ id: string }>();
  const key = [`/api/challenges/${id}`];
  const { data: c, isLoading, isError } = useQuery<ChallengeDetail>({ queryKey: key });

  if (isLoading) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (isError || !c) return <div className="mx-auto max-w-3xl px-4 py-8 text-sm text-muted-foreground">This challenge couldn't be found.</div>;

  const live = c.myEntry && c.myEntry.status !== "withdrawn" ? c.myEntry : null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div>
          <Link href="/challenges" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2" data-testid="link-back">
            <ArrowLeft className="h-3 w-3" /> Challenges
          </Link>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Building2 className="h-4 w-4" />
            <span>{c.company.name}</span>
            {/* Who is actually asking. A name can be anything; this has been checked. */}
            {c.company.verifiedDomain && (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400" data-testid="company-verified">
                <ShieldCheck className="h-3.5 w-3.5" />{c.company.verifiedDomain}
              </span>
            )}
            {c.industry && <Badge variant="outline">{c.industry}</Badge>}
            <Badge variant="secondary" className="ml-auto">{CHALLENGE_STATUS_LABEL[c.status]}</Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight mt-2" data-testid="text-challenge-title">{c.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
            {c.prizeHeld && (
              <span className="inline-flex items-center gap-1.5 font-medium" data-testid="prize-held">
                <Trophy className="h-4 w-4 text-amber-500" />
                {formatPrize(c.prizeHeld.amountCents)}
              </span>
            )}
            {c.prize && <span className="inline-flex items-center gap-1.5 text-muted-foreground">{c.prize}</span>}
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <CalendarClock className="h-4 w-4" />
              {c.acceptingEntries ? `${deadlineLabel(c.deadline, Date.now())} · closes ${new Date(c.deadline).toLocaleDateString()}` : `Closed for entries ${new Date(c.deadline).toLocaleDateString()}`}
            </span>
            <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Users className="h-4 w-4" />{c.entryCount} {c.entryCount === 1 ? "entry" : "entries"}</span>
          </div>

          {c.prizeHeld && (
            <p className="mt-3 inline-flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-sm" data-testid="prize-assurance">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>{prizeAssurance(c.prizeHeld.state, c.prizeHeld.amountCents)}</span>
            </p>
          )}
        </div>

        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">The problem</h2>
          <p className="mt-2 text-sm whitespace-pre-wrap leading-relaxed">{c.brief}</p>
        </section>

        {c.criteria && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">How entries are judged</h2>
            <p className="mt-2 text-sm whitespace-pre-wrap leading-relaxed">{c.criteria}</p>
          </section>
        )}

        {c.terms && (
          <Collapsible className="rounded-lg border border-border">
            <CollapsibleTrigger className="group flex w-full items-center justify-between px-4 py-3 text-sm font-medium" data-testid="button-toggle-terms">
              {c.company.name}'s terms for this challenge
              <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="px-4 pb-4 text-sm whitespace-pre-wrap text-muted-foreground" data-testid="text-terms">{c.terms}</CollapsibleContent>
          </Collapsible>
        )}

        {c.status === "closed" && (
          <section data-testid="section-winners">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Winners</h2>
            {c.winners.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">{c.company.name} didn't name a winner for this one.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {c.winners.map((w) => (
                  <li key={w.entryId} className="rounded-lg border border-border p-3 text-sm">
                    <div className="flex items-center gap-2 font-medium"><Trophy className="h-4 w-4 text-amber-500" />{w.title}</div>
                    <div className="mt-1 text-muted-foreground">
                      by {w.entrantName}
                      {w.project && <> · <Link href={`/projects/${w.project.id}`} className="underline">{w.project.title ?? "their project"}</Link></>}
                      {w.link && <> · <a href={w.link} target="_blank" rel="noopener noreferrer nofollow" className="underline">link</a></>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {live ? (
          <MyEntryCard challenge={c} entry={live} />
        ) : c.isSponsor ? (
          <p className="text-sm text-muted-foreground rounded-lg border border-border p-4">You're part of {c.company.name}, so you can't enter its challenge. You can review entries on the company's page.</p>
        ) : c.acceptingEntries ? (
          <EntryForm challenge={c} />
        ) : c.status !== "closed" ? (
          <p className="text-sm text-muted-foreground rounded-lg border border-border p-4">Entries are closed. {c.company.name} is judging what came in.</p>
        ) : null}
      </div>
    </div>
  );
}

/** What the entry form sends, shared by entering and editing. */
interface Draft { title: string; pitch: string; link: string; projectId: string }

function EntryFields({ draft, set }: { draft: Draft; set: (d: Draft) => void }) {
  const { data: projects } = useQuery<{ id: string; title: string }[]>({ queryKey: ["/api/user/projects"] });
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="entry-title">Title</Label>
        <Input id="entry-title" value={draft.title} maxLength={ENTRY_LIMITS.title.max} onChange={(e) => set({ ...draft, title: e.target.value })} data-testid="input-entry-title" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="entry-pitch">Your answer</Label>
        <Textarea id="entry-pitch" rows={6} value={draft.pitch} maxLength={ENTRY_LIMITS.pitch.max} onChange={(e) => set({ ...draft, pitch: e.target.value })}
          placeholder="How you'd solve it, and why you think it would work." data-testid="input-entry-pitch" />
        <p className="text-xs text-muted-foreground">{draft.pitch.trim().length < ENTRY_LIMITS.pitch.min ? `At least ${ENTRY_LIMITS.pitch.min} characters.` : `${draft.pitch.length} / ${ENTRY_LIMITS.pitch.max}`}</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="entry-link">Link (optional)</Label>
        <Input id="entry-link" type="url" placeholder="https://" value={draft.link} onChange={(e) => set({ ...draft, link: e.target.value })} data-testid="input-entry-link" />
      </div>
      {!!projects?.length && (
        <div className="space-y-1.5">
          <Label>Built in one of your projects? (optional)</Label>
          <Select value={draft.projectId || NO_PROJECT} onValueChange={(v) => set({ ...draft, projectId: v === NO_PROJECT ? "" : v })}>
            <SelectTrigger data-testid="select-entry-project"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_PROJECT}>No project</SelectItem>
              {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

const body = (d: Draft) => ({ title: d.title, pitch: d.pitch, link: d.link.trim() || null, projectId: d.projectId || null });
const ready = (d: Draft) => d.title.trim().length >= ENTRY_LIMITS.title.min && d.pitch.trim().length >= ENTRY_LIMITS.pitch.min;

function EntryForm({ challenge }: { challenge: ChallengeDetail }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>({ title: "", pitch: "", link: "", projectId: "" });
  const [accepted, setAccepted] = useState(false);
  const enter = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/challenges/${challenge.id}/enter`, { ...body(draft), acceptTerms: accepted })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/challenges/${challenge.id}`] });
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/challenges?") });
      toast({ title: "You're in", description: `${challenge.company.name} will see your entry.` });
    },
    onError: (err) => toast({ title: "Couldn't enter", description: errorText(err), variant: "destructive" }),
  });

  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-4" data-testid="section-enter">
      <h2 className="font-semibold">Enter this challenge</h2>
      <EntryFields draft={draft} set={setDraft} />
      <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">{CHALLENGE_DISCLAIMER}</div>
      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <Checkbox checked={accepted} onCheckedChange={(v) => setAccepted(v === true)} className="mt-0.5" data-testid="checkbox-accept-terms" />
        <span>I accept {challenge.company.name}'s terms for this challenge.</span>
      </label>
      <Button disabled={!accepted || !ready(draft) || enter.isPending} onClick={() => enter.mutate()} data-testid="button-enter">
        {enter.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Send my entry
      </Button>
    </section>
  );
}

function MyEntryCard({ challenge, entry }: { challenge: ChallengeDetail; entry: MyEntry }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>({ title: entry.title, pitch: entry.pitch, link: entry.link ?? "", projectId: entry.projectId ?? "" });
  useEffect(() => {
    if (!editing) setDraft({ title: entry.title, pitch: entry.pitch, link: entry.link ?? "", projectId: entry.projectId ?? "" });
  }, [entry, editing]);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/challenges/${challenge.id}`] });
    queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/challenges?") });
  };
  const save = useMutation({
    mutationFn: async () => (await apiRequest("PATCH", `/api/challenges/${challenge.id}/entry`, body(draft))).json(),
    onSuccess: () => { setEditing(false); refresh(); toast({ title: "Entry updated" }); },
    onError: (err) => toast({ title: "Couldn't save", description: errorText(err), variant: "destructive" }),
  });
  const withdraw = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/challenges/${challenge.id}/entry`)).json(),
    onSuccess: () => { refresh(); toast({ title: "Entry withdrawn" }); },
    onError: (err) => toast({ title: "Couldn't withdraw", description: errorText(err), variant: "destructive" }),
  });
  const outcome =
    challenge.status !== "closed" ? null :
    entry.status === "winner" ? `You won. ${challenge.company.name} pays its winners directly, under its terms — expect to hear from them.` :
    entry.status === "shortlisted" ? "You were shortlisted, though not picked as a winner this time." :
    "Not picked this time.";

  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-3" data-testid="section-my-entry">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">Your entry</h2>
        <Badge variant={entry.status === "winner" ? "default" : "secondary"} data-testid="badge-my-entry-status">{ENTRY_STATUS_LABEL[entry.status]}</Badge>
      </div>
      {outcome && <p className="text-sm">{outcome}</p>}
      {entry.feedback && (
        <div className="rounded-lg bg-muted/50 p-3 text-sm">
          <span className="font-medium">{challenge.company.name} said: </span>{entry.feedback}
        </div>
      )}
      {editing ? (
        <>
          <EntryFields draft={draft} set={setDraft} />
          <div className="flex gap-2">
            <Button disabled={!ready(draft) || save.isPending} onClick={() => save.mutate()} data-testid="button-save-entry">Save</Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </>
      ) : (
        <>
          <div>
            <div className="font-medium text-sm">{entry.title}</div>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap mt-1">{entry.pitch}</p>
            {entry.link && (
              <a href={entry.link} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 inline-flex items-center gap-1 text-sm underline">
                {entry.link}<ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <div className="flex gap-2">
            {challenge.acceptingEntries && <Button size="sm" variant="outline" onClick={() => setEditing(true)} data-testid="button-edit-entry">Edit</Button>}
            {challenge.status !== "closed" && (
              <Button size="sm" variant="ghost" disabled={withdraw.isPending}
                onClick={() => { if (confirm("Withdraw your entry? The company won't judge it.")) withdraw.mutate(); }} data-testid="button-withdraw-entry">
                Withdraw
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
