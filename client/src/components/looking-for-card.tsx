import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Search, Handshake, Clock, Layers, PieChart, Plus, X, Pencil, Eye, EyeOff,
} from "lucide-react";
import type { ProfileLookingFor } from "@shared/schema";

interface Options {
  roles: string[];
  stages: string[];
  commitments: string[];
}

const EMPTY: ProfileLookingFor = {
  isActive: true,
  role: "",
  industries: [],
  commitment: null,
  stage: null,
  equityAvailable: null,
  details: null,
};

/**
 * The public "looking for" call — a founder's open ask, LinkedIn's
 * "open to work" equivalent but specific to what builders actually need:
 * role, industry, commitment, stage, and whether equity is on the table.
 */
export function LookingForCard({
  lookingFor, isOwnProfile,
}: {
  lookingFor: ProfileLookingFor | null;
  isOwnProfile: boolean;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ProfileLookingFor>(lookingFor || EMPTY);
  const [industryInput, setIndustryInput] = useState("");

  const { data: options } = useQuery<Options>({
    queryKey: ["/api/profile/looking-for-options"],
    enabled: open,
  });

  const save = useMutation({
    mutationFn: async (payload: any) => {
      const res = await apiRequest("POST", "/api/profile/looking-for", payload);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Saved" });
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/looking-for"] });
    },
    onError: (err: any) => {
      const raw = err?.message || "";
      const start = raw.indexOf("{");
      let description = "Please try again.";
      if (start >= 0) {
        try { description = JSON.parse(raw.slice(start)).message || description; } catch { /* keep */ }
      }
      toast({ title: "Couldn't save", description, variant: "destructive" });
    },
  });

  const addIndustry = () => {
    const value = industryInput.trim();
    if (!value || form.industries.includes(value) || form.industries.length >= 6) return;
    setForm({ ...form, industries: [...form.industries, value] });
    setIndustryInput("");
  };

  const editor = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg max-h-[88vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-5 w-5 text-primary" /> What are you looking for?
          </DialogTitle>
          <DialogDescription>
            Shown publicly on your profile so the right people can find you.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto -mx-6 px-6 py-2 space-y-4">
          <div className="space-y-2">
            <Label>Looking for *</Label>
            <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
              <SelectTrigger data-testid="select-looking-for-role">
                <SelectValue placeholder="Pick one" />
              </SelectTrigger>
              <SelectContent>
                {(options?.roles || []).map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Industry</Label>
            <div className="flex gap-2">
              <Input
                value={industryInput}
                onChange={(e) => setIndustryInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addIndustry(); } }}
                placeholder="e.g. FinTech"
                data-testid="input-industry"
              />
              <Button variant="outline" size="icon" onClick={addIndustry} disabled={!industryInput.trim()}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {form.industries.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {form.industries.map((i) => (
                  <Badge key={i} variant="secondary" className="gap-1">
                    {i}
                    <button onClick={() => setForm({ ...form, industries: form.industries.filter((x) => x !== i) })}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Commitment</Label>
              <Select value={form.commitment || ""} onValueChange={(v) => setForm({ ...form, commitment: v })}>
                <SelectTrigger data-testid="select-commitment"><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent>
                  {(options?.commitments || []).map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Stage</Label>
              <Select value={form.stage || ""} onValueChange={(v) => setForm({ ...form, stage: v })}>
                <SelectTrigger data-testid="select-stage"><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent>
                  {(options?.stages || []).map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Equity available</Label>
            <div className="flex gap-2">
              {[
                { label: "Yes", value: true },
                { label: "No", value: false },
                { label: "Rather not say", value: null },
              ].map((opt) => (
                <Button
                  key={String(opt.value)}
                  type="button"
                  variant={form.equityAvailable === opt.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setForm({ ...form, equityAvailable: opt.value })}
                  data-testid={`button-equity-${opt.label.toLowerCase().replace(/\s/g, "-")}`}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Anything else? (optional)</Label>
            <Textarea
              value={form.details || ""}
              onChange={(e) => setForm({ ...form, details: e.target.value })}
              placeholder="I've got 20 user interviews and a design. I need someone who wants to own the build."
              className="min-h-[70px]"
              data-testid="textarea-looking-for-details"
            />
          </div>

          <div className="flex items-center justify-between gap-4 pt-2 border-t border-border/50">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Show this on my profile</p>
              <p className="text-xs text-muted-foreground">Turn off to keep it saved but hidden.</p>
            </div>
            <Switch
              checked={form.isActive}
              onCheckedChange={(v) => setForm({ ...form, isActive: v })}
              data-testid="switch-looking-for-active"
            />
          </div>
        </div>

        <DialogFooter className="shrink-0 gap-2">
          {lookingFor && (
            <Button
              variant="ghost"
              className="text-destructive"
              disabled={save.isPending}
              onClick={() => save.mutate({ clear: true })}
              data-testid="button-clear-looking-for"
            >
              Remove
            </Button>
          )}
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={!form.role || save.isPending}
            onClick={() => save.mutate(form)}
            data-testid="button-save-looking-for"
          >
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // Nothing set: only the owner sees the prompt to add one.
  if (!lookingFor || (!lookingFor.isActive && !isOwnProfile)) {
    if (!isOwnProfile) return null;
    return (
      <>
        <Card className="border-dashed" data-testid="card-looking-for-empty">
          <CardContent className="p-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Looking for someone?</p>
              <p className="text-xs text-muted-foreground">
                Post what you need — a cofounder, a first engineer, a project to join.
              </p>
            </div>
            <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={() => setOpen(true)} data-testid="button-add-looking-for">
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </CardContent>
        </Card>
        {editor}
      </>
    );
  }

  return (
    <>
      <Card className="border-primary/40 bg-primary/5" data-testid="card-looking-for">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <div className="h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                <Handshake className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">Looking for</p>
                <p className="font-semibold leading-tight" data-testid="text-looking-for-role">{lookingFor.role}</p>
              </div>
            </div>
            {isOwnProfile && (
              <div className="flex items-center gap-1 shrink-0">
                {!lookingFor.isActive && (
                  <Badge variant="secondary" className="gap-1 text-[10px]">
                    <EyeOff className="h-2.5 w-2.5" /> Hidden
                  </Badge>
                )}
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setForm(lookingFor); setOpen(true); }} data-testid="button-edit-looking-for">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm">
            {lookingFor.industries.length > 0 && (
              <div className="col-span-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Industry</p>
                <div className="flex flex-wrap gap-1">
                  {lookingFor.industries.map((i) => (
                    <Badge key={i} variant="outline" className="text-[10px] font-normal">{i}</Badge>
                  ))}
                </div>
              </div>
            )}
            {lookingFor.commitment && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  <Clock className="h-2.5 w-2.5" /> Commitment
                </p>
                <p className="text-sm" data-testid="text-commitment">{lookingFor.commitment}</p>
              </div>
            )}
            {lookingFor.stage && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  <Layers className="h-2.5 w-2.5" /> Stage
                </p>
                <p className="text-sm" data-testid="text-stage">{lookingFor.stage}</p>
              </div>
            )}
            {lookingFor.equityAvailable !== null && lookingFor.equityAvailable !== undefined && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  <PieChart className="h-2.5 w-2.5" /> Equity
                </p>
                <p className="text-sm" data-testid="text-equity">
                  {lookingFor.equityAvailable ? "Available" : "Not available"}
                </p>
              </div>
            )}
          </div>

          {lookingFor.details && (
            <p className="text-sm text-secondary leading-relaxed pt-1 border-t border-primary/20">
              {lookingFor.details}
            </p>
          )}
        </CardContent>
      </Card>
      {editor}
    </>
  );
}
