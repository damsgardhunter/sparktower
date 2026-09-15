import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../src/api/client";
import { colors, font, fontFamily, radius, shadow, spacing } from "../src/theme";
import { Btn, Empty, ErrorNote, Field, Icon, Loading, NovaGradient, Segments, errText, type IconName } from "../src/components/ui";
import { Pill, humanize, isSwitchedOff, tintSoft, useSurfaces } from "../src/components/MoreKit";
import { NoticeBanner, Sheet, useNotice } from "../src/components/Sheet";

type Status = "all" | "active" | "upcoming" | "judging" | "completed";

const STATUS_COLOR: Record<string, string> = { active: colors.success, upcoming: colors.info, judging: colors.warning, completed: colors.textTertiary };
const DIFFICULTY: Record<string, { color: string; icon: IconName }> = {
  beginner: { color: colors.novaEmerald, icon: "star-outline" },
  intermediate: { color: colors.warning, icon: "flame-outline" },
  advanced: { color: colors.danger, icon: "flash-outline" },
};
const RARITY: Record<string, string> = { common: "#6B7280", rare: colors.info, epic: colors.novaPurple, legendary: "#CA8A04" };

const fmtDate = (d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const daysLeft = (end: string) => Math.ceil((new Date(end).getTime() - Date.now()) / 86_400_000);

/** Contests, plus the games and sprints arena — the web's /contests. */
export default function Contests() {
  const router = useRouter();
  const qc = useQueryClient();
  const { on } = useSurfaces();
  const { notice, show, clear } = useNotice();
  const [status, setStatus] = useState<Status>("all");
  const [submitting, setSubmitting] = useState<any>(null);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data, isLoading, refetch, error } = useQuery({
    queryKey: ["contests", status],
    queryFn: () => api<any[]>(status === "all" ? "/api/contests" : `/api/contests?status=${status}`),
  });

  const join = useMutation({
    mutationFn: (id: string) => api(`/api/contests/${id}/join`, { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["contests"] }); show({ tone: "success", text: "You're in. Good luck!" }); },
    onError: (e) => show({ tone: "error", text: errText(e, "Couldn't join that contest.") }),
  });
  const submit = useMutation({
    mutationFn: () => api(`/api/contests/${submitting.id}/submit`, { method: "POST", body: { submissionUrl: url.trim(), submissionNote: note.trim() } }),
    onSuccess: () => {
      setSubmitting(null); setUrl(""); setNote("");
      qc.invalidateQueries({ queryKey: ["contests"] });
      show({ tone: "success", text: "Submission received." });
    },
    onError: (e) => setSubmitError(errText(e, "Submission failed.")),
  });

  const list = data ?? [];
  const promoted = list.filter((c) => c.promoted && c.status !== "completed");
  const regular = list.filter((c) => !c.promoted || c.status === "completed");
  const openSubmit = (c: any) => { setSubmitError(null); setSubmitting(c); };

  return (
    <>
      <Stack.Screen options={{ title: "Contests" }} />
      <ScrollView style={{ flex: 1, backgroundColor: colors.canvas }} contentContainerStyle={{ paddingBottom: spacing.xxl * 2, gap: spacing.lg }}>
        <View style={{ backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.border }}>
          <NovaGradient style={{ height: 4 }} />
          <View style={{ padding: spacing.lg, flexDirection: "row", gap: spacing.md, alignItems: "center" }}>
            <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
              <Icon name="trophy" size={22} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: font.xl, fontFamily: fontFamily.bold }}>Contests</Text>
              <Text style={meta}>Compete, build, and earn badges</Text>
            </View>
          </View>
        </View>

        {(on("games") || on("sprints")) && (
          <View style={{ gap: spacing.sm }}>
            <SectionTitle icon="flash" title="Games arena" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.md, gap: spacing.sm }}>
              {on("games") && (
                <ArenaCard icon="speedometer" tint={colors.success} title="Velocity Type Arena" body="Race others typing builder prompts." tags={["Multiplayer", "Speed"]} onPress={() => router.push("/games/typing")} />
              )}
              {on("games") && (
                <ArenaCard icon="sparkles" tint={colors.novaPurple} title="Signal vs. Noise" body="Sort signal from noise under time pressure." tags={["Solo", "Decisions"]} onPress={() => router.push("/games/signal-noise")} />
              )}
              {on("sprints") && (
                <ArenaCard icon="people" tint="#EA580C" title="Co-Founder Sprint" body="24h or 72h trial build with a possible co-founder." tags={["2-player", "Collaboration"]}
                  actions={<View style={{ flexDirection: "row", gap: 6 }}>
                    <Btn label="Practice" small variant="outline" onPress={() => router.push("/sprint/practice")} />
                    <Btn label="Real sprint" small onPress={() => router.push("/sprint/new")} />
                  </View>} />
              )}
            </ScrollView>
          </View>
        )}

        <View style={{ paddingHorizontal: spacing.md }}>
          <Segments
            options={(["all", "active", "upcoming", "judging", "completed"] as Status[]).map((s) => ({ value: s, label: humanize(s) }))}
            value={status} onChange={setStatus}
          />
        </View>

        {isLoading ? <View style={{ height: 200 }}><Loading /></View>
          : error ? (
            isSwitchedOff(error)
              ? <Empty icon="pause-circle-outline" title="Contests are paused" body="Contests are switched off right now. Check back soon." />
              : <Empty icon="cloud-offline-outline" title="Couldn't load contests" action="Try again" onAction={() => refetch()} />
          ) : list.length === 0 ? (
            <Empty icon="trophy-outline" title="No contests found" body="Check back soon for new challenges!" />
          ) : (
            <View style={{ paddingHorizontal: spacing.md, gap: spacing.lg }}>
              {promoted.length > 0 && (
                <View style={{ gap: spacing.sm }}>
                  <SectionTitle icon="sparkles" title="Featured contests" inset={false} />
                  {promoted.map((c) => <ContestCard key={c.id} contest={c} featured joining={join.isPending && join.variables === c.id} onJoin={() => join.mutate(c.id)} onSubmit={() => openSubmit(c)} />)}
                </View>
              )}
              {regular.length > 0 && (
                <View style={{ gap: spacing.sm }}>
                  <SectionTitle icon="list" title={promoted.length ? "More contests" : "All contests"} inset={false} />
                  {regular.map((c) => <ContestCard key={c.id} contest={c} joining={join.isPending && join.variables === c.id} onJoin={() => join.mutate(c.id)} onSubmit={() => openSubmit(c)} />)}
                </View>
              )}
            </View>
          )}
      </ScrollView>

      <Sheet visible={!!submitting} onClose={() => setSubmitting(null)} title={`Submit to ${submitting?.title ?? ""}`} subtitle="Link to your project or entry. You can add notes for the judges.">
        <Field label="Project / submission URL" value={url} onChangeText={setUrl} placeholder="https://your-project.example" autoCapitalize="none" />
        <Field label="Notes (optional)" value={note} onChangeText={setNote} placeholder="Describe your submission..." multiline />
        {submitError && <ErrorNote message={submitError} />}
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Btn label="Cancel" variant="outline" style={{ flex: 1 }} onPress={() => setSubmitting(null)} />
          <Btn label="Submit entry" icon="send" style={{ flex: 1.4 }} disabled={!url.trim()} loading={submit.isPending} onPress={() => submit.mutate()} />
        </View>
      </Sheet>
      <NoticeBanner notice={notice} onDismiss={clear} />
    </>
  );
}

function SectionTitle({ icon, title, inset = true }: { icon: IconName; title: string; inset?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: inset ? spacing.lg : 2 }}>
      <Icon name={icon} size={16} color={colors.primary} />
      <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>{title}</Text>
    </View>
  );
}

function ArenaCard({ icon, tint, title, body, tags, onPress, actions }: {
  icon: IconName; tint: string; title: string; body: string; tags: string[]; onPress?: () => void; actions?: React.ReactNode;
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [card, { width: 220, gap: 6 }, pressed && { opacity: 0.85 }]}>
      <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: tintSoft(tint), alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={20} color={tint} />
      </View>
      <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>{title}</Text>
      <Text style={[meta, { lineHeight: 18 }]}>{body}</Text>
      <View style={{ flexDirection: "row", gap: 4, flexWrap: "wrap" }}>
        {tags.map((t) => <Pill key={t} label={t} color={colors.textSecondary} />)}
      </View>
      {actions}
    </Pressable>
  );
}

function ContestCard({ contest: c, featured, joining, onJoin, onSubmit }: { contest: any; featured?: boolean; joining: boolean; onJoin: () => void; onSubmit: () => void }) {
  const diff = DIFFICULTY[c.difficulty] ?? DIFFICULTY.beginner;
  const left = daysLeft(c.endDate);
  const open = c.status === "active" || c.status === "upcoming";
  return (
    <View style={[card, featured && { borderColor: tintSoft(colors.primary, 0.5), borderWidth: 1.5 }]}>
      <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: colors.text, fontSize: featured ? font.lg : font.base, fontFamily: fontFamily.bold }}>{c.title}</Text>
          {c.category ? <Text style={[meta, { fontSize: font.xs }]}>{c.category}</Text> : null}
        </View>
        {featured && <Icon name="trophy" size={26} color={tintSoft(colors.primary, 0.6)} />}
      </View>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
        <Pill label={humanize(c.status)} color={STATUS_COLOR[c.status] ?? colors.textTertiary} />
        <Pill label={humanize(c.difficulty)} color={diff.color} icon={diff.icon} />
      </View>
      <Text style={[meta, { color: colors.text, lineHeight: 19 }]} numberOfLines={featured ? undefined : 3}>{c.description}</Text>
      <View style={{ gap: 5 }}>
        <MetaRow icon="people-outline" text={`${c.participantCount ?? 0}${c.maxParticipants ? ` / ${c.maxParticipants}` : ""} joined`} />
        <MetaRow icon="calendar-outline" text={`${fmtDate(c.startDate)} – ${fmtDate(c.endDate)}`} />
        {left > 0 && c.status === "active" && <MetaRow icon="time-outline" text={`${left} ${left === 1 ? "day" : "days"} left`} color={colors.primary} />}
        {c.prize ? <MetaRow icon="trophy-outline" text={c.prize} color="#CA8A04" /> : null}
        {c.badge ? <MetaRow icon="ribbon-outline" text={`${c.badge.name} badge (${c.badge.rarity})`} color={RARITY[c.badge.rarity] ?? colors.textSecondary} /> : null}
      </View>
      {open && (
        <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
          {c.isParticipant ? (
            <>
              <Pill label="Joined" icon="checkmark" color={colors.success} />
              {c.status === "active" && <Btn label="Submit entry" icon="open-outline" small variant="outline" style={{ flex: 1 }} onPress={onSubmit} />}
            </>
          ) : (
            <Btn label={c.status === "active" ? "Join contest" : "Register early"} icon={c.status === "active" ? "rocket-outline" : "locate-outline"} small style={{ flex: 1 }} loading={joining} onPress={onJoin} />
          )}
        </View>
      )}
    </View>
  );
}

function MetaRow({ icon, text, color = colors.textSecondary }: { icon: IconName; text: string; color?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Icon name={icon} size={14} color={color} />
      <Text style={{ color, fontSize: font.xs, fontFamily: fontFamily.medium, flex: 1 }}>{text}</Text>
    </View>
  );
}

const card = {
  backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  padding: spacing.md, gap: spacing.sm, ...shadow.card,
} as const;
const meta = { color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.regular } as const;
