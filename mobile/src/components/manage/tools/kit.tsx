/**
 * What the manager's native tools share: the web's credit prices, a plan
 * gate, the list-and-sheet CRUD every extended tab is built on, the status
 * pills, a choice row in place of the web's selects, and "Ask Nova" — the
 * web's NovaActionButton (preview, then apply) for one surface.
 */
import React, { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../api/client";
import { useEntitlementsQuery } from "../../../hooks/useEntitlements";
import { colors, font, fontFamily, radius, spacing } from "../../../theme";
import { Btn, Card, Cost, ErrorNote, Icon, Label, Loading, Meta, Row, errText, type IconName } from "../../ui";
import { Bubble, EditorSheet, Overline, Tag, Well, useNotify } from "../bits";
import { mkey } from "../shared";

// --- Credits ----------------------------------------------------------------

/** shared/plans.ts CREDIT_COSTS, restated. The server's /api/subscription copy wins when it has one. */
export const CREDIT_COSTS = {
  novaAssist: 3,
  codeAudit: 8,
  documentPlan: 5,
  documentBlockFill: 1,
  healthCheck: 2,
  healthFix: 3,
  pricingAnalysis: 5,
  investorReadinessScore: 5,
  pitchDeckOutline: 8,
  pitchCritique: 5,
  mockInterviewQuestion: 1,
  mockInterviewGrading: 2,
} as const;
export type CreditKey = keyof typeof CREDIT_COSTS;

/** A price, and whether the builder can pay it. */
export function useCredits() {
  const ent = useEntitlementsQuery();
  const cost = (k: CreditKey): number => {
    const server = ent.creditCosts?.[k];
    return typeof server === "number" ? server : CREDIT_COSTS[k];
  };
  const cantAfford = (k: CreditKey | number) => {
    if (ent.isLoading || ent.isUnlimited) return false;
    return ent.creditsRemaining < (typeof k === "number" ? k : cost(k));
  };
  return { ...ent, cost, cantAfford };
}

/** "This costs 8 credits and you have 3." */
export function ShortOfCredits({ cost, have, what = "This" }: { cost: number; have: number; what?: string }) {
  return <Meta style={{ color: colors.danger }}>{what} costs {cost} credits and you have {have}.</Meta>;
}

/** The server's JSON error, keyed for the upgrade case. */
export const isUpgrade = (e: unknown) => (e as any)?.body?.code === "upgrade_required" || (e as any)?.status === 402;

export const invalidateCredits = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: ["subscription"] });

// --- Plan gate --------------------------------------------------------------

/** shared/plans.ts PLAN_PRESENTATION, for the three paid plans a gate can name. */
const PLANS = {
  starter: { name: "Starter", cta: "Start Building" },
  builder: { name: "Builder", cta: "Build My Roadmap" },
  pro: { name: "Pro", cta: "Build Without Limits" },
} as const;
export type PlanId = keyof typeof PLANS;

/** The web's UpgradePrompt: names the plan that unlocks it, sells the outcome, links to plans. */
export function UpgradeCard({ plan, title, description, inline }: { plan: PlanId; title: string; description: string; inline?: boolean }) {
  const router = useRouter();
  const p = PLANS[plan];
  if (inline) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.surface }}>
        <Icon name="lock-closed-outline" size={16} color={colors.textTertiary} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>{title}</Text>
          <Meta>{description}</Meta>
        </View>
        <Btn small variant="outline" label={`Get ${p.name}`} onPress={() => router.push("/pricing" as any)} />
      </View>
    );
  }
  return (
    <Card style={{ alignItems: "center", gap: spacing.md, paddingVertical: spacing.xl, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border }}>
      <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
        <Icon name="sparkles" size={22} color={colors.primary} />
      </View>
      <Row center gap={6} wrap style={{ justifyContent: "center" }}>
        <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.base, color: colors.text, textAlign: "center" }}>{title}</Text>
        <Tag label={p.name} color={colors.textSecondary} />
      </Row>
      <Meta style={{ textAlign: "center", fontSize: font.sm, lineHeight: 19, maxWidth: 320 }}>{description}</Meta>
      <Btn icon="sparkles" label={p.cta} onPress={() => router.push("/pricing" as any)} />
    </Card>
  );
}

/** The amber "this is on the Builder plan" note that sits on a gated action rather than hiding it. */
export function PlanNote({ title, body }: { title: string; body: string }) {
  return (
    <Well tone="warning" style={{ flexDirection: "row", gap: spacing.sm }}>
      <Icon name="lock-closed-outline" size={16} color={colors.warning} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>{title}</Text>
        <Meta>{body}</Meta>
      </View>
    </Well>
  );
}

// --- CRUD -------------------------------------------------------------------

/** The web's useCrudQuery + useCrudMutations: `/api/projects/:id/<endpoint>` list, create, patch, delete. */
export function useCrud<T = any>(projectId: string, endpoint: string, opts?: { enabled?: boolean; retry?: boolean }) {
  const qc = useQueryClient();
  const { fail } = useNotify();
  const key = mkey(projectId, endpoint);
  const query = useQuery({
    queryKey: key,
    queryFn: () => api<T[]>(`/api/projects/${projectId}/${endpoint}`),
    enabled: opts?.enabled ?? true,
    retry: opts?.retry,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const create = useMutation({
    mutationFn: (data: any) => api<T>(`/api/projects/${projectId}/${endpoint}`, { method: "POST", body: data }),
    onSuccess: refresh,
    onError: (e) => fail(e, "Failed to create"),
  });
  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api<T>(`/api/projects/${projectId}/${endpoint}/${id}`, { method: "PATCH", body: data }),
    onSuccess: refresh,
    onError: (e) => fail(e, "Failed to update"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/projects/${projectId}/${endpoint}/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
    onError: (e) => fail(e, "Failed to delete"),
  });
  return { ...query, items: (query.data ?? []) as T[], create, update, remove };
}

// --- Pieces -----------------------------------------------------------------

/** The web's STATUS_COLORS as tints. */
export const STATUS_COLOR: Record<string, string> = {
  planned: colors.textSecondary, running: colors.info, completed: colors.success,
  draft: colors.textSecondary, review: colors.warning, final: colors.success,
  open: colors.info, "in-progress": colors.warning, resolved: colors.success, closed: colors.textSecondary,
  implemented: colors.success, verified: "#059669",
  low: colors.textSecondary, medium: colors.warning, high: colors.danger,
};
export const StatusTag = ({ status }: { status?: string | null }) =>
  status ? <Tag label={status} color={STATUS_COLOR[status] ?? colors.textSecondary} /> : null;

/** A section heading with its primary action on the right — "Customer Interviews · Add Interview". */
export function ToolHeader({ title, subtitle, children }: { title: string; subtitle?: string | null; children?: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Row between style={{ flexWrap: "wrap", gap: spacing.sm }}>
        <View style={{ flexShrink: 1, gap: 1 }}>
          <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.lg, color: colors.text }}>{title}</Text>
          {subtitle ? <Meta style={{ fontSize: font.sm }}>{subtitle}</Meta> : null}
        </View>
        {children ? <Row center gap={spacing.sm} wrap>{children}</Row> : null}
      </Row>
    </View>
  );
}

/** The web's empty card: a faint icon and one line. */
export function EmptyCard({ icon, text }: { icon: IconName; text: string }) {
  return (
    <Card style={{ alignItems: "center", paddingVertical: spacing.xl, gap: spacing.sm }}>
      <Icon name={icon} size={36} color={`${colors.textTertiary}66`} />
      <Meta style={{ textAlign: "center", fontSize: font.sm }}>{text}</Meta>
    </Card>
  );
}

export const ListLoading = () => <View style={{ height: 80 }}><Loading /></View>;

/** The web's section switcher (a row of outline/filled buttons), as bubbles. */
export function SectionSwitch<T extends string>({ options, value, onChange }: { options: { value: T; label: string; icon: IconName }[]; value: T; onChange: (v: T) => void }) {
  return (
    <Row wrap gap={6}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="button" accessibilityState={{ selected: on }}
            style={({ pressed }) => [{
              flexDirection: "row", alignItems: "center", gap: 6, borderRadius: radius.pill, borderWidth: 1,
              borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface,
              paddingHorizontal: spacing.md, paddingVertical: 7,
            }, pressed && { opacity: 0.7 }]}>
            <Icon name={o.icon} size={15} color={on ? colors.primaryText : colors.textSecondary} />
            <Text style={{ fontSize: font.sm, fontFamily: on ? fontFamily.semibold : fontFamily.medium, color: on ? colors.primaryText : colors.text }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </Row>
  );
}

/** A labelled single choice — the web's Select, as tappable bubbles. */
export function Choice<T extends string>({ label, options, value, onChange, small }: {
  label?: string; options: readonly (T | { value: T; label: string })[]; value: T; onChange: (v: T) => void; small?: boolean;
}) {
  return (
    <View style={{ gap: spacing.xs }}>
      {label ? <Label>{label}</Label> : null}
      <Row wrap gap={6}>
        {options.map((o) => {
          const v = typeof o === "string" ? o : o.value;
          const l = typeof o === "string" ? o : o.label;
          return <Bubble key={v} small={small ?? true} label={l} on={v === value} onPress={() => onChange(v)} />;
        })}
      </Row>
    </View>
  );
}

/** A tick box row — the web's Checkbox with its label and hint. */
export function CheckRow({ on, onPress, title, hint, right, disabled }: { on: boolean; onPress: () => void; title: string; hint?: string; right?: React.ReactNode; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
      style={({ pressed }) => [{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", paddingVertical: 4 }, (pressed || disabled) && { opacity: 0.6 }]}>
      <Icon name={on ? "checkbox" : "square-outline"} size={20} color={on ? colors.primary : colors.textTertiary} />
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.text }}>{title}{right}</Text>
        {hint ? <Meta style={{ lineHeight: 16 }}>{hint}</Meta> : null}
      </View>
    </Pressable>
  );
}

/** A labelled input for sheets — Field with the manager's font and a mono option. */
export function Input({ label, value, onChangeText, placeholder, multiline, rows = 4, numeric, mono, maxLength, secure }: {
  label?: string; value: string; onChangeText: (v: string) => void; placeholder?: string; multiline?: boolean; rows?: number; numeric?: boolean; mono?: boolean; maxLength?: number; secure?: boolean;
}) {
  return (
    <View style={{ gap: spacing.xs }}>
      {label ? <Label>{label}</Label> : null}
      <TextInput
        value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.textTertiary}
        multiline={multiline} maxLength={maxLength} secureTextEntry={secure} autoCapitalize={secure ? "none" : undefined}
        keyboardType={numeric ? "decimal-pad" : "default"}
        style={{
          backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
          paddingHorizontal: spacing.md, paddingVertical: 10, color: colors.text, fontSize: mono ? font.xs + 1 : font.sm,
          fontFamily: mono ? undefined : fontFamily.regular, lineHeight: multiline ? 20 : undefined,
          ...(multiline ? { minHeight: rows * 20 + 20, textAlignVertical: "top" as const } : null),
        }}
      />
    </View>
  );
}

/** A small icon-only action with a hit area, for rows. */
export function RowAction({ icon, label, onPress, color = colors.textTertiary, disabled }: { icon: IconName; label: string; onPress: () => void; color?: string; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={8} accessibilityLabel={label} style={({ pressed }) => [{ padding: 4 }, (pressed || disabled) && { opacity: 0.5 }]}>
      <Icon name={icon} size={18} color={color} />
    </Pressable>
  );
}

/** Label: value, as the web's small uppercase heading over a line. */
export function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 2 }}>
      <Overline>{label}</Overline>
      {typeof children === "string" ? <Text style={{ fontSize: font.sm, color: colors.text, fontFamily: fontFamily.regular, lineHeight: 19 }}>{children}</Text> : children}
    </View>
  );
}

export const bullet = (text: string, key: React.Key, color: string = colors.text) => (
  <Text key={key} style={{ fontSize: font.sm, color, fontFamily: fontFamily.regular, lineHeight: 19 }}>·  {text}</Text>
);

// --- Ask Nova ---------------------------------------------------------------

export type NovaSurface = "research" | "strategy" | "pricing" | "analytics";

/** shared/nova-surfaces.ts, for the four surfaces these tabs carry. */
const NOVA_SURFACES: Record<NovaSurface, { label: string; blurb: string; placeholder: string; presets: { label: string; ask: string }[] }> = {
  research: {
    label: "Customer research",
    blurb: "Nova designs the interviews and experiments that would settle your riskiest assumption — with the actual questions written out.",
    placeholder: "e.g. Design the interviews that would tell me whether solo builders will actually post a weekly update.",
    presets: [
      { label: "Plan interviews for my riskiest assumption", ask: "Work out the riskiest assumption in my brief, then plan the customer interviews that would settle it. For each one name the role to talk to and write the actual questions — about past behaviour, not hypotheticals." },
      { label: "Design an experiment to test the core loop", ask: "Design an experiment that would tell me whether my core loop works. Give me a falsifiable hypothesis, the method, and the exact number and threshold that decides it." },
      { label: "What am I assuming without evidence?", ask: "List the assumptions my plan depends on that I have no evidence for, ranked by how much damage being wrong would do. Then create the interviews or experiments that would test the top ones." },
      { label: "Turn what I've learned into next steps", ask: "Read the interviews and experiments I've already recorded and tell me what they actually establish, what they don't, and what to do next as a result." },
    ],
  },
  strategy: {
    label: "Strategy & investors",
    blurb: "Nova plays the sceptical investor: the question your plan avoids, and what would answer it.",
    placeholder: "e.g. What's the hardest question an investor would ask me, and what evidence would I need to answer it?",
    presets: [
      { label: "What would an investor attack first?", ask: "Read my brief as a sceptical investor. Name the questions I can't currently answer, ranked by how badly they'd damage a meeting, and create the work that would let me answer them." },
      { label: "Sharpen my positioning", ask: "My positioning is too broad or too vague. Rewrite the one-liner, value proposition and target customer so they're specific enough to be arguable, and save them to my brief." },
      { label: "Where's my moat, honestly?", ask: "Tell me honestly what would stop a competent competitor copying this in a month, and what I'd have to do to build a real advantage. Don't flatter me." },
      { label: "What has to be true for this to work?", ask: "List the things that must be true for this business to work, mark which ones I have evidence for, and create the work to test the rest." },
    ],
  },
  pricing: {
    label: "Pricing",
    blurb: "Nova prices against the value to your customer and what comparable products charge — and shows its reasoning.",
    placeholder: "e.g. Suggest three tiers for solo builders, and tell me what to charge and why.",
    presets: [
      { label: "Suggest pricing tiers for my customer", ask: "Propose pricing tiers for my target customer. For each one: the price, who it's for, the reason to upgrade from the tier below, and your reasoning for the number." },
      { label: "What should I actually charge?", ask: "Based on the value to my target customer and what comparable products charge, tell me what to charge. Show your reasoning and say what would make you revise it." },
      { label: "Pressure-test my current pricing", ask: "Look at the tiers I already have and tell me what's wrong with them: gaps, tiers with no reason to exist, missing upgrade triggers, prices that don't match the value." },
      { label: "Design a free tier that converts", ask: "Design a free tier that shows real value but leaves a clear reason to upgrade, and say exactly which limit does the converting." },
    ],
  },
  analytics: {
    label: "Measurement",
    blurb: "Nova defines the smallest set of events that would tell you whether the product works.",
    placeholder: "e.g. Which events should I track to know whether my weekly loop is working?",
    presets: [
      { label: "Which metrics should I track?", ask: "Define the smallest set of events that would tell me whether this product works, mapped to the success metrics in my brief. For each one say the decision it would inform." },
      { label: "Build me a funnel I can act on", ask: "Define the funnel for my core loop, step by step, with the event at each step and a realistic target conversion. Create the tasks to instrument it." },
      { label: "Are my success metrics any good?", ask: "Critique the success metrics in my brief. Say which are vanity, which aren't measurable as written, and rewrite them into ones I could actually report on." },
    ],
  },
};

interface Suggestion { summary: string; items: { label: string; detail: string }[]; operations: unknown[]; creditsCharged: number }

/** "Ask Nova" for one surface: presets or a free ask, a preview that writes nothing, then Apply. */
export function AskNova({ projectId, surface, variant = "outline" }: { projectId: string; surface: NovaSurface; variant?: "primary" | "outline" }) {
  const qc = useQueryClient();
  const { notify } = useNotify();
  const { can, cost, cantAfford, creditsRemaining } = useCredits();
  const config = NOVA_SURFACES[surface];
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState("");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const price = cost("novaAssist");
  const isBuilder = can("aiMilestones");

  const close = () => { setOpen(false); setSuggestion(null); setAsk(""); setError(null); };

  const suggest = useMutation({
    mutationFn: (question: string) => api<Suggestion>(`/api/projects/${projectId}/nova/suggest`, { method: "POST", body: { surface, ask: question } }),
    onMutate: () => setError(null),
    onSuccess: (r) => { setSuggestion(r); void invalidateCredits(qc); },
    onError: (e) => setError(isUpgrade(e) ? `Builder plan needed. ${errText(e)}` : errText(e, "Nova couldn't help with that.")),
  });
  const apply = useMutation({
    mutationFn: () => api<{ changes: { description: string }[]; skipped: string[] }>(`/api/projects/${projectId}/nova/apply`, { method: "POST", body: { operations: suggestion?.operations ?? [] } }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["manage", projectId] });
      notify(`Applied — ${r.changes.length} change${r.changes.length === 1 ? "" : "s"}${r.skipped.length ? ` · ${r.skipped.length} skipped` : ""}`);
      close();
    },
    onError: (e) => setError(errText(e, "Couldn't apply that. Try again.")),
  });

  return (
    <>
      <Btn small variant={variant} icon="sparkles" label="Ask Nova" onPress={() => setOpen(true)} />
      <EditorSheet
        visible={open} onClose={close} title={`Nova · ${config.label}`}
        subtitle={suggestion ? "Nothing has been saved yet. Read it over, then apply." : config.blurb}
        footer={suggestion ? (
          <Row gap={spacing.sm} style={{ justifyContent: "flex-end" }} wrap>
            <Btn small variant="ghost" icon="arrow-back" label="Ask something else" onPress={() => setSuggestion(null)} style={{ marginRight: "auto" }} />
            <Btn small variant="outline" label="Discard" onPress={close} />
            <Btn small icon="checkmark" label={apply.isPending ? "Applying…" : "Apply"} loading={apply.isPending} disabled={suggestion.operations.length === 0} onPress={() => apply.mutate()} />
          </Row>
        ) : (
          <Row gap={spacing.sm} style={{ justifyContent: "flex-end" }} center>
            <Btn small variant="outline" label="Cancel" onPress={close} />
            <Btn small icon="sparkles" label={suggest.isPending ? "Nova is thinking…" : `Ask Nova (${price})`} loading={suggest.isPending}
              disabled={!ask.trim() || cantAfford("novaAssist")} onPress={() => suggest.mutate(ask)} />
          </Row>
        )}
      >
        {!isBuilder && <PlanNote title="Nova's assistant is on the Builder plan" body="Asking will tell you what to upgrade to." />}
        {error ? <ErrorNote message={error} /> : null}
        {!suggestion ? (
          <>
            <View style={{ gap: spacing.sm }}>
              <Label>Common asks</Label>
              {config.presets.map((p) => (
                <Pressable key={p.label} disabled={suggest.isPending || cantAfford("novaAssist")} onPress={() => { setAsk(p.ask); suggest.mutate(p.ask); }}
                  style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.md }, (pressed || suggest.isPending) && { opacity: 0.6 }]}>
                  <Icon name="color-wand-outline" size={16} color={colors.primary} />
                  <Text style={{ flex: 1, fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.text }}>{p.label}</Text>
                  <Cost credits={price} />
                </Pressable>
              ))}
            </View>
            <Input label="Or ask for something specific" value={ask} onChangeText={setAsk} placeholder={config.placeholder} multiline rows={4} />
            {cantAfford("novaAssist") && <ShortOfCredits cost={price} have={creditsRemaining} />}
          </>
        ) : (
          <>
            {!!suggestion.summary && <Text style={{ fontSize: font.sm, color: colors.textSecondary, fontFamily: fontFamily.regular, lineHeight: 20 }}>{suggestion.summary}</Text>}
            {suggestion.items.length > 0 ? (
              <View style={{ gap: spacing.sm }}>
                <Row center gap={6}><Label>What Nova would change</Label><Tag label={String(suggestion.items.length)} color={colors.textSecondary} /></Row>
                {suggestion.items.map((it, i) => (
                  <View key={i} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.md, gap: 3 }}>
                    <Row gap={spacing.sm} style={{ alignItems: "flex-start" }}>
                      <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center", marginTop: 1 }}>
                        <Text style={{ fontSize: 9, fontFamily: fontFamily.bold, color: colors.primary }}>{i + 1}</Text>
                      </View>
                      <Text style={{ flex: 1, fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.text }}>{it.label}</Text>
                    </Row>
                    {!!it.detail && <Meta style={{ paddingLeft: 26 }}>{it.detail}</Meta>}
                  </View>
                ))}
              </View>
            ) : <Meta style={{ fontSize: font.sm }}>Nova didn't propose any changes for that — read the note above.</Meta>}
          </>
        )}
      </EditorSheet>
    </>
  );
}
