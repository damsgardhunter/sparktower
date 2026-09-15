import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, HandCoins, CheckCircle2 } from "lucide-react";
import {
  INVESTMENT_AMOUNTS, INVESTMENT_INSTRUMENTS, INVESTOR_TYPES, ACCREDITED_ANSWERS, INVESTMENT_STATUS_LABEL,
  INVESTMENT_MESSAGE_MAX, labelOf, type InvestmentAsk, type InvestmentStatus,
} from "@shared/investment";

interface InvestmentInfo {
  open: boolean;
  ask: InvestmentAsk | null;
  isOwner: boolean;
  mine: { id: string; status: InvestmentStatus; createdAt: string } | null;
  disclaimer: string;
}

function Chips({ list, value, onChange, testId }: { list: readonly { id: string; label: string }[]; value: string; onChange: (v: string) => void; testId: string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(value === o.id ? "" : o.id)}
          className={`rounded-full border px-3 py-1 text-xs transition-colors ${value === o.id ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/60"}`}
          data-testid={`${testId}-${o.id}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The public side of investment applications: the founder's ask, and a way to
 * apply. Renders nothing when applications are closed, except to the owner,
 * who's pointed at where to open them.
 */
export function InvestCard({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const empty = { amount: "", instrument: "", investorType: "", accredited: "", message: "", phone: "", linkedinUrl: "", consent: false };
  const [form, setForm] = useState(empty);
  const key = ["/api/projects", projectId, "investment"];
  const { data } = useQuery<InvestmentInfo>({ queryKey: key });

  const apply = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/projects/${projectId}/investment/applications`, form)).json(),
    onSuccess: () => {
      setOpen(false); setForm(empty);
      void queryClient.invalidateQueries({ queryKey: key });
      toast({ title: "Application sent", description: "The founder will review it and reach out if it's a fit." });
    },
    onError: (e) => toast({ title: "Couldn't send that", description: errorText(e), variant: "destructive" }),
  });
  const withdraw = useMutation({
    mutationFn: async (id: string) => (await apiRequest("PATCH", `/api/investment-applications/${id}`, { status: "withdrawn" })).json(),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: key }); toast({ title: "Application withdrawn" }); },
    onError: (e) => toast({ title: "Couldn't withdraw", description: errorText(e), variant: "destructive" }),
  });

  if (!data) return null;
  if (!data.open) {
    if (!data.isOwner) return null;
    return (
      <Card className="border-dashed" data-testid="invest-card-closed">
        <CardContent className="p-4 space-y-2">
          <p className="text-sm font-medium flex items-center gap-2"><HandCoins className="h-4 w-4 text-primary" /> Investment applications are off</p>
          <p className="text-xs text-muted-foreground">Open them and anyone who finds this page can apply to invest. You review every application first.</p>
          <Button size="sm" variant="outline" onClick={() => setLocation(`/projects/${projectId}/manage?tab=investors`)} data-testid="button-open-investment-settings">Set up applications</Button>
        </CardContent>
      </Card>
    );
  }

  const ask = data.ask;
  const active = data.mine && data.mine.status !== "withdrawn" && data.mine.status !== "declined";
  const ready = form.amount && form.instrument && form.investorType && form.accredited && form.message.trim().length >= 20 && form.consent;

  return (
    <>
      <Card data-testid="invest-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2"><HandCoins className="h-4 w-4 text-primary" /> Invest in this project</CardTitle>
          {ask?.headline && <p className="text-sm text-muted-foreground leading-relaxed">{ask.headline}</p>}
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-sm">
            {ask?.amount && <div><p className="text-[11px] text-muted-foreground">Raising</p><p className="font-medium">{labelOf(INVESTMENT_AMOUNTS, ask.amount)}</p></div>}
            {ask?.minimum && <div><p className="text-[11px] text-muted-foreground">Smallest check</p><p className="font-medium">{labelOf(INVESTMENT_AMOUNTS, ask.minimum)}</p></div>}
          </div>
          {!!ask?.instruments.length && (
            <div className="flex flex-wrap gap-1">{ask.instruments.map((i) => <Badge key={i} variant="secondary" className="font-normal">{labelOf(INVESTMENT_INSTRUMENTS, i)}</Badge>)}</div>
          )}
          {ask?.useOfFunds && <p className="text-xs text-muted-foreground whitespace-pre-line"><span className="text-foreground font-medium">The money goes to:</span> {ask.useOfFunds}</p>}

          {data.isOwner ? (
            <p className="text-xs text-muted-foreground">This is how investors see your ask. Applications arrive under Investors in your project manager.</p>
          ) : active ? (
            <div className="rounded-md border border-primary/40 bg-primary/5 p-2.5 text-sm space-y-1.5" data-testid="invest-applied">
              <p className="flex items-center gap-1.5 font-medium"><CheckCircle2 className="h-4 w-4 text-primary" /> You applied · {INVESTMENT_STATUS_LABEL[data.mine!.status]}</p>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={withdraw.isPending} onClick={() => withdraw.mutate(data.mine!.id)} data-testid="button-withdraw-application">Withdraw</Button>
            </div>
          ) : (
            <Button className="w-full" onClick={() => (user ? setOpen(true) : setLocation("/"))} data-testid="button-apply-invest">
              {user ? "Apply to invest" : "Sign in to apply"}
            </Button>
          )}
          <p className="text-[11px] text-muted-foreground leading-relaxed">{data.disclaimer}</p>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Apply to invest</DialogTitle>
            <DialogDescription>The founder reads every application and gets in touch if it's a fit.</DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 -mx-1 px-1">
            <div className="space-y-1.5"><p className="text-sm font-medium">How much would you consider?</p><Chips list={INVESTMENT_AMOUNTS} value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} testId="apply-amount" /></div>
            <div className="space-y-1.5"><p className="text-sm font-medium">How would you invest?</p><Chips list={INVESTMENT_INSTRUMENTS} value={form.instrument} onChange={(v) => setForm({ ...form, instrument: v })} testId="apply-instrument" /></div>
            <div className="space-y-1.5"><p className="text-sm font-medium">What kind of investor are you?</p><Chips list={INVESTOR_TYPES} value={form.investorType} onChange={(v) => setForm({ ...form, investorType: v })} testId="apply-type" /></div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Are you an accredited investor?</p>
              <p className="text-xs text-muted-foreground -mt-1">Broadly, $200k+ income or $1M+ net worth excluding your home. It changes what a founder can legally offer you.</p>
              <Chips list={ACCREDITED_ANSWERS} value={form.accredited} onChange={(v) => setForm({ ...form, accredited: v })} testId="apply-accredited" />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">About you, and why this project</p>
              <Textarea value={form.message} maxLength={INVESTMENT_MESSAGE_MAX} onChange={(e) => setForm({ ...form, message: e.target.value })}
                placeholder="What you do, what you've backed before, and what drew you here." className="min-h-[90px]" data-testid="apply-message" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Phone (optional)" data-testid="apply-phone" />
              <Input value={form.linkedinUrl} onChange={(e) => setForm({ ...form, linkedinUrl: e.target.value })} placeholder="LinkedIn URL (optional)" data-testid="apply-linkedin" />
            </div>
            <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
              <Checkbox className="mt-0.5" checked={form.consent} onCheckedChange={(v) => setForm({ ...form, consent: v === true })} data-testid="apply-consent" />
              <span>I understand this is an application to talk, not an investment, and the founder will see my name, email and the details above.</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!ready || apply.isPending} onClick={() => apply.mutate()} data-testid="button-send-application">
              {apply.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />} Send application
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
