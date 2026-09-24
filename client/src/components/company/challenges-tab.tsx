/**
 * A company's challenges: posting one, watching entries arrive, and judging
 * them.
 *
 * The order of the buttons follows the life of a challenge — open, then
 * "close entries" to start judging, then shortlist and pick winners, then
 * announce, which tells every entrant how they did. Judging is only offered
 * once entries are closed, because the server only allows it then: picking a
 * winner while people are still entering would be judging half a field.
 *
 * Members see all of it; only admins and owners get the buttons.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronDown, ChevronUp, ExternalLink, Loader2, Plus, ShieldAlert, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";
import { INDUSTRIES } from "@shared/companies";
import { CHALLENGE_FEE_CENTS, formatPrize, readPrize, totalToPost } from "@shared/challenges-money";
import {
  CHALLENGE_DISCLAIMER, CHALLENGE_LIMITS, CHALLENGE_STATUS_LABEL, deadlineLabel, ENTRY_STATUS_LABEL,
  type ChallengeStatus, type EntryStatus,
} from "@shared/challenges";

interface CompanyChallenge {
  id: string; title: string; brief: string; criteria: string | null; prize: string | null; terms: string | null;
  industry: string | null; deadline: string; status: ChallengeStatus; acceptingEntries: boolean; entryCount: number;
}
interface ReviewEntry {
  id: string; title: string; pitch: string; link: string | null; status: EntryStatus; feedback: string | null;
  createdAt: string; entrantName: string; project: { id: string; title: string | null; href: string } | null;
}

const NO_INDUSTRY = "none";
const listKey = (companyId: string) => [`/api/companies/${companyId}/challenges`];

export function ChallengesTab({ companyId, canManage, verifiedDomain }: {
  companyId: string; canManage: boolean;
  /** Null until somebody proves the website. An unverified company cannot post. */
  verifiedDomain?: string | null;
}) {
  const [creating, setCreating] = useState(false);
  const { data, isLoading, isError } = useQuery<CompanyChallenge[]>({ queryKey: listKey(companyId) });
  const verified = !!verifiedDomain;

  return (
    <div className="space-y-4 pt-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Challenges</h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Put a real problem in front of founders. The prize is money, paid in when you post and held by SparkTower until you pick a winner.
          </p>
        </div>
        {canManage && !creating && (
          /*
            * Disabled rather than hidden when the company is unverified: a
            * button that vanishes leaves somebody looking for it, and the
            * banner above the tabs is where the way out is.
            */
          <Button
            size="sm" disabled={!verified} onClick={() => setCreating(true)}
            title={verified ? undefined : "Prove the company's website first"}
            data-testid="button-new-challenge"
          >
            <Plus className="h-4 w-4 mr-1" />New challenge
          </Button>
        )}
      </div>

      {canManage && !verified && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm" data-testid="challenges-need-verification">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>
            <span className="font-medium">Prove the company's website to post challenges.</span>{" "}
            <span className="text-muted-foreground">
              It is what tells an entrant the company is real before they spend a fortnight on one. The banner at the top of this page starts it.
            </span>
          </span>
        </p>
      )}

      {creating && <CreateChallenge companyId={companyId} onDone={() => setCreating(false)} />}

      {isLoading ? (
        <div className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : isError ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Challenges couldn't be loaded.</p>
      ) : !data?.length ? (
        <p className="py-10 text-center text-sm text-muted-foreground" data-testid="text-no-company-challenges">
          No challenges yet.{canManage ? " Post one to hear how founders would solve a problem you have." : ""}
        </p>
      ) : (
        <ul className="space-y-3">
          {data.map((c) => <ChallengeRow key={c.id} companyId={companyId} challenge={c} canManage={canManage} />)}
        </ul>
      )}
    </div>
  );
}

function CreateChallenge({ companyId, onDone }: { companyId: string; onDone: () => void }) {
  const { toast } = useToast();
  const [f, setF] = useState({ title: "", brief: "", criteria: "", prize: "", terms: "", industry: NO_INDUSTRY, deadline: "" });
  /** The prize in whole dollars, which is how anybody thinks about it. Cents on the wire. */
  const [prizeDollars, setPrizeDollars] = useState("500");
  const prizeCents = Math.round(Number(prizeDollars) * 100);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const create = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/companies/${companyId}/challenges`, {
      title: f.title, brief: f.brief, criteria: f.criteria || null, prize: f.prize || null, terms: f.terms,
      prizeCents,
      industry: f.industry === NO_INDUSTRY ? null : f.industry,
      // The end of the chosen day, where the company is: "closes on the 30th" should include the 30th.
      deadline: f.deadline ? new Date(`${f.deadline}T23:59:59`).toISOString() : null,
    })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listKey(companyId) });
      // The public list and pages too: an admin who looked at them earlier would otherwise not see this one there.
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/challenges") });
      toast({
        title: "Challenge posted",
        description: `${formatPrize(prizeCents)} is held by SparkTower until you pick a winner.`,
      });
      onDone();
    },
    onError: (err) => toast({ title: "Couldn't post it", description: errorText(err), variant: "destructive" }),
  });
  const L = CHALLENGE_LIMITS;
  const prizeRead = readPrize(prizeCents);
  // The date input speaks the viewer's calendar, and so does the deadline built
  // from it above; toISOString would give tomorrow's date to anyone west of UTC
  // in the evening, and refuse today.
  const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = localDay(new Date());
  const lastDay = localDay(new Date(Date.now() + (L.maxDeadlineDays - 1) * 86_400_000));
  const ready = f.title.trim().length >= L.title.min && f.brief.trim().length >= L.brief.min && f.terms.trim().length >= L.terms.min && !!f.deadline;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3" data-testid="form-new-challenge">
      <div className="space-y-1.5">
        <Label htmlFor="ch-title">Title</Label>
        <Input id="ch-title" value={f.title} maxLength={L.title.max} onChange={set("title")} placeholder="Cut our returns rate in half" data-testid="input-challenge-title" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ch-brief">The problem</Label>
        <Textarea id="ch-brief" rows={5} value={f.brief} maxLength={L.brief.max} onChange={set("brief")}
          placeholder="What's going wrong, what you've tried, and what a solution would change for you." data-testid="input-challenge-brief" />
        <p className="text-xs text-muted-foreground">At least {L.brief.min} characters.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ch-prize">Anything else the winner gets (optional)</Label>
        <Input id="ch-prize" value={f.prize} maxLength={L.prize.max} onChange={set("prize")} placeholder="A paid pilot and a call with our CTO" data-testid="input-challenge-prize" />
        <p className="text-[11px] text-muted-foreground">The money above is held and paid automatically. This is for anything it can't say.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ch-criteria">How you'll judge entries (optional)</Label>
        <Textarea id="ch-criteria" rows={3} value={f.criteria} maxLength={L.criteria.max} onChange={set("criteria")} data-testid="input-challenge-criteria" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5 sm:col-span-1">
          <Label htmlFor="ch-prize-cents">Prize, in dollars</Label>
          <Input
            id="ch-prize-cents" type="number" min={50} step={50}
            value={prizeDollars} onChange={(e) => setPrizeDollars(e.target.value)}
            data-testid="input-challenge-prize-amount"
          />
          {/* Said before it is taken, not after. */}
          <p className="text-[11px] text-muted-foreground">
            {prizeRead.ok
              ? <>Held by SparkTower until you pick a winner.</>
              : <span className="text-destructive">{prizeRead.message}</span>}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Industry</Label>
          <Select value={f.industry} onValueChange={(v) => setF({ ...f, industry: v })}>
            <SelectTrigger data-testid="select-challenge-industry"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_INDUSTRY}>Any</SelectItem>
              {INDUSTRIES.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ch-deadline">Entries close</Label>
          <Input id="ch-deadline" type="date" min={today} max={lastDay} value={f.deadline} onChange={set("deadline")} data-testid="input-challenge-deadline" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ch-terms">Your terms</Label>
        <Textarea id="ch-terms" rows={5} value={f.terms} maxLength={L.terms.max} onChange={set("terms")}
          placeholder="When and how you pay winners, who owns what's submitted, what happens to entries that don't win." data-testid="input-challenge-terms" />
        <p className="text-xs text-muted-foreground">Entrants must accept these to enter. They're between you and the entrant.</p>
      </div>
      <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">{CHALLENGE_DISCLAIMER} You pay your winners yourselves.</p>
      <div className="flex gap-2">
        {/*
          * What it costs, on the button, before it is pressed. The fee and the
          * prize are separate numbers because they are separate things: one is
          * ours and one comes back if nobody wins.
          */}
        <Button disabled={!ready || !prizeRead.ok || create.isPending} onClick={() => create.mutate()} data-testid="button-post-challenge">
          {create.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
          Post challenge
          {prizeRead.ok && <span className="ml-1.5 text-xs opacity-80">{formatPrize(totalToPost(prizeCents))}</span>}
        </Button>
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        {prizeRead.ok && (
          <p className="w-full text-xs text-muted-foreground" data-testid="challenge-cost-breakdown">
            {formatPrize(CHALLENGE_FEE_CENTS)} to post, and {formatPrize(prizeCents)} held for the prize — returned if you close without picking a winner.
          </p>
        )}
      </div>
    </div>
  );
}

function ChallengeRow({ companyId, challenge: c, canManage }: { companyId: string; challenge: CompanyChallenge; canManage: boolean }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const base = `/api/companies/${companyId}/challenges/${c.id}`;
  const step = useMutation({
    mutationFn: async (action: "close-entries" | "announce") => (await apiRequest("POST", `${base}/${action}`)).json(),
    onSuccess: (_d, action) => {
      queryClient.invalidateQueries({ queryKey: listKey(companyId) });
      queryClient.invalidateQueries({ queryKey: [`${base}/entries`] });
      // The challenge's public page and the open list: "Judging" with no winners, after announcing, is the old page.
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/challenges") });
      toast({ title: action === "announce" ? "Results announced" : "Entries closed", description: action === "announce" ? "Every entrant has been told how they did." : "You can shortlist and pick winners now." });
    },
    onError: (err) => toast({ title: "That didn't work", description: errorText(err), variant: "destructive" }),
  });
  // An open challenge past its deadline takes no entries; say so, since the stored status still reads "open".
  const label = c.status === "open" && !c.acceptingEntries ? "Deadline passed" : CHALLENGE_STATUS_LABEL[c.status];

  return (
    <li className="rounded-xl border border-border bg-card" data-testid={`row-challenge-${c.id}`}>
      <div className="p-4 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link href={`/challenges/${c.id}`} className="font-medium hover:underline truncate">{c.title}</Link>
            <Badge variant={c.status === "open" && c.acceptingEntries ? "default" : "secondary"}>{label}</Badge>
          </div>
          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-3">
            {c.prize && <span className="inline-flex items-center gap-1"><Trophy className="h-3 w-3" />{c.prize}</span>}
            <span>{c.status === "open" ? deadlineLabel(c.deadline, Date.now()) : `Closed ${new Date(c.deadline).toLocaleDateString()}`}</span>
            <span>{c.entryCount} {c.entryCount === 1 ? "entry" : "entries"}</span>
          </div>
        </div>
        {canManage && c.status === "open" && (
          <Button size="sm" variant="outline" disabled={step.isPending}
            onClick={() => { if (confirm("Close entries and start judging? Nobody else will be able to enter.")) step.mutate("close-entries"); }}
            data-testid={`button-close-entries-${c.id}`}>Close entries</Button>
        )}
        {canManage && c.status === "judging" && (
          <Button size="sm" disabled={step.isPending}
            onClick={() => { if (confirm("Announce the results? Every entrant is told how they did, and winners can't be changed after.")) step.mutate("announce"); }}
            data-testid={`button-announce-${c.id}`}>Announce results</Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} data-testid={`button-toggle-entries-${c.id}`}>
          Entries {open ? <ChevronUp className="h-4 w-4 ml-1" /> : <ChevronDown className="h-4 w-4 ml-1" />}
        </Button>
      </div>
      {open && <Entries companyId={companyId} challenge={c} canManage={canManage} />}
    </li>
  );
}

function Entries({ companyId, challenge: c, canManage }: { companyId: string; challenge: CompanyChallenge; canManage: boolean }) {
  const key = [`/api/companies/${companyId}/challenges/${c.id}/entries`];
  const { data, isLoading } = useQuery<ReviewEntry[]>({ queryKey: key });
  if (isLoading) return <div className="border-t border-border py-6 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  if (!data?.length) return <p className="border-t border-border px-4 py-6 text-sm text-muted-foreground">No entries yet.</p>;
  return (
    <div className="border-t border-border divide-y divide-border">
      {c.status === "open" && canManage && (
        <p className="px-4 py-2 text-xs text-muted-foreground">Close entries to start shortlisting and picking winners.</p>
      )}
      {data.map((e) => <EntryReview key={e.id} companyId={companyId} challenge={c} entry={e} canJudge={canManage && c.status === "judging"} />)}
    </div>
  );
}

function EntryReview({ companyId, challenge: c, entry: e, canJudge }: { companyId: string; challenge: CompanyChallenge; entry: ReviewEntry; canJudge: boolean }) {
  const { toast } = useToast();
  const [feedback, setFeedback] = useState(e.feedback ?? "");
  const judge = useMutation({
    mutationFn: async (status: "entered" | "shortlisted" | "winner") =>
      (await apiRequest("POST", `/api/companies/${companyId}/challenges/${c.id}/entries/${e.id}/status`, { status, feedback })).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/challenges/${c.id}/entries`] }),
    onError: (err) => toast({ title: "Couldn't update that entry", description: errorText(err), variant: "destructive" }),
  });
  const withdrawn = e.status === "withdrawn";

  return (
    <div className={`px-4 py-3 space-y-2 ${withdrawn ? "opacity-60" : ""}`} data-testid={`entry-${e.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-sm">{e.title}</span>
        <Badge variant={e.status === "winner" ? "default" : "secondary"}>{ENTRY_STATUS_LABEL[e.status]}</Badge>
        <span className="text-xs text-muted-foreground">by {e.entrantName}</span>
      </div>
      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{e.pitch}</p>
      <div className="flex flex-wrap gap-3 text-xs">
        {e.project && <Link href={e.project.href} className="underline">{e.project.title ?? "Their project"}</Link>}
        {e.link && <a href={e.link} target="_blank" rel="noopener noreferrer nofollow" className="underline inline-flex items-center gap-1">{e.link}<ExternalLink className="h-3 w-3" /></a>}
      </div>
      {canJudge && !withdrawn ? (
        <div className="space-y-2 pt-1">
          <Input value={feedback} maxLength={1000} onChange={(ev) => setFeedback(ev.target.value)}
            placeholder="A line of feedback the entrant will see (optional)" data-testid={`input-feedback-${e.id}`} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={e.status === "shortlisted" ? "default" : "outline"} disabled={judge.isPending}
              onClick={() => judge.mutate(e.status === "shortlisted" ? "entered" : "shortlisted")} data-testid={`button-shortlist-${e.id}`}>
              {e.status === "shortlisted" ? "Shortlisted" : "Shortlist"}
            </Button>
            <Button size="sm" variant={e.status === "winner" ? "default" : "outline"} disabled={judge.isPending}
              onClick={() => judge.mutate(e.status === "winner" ? "shortlisted" : "winner")} data-testid={`button-winner-${e.id}`}>
              <Trophy className="h-3.5 w-3.5 mr-1" />{e.status === "winner" ? "Winner" : "Pick as winner"}
            </Button>
            {feedback !== (e.feedback ?? "") && e.status !== "withdrawn" && (
              <Button size="sm" variant="ghost" disabled={judge.isPending} onClick={() => judge.mutate(e.status as "entered" | "shortlisted" | "winner")}>Save feedback</Button>
            )}
          </div>
        </div>
      ) : e.feedback ? (
        <p className="text-xs text-muted-foreground">Feedback: {e.feedback}</p>
      ) : null}
    </div>
  );
}
