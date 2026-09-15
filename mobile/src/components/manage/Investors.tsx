/**
 * Investors: the founder's investment inbox (the ask, the open/close switch,
 * and every application with its status and a private note), then the
 * pitch tools — readiness score, deck outline, pricing, mock interview and
 * critique. Native counterparts of investment-inbox.tsx and investor-tools.tsx.
 */
import { useEffect, useState } from "react";
import { Linking, Pressable, Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { colors, font, fontFamily, spacing } from "../../theme";
import { Avatar, Body, Btn, Card, Cost, Divider, Icon, Label, Loading, Meta, Row, Segments, type IconName } from "../ui";
import { Area, Bubble, Line, Tag, useNotify } from "./bits";
import {
  ACCREDITED_ANSWERS, INVESTMENT_AMOUNTS, INVESTMENT_DISCLAIMER, INVESTMENT_INSTRUMENTS, INVESTMENT_STATUS_LABEL, INVESTOR_TYPES,
  labelOf, mkey, type InvestmentAsk, type InvestmentStatus,
} from "./shared";

interface Application {
  id: string; amount: string; instrument: string; investorType: string; accredited: string; message: string;
  linkedinUrl: string | null; status: InvestmentStatus; ownerNote: string | null; createdAt: string;
  investor: { id: string; name: string; headline: string | null; avatarUrl: string | null; email: string | null; phone: string | null };
}

const STATUS_COLOR: Record<InvestmentStatus, string> = {
  new: colors.primary, reviewing: colors.info, accepted: colors.success, declined: colors.textTertiary, withdrawn: colors.textTertiary,
};

export function Investors({ projectId, isOwner }: { projectId: string; isOwner: boolean }) {
  return (
    <View style={{ gap: spacing.md }}>
      {isOwner && <InvestmentInbox projectId={projectId} />}
      <PitchTools projectId={projectId} />
    </View>
  );
}

function InvestmentInbox({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { notify, fail } = useNotify();
  const infoKey = mkey(projectId, "investment");
  const listKey = mkey(projectId, "investment", "applications");
  const { data: info } = useQuery({ queryKey: infoKey, queryFn: () => api<{ open: boolean; ask: InvestmentAsk | null }>(`/api/projects/${projectId}/investment`) });
  const { data: apps, isLoading } = useQuery({ queryKey: listKey, queryFn: () => api<Application[]>(`/api/projects/${projectId}/investment/applications`) });
  const [ask, setAsk] = useState<InvestmentAsk>({ headline: "", amount: null, minimum: null, instruments: [], useOfFunds: "" });
  const [filter, setFilter] = useState<"active" | "all">("active");
  const [notes, setNotes] = useState<Record<string, string>>({});

  useEffect(() => { if (info?.ask) setAsk(info.ask); }, [info?.ask]);

  const save = useMutation({
    mutationFn: (body: { open?: boolean; ask?: InvestmentAsk }) => api<{ open: boolean }>(`/api/projects/${projectId}/investment`, { method: "PATCH", body }),
    onSuccess: (r, body) => { qc.invalidateQueries({ queryKey: infoKey }); notify(body.open === undefined ? "Ask saved" : r.open ? "Applications are open on your project page" : "Applications closed"); },
    onError: (e) => fail(e, "Couldn't save that"),
  });
  const review = useMutation({
    mutationFn: (b: { id: string; status?: string; ownerNote?: string }) => api(`/api/investment-applications/${b.id}`, { method: "PATCH", body: b }),
    onSuccess: (_r, b) => { qc.invalidateQueries({ queryKey: listKey }); if (b.ownerNote !== undefined) notify("Note saved"); },
    onError: (e) => fail(e, "Couldn't update that"),
  });

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const shown = (apps ?? []).filter((a) => filter === "all" || !["declined", "withdrawn"].includes(a.status));
  const fresh = (apps ?? []).filter((a) => a.status === "new").length;

  return (
    <>
      <Card style={{ gap: spacing.md }}>
        <Row between style={{ alignItems: "flex-start" }} gap={spacing.md}>
          <View style={{ flex: 1, gap: 2 }}>
            <Row center gap={6}><Icon name="cash-outline" size={18} color={colors.primary} /><Text style={{ fontFamily: fontFamily.bold, fontSize: font.lg, color: colors.text }}>Investment applications</Text></Row>
            <Meta>When open, your public project page takes applications from people who'd like to invest. You decide who to talk to.</Meta>
          </View>
          <View style={{ alignItems: "center", gap: 2 }}>
            <Switch value={!!info?.open} disabled={save.isPending} onValueChange={(v) => save.mutate({ open: v, ask })} trackColor={{ false: colors.border, true: colors.primary }} thumbColor="#FFFFFF" />
            <Meta>{info?.open ? "Open" : "Closed"}</Meta>
          </View>
        </Row>
        <View style={{ gap: spacing.xs }}>
          <Label>The ask</Label>
          <Line value={ask.headline} maxLength={160} onChangeText={(v) => setAsk({ ...ask, headline: v })} placeholder="e.g. Raising $150k to open our second location" />
        </View>
        {(["amount", "minimum"] as const).map((field) => (
          <View key={field} style={{ gap: spacing.sm }}>
            <Label>{field === "amount" ? "Raising" : "Smallest check"}</Label>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {INVESTMENT_AMOUNTS.map((o) => <Bubble key={o.id} small label={o.label} on={ask[field] === o.id} onPress={() => setAsk({ ...ask, [field]: ask[field] === o.id ? null : o.id })} />)}
            </View>
          </View>
        ))}
        <View style={{ gap: spacing.sm }}>
          <Label>How people can invest</Label>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {INVESTMENT_INSTRUMENTS.map((o) => <Bubble key={o.id} small label={o.label} on={ask.instruments.includes(o.id)} onPress={() => setAsk({ ...ask, instruments: toggle(ask.instruments, o.id) })} />)}
          </View>
        </View>
        <View style={{ gap: spacing.xs }}>
          <Label>Use of funds</Label>
          <Area value={ask.useOfFunds} maxLength={1000} onChangeText={(v) => setAsk({ ...ask, useOfFunds: v })} placeholder="What the money goes to" rows={3} />
        </View>
        <Btn small variant="outline" label="Save the ask" loading={save.isPending && save.variables?.open === undefined} onPress={() => save.mutate({ ask })} style={{ alignSelf: "flex-start" }} />
        <Meta>Raising from investors is regulated. Publicly advertising a securities offering has rules — check them with a securities attorney before promoting your raise. {INVESTMENT_DISCLAIMER}</Meta>
      </Card>

      <Card style={{ gap: spacing.md }}>
        <Row between>
          <Row center gap={6}>
            <Icon name="file-tray-full-outline" size={17} color={colors.text} />
            <Text style={{ fontFamily: fontFamily.bold, fontSize: font.base, color: colors.text }}>Applications</Text>
            {fresh > 0 && <Tag label={`${fresh} new`} solid />}
          </Row>
          <View style={{ width: 150 }}>
            <Segments options={[{ value: "active", label: "Active" }, { value: "all", label: "All" }]} value={filter} onChange={(v) => setFilter(v as "active" | "all")} />
          </View>
        </Row>
        {isLoading ? <View style={{ height: 60 }}><Loading /></View> : shown.length === 0 ? (
          <Meta style={{ textAlign: "center", paddingVertical: spacing.md }}>{info?.open ? "No applications yet. They'll appear here." : "Open applications to start receiving them."}</Meta>
        ) : shown.map((a, i) => (
          <View key={a.id} style={{ gap: spacing.sm }}>
            {i > 0 && <Divider />}
            <Row gap={spacing.sm} style={{ alignItems: "flex-start" }}>
              <Avatar name={a.investor.name} uri={a.investor.avatarUrl} size={44} />
              <View style={{ flex: 1, gap: 2 }}>
                <Row center gap={6} wrap>
                  <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm + 1, color: colors.text }}>{a.investor.name}</Text>
                  <Tag label={INVESTMENT_STATUS_LABEL[a.status]} color={STATUS_COLOR[a.status]} solid={a.status === "new"} />
                </Row>
                {!!a.investor.headline && <Meta numberOfLines={2}>{a.investor.headline}</Meta>}
                <Meta>{new Date(a.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</Meta>
              </View>
            </Row>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {[labelOf(INVESTMENT_AMOUNTS, a.amount), labelOf(INVESTMENT_INSTRUMENTS, a.instrument), labelOf(INVESTOR_TYPES, a.investorType), `Accredited: ${labelOf(ACCREDITED_ANSWERS, a.accredited)}`].map((x) => (
                <Tag key={x} label={x} color={colors.textSecondary} />
              ))}
            </View>
            <Body>{a.message}</Body>
            {a.status !== "withdrawn" && (
              <Row gap={spacing.lg} wrap>
                {!!a.investor.email && <Contact icon="mail-outline" label={a.investor.email} onPress={() => Linking.openURL(`mailto:${a.investor.email}`)} />}
                {!!a.investor.phone && <Contact icon="call-outline" label={a.investor.phone} onPress={() => Linking.openURL(`tel:${a.investor.phone}`)} />}
                {!!a.linkedinUrl && <Contact icon="logo-linkedin" label="LinkedIn" onPress={() => Linking.openURL(a.linkedinUrl!)} />}
              </Row>
            )}
            {a.status !== "withdrawn" && (
              <Row gap={6}>
                {(["reviewing", "accepted", "declined"] as const).map((s) => (
                  <Btn key={s} small variant={a.status === s ? "primary" : "outline"} label={INVESTMENT_STATUS_LABEL[s]} disabled={review.isPending || a.status === s}
                    onPress={() => review.mutate({ id: a.id, status: s })} style={{ flex: 1, paddingHorizontal: 6 }} />
                ))}
              </Row>
            )}
            <Area value={notes[a.id] ?? a.ownerNote ?? ""} onChangeText={(v) => setNotes({ ...notes, [a.id]: v })} placeholder="Private note (only you see this)" rows={2} />
            {notes[a.id] !== undefined && notes[a.id] !== (a.ownerNote ?? "") && (
              <Btn small variant="ghost" label="Save note" onPress={() => review.mutate({ id: a.id, ownerNote: notes[a.id] })} style={{ alignSelf: "flex-start" }} />
            )}
          </View>
        ))}
      </Card>
    </>
  );
}

function Contact({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Icon name={icon} size={14} color={colors.primary} />
      <Text style={{ color: colors.primary, fontSize: font.xs + 1, fontFamily: fontFamily.medium }}>{label}</Text>
    </Pressable>
  );
}

const TOOLS = [
  { key: "readiness-score", kind: "readiness_score", label: "Readiness score", blurb: "How ready are you to raise, scored honestly across six categories.", icon: "speedometer-outline" as IconName, credits: 5 },
  { key: "pitch-deck", kind: "deck_outline", label: "Pitch deck outline", blurb: "Slide-by-slide outline with the actual headlines.", icon: "easel-outline" as IconName, credits: 8 },
  { key: "pricing-analysis", kind: "pricing_analysis", label: "Pricing analysis", blurb: "What to charge, and why.", icon: "pricetag-outline" as IconName, credits: 5 },
];

function PitchTools({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const { fail } = useNotify();
  const [running, setRunning] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["project", projectId, "investor"],
    queryFn: () => api<any>(`/api/projects/${projectId}/investor-artifacts`),
  });
  const run = useMutation({
    mutationFn: (path: string) => api(`/api/projects/${projectId}/${path}`, { method: "POST" }),
    onSettled: () => setRunning(null),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["project", projectId, "investor"] }); qc.invalidateQueries({ queryKey: ["subscription"] }); },
    onError: (e) => fail(e, "Nova couldn't run that."),
  });

  const latest = (kind: string) => data?.artifacts?.find((a: any) => a.kind === kind);
  const score = latest("readiness_score");
  const deck = latest("deck_outline");
  const pricing = latest("pricing_analysis");

  return (
    <Card style={{ gap: spacing.md }}>
      <Row center gap={6}><Icon name="mic-outline" size={17} color={colors.primary} /><Text style={{ fontFamily: fontFamily.bold, fontSize: font.base, color: colors.text }}>Pitch prep</Text></Row>
      {isLoading ? <View style={{ height: 60 }}><Loading /></View> : (
        <>
          {TOOLS.map((t) => {
            const done = latest(t.kind);
            return (
              <Row key={t.key} gap={spacing.md} center>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}><Icon name={t.icon} size={18} color={colors.primary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>{t.label}</Text>
                  <Meta numberOfLines={2}>{t.blurb}</Meta>
                </View>
                <Row center gap={4}>
                  <Btn small variant="outline" label={done ? "Redo" : "Run"} loading={running === t.key} onPress={() => { setRunning(t.key); run.mutate(t.key); }} />
                  <Cost credits={t.credits} />
                </Row>
              </Row>
            );
          })}

          {score && (
            <View style={{ gap: spacing.sm, borderTopWidth: 1, borderColor: colors.borderSubtle, paddingTop: spacing.md }}>
              <Label>Investor readiness</Label>
              <Row center gap={spacing.md}>
                <Text style={{ fontSize: 34, fontFamily: fontFamily.bold, color: colors.primary }}>{score.score}</Text>
                <View style={{ flex: 1, gap: 4 }}>
                  {!!score.content?.verdict && <Tag label={String(score.content.verdict).replace(/-/g, " ")} solid />}
                  <Body muted>{score.summary}</Body>
                </View>
              </Row>
              {(score.content?.blockers ?? []).map((b: string, i: number) => <Meta key={i}>•  {b}</Meta>)}
            </View>
          )}
          {deck && (
            <View style={{ gap: spacing.sm, borderTopWidth: 1, borderColor: colors.borderSubtle, paddingTop: spacing.md }}>
              <Label>Pitch deck outline</Label>
              {!!deck.summary && <Body muted>{deck.summary}</Body>}
              {(deck.content?.slides ?? []).slice(0, 12).map((s: any, i: number) => (
                <View key={i} style={{ gap: 1 }}>
                  <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>{s.number}. {s.headline}</Text>
                  <Meta>{s.purpose}</Meta>
                </View>
              ))}
            </View>
          )}
          {pricing && (
            <View style={{ gap: spacing.sm, borderTopWidth: 1, borderColor: colors.borderSubtle, paddingTop: spacing.md }}>
              <Label>Pricing analysis</Label>
              <Body muted>{pricing.summary}</Body>
            </View>
          )}

          <Divider />
          {[
            { href: `/investor/interview?id=${projectId}`, icon: "chatbubbles-outline" as IconName, label: "Mock investor interview", sub: "Nova plays the investor and grades every answer.", credits: 1 },
            { href: `/investor/critique?id=${projectId}`, icon: "document-text-outline" as IconName, label: "Pitch critique", sub: "Paste your pitch and get it pulled apart, kindly.", credits: 5 },
          ].map((t) => (
            <Pressable key={t.href} onPress={() => router.push(t.href as any)} style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: spacing.md }, pressed && { opacity: 0.6 }]}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}><Icon name={t.icon} size={18} color={colors.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>{t.label}</Text>
                <Meta>{t.sub}</Meta>
              </View>
              <Cost credits={t.credits} />
              <Icon name="chevron-forward" size={16} color={colors.textTertiary} />
            </Pressable>
          ))}
        </>
      )}
    </Card>
  );
}
