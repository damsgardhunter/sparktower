/**
 * The customer console: find the person who wrote in, and fix their problem.
 *
 * ## The shape of the screen is the shape of the job
 *
 * Support arrives as a sentence — "my generation failed and it took my
 * dollar", "I never got the confirmation email", "I published by mistake" — so
 * the screen is a search box, then one person, then a short list of things you
 * can do to them. Not a table of every account: nobody browses their customers,
 * they look one up.
 *
 * ## Every action asks why, and says what it will do first
 *
 * The reason is not paperwork. It goes into the moderation log, which the
 * database refuses to update or delete, and it is the only thing that makes an
 * administrative change distinguishable from an intrusion six months later. So
 * the button does not run until there is a sentence in the box, and the
 * confirmation names the person and the amount rather than saying "are you
 * sure".
 *
 * ## Owner-only actions look owner-only
 *
 * Money and ownership are the owner's alone. An admin sees those buttons
 * disabled with the reason on them, in the same words the server would refuse
 * with — finding out by pressing is how people learn to distrust a console.
 * The server decides; this only draws what the server said.
 *
 * ## Undo is on the screen, not in a runbook
 *
 * Everything reversible can be put back from the log, and the log is right
 * there under the actions. That is what makes the console safe to use quickly:
 * the cost of a mistake is one click, and both the mistake and the correction
 * stay on the record.
 */
import { useState } from "react";
import { Loading } from "@/components/nova";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";
import NotFound from "@/pages/not-found";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Loader2, Search, Wallet, ShieldCheck, Undo2, User as UserIcon, FolderKanban,
  Crown, Mail, Ban, Clock,
} from "lucide-react";
import {
  MAX_PASS_DAYS, MIN_REASON, type ConsoleAction, type ConsoleActionDef,
} from "@shared/admin-console";

interface Catalogue {
  you: { id: string; isOwner: boolean };
  actions: ConsoleActionDef[];
  limits: {
    maxGrantCents: number; maxGrantPerDayCents: number; grantedTodayCents: number;
    maxPassDays: number; minReason: number;
  };
}
interface Person {
  id: string; email: string | null; name: string; role: string;
  suspended: boolean; isBot: boolean; balance: string; joined: string | null;
}
interface ProjectRow {
  id: string; title: string; ownerId?: string; isPrivate: boolean; goal: string;
  subcategory?: string; buildPass?: boolean; createdAt?: string;
}
interface Customer {
  account: {
    id: string; email: string | null; name: string; role: string; isBot: boolean;
    suspended: boolean; suspendedReason: string | null; emailVerifiedAt: string | null;
    mfaEnabled: boolean; joined: string | null; subscriptionTier: string | null;
  };
  wallet: { balanceDisplay: string; allowanceLeft?: number; allowanceLimit?: number; dayPassUntil: string | null };
  allowance: { used: number; of: number; resetAt: string | null };
  projects: ProjectRow[];
  ledger: { id: string; kind: string; amountCents: number; note: string | null; createdAt: string }[];
  history: { id: string; action: string; reason: string | null; createdAt: string; details: any }[];
}

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-GB") : "—");
const money = (cents: number) => `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;

export default function AdminConsole() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: catalogue, isLoading, error } = useQuery<Catalogue>({
    queryKey: ["/api/admin/console/actions"],
    retry: false,
  });

  const { data: results, isFetching } = useQuery<{ people: Person[]; projects: ProjectRow[] }>({
    queryKey: ["/api/admin/console/search", searched],
    queryFn: async () =>
      (await apiRequest("GET", `/api/admin/console/search?q=${encodeURIComponent(searched)}`)).json(),
    enabled: searched.trim().length >= 2,
  });

  const { data: customer } = useQuery<Customer>({
    queryKey: ["/api/admin/console/users", openId],
    queryFn: async () => (await apiRequest("GET", `/api/admin/console/users/${openId}`)).json(),
    enabled: !!openId,
  });

  // A 404 is what this console says to anyone who shouldn't know it exists.
  if (error) return <NotFound />;
  if (isLoading || !catalogue) {
    return <Loading what="Opening the console" />;
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
        <header className="space-y-1">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl" data-testid="text-console-title">
            Customer console
            {catalogue.you.isOwner
              ? <Badge className="gap-1"><Crown className="h-3 w-3" /> owner</Badge>
              : <Badge variant="secondary">admin</Badge>}
          </h1>
          <p className="text-muted-foreground">
            Look somebody up and fix their problem. Everything here is written to the permanent record with your name
            on it, and most of it can be put back.
          </p>
          {!catalogue.you.isOwner && (
            <p className="text-sm text-muted-foreground">
              Money and moving a project between accounts are the owner's to do — those buttons are here but disabled.
            </p>
          )}
        </header>

        {/* Find them. */}
        <Card>
          <CardContent className="space-y-3 p-4 sm:p-5">
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => { e.preventDefault(); setSearched(query.trim()); }}
            >
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Email, name, or an id pasted out of their message"
                data-testid="input-console-search"
              />
              <Button type="submit" className="shrink-0" disabled={query.trim().length < 2} data-testid="button-console-search">
                {isFetching ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Search className="mr-1.5 h-4 w-4" />}
                Find
              </Button>
            </form>

            {results && (results.people.length > 0 || results.projects.length > 0) && (
              <div className="space-y-2" data-testid="console-results">
                {results.people.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setOpenId(p.id)}
                    className={`flex w-full flex-wrap items-center gap-2 rounded-lg border p-3 text-left transition hover:bg-muted/50 ${openId === p.id ? "border-primary" : "border-border"}`}
                    data-testid={`console-person-${p.id}`}
                  >
                    <UserIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{p.email ?? "(no address)"}</span>
                    </span>
                    {p.isBot && <Badge variant="outline">bot</Badge>}
                    {p.suspended && <Badge variant="destructive"><Ban className="mr-1 h-3 w-3" />suspended</Badge>}
                    {p.role !== "user" && <Badge variant="secondary">{p.role}</Badge>}
                    <span className="text-sm tabular-nums">{p.balance}</span>
                  </button>
                ))}
                {results.projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => p.ownerId && setOpenId(p.ownerId)}
                    className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-left transition hover:bg-muted/50"
                    data-testid={`console-project-${p.id}`}
                  >
                    <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.title}</span>
                    <Badge variant="outline">{p.isPrivate ? "private" : "public"}</Badge>
                    <span className="text-xs text-muted-foreground">open its owner</span>
                  </button>
                ))}
              </div>
            )}
            {results && results.people.length === 0 && results.projects.length === 0 && (
              <p className="text-sm text-muted-foreground" data-testid="console-no-results">
                Nobody and nothing matched “{searched}”.
              </p>
            )}
          </CardContent>
        </Card>

        {openId && customer && (
          <CustomerPanel
            customer={customer}
            catalogue={catalogue}
            onDone={() => {
              void qc.invalidateQueries({ queryKey: ["/api/admin/console/users", openId] });
              /* The daily money ceiling on the catalogue has moved. */
              void qc.invalidateQueries({ queryKey: ["/api/admin/console/actions"] });
              /*
               * And the record below, which is where undo lives. Queries here
               * are kept for ever unless something invalidates them, so
               * without this the action landed, the customer changed, and the
               * log went on showing the world as it was before — with no way
               * to take back what had just been done until a reload.
               */
              void qc.invalidateQueries({ queryKey: ["/api/admin/console/log"] });
              toast({ title: "Done, and on the record" });
            }}
          />
        )}

        <ConsoleLog />
      </div>
    </div>
  );
}

/** One customer: what they have, and what you can do about it. */
function CustomerPanel({ customer, catalogue, onDone }: {
  customer: Customer; catalogue: Catalogue; onDone: () => void;
}) {
  const { toast } = useToast();
  const [asking, setAsking] = useState<ConsoleAction | null>(null);
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("5.00");
  const [days, setDays] = useState("1");
  const [projectId, setProjectId] = useState<string>(customer.projects[0]?.id ?? "");
  const [toUserId, setToUserId] = useState("");

  const def = asking ? catalogue.actions.find((a) => a.id === asking) ?? null : null;

  const act = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { action: asking, reason };
      if (def?.subject === "user") body.userId = customer.account.id;
      else body.projectId = projectId;
      if (asking === "credit") body.cents = Math.round(Number(amount) * 100);
      if (asking === "day_pass" || asking === "image_pass") body.days = Number(days);
      if (asking === "project_privacy") {
        body.isPrivate = !customer.projects.find((p) => p.id === projectId)?.isPrivate;
      }
      if (asking === "transfer_project") body.toUserId = toUserId.trim();
      return (await apiRequest("POST", "/api/admin/console/act", body)).json();
    },
    onSuccess: () => { setAsking(null); setReason(""); onDone(); },
    onError: (e) => toast({ title: "Didn't run", description: errorText(e), variant: "destructive" }),
  });

  const a = customer.account;
  const chosen = customer.projects.find((p) => p.id === projectId);

  return (
    <Card data-testid="console-customer">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-lg font-semibold">
              {a.name}
              {a.suspended && <Badge variant="destructive"><Ban className="mr-1 h-3 w-3" />suspended</Badge>}
              {a.role !== "user" && <Badge variant="secondary">{a.role}</Badge>}
              {a.emailVerifiedAt
                ? <Badge variant="outline" className="border-green-600/40 text-green-600"><ShieldCheck className="mr-1 h-3 w-3" />verified</Badge>
                : <Badge variant="outline"><Mail className="mr-1 h-3 w-3" />unverified</Badge>}
            </p>
            <p className="text-sm text-muted-foreground">{a.email ?? "(no address)"} · joined {when(a.joined)}</p>
            <p className="text-xs text-muted-foreground">id {a.id}</p>
          </div>
          <div className="text-right">
            <p className="flex items-center gap-1.5 text-xl font-semibold tabular-nums"><Wallet className="h-4 w-4 text-muted-foreground" />{customer.wallet.balanceDisplay}</p>
            <p className="text-xs text-muted-foreground">
              {customer.allowance.used}/{customer.allowance.of} free actions used
            </p>
          </div>
        </div>

        {/* Their projects — titles and settings, never contents. */}
        {customer.projects.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Their projects</p>
            <div className="flex flex-wrap gap-1.5">
              {customer.projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setProjectId(p.id)}
                  className={`rounded-full border px-3 py-1 text-xs transition ${projectId === p.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}
                  data-testid={`console-pick-project-${p.id}`}
                >
                  {p.title} · {p.isPrivate ? "private" : "public"}{p.buildPass ? " · built" : ""}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* What you can do. Owner-only actions are drawn, and disabled, with the reason on them. */}
        <div className="grid gap-2 sm:grid-cols-2">
          {catalogue.actions.map((action) => {
            const locked = action.role === "owner" && !catalogue.you.isOwner;
            const needsProject = action.subject === "project" && !projectId;
            return (
              <button
                key={action.id}
                type="button"
                disabled={locked || needsProject}
                onClick={() => { setAsking(action.id); setReason(""); }}
                className="rounded-lg border border-border p-3 text-left transition hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
                data-testid={`console-action-${action.id}`}
              >
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  {action.label}
                  {action.role === "owner" && <Crown className="h-3 w-3 text-muted-foreground" />}
                </p>
                <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                  {locked ? "The account owner's to do." : needsProject ? "Pick one of their projects first." : action.blurb}
                </p>
              </button>
            );
          })}
        </div>

        {/* Their statement, so a refund conversation has the facts in front of it. */}
        {customer.ledger.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent movements</p>
            <div className="space-y-1">
              {customer.ledger.slice(0, 8).map((l) => (
                <div key={l.id} className="flex items-center gap-2 text-sm" data-testid={`console-ledger-${l.id}`}>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{l.note ?? l.kind}</span>
                  <span className="tabular-nums">{money(l.amountCents)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{when(l.createdAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <AlertDialog open={!!asking} onOpenChange={(open) => { if (!open) setAsking(null); }}>
          <AlertDialogContent data-testid="console-confirm">
            <AlertDialogHeader>
              <AlertDialogTitle>{def?.label}</AlertDialogTitle>
              <AlertDialogDescription>
                {def?.blurb}
                {def?.subject === "project" && chosen && <> This is about <strong>{chosen.title}</strong>.</>}
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="space-y-3">
              {asking === "credit" && (
                <label className="block space-y-1 text-sm">
                  <span className="font-medium">How much, in dollars</span>
                  <Input type="number" step="0.50" min="0.5" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="input-console-amount" />
                  <span className="block text-xs text-muted-foreground">
                    Up to {money(catalogue.limits.maxGrantCents)} at a time. You've given {money(catalogue.limits.grantedTodayCents)} of {money(catalogue.limits.maxGrantPerDayCents)} today.
                  </span>
                </label>
              )}
              {(asking === "day_pass" || asking === "image_pass") && (
                <label className="block space-y-1 text-sm">
                  <span className="font-medium">How many days</span>
                  <Input type="number" min="1" max={MAX_PASS_DAYS} value={days} onChange={(e) => setDays(e.target.value)} data-testid="input-console-days" />
                </label>
              )}
              {asking === "transfer_project" && (
                <label className="block space-y-1 text-sm">
                  <span className="font-medium">Move it to which account id</span>
                  <Input value={toUserId} onChange={(e) => setToUserId(e.target.value)} placeholder="the other account's id" data-testid="input-console-to-user" />
                </label>
              )}
              {asking === "project_privacy" && chosen && (
                <p className="text-sm">
                  This will make it <strong>{chosen.isPrivate ? "public" : "private"}</strong>.
                </p>
              )}

              <label className="block space-y-1 text-sm">
                <span className="font-medium">Why — this goes on the permanent record</span>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  placeholder="Refunding a build that failed halfway — ticket 412."
                  data-testid="input-console-reason"
                />
                <span className="block text-xs text-muted-foreground">
                  At least {MIN_REASON} characters. Your name and the time go on it automatically.
                </span>
              </label>
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-console-cancel">Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); act.mutate(); }}
                disabled={act.isPending || reason.trim().length < MIN_REASON}
                data-testid="button-console-confirm"
              >
                {act.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Do it
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

/** Everything the console has done, with an undo on whatever can still be taken back. */
function ConsoleLog() {
  const { toast } = useToast();
  const [undoing, setUndoing] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const { data } = useQuery<{ entries: any[] }>({ queryKey: ["/api/admin/console/log"] });

  const undo = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/admin/console/undo/${undoing}`, { reason })).json(),
    onSuccess: () => {
      setUndoing(null); setReason("");
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/console/log"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/console/users"] });
      toast({ title: "Put back", description: "Both the action and the correction are on the record." });
    },
    onError: (e) => toast({ title: "Couldn't put that back", description: errorText(e), variant: "destructive" }),
  });

  const entries = data?.entries ?? [];
  if (!entries.length) return null;

  return (
    <Card>
      <CardContent className="space-y-3 p-4 sm:p-5">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Clock className="h-3.5 w-3.5" /> What's been done here
        </p>
        <div className="space-y-1.5" data-testid="console-log">
          {entries.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2.5 text-sm" data-testid={`console-log-${e.id}`}>
              <Badge variant={e.action === "console:undo" ? "outline" : "secondary"} className="shrink-0">
                {e.action.replace("console:", "").replace(/_/g, " ")}
              </Badge>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{e.reason}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{e.actor} · {when(e.createdAt)}</span>
              {e.action !== "console:undo" && !e.undone && e.details?.reversible && (
                <Button size="sm" variant="ghost" onClick={() => { setUndoing(e.id); setReason(""); }} data-testid={`button-undo-${e.id}`}>
                  <Undo2 className="mr-1 h-3.5 w-3.5" /> Undo
                </Button>
              )}
              {e.undone && <Badge variant="outline" className="shrink-0">put back</Badge>}
            </div>
          ))}
        </div>

        <AlertDialog open={!!undoing} onOpenChange={(open) => { if (!open) setUndoing(null); }}>
          <AlertDialogContent data-testid="console-undo-confirm">
            <AlertDialogHeader>
              <AlertDialogTitle>Put this one back?</AlertDialogTitle>
              <AlertDialogDescription>
                It restores exactly what was there before. The original action stays on the record, and so does this.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Granted to the wrong account — ticket 412." data-testid="input-undo-reason" />
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); undo.mutate(); }}
                disabled={undo.isPending || reason.trim().length < MIN_REASON}
                data-testid="button-undo-confirm"
              >
                {undo.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Put it back
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
