/**
 * "What would it take?" on the phone — the native counterpart of
 * client/src/components/what-would-it-take.tsx.
 *
 * Pick one of four sizes, read the roadmap the server already built, and build
 * or re-build one. Deliberately read-first: the owner who opens this on a
 * phone is usually not at a desk deciding to spend credits, they are looking
 * something up — so the plain-English note on what each size of company is,
 * and the last roadmap for the target they tap, are there before any button is
 * pressed.
 *
 * Nothing here computes anything. The gap, the multiples, the stage lengths
 * and the verdict all arrive from the server already worked out
 * (shared/what-would-it-take.ts), so unlike the simulation mirrors this screen
 * has no copy of the engine that can drift out of step with it. If a number
 * needs to appear here, it gets added to the payload rather than re-derived —
 * two places computing "how many times bigger" is exactly how a phone ends up
 * telling an owner something the website disagrees with.
 */
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useEntitlementsQuery } from "../../hooks/useEntitlements";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Btn, Card, Cost, Icon, Loading, Meta, Row } from "../ui";
import { Tag, useNotify } from "./bits";
import { mkey } from "./shared";

type TargetId = "m1" | "m100" | "b1" | "b50";
type Verdict = "reachable" | "a stretch" | "a different business";

interface TargetView { id: TargetId; label: string; short: string; whatItIs: string; worth: string; howMany: string | null }
interface Stage {
  number: number; title: string; multiple: number; endsAt: number; howLong: string;
  mustBeTrue: string[]; breaksFirst: string; costToFix: string;
}
interface Stored {
  id: string; target: TargetId; generatedAt: string; annualRevenue: number | null;
  grounding: { revenueFrom: string | null; checkinsOnFile: number };
  roadmap: {
    gap: { multiple: number } | null;
    body: {
      headline: string; arithmetic: string[]; stages: Stage[];
      first90: { title: string; why: string }[];
      verdict: Verdict; verdictOnRevenueAlone: Verdict; tightenedByMargin: boolean;
      marginNote: string; verdictText: string; worth: string;
    };
  };
}
interface Payload {
  targets: TargetView[];
  credits: number;
  aiAvailable: boolean;
  grounding: { revenueFrom: string | null; annualRevenue: number | null };
  notReady: string | null;
  roadmaps: Record<TargetId, { latest: Stored | null; runs: number; movement: { text: string } | null }>;
}

const VERDICT_COLOR: Record<Verdict, string> = {
  reachable: colors.success,
  "a stretch": colors.warning,
  "a different business": colors.danger,
};

/** "96,154×" past ten, "3.4×" below it. Mirrors showMultiple in shared/what-would-it-take.ts. */
const times = (m: number) => `${m >= 10 ? Math.round(m).toLocaleString("en-GB") : Math.round(m * 100) / 100}×`;

/** Money the way shared/company-rhythm.ts's formatValue writes it, for the figures the payload sends as raw numbers. */
function money(v: number | null | undefined): string {
  if (v == null) return "—";
  const a = Math.abs(v);
  const body = a >= 1_000_000 ? `${(a / 1_000_000).toFixed(2)}m` : a >= 10_000 ? `${(a / 1000).toFixed(1).replace(/\.0$/, "")}k` : Math.round(a).toLocaleString("en-GB");
  return `${v < 0 ? "−" : ""}$${body}`;
}

const stamp = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function WhatWouldItTake({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { notify, fail } = useNotify();
  const { creditCosts } = useEntitlementsQuery();
  const key = mkey(projectId, "what-would-it-take");
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api<Payload>(`/api/projects/${projectId}/what-would-it-take`),
  });
  const [chosen, setChosen] = useState<TargetId>("m1");

  /* Open on a size that already has a roadmap, once, so coming back shows the work. */
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (!data || opened) return;
    const withOne = data.targets.find((t) => data.roadmaps[t.id]?.latest);
    if (withOne) setChosen(withOne.id);
    setOpened(true);
  }, [data, opened]);

  const build = useMutation({
    mutationFn: (target: TargetId) => api(`/api/projects/${projectId}/what-would-it-take/${target}`, { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ["subscription"] });
      notify("Nova built the roadmap.");
    },
    onError: (e) => fail(e, "Couldn't build that roadmap."),
  });

  if (isLoading || !data) return <Card><Loading /></Card>;

  const target = data.targets.find((t) => t.id === chosen) ?? data.targets[0];
  const slot = data.roadmaps[target.id];
  const latest = slot?.latest ?? null;
  const cost = creditCosts?.whatWouldItTake ?? data.credits;

  return (
    <Card style={{ gap: spacing.md }}>
      <View style={{ gap: 4 }} testID="wwit">
        <Row center gap={6}>
          <Icon name="trending-up-outline" size={15} color={colors.textTertiary} />
          <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text }}>What would it take?</Text>
        </Row>
        <Meta style={{ fontSize: font.sm }}>
          Pick a size and Nova works out the route there from your own check-in numbers — including when the answer is that it isn't reachable from here.
        </Meta>
      </View>

      <View style={{ gap: spacing.sm }} testID="wwit-targets">
        {data.targets.map((t) => {
          const on = t.id === target.id;
          return (
            <Pressable
              key={t.id}
              onPress={() => setChosen(t.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              testID={`wwit-target-${t.id}`}
              style={({ pressed }) => [{
                borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: 4,
                borderColor: on ? colors.primary : colors.border,
                backgroundColor: on ? colors.primarySoft : colors.surface,
              }, pressed && { opacity: 0.7 }]}
            >
              <Row center gap={6}>
                <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text }}>{t.label}</Text>
                {data.roadmaps[t.id]?.latest ? <Tag label="Built" /> : null}
              </Row>
              <Meta style={{ fontSize: font.xs + 1 }}>{t.whatItIs}</Meta>
            </Pressable>
          );
        })}
      </View>

      <View style={{ gap: spacing.sm }}>
        <Meta style={{ fontSize: font.xs + 1 }}>{target.worth}</Meta>
        {target.howMany ? <Meta style={{ fontSize: font.xs + 1 }}>{target.howMany}</Meta> : null}
        {data.notReady ? (
          <Text style={{ fontSize: font.sm, fontFamily: fontFamily.regular, color: colors.warning }} testID="wwit-not-ready">{data.notReady}</Text>
        ) : (
          <Row wrap gap={spacing.sm} center>
            <Btn
              small
              icon={latest ? "refresh" : "sparkles"}
              label={latest ? "Run it again" : "Build the roadmap"}
              loading={build.isPending}
              disabled={!data.aiAvailable}
              onPress={() => build.mutate(target.id)}
            />
            <Cost credits={cost} />
          </Row>
        )}
      </View>

      {latest ? <Roadmap stored={latest} movement={slot?.movement?.text ?? null} /> : null}
    </Card>
  );
}

function Roadmap({ stored, movement }: { stored: Stored; movement: string | null }) {
  const body = stored.roadmap.body;
  return (
    <View style={{ gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderSubtle, paddingTop: spacing.md }} testID="wwit-roadmap">
      <Row center wrap gap={spacing.sm}>
        <Tag label={body.verdict} color={VERDICT_COLOR[body.verdict]} solid />
        {stored.roadmap.gap ? <View testID="wwit-multiple"><Meta>{times(stored.roadmap.gap.multiple)} where you are</Meta></View> : null}
        {body.tightenedByMargin ? <Meta style={{ fontSize: font.xs }}>on revenue alone, "{body.verdictOnRevenueAlone}"</Meta> : null}
      </Row>
      <Text style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.text, lineHeight: 20 }} testID="wwit-headline">{body.headline}</Text>

      {/* What it was built from, with the date — never an answer without its question. */}
      <Meta style={{ fontSize: font.xs }}>
        Built {stamp(stored.generatedAt)} from {stored.grounding.revenueFrom ?? "your check-ins"}
        {stored.annualRevenue != null ? ` — about ${money(stored.annualRevenue)} a year` : ""}
      </Meta>
      {movement ? <View testID="wwit-movement"><Meta style={{ fontSize: font.sm, color: colors.text }}>{movement}</Meta></View> : null}

      <View style={{ gap: 3 }} testID="wwit-arithmetic">
        {body.arithmetic.map((l, i) => <Meta key={i} style={{ fontSize: font.sm }}>{l}</Meta>)}
      </View>

      <View style={{ gap: spacing.sm }} testID="wwit-stages">
        {body.stages.map((s) => (
          <View key={s.number} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm + 2, gap: 4 }} testID={`wwit-stage-${s.number}`}>
            <Row center wrap gap={6}>
              <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text }}>{s.number}. {s.title}</Text>
              <Tag label={times(s.multiple)} />
              <Meta style={{ fontSize: font.xs }}>{s.howLong} · to {money(s.endsAt)} a year</Meta>
            </Row>
            {s.mustBeTrue.map((m, i) => <Meta key={i} style={{ fontSize: font.sm }}>• {m}</Meta>)}
            {s.breaksFirst ? <Meta style={{ fontSize: font.sm }}>Breaks first: {s.breaksFirst}{s.costToFix ? ` Fixing it: ${s.costToFix}` : ""}</Meta> : null}
          </View>
        ))}
      </View>

      <View style={{ gap: 4 }} testID="wwit-first90">
        <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text }}>The first 90 days</Text>
        {body.first90.map((s, i) => (
          <Meta key={i} style={{ fontSize: font.sm }}>{i + 1}. {s.title}{s.why ? ` — ${s.why}` : ""}</Meta>
        ))}
      </View>

      {/* Revenue is not money kept: the note says which is on the screen. */}
      {body.marginNote ? <Meta style={{ fontSize: font.sm, color: colors.text }}>{body.marginNote}</Meta> : null}

      <View style={{ gap: 4 }} testID="wwit-verdict-text">
        <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text }}>Honestly</Text>
        <Text style={{ fontSize: font.sm, fontFamily: fontFamily.regular, color: colors.text, lineHeight: 20 }}>{body.verdictText}</Text>
      </View>
    </View>
  );
}
