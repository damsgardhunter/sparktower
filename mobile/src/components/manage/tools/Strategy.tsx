/**
 * Strategy — the native StrategyTab (client/src/pages/pm-extended-tabs.tsx):
 * investor readiness (InvestorTools: score, deck outline, pitch critique, and
 * the mock interview, which has its own screen on the phone), pricing tiers
 * with Nova's pricing verdict, and legal documents from templates.
 */
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../api/client";
import { colors, font, fontFamily, radius, spacing } from "../../../theme";
import { Btn, Card, Icon, Label, Meta, Progress, Row, type IconName } from "../../ui";
import { EditorSheet, Overline, Tag, Well, useNotify } from "../bits";
import {
  AskNova, CheckRow, Choice, EmptyCard, Fact, Input, ListLoading, RowAction, SectionSwitch, ShortOfCredits,
  StatusTag, ToolHeader, UpgradeCard, bullet, invalidateCredits, useCrud, useCredits, type CreditKey,
} from "./kit";

type Section = "investor" | "pricing" | "legal";

export function StrategyTool({ projectId }: { projectId: string }) {
  const [section, setSection] = useState<Section>("investor");
  return (
    <View style={{ gap: spacing.md }}>
      <SectionSwitch value={section} onChange={setSection} options={[
        { value: "investor", label: "Investor Readiness", icon: "briefcase-outline" },
        { value: "pricing", label: "Pricing", icon: "cash-outline" },
        { value: "legal", label: "Legal", icon: "shield-checkmark-outline" },
      ]} />
      {/* Pricing has its own Nova surface — tiers and what to charge are a different job from investor strategy. */}
      <Row><AskNova projectId={projectId} surface={section === "pricing" ? "pricing" : "strategy"} variant="primary" /></Row>
      {section === "investor" && <InvestorReadiness projectId={projectId} />}
      {section === "pricing" && <Pricing projectId={projectId} />}
      {section === "legal" && <Legal projectId={projectId} />}
    </View>
  );
}

/** Shared with the Investors tab and the pitch screens, so a run anywhere shows everywhere. */
const artifactsKey = (projectId: string) => ["project", projectId, "investor"];
const useArtifacts = (projectId: string) =>
  useQuery({ queryKey: artifactsKey(projectId), queryFn: () => api<{ artifacts: any[]; interviews: any[] }>(`/api/projects/${projectId}/investor-artifacts`) });

// --- Investor readiness -------------------------------------------------------

type Tool = "score" | "deck" | "critique" | "interview";
const TOOLS: { id: Tool; label: string; icon: IconName; credit: CreditKey; blurb: string; path?: string; kind?: string }[] = [
  { id: "score", label: "Readiness Score", icon: "speedometer-outline", credit: "investorReadinessScore", blurb: "How ready are you to raise, scored honestly across six categories.", path: "readiness-score", kind: "readiness_score" },
  { id: "deck", label: "Pitch Deck Outline", icon: "easel-outline", credit: "pitchDeckOutline", blurb: "Slide-by-slide outline with the actual headlines and speaker notes.", path: "pitch-deck", kind: "deck_outline" },
  { id: "critique", label: "Pitch Critique", icon: "chatbox-ellipses-outline", credit: "pitchCritique", blurb: "Paste your pitch and get it torn apart constructively, line by line.", path: "pitch-critique", kind: "pitch_critique" },
  { id: "interview", label: "Mock Interview", icon: "mic-outline", credit: "mockInterviewQuestion", blurb: "Nova plays an investor, asks hard questions, and grades every answer." },
];
const VERDICT_COLOR: Record<string, string> = { "not-ready": "#E11D48", early: "#D97706", "getting-close": "#2563EB", ready: "#059669" };

function InvestorReadiness({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const { notify, fail } = useNotify();
  const { can, cost, cantAfford, creditsRemaining, isLoading: entLoading } = useCredits();
  const [tool, setTool] = useState<Tool>("score");
  const [pitch, setPitch] = useState("");
  const { data, isLoading } = useArtifacts(projectId);

  const run = useMutation({
    mutationFn: (t: (typeof TOOLS)[number]) => api(`/api/projects/${projectId}/${t.path}`, { method: "POST", body: t.id === "critique" ? { pitch } : undefined }),
    onSuccess: () => { notify("Nova's done"); setPitch(""); void qc.invalidateQueries({ queryKey: artifactsKey(projectId) }); void invalidateCredits(qc); },
    onError: (e) => fail(e, "Couldn't run that. Please try again."),
  });

  if (entLoading) return <ListLoading />;
  if (!can("aiRoadmap")) {
    return <UpgradeCard plan="builder" title="Get investor-ready" description="Score your readiness, outline a deck, have your pitch pulled apart, and sit a mock investor interview that grades every answer." />;
  }

  const current = TOOLS.find((t) => t.id === tool)!;
  const latest = (kind?: string) => data?.artifacts?.find((a) => a.kind === kind);
  const price = cost(current.credit);
  const interviewCost = `${cost("mockInterviewQuestion")}–${cost("mockInterviewGrading")}/answer`;

  return (
    <View style={{ gap: spacing.md }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
        {TOOLS.map((t) => {
          const on = t.id === tool;
          return (
            <Pressable key={t.id} onPress={() => setTool(t.id)} style={({ pressed }) => [{
              width: 176, padding: spacing.md, borderRadius: radius.md, borderWidth: 2, gap: 4,
              borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primarySoft : colors.surface,
            }, pressed && { opacity: 0.7 }]}>
              <Row center gap={6}>
                <Icon name={t.icon} size={16} color={on ? colors.primary : colors.textTertiary} />
                <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text }}>{t.label}</Text>
              </Row>
              <Meta numberOfLines={3} style={{ lineHeight: 15 }}>{t.blurb}</Meta>
              <Tag label={`${t.id === "interview" ? interviewCost : cost(t.credit)} credits`} color={colors.textSecondary} />
            </Pressable>
          );
        })}
      </ScrollView>

      {isLoading ? <ListLoading /> : tool === "interview" ? (
        <Card style={{ gap: spacing.md }}>
          <Row center gap={6}><Icon name="mic-outline" size={17} color={colors.primary} /><Text style={{ fontFamily: fontFamily.semibold, fontSize: font.base, color: colors.text }}>Mock investor interview</Text></Row>
          <Meta style={{ fontSize: font.sm, lineHeight: 19 }}>
            Nova plays an investor, asks progressively harder questions, and grades each answer out of 100. {cost("mockInterviewQuestion")} credit per question, {cost("mockInterviewGrading")} to grade your answer.
          </Meta>
          <Btn icon="mic-outline" label="Start the interview" onPress={() => router.push(`/investor/interview?id=${projectId}` as any)} />
          {(data?.interviews?.length ?? 0) > 0 && (
            <View style={{ gap: spacing.sm, borderTopWidth: 1, borderColor: colors.borderSubtle, paddingTop: spacing.md }}>
              <Overline>Past sessions</Overline>
              {data!.interviews.map((iv: any) => (
                <Row key={iv.id} between style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm + 2 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.text, textTransform: "capitalize" }}>{String(iv.persona).replace(/_/g, " ")} · {iv.difficulty}</Text>
                    <Meta>{new Date(iv.createdAt).toLocaleString()}</Meta>
                  </View>
                  <Row center gap={6}>
                    {iv.averageScore != null && <Tag label={`${iv.averageScore}/100`} />}
                    <Tag label={iv.status} color={colors.textSecondary} />
                  </Row>
                </Row>
              ))}
            </View>
          )}
        </Card>
      ) : (
        <Card style={{ gap: spacing.md }}>
          <Row between>
            <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.base, color: colors.text }}>{current.label}</Text>
            <Btn small icon="arrow-forward" label={`${latest(current.kind) ? "Run again" : "Run"} (${price})`} loading={run.isPending}
              disabled={cantAfford(current.credit) || (tool === "critique" && !pitch.trim())} onPress={() => run.mutate(current)} />
          </Row>
          {cantAfford(current.credit) && <ShortOfCredits cost={price} have={creditsRemaining} />}
          {tool === "critique" && (
            <View style={{ gap: spacing.xs }}>
              <Input label="Paste your pitch" value={pitch} onChangeText={setPitch} multiline rows={6} placeholder="Your elevator pitch, cold email, or the script you'd read in a meeting…" />
              <Meta>Nova quotes your own words back when something doesn't land.</Meta>
            </View>
          )}
          {tool === "score" && <ReadinessResult artifact={latest("readiness_score")} />}
          {tool === "deck" && <DeckResult artifact={latest("deck_outline")} />}
          {tool === "critique" && <CritiqueResult artifact={latest("pitch_critique")} />}
        </Card>
      )}
    </View>
  );
}

const BodyText = ({ children, color = colors.text, italic }: { children: React.ReactNode; color?: string; italic?: boolean }) => (
  <Text style={{ fontSize: font.sm, color, fontFamily: fontFamily.regular, lineHeight: 19, fontStyle: italic ? "italic" : "normal" }}>{children}</Text>
);

function ReadinessResult({ artifact }: { artifact?: any }) {
  if (!artifact) return <Meta style={{ fontSize: font.sm }}>No score yet. Run it to see where you stand.</Meta>;
  const c = artifact.content ?? {};
  return (
    <View style={{ gap: spacing.md }}>
      <Row gap={spacing.lg} style={{ alignItems: "flex-start" }}>
        <View style={{ alignItems: "center" }}>
          <Text style={{ fontSize: 34, fontFamily: fontFamily.bold, color: colors.text }}>{artifact.score}</Text>
          <Meta>out of 100</Meta>
        </View>
        <View style={{ flex: 1, gap: spacing.sm }}>
          {!!c.verdict && <Tag label={String(c.verdict).replace(/-/g, " ")} color={VERDICT_COLOR[c.verdict] ?? colors.textSecondary} />}
          <BodyText color={colors.textSecondary}>{artifact.summary}</BodyText>
        </View>
      </Row>
      {(c.blockers ?? []).length > 0 && (
        <View style={{ borderWidth: 1, borderColor: "#F43F5E4D", backgroundColor: "#F43F5E0D", borderRadius: radius.sm, padding: spacing.md, gap: 4 }}>
          <Row center gap={6}><Icon name="warning-outline" size={14} color="#E11D48" /><Overline color="#E11D48">Would sink a real meeting</Overline></Row>
          {c.blockers.map((b: string, i: number) => bullet(b, i))}
        </View>
      )}
      {(c.categories ?? []).map((cat: any, i: number) => (
        <View key={i} style={{ gap: 4 }}>
          <Row between><Text style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.text }}>{cat.name}</Text><Meta style={{ fontSize: font.sm }}>{cat.score}</Meta></Row>
          <Progress value={cat.score ?? 0} />
          <Meta>{cat.finding}</Meta>
          <Meta style={{ color: colors.text }}><Text style={{ color: colors.textTertiary }}>Fix first: </Text>{cat.toImprove}</Meta>
        </View>
      ))}
      <Meta>Scored {new Date(artifact.createdAt).toLocaleString()}</Meta>
    </View>
  );
}

function DeckResult({ artifact }: { artifact?: any }) {
  if (!artifact) return <Meta style={{ fontSize: font.sm }}>No outline yet. Run it to get a slide-by-slide plan.</Meta>;
  const slides: any[] = artifact.content?.slides ?? [];
  return (
    <View style={{ gap: spacing.sm }}>
      {!!artifact.summary && <BodyText color={colors.textSecondary}>{artifact.summary}</BodyText>}
      {slides.map((s, i) => (
        <View key={i} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.md, gap: 6 }}>
          <Row gap={spacing.sm} style={{ alignItems: "flex-start" }}>
            <View style={{ width: 24, height: 24, borderRadius: 6, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: font.xs, fontFamily: fontFamily.bold, color: colors.primary }}>{s.number}</Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Overline>{s.purpose}</Overline>
              <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text }}>{s.headline}</Text>
            </View>
          </Row>
          <View style={{ paddingLeft: 32, gap: 2 }}>
            {(s.bullets ?? []).map((b: string, j: number) => <Meta key={j}>·  {b}</Meta>)}
            {!!s.speakerNote && <Meta style={{ fontStyle: "italic" }}>Say: {s.speakerNote}</Meta>}
            {!!s.missingData && <Meta style={{ color: colors.warning }}>You need: {s.missingData}</Meta>}
          </View>
        </View>
      ))}
    </View>
  );
}

function CritiqueResult({ artifact }: { artifact?: any }) {
  if (!artifact) return <Meta style={{ fontSize: font.sm }}>No critique yet. Paste a pitch above and run it.</Meta>;
  const c = artifact.content ?? {};
  return (
    <View style={{ gap: spacing.md }}>
      <Row gap={spacing.md} center>
        <Text style={{ fontSize: 30, fontFamily: fontFamily.bold, color: colors.text }}>{artifact.score}</Text>
        <View style={{ flex: 1 }}><BodyText color={colors.textSecondary}>{artifact.summary}</BodyText></View>
      </Row>
      {(c.worksWell ?? []).length > 0 && (
        <View style={{ gap: 3 }}>
          <Row center gap={6}><Icon name="checkmark-circle-outline" size={14} color="#059669" /><Overline color="#059669">This lands</Overline></Row>
          {c.worksWell.map((w: string, i: number) => bullet(w, i))}
        </View>
      )}
      {(c.problems ?? []).length > 0 && (
        <View style={{ gap: spacing.sm }}>
          <Overline>What doesn't</Overline>
          {c.problems.map((p: any, i: number) => (
            <View key={i} style={{ borderLeftWidth: 2, borderLeftColor: "#F43F5E80", backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, padding: spacing.md, gap: 3 }}>
              <BodyText italic>"{p.quote}"</BodyText>
              <Meta>{p.issue}</Meta>
              <Meta style={{ color: colors.text }}><Text style={{ color: colors.textTertiary }}>Instead: </Text>{p.fix}</Meta>
            </View>
          ))}
        </View>
      )}
      {(c.questionsTheyWillAsk ?? []).length > 0 && (
        <View style={{ gap: 3 }}>
          <Overline>They'll ask you this</Overline>
          {c.questionsTheyWillAsk.map((q: string, i: number) => bullet(q, i))}
        </View>
      )}
      {!!c.rewrittenOpener && (
        <Well tone="primary">
          <Overline color={colors.primary}>Try opening with this</Overline>
          <BodyText>{c.rewrittenOpener}</BodyText>
        </Well>
      )}
    </View>
  );
}

// --- Pricing --------------------------------------------------------------------

const EMPTY_TIER = { name: "", price: 0, billingPeriod: "monthly", features: [] as string[], isFeatured: false };

function Pricing({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { notify, fail } = useNotify();
  const { cost, cantAfford, creditsRemaining } = useCredits();
  const { items: tiers, isLoading, create, remove } = useCrud<any>(projectId, "pricing");
  const { data: artifacts } = useArtifacts(projectId);
  const artifact = artifacts?.artifacts?.find((a) => a.kind === "pricing_analysis");
  const analysis = artifact?.content as { willingnessToPay?: string; recommended?: { name: string; price: string; forWho: string; rationale: string }[]; risks?: string[]; howToValidate?: string[] } | undefined;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_TIER);
  const [priceText, setPriceText] = useState("0");
  const [feature, setFeature] = useState("");

  const analyse = useMutation({
    mutationFn: () => api(`/api/projects/${projectId}/pricing-analysis`, { method: "POST" }),
    onSuccess: () => { notify("Nova priced it out — her verdict is below."); void qc.invalidateQueries({ queryKey: artifactsKey(projectId) }); void invalidateCredits(qc); },
    onError: (e) => fail(e, "Couldn't run that. Please try again."),
  });
  const price = cost("pricingAnalysis");
  const addFeature = () => { if (feature.trim()) { setForm({ ...form, features: [...form.features, feature.trim()] }); setFeature(""); } };
  const save = () => create.mutate({ ...form, price: parseInt(priceText, 10) || 0 }, { onSuccess: () => { setOpen(false); setForm(EMPTY_TIER); setPriceText("0"); } });

  return (
    <View style={{ gap: spacing.md }}>
      <ToolHeader title="Pricing Tiers">
        <Btn small variant="outline" icon="search-outline" label={analyse.isPending ? "Nova is pricing…" : `${analysis ? "Re-run analysis" : "Pressure-test my pricing"} (${price})`}
          loading={analyse.isPending} disabled={cantAfford("pricingAnalysis")} onPress={() => analyse.mutate()} />
        <Btn small icon="add" label="Add Tier" onPress={() => setOpen(true)} />
      </ToolHeader>
      {cantAfford("pricingAnalysis") && <ShortOfCredits cost={price} have={creditsRemaining} />}

      {analysis && (
        <Card style={{ gap: spacing.md, borderWidth: 1, borderColor: `${colors.primary}66`, backgroundColor: colors.primarySoft }}>
          <Row center gap={6}><Icon name="cash-outline" size={16} color={colors.primary} /><Text style={{ fontFamily: fontFamily.semibold, fontSize: font.base, color: colors.text }}>Nova's verdict</Text></Row>
          {!!artifact?.summary && <BodyText color={colors.textSecondary}>{artifact.summary}</BodyText>}
          {!!analysis.willingnessToPay && <Fact label="What they'll actually pay">{analysis.willingnessToPay}</Fact>}
          {(analysis.recommended ?? []).length > 0 && (
            <View style={{ gap: spacing.sm }}>
              <Overline>Suggested tiers</Overline>
              {analysis.recommended!.map((t, i) => (
                <View key={i} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.md, gap: 3 }}>
                  <Row between><Text style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.text }}>{t.name}</Text><Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text }}>{t.price}</Text></Row>
                  {!!t.forWho && <Meta>{t.forWho}</Meta>}
                  {!!t.rationale && <Meta style={{ color: colors.text }}>{t.rationale}</Meta>}
                </View>
              ))}
            </View>
          )}
          {(analysis.risks ?? []).length > 0 && (
            <View style={{ gap: 4 }}>
              <Overline>Where this could go wrong</Overline>
              {analysis.risks!.map((r, i) => <Row key={i} gap={6} style={{ alignItems: "flex-start" }}><Icon name="warning-outline" size={14} color="#F59E0B" /><View style={{ flex: 1 }}><BodyText>{r}</BodyText></View></Row>)}
            </View>
          )}
          {(analysis.howToValidate ?? []).length > 0 && (
            <View style={{ gap: 4 }}>
              <Overline>Test it before you commit</Overline>
              {analysis.howToValidate!.map((s, i) => <Row key={i} gap={6} style={{ alignItems: "flex-start" }}><Icon name="checkmark-circle-outline" size={14} color={colors.primary} /><View style={{ flex: 1 }}><BodyText>{s}</BodyText></View></Row>)}
            </View>
          )}
        </Card>
      )}

      {isLoading ? <ListLoading /> : !tiers.length ? (
        <EmptyCard icon="cash-outline" text="No pricing tiers yet. Define your plans!" />
      ) : tiers.map((tier) => (
        <Card key={tier.id} style={[{ gap: spacing.sm }, tier.isFeatured && { borderWidth: 2, borderColor: colors.primary }]}>
          <Row between>
            <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.lg, color: colors.text }}>{tier.name}</Text>
            <RowAction icon="trash-outline" color={colors.danger} label="Delete tier" onPress={() => remove.mutate(tier.id)} />
          </Row>
          {tier.isFeatured && <Tag label="Popular" solid />}
          <Text style={{ fontSize: 28, fontFamily: fontFamily.bold, color: colors.text }}>
            ${((tier.price ?? 0) / 100).toFixed(2)}<Text style={{ fontSize: font.sm, fontFamily: fontFamily.regular, color: colors.textTertiary }}>/{tier.billingPeriod}</Text>
          </Text>
          {Array.isArray(tier.features) && tier.features.map((f: string, i: number) => (
            <Row key={i} center gap={6}><Icon name="checkmark-circle" size={13} color={colors.success} /><Text style={{ fontSize: font.sm, color: colors.text, fontFamily: fontFamily.regular }}>{f}</Text></Row>
          ))}
        </Card>
      ))}

      <EditorSheet visible={open} onClose={() => setOpen(false)} title="New Pricing Tier"
        action={{ label: "Save", onPress: save, disabled: !form.name.trim(), loading: create.isPending }}>
        <Input label="Plan Name" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} placeholder="e.g. Pro" />
        <Input label="Price (cents)" value={priceText} onChangeText={(v) => setPriceText(v.replace(/[^0-9]/g, ""))} numeric />
        <Choice label="Billing Period" value={form.billingPeriod} onChange={(v) => setForm({ ...form, billingPeriod: v })}
          options={[{ value: "monthly", label: "Monthly" }, { value: "yearly", label: "Yearly" }, { value: "one-time", label: "One-time" }]} />
        <View style={{ gap: spacing.xs }}>
          <Label>Features</Label>
          <Row gap={spacing.sm} center>
            <View style={{ flex: 1 }}><Input value={feature} onChangeText={setFeature} placeholder="Add a feature..." /></View>
            <Btn small label="Add" onPress={addFeature} disabled={!feature.trim()} />
          </Row>
          <Row wrap gap={6}>
            {form.features.map((f, i) => (
              <Pressable key={i} onPress={() => setForm({ ...form, features: form.features.filter((_, j) => j !== i) })}
                style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.surfaceRaised, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Text style={{ fontSize: font.xs + 1, color: colors.text, fontFamily: fontFamily.medium }}>{f}</Text>
                <Icon name="close" size={12} color={colors.textTertiary} />
              </Pressable>
            ))}
          </Row>
        </View>
        <CheckRow on={form.isFeatured} onPress={() => setForm({ ...form, isFeatured: !form.isFeatured })} title="Mark as featured/popular" />
      </EditorSheet>
    </View>
  );
}

// --- Legal ----------------------------------------------------------------------

const LEGAL_TEMPLATES: Record<string, { title: string; content: string }> = {
  "ip-ownership": {
    title: "IP Ownership Agreement",
    content: `INTELLECTUAL PROPERTY OWNERSHIP AGREEMENT

1. DEFINITIONS
"Work Product" means all inventions, designs, code, documentation, and creative works produced during the project.

2. OWNERSHIP
All Work Product created by team members in connection with this project shall be owned by [PROJECT OWNER/COMPANY].

3. ASSIGNMENT
Each team member agrees to assign and hereby assigns all rights, title, and interest in any Work Product to the project owner.

4. PRIOR INVENTIONS
Team members retain ownership of any pre-existing intellectual property not created for this project.

5. CONFIDENTIALITY
All proprietary information shared during the project shall remain confidential.

Signed: _______________  Date: _______________`,
  },
  tos: {
    title: "Terms of Service",
    content: `TERMS OF SERVICE

Last updated: [DATE]

1. ACCEPTANCE OF TERMS
By accessing or using [PROJECT NAME], you agree to be bound by these Terms.

2. DESCRIPTION OF SERVICE
[PROJECT NAME] provides [BRIEF DESCRIPTION].

3. USER ACCOUNTS
You must provide accurate information when creating an account.

4. ACCEPTABLE USE
You agree not to misuse the service or help anyone else do so.

5. INTELLECTUAL PROPERTY
The service and its content are protected by copyright and other laws.

6. LIMITATION OF LIABILITY
THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND.

7. GOVERNING LAW
These Terms shall be governed by the laws of [JURISDICTION].

8. CHANGES TO TERMS
We may modify these Terms at any time with notice.`,
  },
  privacy: {
    title: "Privacy Policy",
    content: `PRIVACY POLICY

Last updated: [DATE]

1. INFORMATION WE COLLECT
- Account information (name, email)
- Usage data
- Device information

2. HOW WE USE INFORMATION
- To provide and improve the service
- To communicate with you
- To ensure security

3. DATA SHARING
We do not sell your personal information. We may share data with:
- Service providers who help operate our platform
- As required by law

4. DATA RETENTION
We retain your data as long as your account is active.

5. YOUR RIGHTS
You may request access, correction, or deletion of your data.

6. SECURITY
We implement reasonable security measures to protect your data.

7. CONTACT
For privacy inquiries: [EMAIL]`,
  },
};
const DOC_TYPES = [
  { value: "ip-ownership", label: "IP Ownership" }, { value: "tos", label: "Terms of Service" }, { value: "privacy", label: "Privacy Policy" },
  { value: "nda", label: "NDA" }, { value: "other", label: "Other" },
];
const DOC_STATUSES = [{ value: "draft", label: "Draft" }, { value: "review", label: "Review" }, { value: "final", label: "Final" }];
const EMPTY_DOC = { docType: "tos", title: "", content: "" };

function Legal({ projectId }: { projectId: string }) {
  const { items: docs, isLoading, create, update, remove } = useCrud<any>(projectId, "legal-docs");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_DOC);
  const [viewId, setViewId] = useState<string | null>(null);
  const view = docs.find((d) => d.id === viewId) ?? null;
  const save = () => create.mutate(form, { onSuccess: () => { setOpen(false); setForm(EMPTY_DOC); } });
  const template = (type: string) => { const t = LEGAL_TEMPLATES[type]; if (t) setForm({ docType: type, title: t.title, content: t.content }); };

  return (
    <View style={{ gap: spacing.md }}>
      <ToolHeader title="Legal Documents">
        <Btn small icon="add" label="Add Document" onPress={() => setOpen(true)} />
      </ToolHeader>
      {isLoading ? <ListLoading /> : !docs.length ? (
        <EmptyCard icon="shield-checkmark-outline" text="No legal documents yet. Use templates to get started!" />
      ) : docs.map((doc) => (
        <Card key={doc.id} style={{ gap: spacing.sm }}>
          <Row gap={spacing.md} center>
            <Icon name="document-text-outline" size={20} color={colors.textTertiary} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.base, color: colors.text }}>{doc.title}</Text>
              <Row gap={6} wrap><Tag label={doc.docType} color={colors.textSecondary} /><StatusTag status={doc.status} /></Row>
            </View>
            <RowAction icon="eye-outline" label="View document" onPress={() => setViewId(doc.id)} />
            <RowAction icon="trash-outline" color={colors.danger} label="Delete document" onPress={() => remove.mutate(doc.id)} />
          </Row>
          <Choice value={doc.status ?? "draft"} options={DOC_STATUSES} onChange={(v) => update.mutate({ id: doc.id, data: { status: v } })} />
        </Card>
      ))}

      <EditorSheet visible={open} onClose={() => setOpen(false)} title="New Legal Document"
        action={{ label: "Save", onPress: save, disabled: !form.title.trim(), loading: create.isPending }}>
        <View style={{ gap: spacing.xs }}>
          <Label>Quick Templates</Label>
          <Row wrap gap={spacing.sm}>
            <Btn small variant="outline" label="IP Ownership" onPress={() => template("ip-ownership")} />
            <Btn small variant="outline" label="Terms of Service" onPress={() => template("tos")} />
            <Btn small variant="outline" label="Privacy Policy" onPress={() => template("privacy")} />
          </Row>
        </View>
        <Choice label="Type" value={form.docType} options={DOC_TYPES} onChange={(v) => setForm({ ...form, docType: v })} />
        <Input label="Title" value={form.title} onChangeText={(v) => setForm({ ...form, title: v })} />
        <Input label="Content" value={form.content} onChangeText={(v) => setForm({ ...form, content: v })} multiline rows={12} mono />
      </EditorSheet>

      <EditorSheet visible={!!view} onClose={() => setViewId(null)} title={view?.title ?? ""}>
        <View style={{ backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, padding: spacing.md }}>
          <Text selectable style={{ fontSize: font.xs + 1, color: colors.text, lineHeight: 18 }}>{view?.content}</Text>
        </View>
      </EditorSheet>
    </View>
  );
}
