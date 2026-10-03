import { useState } from "react";
import { Text, View } from "react-native";
import { Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, font, fontFamily, spacing } from "../../src/theme";
import { Loading, Screen } from "../../src/components/ui";
import { Callout, PageIntro, TitledCard } from "../../src/components/MoreKit";
import { Pill } from "../../src/components/nova/Pill";
import {
  ChoiceList, CountRow, NotFoundScreen, StatBox, StatGrid, isNotFound, text,
} from "../../src/components/more/AdminKit";

/**
 * Where the AI money went — the phone's half of
 * `client/src/pages/admin-ai-spend.tsx`.
 *
 * `server/ai-spend-routes.ts` says what this is for, and it is the right frame
 * for a phone: "Four questions, which are the four a launch day actually asks."
 *
 *   - What is today costing, and how does that sit against the brake?
 *   - Which parts of the product are dear? Not which are popular — a chat turn
 *     is one credit and a codebase audit is eight.
 *   - Who is spending it, and had they paid?
 *   - Is the caching actually working?
 *
 * So this screen is those four, in that order, and not the web's charts. A
 * phone is where somebody looks during a launch when they are not at a desk,
 * and the thing they need then is the brake and the worst offender, not a
 * seven-day sparkline. The web keeps the charts; nothing is lost by them being
 * there rather than here.
 *
 * Two things deliberately left on the web, both recorded in
 * `docs/mobile-parity.md` rather than silently absent:
 *
 *   - **Changing the cap and the cost per credit.** It is a `PUT` with bounds
 *     and a live re-costed pricing ladder, and the ladder is the thing it is
 *     for. Reading the cap is the urgent half and it is here; setting it is a
 *     desk job.
 *   - **The daily table.** Its one column a phone wants — the cache rate — is
 *     on every section row already, which is a better place for it anyway,
 *     since "is the caching working" is really "is it working *for the
 *     expensive thing*".
 */

interface Today {
  spentUsd: number; ceilingUsd: number; freeCutoffUsd: number;
  freeStopped: boolean; allStopped: boolean; costPerCredit: number;
}
interface SectionRow {
  action: string; calls: number; people: number; credits: number; costUsd: number;
  unanswered: number; promptTokens: number; completionTokens: number;
  tokensPerCall: number | null; cacheRate: number | null;
}
interface PersonRow {
  userId: string; name: string; email: string | null; tier: string; paying: boolean;
  credits: number; calls: number; costUsd: number; promptTokens: number;
  monthlyAllowance: number | null; allowanceUsed: number | null; lastAt: string;
}
interface FreeTier {
  days: number; allowance: number; people: number; calls: number; credits: number;
  costUsd: number; exhausted: number; ifAllExhaustedUsd: number; perPersonUsd: number;
}
interface Settings {
  costPerCreditUsd: number; dailySpendCapUsd: number;
  updatedAt: string | null; isDefault: boolean;
  freeTierShare: number; ladder: unknown[];
  bounds: { costMin: number; costMax: number; capMax: number };
}

const TITLE = "AI spend";
const usd = (n: number) => `$${n.toFixed(2)}`;
const big = (n: number) => (n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1000)}k` : String(n));
const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n * 100)}%`);

/** An action's key, said the way a person would say it. Restated from the web page. */
const SECTION_NAMES: Record<string, string> = {
  novaChat: "Nova chat", novaGuide: "Nova coaching", novaAssist: "Surface assists",
  codeAudit: "Codebase audit", loopAudit: "Loop audit", documentPlan: "Document plan",
  roadmapRebuild: "Roadmap rebuild", simulationBuild: "Nova builds a simulation",
  gameVerdict: "Ten Years verdict (free)", taskAssist: "Task planning",
};
const nameOf = (a: string) => SECTION_NAMES[a] ?? a.replace(/_/g, " ");

export default function AdminAiSpend() {
  const [days, setDays] = useState<"7" | "30">("7");
  const n = Number(days);

  /* Watched during a launch, so it refreshes itself rather than being reloaded. */
  const opts = { refetchInterval: 30_000, retry: false } as const;
  const today = useQuery<Today>({ queryKey: ["ai-spend-today"], queryFn: () => api<Today>("/api/admin/ai-spend/today"), ...opts });
  const sections = useQuery<{ rows: SectionRow[] }>({ queryKey: ["ai-spend-sections", n], queryFn: () => api<{ rows: SectionRow[] }>(`/api/admin/ai-spend/sections?days=${n}`), ...opts });
  const people = useQuery<{ rows: PersonRow[] }>({ queryKey: ["ai-spend-people", n], queryFn: () => api<{ rows: PersonRow[] }>(`/api/admin/ai-spend/people?days=${n}`), ...opts });
  const free = useQuery<FreeTier>({ queryKey: ["ai-spend-free", n], queryFn: () => api<FreeTier>(`/api/admin/ai-spend/free-tier?days=${n}`), ...opts });
  const settings = useQuery<Settings>({ queryKey: ["ai-spend-settings"], queryFn: () => api<Settings>("/api/admin/ai-spend/settings"), ...opts });

  /* Owner-only on the server; the screen says the same thing it says. */
  if (isNotFound(today.error)) return <NotFoundScreen title={TITLE} />;

  if (today.isLoading || !today.data) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        <Stack.Screen options={{ title: TITLE }} />
        <Loading />
      </View>
    );
  }

  const t = today.data;
  const share = t.ceilingUsd > 0 ? t.spentUsd / t.ceilingUsd : null;
  const topSections = (sections.data?.rows ?? []).slice(0, 10);
  const dearest = topSections.reduce((m, r) => Math.max(m, r.costUsd), 0);
  const topPeople = (people.data?.rows ?? []).slice(0, 10);
  const spentMost = topPeople.reduce((m, r) => Math.max(m, r.costUsd), 0);

  return (
    <Screen>
      <Stack.Screen options={{ title: TITLE }} />
      <PageIntro icon="flash" title={TITLE} body="What the model is costing, where it goes, and who is spending it." />

      {/* 1. Today, against the brake. */}
      <TitledCard icon="speedometer" title="Today, against the brake" action={
        <Pill label={t.allStopped ? "All stopped" : t.freeStopped ? "Free tier stopped" : "Running"}
          tone={t.allStopped ? "bad" : t.freeStopped ? "warn" : "good"} />
      }>
        <Text style={{ color: colors.text, fontSize: 34, fontFamily: fontFamily.bold }} testID="text-spent-today">
          {usd(t.spentUsd)}
        </Text>
        <Text style={text.meta}>
          of {usd(t.ceilingUsd)} a day. Free accounts stop at {usd(t.freeCutoffUsd)}, which is why
          they stop first: when a launch day runs hot the people to stop are the ones who have paid
          nothing.
        </Text>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surfaceRaised, overflow: "hidden", marginTop: spacing.sm }}>
          <View style={{
            height: "100%",
            width: `${Math.max(0, Math.min(100, Math.round((share ?? 0) * 100)))}%`,
            backgroundColor: t.allStopped ? colors.danger : t.freeStopped ? colors.warning : colors.success,
          }} />
        </View>
        {t.allStopped ? (
          <Callout tone="danger" icon="warning" body="The day's ceiling is reached. Every AI route is refusing until the day rolls over, or until the cap is raised from the web console." />
        ) : null}
      </TitledCard>

      <View style={{ paddingHorizontal: spacing.lg }}>
        <ChoiceList
          options={[{ id: "7", label: "Last 7 days" }, { id: "30", label: "Last 30 days" }]}
          value={days}
          onChange={setDays}
        />
      </View>

      {/* 2. Which parts are dear — and 4. whether the caching is working, per part. */}
      <TitledCard icon="layers" title={`Dearest parts · ${n} days`}>
        <Text style={text.meta}>
          Cost, not popularity. A chat turn is one credit and a codebase audit is eight, so the
          interesting column is the product of the two. `cache` is the share of prompt tokens the
          provider served from its cache — the prompt ordering only pays off if it is high.
        </Text>
        {sections.isLoading ? <Loading /> : topSections.length === 0 ? (
          <Text style={text.meta}>Nothing yet in this window.</Text>
        ) : topSections.map((r) => (
          <CountRow
            key={r.action}
            label={nameOf(r.action)}
            value={usd(r.costUsd)}
            note={`cache ${pct(r.cacheRate)}`}
            share={dearest > 0 ? r.costUsd / dearest : null}
          />
        ))}
      </TitledCard>

      {/* 3. Who is spending it, and had they paid. */}
      <TitledCard icon="people" title={`Biggest spenders · ${n} days`}>
        <Text style={text.meta}>
          The question is not who is busiest, it is whether the busiest had paid. A free account at
          the top of this list is the free tier working as intended or being farmed, and the
          difference is whether the allowance ran out.
        </Text>
        {people.isLoading ? <Loading /> : topPeople.length === 0 ? (
          <Text style={text.meta}>Nothing yet in this window.</Text>
        ) : topPeople.map((p) => (
          <CountRow
            key={p.userId}
            label={p.name || p.email || "Somebody"}
            value={usd(p.costUsd)}
            note={`${big(p.calls)} calls`}
            share={spentMost > 0 ? p.costUsd / spentMost : null}
            leading={<Pill label={p.paying ? p.tier : "free"} tone={p.paying ? "good" : "neutral"} />}
          />
        ))}
      </TitledCard>

      {/* What the free tier costs, which is the question behind question 3. */}
      {free.data ? (
        <TitledCard icon="gift" title={`The free tier · ${free.data.days} days`}>
          <StatGrid>
            <StatBox label="People" value={big(free.data.people)} />
            <StatBox label="Cost" value={usd(free.data.costUsd)} />
            <StatBox label="Each" value={usd(free.data.perPersonUsd)} />
            <StatBox
              label="Ran out"
              value={`${free.data.exhausted}`}
              sub={`of ${free.data.people}`}
              state={free.data.people > 0 && free.data.exhausted / free.data.people > 0.5 ? "warn" : "none"}
            />
          </StatGrid>
          <Text style={text.meta}>
            If every free account used its whole allowance it would cost {usd(free.data.ifAllExhaustedUsd)}.
            That is the number the free tier is a bet on.
          </Text>
        </TitledCard>
      ) : null}

      {/* The settings, read-only. */}
      {settings.data ? (
        <TitledCard icon="options" title="Settings">
          <StatGrid>
            <StatBox label="Daily cap" value={usd(settings.data.dailySpendCapUsd)} />
            <StatBox label="Per credit" value={`$${settings.data.costPerCreditUsd.toFixed(4)}`} />
            <StatBox label="Free share" value={pct(settings.data.freeTierShare)} />
          </StatGrid>
          <Text style={text.meta}>
            {settings.data.isDefault
              ? "These are the shipped defaults — nobody has set them for this deployment."
              : `Last changed ${new Date(settings.data.updatedAt ?? "").toLocaleDateString()}.`}
            {" "}Changing them, and seeing what each price does to the pricing ladder, is on the web
            console: the ladder is the point of that screen and it does not fit here.
          </Text>
        </TitledCard>
      ) : null}

      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}
