/**
 * The leaders' console: adding people, giving them powers, changing roles,
 * removing people, and the record of all of it.
 *
 * Only somebody who can manage the team sees the controls; everyone else is
 * told who the leaders are, so they know whom to ask. Every control mirrors a
 * rule the server enforces anyway — a checkbox is disabled here only to save
 * somebody a refusal, and says why.
 */
import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Trash2, UserPlus } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  COMPANY_PERMISSIONS, COMPANY_ROLES, ROLE_RANK, hasPower,
  type CompanyPermission, type CompanyRole,
} from "@shared/companies";
import type { CompanyView } from "@/pages/company";

type Member = CompanyView["members"][number];
type Me = { userId: string; role: CompanyRole; permissions: CompanyPermission[] };

const isLeader = (r: CompanyRole) => r === "owner" || r === "admin";
const powerLabel = (p: string) => COMPANY_PERMISSIONS.find((x) => x.id === p)?.label ?? p;

/**
 * Why `me` can't change this person's powers or remove them, or null if they can.
 *
 * The same rule as `mayActOn` in server/company-access.ts: you need "manage
 * the team", you can't act on yourself, and nobody who outranks you is yours
 * to change.
 */
function blockedOn(me: Me, target: Member): string | null {
  if (!hasPower(me, "manage_team")) return "You don't manage the team.";
  if (target.userId === me.userId) return "Ask another leader to change your own access.";
  if (me.role !== "owner" && ROLE_RANK[target.role] > ROLE_RANK[me.role]) {
    return target.role === "owner" ? "Only an owner can change an owner." : "Only an owner or admin can change a leader.";
  }
  return null;
}

export function AdminTab({ companyId, powers = [] }: { companyId: string; canManage: boolean; powers?: CompanyPermission[] }) {
  const key = [`/api/companies/${companyId}`];
  const { data } = useQuery<CompanyView>({ queryKey: key });
  const { user } = useAuth();
  if (!data) return null;

  const me: Me = data.me ?? { userId: user?.id ?? "", role: data.role, permissions: [] };
  if (!powers.includes("manage_team")) {
    const leaders = data.members.filter((m) => isLeader(m.role));
    return (
      <Card>
        <CardContent className="py-5 text-sm text-muted-foreground space-y-1" data-testid="admin-not-allowed">
          <p>The company's leaders add people and decide who can do what.</p>
          <p>
            Ask {leaders.length ? leaders.map((l) => `${l.name} (${l.role})`).join(", ") : "an owner"} if you need to do something you can't.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <AddSomeone companyId={companyId} me={me} />
      <People companyId={companyId} view={data} me={me} />
      <Activity companyId={companyId} />
    </div>
  );
}

/** The powers checklist used when adding someone and in each member's row. */
function PowerChecks({
  value, onChange, disabledWhy, idPrefix,
}: {
  value: CompanyPermission[];
  onChange: (next: CompanyPermission[]) => void;
  disabledWhy: (p: CompanyPermission) => string | null;
  idPrefix: string;
}) {
  return (
    <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
      {COMPANY_PERMISSIONS.map((p) => {
        const why = disabledWhy(p.id);
        const id = `${idPrefix}-${p.id}`;
        const box = (
          <div className="flex items-start gap-2">
            <Checkbox
              id={id} checked={value.includes(p.id)} disabled={!!why}
              onCheckedChange={(on) => onChange(on ? [...value, p.id] : value.filter((x) => x !== p.id))}
              data-testid={`check-${id}`}
            />
            <Label htmlFor={id} className={`text-sm font-normal leading-tight ${why ? "text-muted-foreground" : ""}`}>{p.label}</Label>
          </div>
        );
        return (
          <Tooltip key={p.id}>
            <TooltipTrigger asChild><div>{box}</div></TooltipTrigger>
            <TooltipContent className="max-w-xs">{why ?? p.help}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

function AddSomeone({ companyId, me }: { companyId: string; me: Me }) {
  const [identifier, setIdentifier] = useState("");
  const [perms, setPerms] = useState<CompanyPermission[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const add = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${companyId}/members`, { identifier, permissions: perms }).then((r) => r.json()),
    onSuccess: (res: { member?: { name: string } }) => {
      setIdentifier(""); setPerms([]); setError(null);
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/audit`] });
      toast({ title: `${res.member?.name ?? "They"} joined the company`, description: "They've been told." });
    },
    onError: (e) => setError(errorText(e, "Couldn't add that person.")),
  });

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Add someone</CardTitle></CardHeader>
      <CardContent>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (identifier.trim()) add.mutate(); }}>
          <p className="text-sm text-muted-foreground">
            They need an account already. They join as a member, with any powers you tick, and get a notification.
          </p>
          <div className="flex gap-2 flex-wrap">
            <Input
              value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="Email address or username"
              className="flex-1 min-w-[14rem]" maxLength={254} data-testid="input-add-member"
            />
            <Button type="submit" disabled={add.isPending || !identifier.trim()} data-testid="button-add-member">
              {add.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <UserPlus className="h-4 w-4 mr-1.5" />} Add
            </Button>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Powers (optional)</p>
            <PowerChecks
              idPrefix="add" value={perms} onChange={setPerms}
              disabledWhy={(p) => (p === "manage_team" && !isLeader(me.role) ? "Only an owner or admin can let someone manage the team." : null)}
            />
          </div>
          {error && <p className="text-sm text-destructive" data-testid="text-add-error">{error}</p>}
        </form>
      </CardContent>
    </Card>
  );
}

function People({ companyId, view, me }: { companyId: string; view: CompanyView; me: Me }) {
  const { toast } = useToast();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}`] });
    queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/audit`] });
  };
  const fail = (title: string) => (e: unknown) => toast({ title, description: errorText(e), variant: "destructive" });

  const setPowers = useMutation({
    mutationFn: (v: { userId: string; permissions: CompanyPermission[] }) =>
      apiRequest("PUT", `/api/companies/${companyId}/members/${v.userId}/permissions`, { permissions: v.permissions }),
    onSuccess: refresh,
    onError: (e) => { fail("Couldn't change those powers")(e); refresh(); },
  });
  const changeRole = useMutation({
    mutationFn: (v: { userId: string; role: CompanyRole }) =>
      apiRequest("PATCH", `/api/companies/${companyId}/members/${v.userId}`, { role: v.role }),
    onSuccess: refresh,
    onError: fail("Couldn't change that role"),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => apiRequest("DELETE", `/api/companies/${companyId}/members/${userId}`),
    onSuccess: refresh,
    onError: fail("Couldn't remove that person"),
  });

  const meLeads = isLeader(me.role);
  const isOwner = me.role === "owner";

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">People and powers</CardTitle></CardHeader>
      <CardContent className="divide-y">
        {view.members.map((m) => {
          const you = m.userId === me.userId;
          const blocked = blockedOn(me, m);
          // Ownership is for owners to hand out, and the server says the same.
          const canRole = meLeads && (isOwner || m.role !== "owner");
          return (
            <div key={m.userId} className="py-3 space-y-2" data-testid={`admin-member-${m.userId}`}>
              <div className="flex items-center gap-3">
                <Avatar className="h-8 w-8">
                  {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt="" />}
                  <AvatarFallback>{m.name.slice(0, 1).toUpperCase()}</AvatarFallback>
                </Avatar>
                <p className="flex-1 min-w-0 text-sm font-medium truncate">
                  {m.name}{you && <span className="text-muted-foreground font-normal"> (you)</span>}
                </p>
                {canRole ? (
                  <Select value={m.role} onValueChange={(role) => changeRole.mutate({ userId: m.userId, role: role as CompanyRole })}>
                    <SelectTrigger className="w-28 h-8" data-testid={`select-role-${m.userId}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {COMPANY_ROLES.filter((r) => isOwner || r !== "owner").map((r) => (
                        <SelectItem key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant="secondary" className="capitalize">{m.role}</Badge>
                )}
                {!you && !blocked ? (
                  <Button
                    variant="ghost" size="sm" title={`Remove ${m.name}`} disabled={remove.isPending}
                    onClick={() => { if (confirm(`Remove ${m.name} from ${view.company.name}? They lose access straight away, and every invite link made so far stops working.`)) remove.mutate(m.userId); }}
                    data-testid={`button-remove-${m.userId}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : <span className="w-9" />}
              </div>

              <div className="pl-11">
                {isLeader(m.role) ? (
                  <p className="text-xs text-muted-foreground">All powers — {m.role === "owner" ? "owners" : "admins"} can do everything{m.role === "admin" ? " except delete the company" : ""}.</p>
                ) : (
                  <>
                    <PowerChecks
                      idPrefix={`m-${m.userId}`} value={m.permissions ?? []}
                      onChange={(next) => setPowers.mutate({ userId: m.userId, permissions: next })}
                      disabledWhy={(p) => blocked ?? (p === "manage_team" && !meLeads ? "Only an owner or admin can give or take away managing the team." : null)}
                    />
                    {blocked && <p className="text-xs text-muted-foreground mt-1">{blocked}</p>}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

type AuditEntry = {
  id: string; action: string; actorName: string; targetName: string | null;
  detail: Record<string, any> | null; createdAt: string;
};

/** One line of plain English per entry. Unknown actions still say who did something, and when. */
function describe(e: AuditEntry): string {
  const who = e.targetName ?? "someone";
  const d = e.detail ?? {};
  const list = (xs: unknown) => (Array.isArray(xs) && xs.length ? xs.map(powerLabel).join(", ").toLowerCase() : "no extra powers");
  switch (e.action) {
    case "member_added": return `added ${who}${Array.isArray(d.permissions) && d.permissions.length ? ` with ${list(d.permissions)}` : ""}`;
    case "member_joined": return `joined with an invite link as ${d.role === "admin" ? "an admin" : "a member"}`;
    case "member_removed": return `removed ${who}`;
    case "member_left": return "left the company";
    case "role_changed": return `made ${who} ${d.to === "admin" ? "an admin" : d.to === "owner" ? "an owner" : "a member"}${d.from ? ` (was ${d.from})` : ""}`;
    case "permissions_changed": return `changed ${who}'s powers to ${list(d.after)}`;
    case "season_created": return `set up the training season "${d.name ?? ""}"`;
    case "season_started": return `started the training season "${d.name ?? ""}"`;
    case "candidate_invited": return `invited ${who} to talk`;
    case "challenge_posted": return `posted the challenge "${d.title ?? ""}"`;
    case "challenge_announced": return `announced the results of "${d.title ?? ""}"`;
    case "post_published": return "posted on the feed as the company";
    case "invite_links_reset": return "reset the invite links, so every earlier link stopped working";
    case "owner_succeeded": return `${who} became an owner when the last owner closed their account`;
    default: return e.action.replace(/_/g, " ");
  }
}

function Activity({ companyId }: { companyId: string }) {
  const log = useInfiniteQuery({
    queryKey: [`/api/companies/${companyId}/audit`],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams({ limit: "30" });
      if (pageParam) qs.set("before", pageParam);
      const r = await apiRequest("GET", `/api/companies/${companyId}/audit?${qs}`);
      return (await r.json()) as { entries: AuditEntry[]; nextBefore: string | null };
    },
    getNextPageParam: (last) => last.nextBefore,
    /*
     * Fresh whenever the tab opens. Most of what it records happens on other
     * tabs — a season set up, a challenge posted, a post published — and none
     * of those know to refresh this, so a cached log was missing them.
     */
    refetchOnMount: "always",
  });
  const entries = log.data?.pages.flatMap((p) => p.entries) ?? [];

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Activity</CardTitle></CardHeader>
      <CardContent>
        {log.isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : log.isError ? (
          <p className="text-sm text-muted-foreground">Couldn't load the activity.</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet. Adding people, changing what they can do and removing them will show up here.</p>
        ) : (
          <ul className="divide-y" data-testid="list-audit">
            {entries.map((e) => (
              <li key={e.id} className="py-2 text-sm flex gap-3 justify-between">
                {e.action === "owner_succeeded"
                  ? <span>{describe(e)[0].toUpperCase() + describe(e).slice(1)}</span>
                  : <span><span className="font-medium">{e.actorName}</span> {describe(e)}</span>}
                <time className="text-xs text-muted-foreground whitespace-nowrap" dateTime={e.createdAt}>
                  {new Date(e.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                </time>
              </li>
            ))}
          </ul>
        )}
        {log.hasNextPage && (
          <Button variant="outline" size="sm" className="mt-3" onClick={() => log.fetchNextPage()} disabled={log.isFetchingNextPage}>
            {log.isFetchingNextPage && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />} Show older
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
