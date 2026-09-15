import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { UserAvatar } from "@/components/user-avatar";
import { Loader2, HandCoins, Mail, Phone, Linkedin, Inbox } from "lucide-react";
import {
  INVESTMENT_AMOUNTS, INVESTMENT_INSTRUMENTS, INVESTOR_TYPES, ACCREDITED_ANSWERS, INVESTMENT_STATUS_LABEL,
  INVESTMENT_DISCLAIMER, labelOf, type InvestmentAsk, type InvestmentStatus,
} from "@shared/investment";

interface Application {
  id: string; amount: string; instrument: string; investorType: string; accredited: string; message: string;
  linkedinUrl: string | null; status: InvestmentStatus; ownerNote: string | null; createdAt: string;
  investor: { id: string; name: string; headline: string | null; avatarUrl: string | null; email: string | null; phone: string | null };
}

const STATUS_TONE: Record<InvestmentStatus, "default" | "secondary" | "outline" | "destructive"> = {
  new: "default", reviewing: "secondary", accepted: "default", declined: "outline", withdrawn: "outline",
};

/**
 * The founder's side of investment applications: the ask investors see, the
 * switch that opens applications, and every application with the investor's
 * contact, to mark and note.
 */
export function InvestmentInbox({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const infoKey = ["/api/projects", projectId, "investment"];
  const listKey = ["/api/projects", projectId, "investment", "applications"];
  const { data: info } = useQuery<{ open: boolean; ask: InvestmentAsk | null }>({ queryKey: infoKey });
  const { data: apps, isLoading } = useQuery<Application[]>({ queryKey: listKey });
  const [ask, setAsk] = useState<InvestmentAsk>({ headline: "", amount: null, minimum: null, instruments: [], useOfFunds: "" });
  const [filter, setFilter] = useState<"active" | "all">("active");

  useEffect(() => { if (info?.ask) setAsk(info.ask); }, [info?.ask]);

  const save = useMutation({
    mutationFn: async (body: { open?: boolean; ask?: InvestmentAsk }) => (await apiRequest("PATCH", `/api/projects/${projectId}/investment`, body)).json(),
    onSuccess: (r: { open: boolean }, body) => {
      void queryClient.invalidateQueries({ queryKey: infoKey });
      toast({ title: body.open === undefined ? "Ask saved" : r.open ? "Applications are open on your project page" : "Applications closed" });
    },
    onError: (e) => toast({ title: "Couldn't save that", description: errorText(e), variant: "destructive" }),
  });
  const review = useMutation({
    mutationFn: async (b: { id: string; status?: string; ownerNote?: string }) => (await apiRequest("PATCH", `/api/investment-applications/${b.id}`, b)).json(),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: listKey }),
    onError: (e) => toast({ title: "Couldn't update that", description: errorText(e), variant: "destructive" }),
  });

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const shown = (apps ?? []).filter((a) => filter === "all" || !["declined", "withdrawn"].includes(a.status));
  const fresh = (apps ?? []).filter((a) => a.status === "new").length;

  return (
    <div className="space-y-4" data-testid="investment-inbox">
      <Card>
        <CardHeader className="pb-3 flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="space-y-1">
            <CardTitle className="text-lg flex items-center gap-2"><HandCoins className="h-4 w-4 text-primary" /> Investment applications</CardTitle>
            <p className="text-sm text-muted-foreground">When open, your public project page takes applications from people who'd like to invest. You decide who to talk to.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs">{info?.open ? "Open" : "Closed"}</span>
            <Switch checked={!!info?.open} disabled={save.isPending} onCheckedChange={(v) => save.mutate({ open: v, ask })} data-testid="switch-investment-open" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input value={ask.headline} maxLength={160} onChange={(e) => setAsk({ ...ask, headline: e.target.value })}
            placeholder="The ask in a line — e.g. Raising $150k to open our second location" data-testid="input-ask-headline" />
          <div className="grid gap-3 sm:grid-cols-2">
            {(["amount", "minimum"] as const).map((field) => (
              <div key={field} className="space-y-1.5">
                <p className="text-xs font-medium">{field === "amount" ? "Raising" : "Smallest check"}</p>
                <div className="flex flex-wrap gap-1.5">
                  {INVESTMENT_AMOUNTS.map((o) => (
                    <button key={o.id} type="button" aria-pressed={ask[field] === o.id} onClick={() => setAsk({ ...ask, [field]: ask[field] === o.id ? null : o.id })}
                      className={`rounded-full border px-2.5 py-0.5 text-xs ${ask[field] === o.id ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
                      data-testid={`ask-${field}-${o.id}`}>{o.label}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium">How people can invest</p>
            <div className="flex flex-wrap gap-1.5">
              {INVESTMENT_INSTRUMENTS.map((o) => (
                <button key={o.id} type="button" aria-pressed={ask.instruments.includes(o.id)} onClick={() => setAsk({ ...ask, instruments: toggle(ask.instruments, o.id) })}
                  className={`rounded-full border px-2.5 py-0.5 text-xs ${ask.instruments.includes(o.id) ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
                  data-testid={`ask-instrument-${o.id}`}>{o.label}</button>
              ))}
            </div>
          </div>
          <Textarea value={ask.useOfFunds} maxLength={1000} onChange={(e) => setAsk({ ...ask, useOfFunds: e.target.value })}
            placeholder="What the money goes to" className="min-h-[60px] text-sm" data-testid="input-ask-use" />
          <div className="flex items-center gap-3 flex-wrap">
            <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => save.mutate({ ask })} data-testid="button-save-ask">Save the ask</Button>
            <p className="text-[11px] text-muted-foreground flex-1 min-w-[200px]">
              Raising from investors is regulated. Publicly advertising a securities offering has rules — check them with a securities attorney before promoting your raise. {INVESTMENT_DISCLAIMER}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <Inbox className="h-4 w-4" /> Applications {fresh > 0 && <Badge data-testid="badge-new-applications">{fresh} new</Badge>}
          </CardTitle>
          <div className="flex gap-1">
            {(["active", "all"] as const).map((f) => (
              <Button key={f} size="sm" variant={filter === f ? "secondary" : "ghost"} className="h-7 text-xs" onClick={() => setFilter(f)}>{f === "active" ? "Active" : "All"}</Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
            : shown.length === 0 ? <p className="text-sm text-muted-foreground py-4 text-center">{info?.open ? "No applications yet. They'll appear here." : "Open applications to start receiving them."}</p>
            : shown.map((a) => (
              <div key={a.id} className="rounded-lg border border-border p-3 space-y-2" data-testid={`application-${a.id}`}>
                <div className="flex items-start gap-3">
                  <UserAvatar src={a.investor.avatarUrl} name={a.investor.name} className="h-9 w-9" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-sm">{a.investor.name}</p>
                      <Badge variant={STATUS_TONE[a.status]} className="text-[10px]">{INVESTMENT_STATUS_LABEL[a.status]}</Badge>
                    </div>
                    {a.investor.headline && <p className="text-xs text-muted-foreground">{a.investor.headline}</p>}
                    <p className="text-xs mt-1">
                      {labelOf(INVESTMENT_AMOUNTS, a.amount)} · {labelOf(INVESTMENT_INSTRUMENTS, a.instrument)} · {labelOf(INVESTOR_TYPES, a.investorType)} · Accredited: {labelOf(ACCREDITED_ANSWERS, a.accredited)}
                    </p>
                  </div>
                  <span className="text-[11px] text-muted-foreground shrink-0">{new Date(a.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                </div>
                <p className="text-sm whitespace-pre-line">{a.message}</p>
                {a.status !== "withdrawn" && (
                  <div className="flex flex-wrap gap-3 text-xs">
                    {a.investor.email && <a href={`mailto:${a.investor.email}`} className="inline-flex items-center gap-1 text-primary hover:underline"><Mail className="h-3 w-3" />{a.investor.email}</a>}
                    {a.investor.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{a.investor.phone}</span>}
                    {a.linkedinUrl && <a href={a.linkedinUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><Linkedin className="h-3 w-3" />LinkedIn</a>}
                  </div>
                )}
                {a.status !== "withdrawn" && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {(["reviewing", "accepted", "declined"] as const).map((s) => (
                      <Button key={s} size="sm" variant={a.status === s ? "default" : "outline"} className="h-7 text-xs" disabled={review.isPending || a.status === s}
                        onClick={() => review.mutate({ id: a.id, status: s })} data-testid={`button-app-${s}-${a.id}`}>
                        {INVESTMENT_STATUS_LABEL[s]}
                      </Button>
                    ))}
                  </div>
                )}
                <Textarea defaultValue={a.ownerNote ?? ""} placeholder="Private note (only you see this)" className="min-h-[40px] text-xs"
                  onBlur={(e) => { if (e.target.value !== (a.ownerNote ?? "")) review.mutate({ id: a.id, ownerNote: e.target.value }); }} data-testid={`note-${a.id}`} />
              </div>
            ))}
        </CardContent>
      </Card>
    </div>
  );
}
