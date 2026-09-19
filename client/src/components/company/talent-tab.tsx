/**
 * The company's talent search: people who have opened their record to
 * companies, strongest record first, and a way to ask one of them to talk.
 *
 * Everything shown here is exactly what the person sees on their own /talent
 * page as their preview. `TrackRecordView` is shared with that page for that
 * reason — two renderings of the same record would drift, and the promise
 * "this is what companies will see" would quietly stop being true.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, MapPin, Search, Send, Wifi } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TALENT_ROLES, type TrackRecord, type TrackRecordSummary } from "@shared/track-record";

type InviteStatus = "sent" | "accepted" | "declined";

interface Candidate {
  userId: string;
  name: string;
  avatarUrl: string | null;
  headline: string | null;
  roles: string[];
  location: string | null;
  remote: boolean;
  record: TrackRecordSummary;
  invite: InviteStatus | null;
}

interface CandidateDetail extends Omit<Candidate, "record" | "invite"> {
  record: TrackRecord;
  invite: { id: string; status: InviteStatus; role: string | null; createdAt: string; answeredAt: string | null } | null;
}

interface SentInvite {
  id: string; userId: string; name: string; role: string | null; message: string; status: InviteStatus;
  createdAt: string; answeredAt: string | null; sentBy: { id: string; name: string };
}

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);

const STATUS_COPY: Record<InviteStatus, string> = {
  sent: "Invited, waiting",
  accepted: "Said yes",
  declined: "Said no",
};

/**
 * A record, as a company sees it — and as the person sees their own preview.
 * `full` adds the season-by-season lines.
 */
export function TrackRecordView({ record, full = false }: { record: TrackRecordSummary | TrackRecord; full?: boolean }) {
  if (record.empty) {
    return <p className="text-sm text-muted-foreground">Nothing on record yet: no public simulation seasons and no scored startup games.</p>;
  }
  const stats = [
    { label: "Seasons played", value: String(record.seasonsPlayed) },
    { label: "Turnout", value: record.turnout === null ? "—" : `${pct(record.turnout)} (${record.yearsFiled} of ${record.yearsPlayed} years)` },
    { label: "Best finish", value: record.bestFinish ? `${record.bestFinish.rank} of ${record.bestFinish.of}` : "—" },
    { label: "Average finish", value: record.averagePercentile === null ? "—" : `better than ${record.averagePercentile}% of the field` },
    { label: "Objectives met", value: record.objectives.total ? `${record.objectives.met} of ${record.objectives.total}` : "—" },
    { label: "Startup games", value: record.startupGames.scored ? `${record.startupGames.scored}, average ${record.startupGames.average}, best ${record.startupGames.best}` : "—" },
  ];
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-sm">
        {stats.map((s) => (
          <div key={s.label}>
            <dt className="text-xs text-muted-foreground">{s.label}</dt>
            <dd className="font-medium">{s.value}</dd>
          </div>
        ))}
      </dl>
      {record.seats.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {record.seats.map((s) => <Badge key={s.role} variant="outline">{s.title}{s.count > 1 ? ` ×${s.count}` : ""}</Badge>)}
        </div>
      )}
      {record.strengths.length > 0 && (
        <ul className="text-sm space-y-0.5">
          {record.strengths.map((s) => <li key={s} className="flex gap-2"><span className="text-primary">•</span>{s}</li>)}
        </ul>
      )}
      {full && "seasons" in record && record.seasons.length > 0 && (
        <div className="border rounded-md divide-y text-sm">
          {record.seasons.map((s, i) => (
            <div key={i} className="px-3 py-2 flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <span className="font-medium">{s.seasonName}</span>
                {s.nicheName && <span className="text-muted-foreground"> · {s.nicheName}</span>}
                {s.roleTitle && <span className="text-muted-foreground"> · {s.roleTitle}</span>}
              </div>
              <div className="text-xs text-muted-foreground">
                {s.status === "finished" && s.rank && s.of ? `Finished ${s.rank} of ${s.of}` : s.status === "running" ? "Still running" : s.status}
                {" · "}filed {s.yearsFiled} of {s.yearsPlayed} years
                {" · "}objectives met {s.objectives.met} of {s.objectives.met + s.objectives.partial + s.objectives.missed}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Where({ location, remote }: { location: string | null; remote: boolean }) {
  if (!location && !remote) return null;
  return (
    <span className="flex items-center gap-2 text-xs text-muted-foreground">
      {location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{location}</span>}
      {remote && <span className="flex items-center gap-1"><Wifi className="h-3 w-3" />Open to remote</span>}
    </span>
  );
}

function CandidateDialog({ companyId, userId, canManage, onClose }: { companyId: string; userId: string; canManage: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [message, setMessage] = useState("");
  const [role, setRole] = useState("");
  const { data, isLoading, isError } = useQuery<CandidateDetail>({ queryKey: [`/api/companies/${companyId}/talent/${userId}`] });

  const invite = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/companies/${companyId}/talent/${userId}/invite`, { message, role: role || undefined })).json(),
    onSuccess: () => {
      toast({ title: "Invitation sent", description: "They'll see it on their talent page. If they say yes, a conversation opens in Messages." });
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith(`/api/companies/${companyId}/talent`) });
      setMessage("");
    },
    onError: (e) => toast({ title: "Couldn't send it", description: errorText(e), variant: "destructive" }),
  });

  const length = message.trim().length;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
        ) : isError || !data ? (
          <p className="text-sm text-muted-foreground py-6">This person is no longer open to companies.</p>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{data.name}</DialogTitle>
              <DialogDescription>{data.headline || "No headline"}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                {data.roles.map((r) => <Badge key={r} variant="secondary" className="capitalize">{r}</Badge>)}
                <Where location={data.location} remote={data.remote} />
              </div>
              <TrackRecordView record={data.record} full />
              {data.invite ? (
                <p className="text-sm rounded-md bg-muted px-3 py-2">
                  Your company has already asked them{data.invite.role ? ` about ${data.invite.role}` : ""}: <span className="font-medium">{STATUS_COPY[data.invite.status].toLowerCase()}</span>.
                  {" "}One invitation per person, so nobody hears from the same company twice.
                </p>
              ) : canManage ? (
                <div className="space-y-2 border-t pt-4">
                  <h3 className="font-medium text-sm">Invite to talk</h3>
                  <p className="text-xs text-muted-foreground">
                    You can ask each person once. Say who you are, what the role is, and why their record caught your eye.
                  </p>
                  <div className="space-y-1">
                    <Label htmlFor="invite-role">Role (optional)</Label>
                    <Input id="invite-role" value={role} onChange={(e) => setRole(e.target.value)} maxLength={80} placeholder="e.g. Head of operations" data-testid="input-invite-role" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="invite-message">Message</Label>
                    <Textarea id="invite-message" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={800} rows={5} data-testid="input-invite-message" />
                    <p className="text-xs text-muted-foreground">{length < 20 ? `At least 20 characters (${length} so far).` : `${length} of 800`}</p>
                  </div>
                  <Button onClick={() => invite.mutate()} disabled={length < 20 || invite.isPending} data-testid="button-send-invite">
                    {invite.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                    Send invitation
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">An admin of your company can invite them to talk.</p>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function TalentTab({ companyId, canManage }: { companyId: string; canManage: boolean }) {
  const [q, setQ] = useState("");
  const [role, setRole] = useState("any");
  const [minSeasons, setMinSeasons] = useState("0");
  const [open, setOpen] = useState<string | null>(null);
  const { user } = useAuth();

  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (role !== "any") params.set("role", role);
  if (minSeasons !== "0") params.set("minSeasons", minSeasons);
  const query = params.toString();

  const { data, isLoading } = useQuery<{ candidates: Candidate[] }>({
    queryKey: [`/api/companies/${companyId}/talent${query ? `?${query}` : ""}`],
  });
  const { data: sent } = useQuery<{ invites: SentInvite[] }>({ queryKey: [`/api/companies/${companyId}/talent-invites`] });

  return (
    <div className="space-y-6 pt-2">
      <p className="text-sm text-muted-foreground max-w-2xl">
        People who have chosen to let companies see how they play: the business simulation and the startup game.
        Private training seasons are never included. Everyone here opted in, and can opt out at any time.
      </p>

      <div className="flex flex-wrap gap-2 items-end">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, headline, place" className="pl-8" data-testid="input-talent-search" />
        </div>
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger className="w-[180px]" data-testid="select-talent-role"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any role</SelectItem>
            {TALENT_ROLES.map((r) => <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={minSeasons} onValueChange={setMinSeasons}>
          <SelectTrigger className="w-[170px]" data-testid="select-talent-seasons"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Any experience</SelectItem>
            <SelectItem value="1">1+ seasons</SelectItem>
            <SelectItem value="2">2+ seasons</SelectItem>
            <SelectItem value="3">3+ seasons</SelectItem>
            <SelectItem value="5">5+ seasons</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : !data?.candidates.length ? (
        <p className="text-sm text-muted-foreground py-6">
          Nobody matches yet. People appear here once they open their record to companies from their own talent page.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.candidates.map((c) => (
            <Card key={c.userId} className="hover:border-primary/40 transition-colors" data-testid={`card-candidate-${c.userId}`}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{c.name}</div>
                    {c.headline && <div className="text-sm text-muted-foreground line-clamp-2">{c.headline}</div>}
                  </div>
                  {c.invite && <Badge variant={c.invite === "accepted" ? "default" : "outline"}>{STATUS_COPY[c.invite]}</Badge>}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {c.roles.map((r) => <Badge key={r} variant="secondary" className="capitalize">{r}</Badge>)}
                  <Where location={c.location} remote={c.remote} />
                </div>
                <TrackRecordView record={c.record} />
                <Button variant="outline" size="sm" onClick={() => setOpen(c.userId)} data-testid={`button-open-candidate-${c.userId}`}>
                  {canManage && !c.invite ? "See record and invite" : "See full record"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <h3 className="font-semibold">Invitations sent</h3>
        {!sent?.invites.length ? (
          <p className="text-sm text-muted-foreground">None yet.</p>
        ) : (
          <div className="border rounded-md divide-y">
            {sent.invites.map((i) => (
              <div key={i.id} className="px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <button className="font-medium hover:underline" onClick={() => setOpen(i.userId)}>{i.name}</button>
                  {i.role && <span className="text-muted-foreground"> · {i.role}</span>}
                  <div className="text-xs text-muted-foreground">
                    Sent by {i.sentBy.name} on {new Date(i.createdAt).toLocaleDateString()}
                    {i.answeredAt && `, answered ${new Date(i.answeredAt).toLocaleDateString()}`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={i.status === "accepted" ? "default" : "outline"}>{STATUS_COPY[i.status]}</Badge>
                  {/* The conversation is between the person and whoever asked, so only they get the link. */}
                  {i.status === "accepted" && i.sentBy.id === user?.id && (
                    <a href={`/messages?with=${i.userId}`} className="text-xs text-primary hover:underline">Message</a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {open && <CandidateDialog companyId={companyId} userId={open} canManage={canManage} onClose={() => setOpen(null)} />}
    </div>
  );
}
