import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, readPref, writePref } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import {
  Avatar, Btn, Chip, Empty, Field, Icon, IconButton, Loading, Progress, TabStrip, errText, plain, type IconName,
} from "../../src/components/ui";
import { Callout, OptionCard, Pill, TitledCard, tintSoft } from "../../src/components/MoreKit";
import { NoticeBanner, Sheet, useNotice } from "../../src/components/Sheet";
import { SprintIdeaPicker } from "../../src/components/SprintIdeaPicker";
import {
  PHASE_ICONS, PHASE_LABELS, SPRINT_CREDIT_COSTS, SPRINT_PHASES, credits, planBlock, styleLabel, type SprintIdea,
} from "../../src/components/SprintKit";

const IDEATION_QUESTIONS = [
  { key: "real_problem", label: "What real problem does this product solve?", placeholder: "Describe the core problem you see..." },
  { key: "target_user", label: "Who is the target user?", placeholder: "Describe the ideal user persona..." },
  { key: "riskiest_assumption", label: "What is the riskiest assumption?", placeholder: "What could make this fail?" },
  { key: "success_criteria", label: "What does success look like?", placeholder: "Define measurable success criteria..." },
];

const KANBAN: { id: "todo" | "in-progress" | "done"; label: string; icon: IconName }[] = [
  { id: "todo", label: "To do", icon: "ellipse-outline" },
  { id: "in-progress", label: "In progress", icon: "time-outline" },
  { id: "done", label: "Done", icon: "checkmark-circle" },
];

const NOVA_PREFIX = "[Nova AI Practice Partner]";
/** How long after ideation opens Nova's background answers get before we offer to ask again. */
const NOVA_ANSWER_GRACE_MS = 90_000;
/**
 * The server only lets ratings be read once a sprint is completed, so during
 * review there's no way to ask whether you've already rated. Remember it on
 * the device instead, so the form doesn't come back and "Complete sprint" can.
 */
const ratedKey = (sprintId: string) => `sparktower.sprintRated.${sprintId}`;
const DECISION_LABEL: Record<string, string> = { proceed: "Proceed", pivot: "Pivot", kill: "Kill" };
const DECISION_COLOR: Record<string, string> = { proceed: colors.success, pivot: colors.warning, kill: colors.danger };

type Tab = "sprint" | "chat";

/**
 * The sprint dashboard — every phase of the web's /sprints/:id: agreeing on a
 * product, private ideation, alignment, the task board and deliverables,
 * validation, the review (decision and rating), and the compatibility report.
 * Chat is its own tab rather than a drawer, which suits a phone better.
 */
export default function SprintDashboard() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { notice, show, clear } = useNotice();
  const [tab, setTab] = useState<Tab>("sprint");

  const { data: sprint, isLoading } = useQuery({
    queryKey: ["sprint", id],
    queryFn: () => api<any>(`/api/sprints/${id}`),
    enabled: !!id,
    refetchInterval: 5000,
  });
  const status: string = sprint?.status ?? "setup";
  const from = (phases: string[]) => !!sprint && phases.includes(status);

  const { data: responses } = useQuery({
    queryKey: ["sprint", id, "responses"], queryFn: () => api<any[]>(`/api/sprints/${id}/responses`),
    enabled: from(["ideation", "alignment", "building", "validation", "review", "completed"]), refetchInterval: 5000,
  });
  const { data: tasks } = useQuery({
    queryKey: ["sprint", id, "tasks"], queryFn: () => api<any[]>(`/api/sprints/${id}/tasks`),
    enabled: from(["building", "validation", "review", "completed"]), refetchInterval: 5000,
  });
  const { data: deliverables } = useQuery({
    queryKey: ["sprint", id, "deliverables"], queryFn: () => api<any[]>(`/api/sprints/${id}/deliverables`),
    enabled: from(["building", "validation", "review", "completed"]), refetchInterval: 5000,
  });
  const { data: ratings } = useQuery({
    queryKey: ["sprint", id, "ratings"],
    // A 400 before completion is the server hiding ratings, not a failure.
    queryFn: () => api<any[]>(`/api/sprints/${id}/ratings`).catch((e) => { if (e?.status === 400) return []; throw e; }),
    enabled: from(["review", "completed"]),
  });
  const { data: decisions } = useQuery({
    queryKey: ["sprint", id, "decisions"], queryFn: () => api<any[]>(`/api/sprints/${id}/decisions`),
    enabled: from(["review", "completed"]),
  });
  const { data: report } = useQuery({
    queryKey: ["sprint", id, "report"], queryFn: () => api<any>(`/api/sprints/${id}/report`).catch(() => null),
    enabled: from(["completed"]),
  });
  const { data: messages } = useQuery({
    queryKey: ["sprint", id, "messages"], queryFn: () => api<any[]>(`/api/sprints/${id}/messages`),
    enabled: !!id, refetchInterval: tab === "chat" ? 3000 : 15000,
  });

  const refresh = (...keys: string[]) => keys.forEach((k) => qc.invalidateQueries({ queryKey: k ? ["sprint", id, k] : ["sprint", id] }));
  /** The web's destructive toast; a plan or credit block also offers the way to pricing. */
  const fail = (e: unknown, fallback: string, retry?: () => void) => {
    const block = planBlock(e);
    show({
      tone: "error", text: errText(e, fallback),
      action: block ? { label: "See plans", onPress: () => router.push("/pricing") } : retry ? { label: "Retry", onPress: retry } : undefined,
    });
  };

  /*
   * Leaving ends the sprint for both people, so it confirms first — in a sheet
   * rather than a native alert, because the note for the partner needs
   * somewhere to type. The web dialog offers the same field, and the two
   * should not disagree about what leaving involves.
   */
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveReason, setLeaveReason] = useState("");

  const leave = useMutation({
    mutationFn: () => api<any>(`/api/sprints/${id}/leave`, {
      method: "POST",
      body: { reason: leaveReason.trim() || undefined },
    }),
    onSuccess: (r: any) => {
      setLeaveOpen(false);
      qc.invalidateQueries({ queryKey: ["sprint", id] });
      qc.invalidateQueries({ queryKey: ["sprints"] });
      Alert.alert("You've left the sprint", r?.partnerNotified ? "Your partner has been told." : undefined);
      router.back();
    },
    onError: (e: any) => Alert.alert("Couldn't leave", errText(e) || "Please try again."),
  });

  const advance = useMutation({
    mutationFn: () => api<any>(`/api/sprints/${id}/advance`, { method: "POST" }),
    onSuccess: (r) => {
      refresh("", "tasks", "responses");
      qc.invalidateQueries({ queryKey: ["sprints"] });
      show({
        tone: "success",
        text: r?.novaCreditsOnSuccess > 0
          ? `On to ${PHASE_LABELS[r.status]?.toLowerCase() ?? "the next phase"}. Nova is writing its answers (${credits(r.novaCreditsOnSuccess)} once they land).`
          : "Sprint advanced to the next phase.",
      });
    },
    onError: (e) => fail(e, "Couldn't advance the sprint."),
  });

  if (isLoading) return <Loading />;
  if (!sprint) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas, justifyContent: "center" }}>
        <Stack.Screen options={{ title: "Sprint" }} />
        <Empty icon="alert-circle-outline" title="Sprint not found" action="Back to sprints" onAction={() => router.replace("/(tabs)/sprints")} />
      </View>
    );
  }

  const isParticipant = sprint.user1Id === user?.id || sprint.user2Id === user?.id;
  if (!isParticipant) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas, justifyContent: "center" }}>
        <Stack.Screen options={{ title: "Sprint" }} />
        <Empty icon="lock-closed-outline" title="Not your sprint" body="You are not a participant in this sprint." action="Go home" onAction={() => router.replace("/(tabs)/feed")} />
      </View>
    );
  }

  const partnerId = sprint.user1Id === user?.id ? sprint.user2Id : sprint.user1Id;
  const partner = sprint.user1Id === user?.id ? sprint.user2 : sprint.user1;
  const me = sprint.user1Id === user?.id ? sprint.user1 : sprint.user2;
  const currentIdx = SPRINT_PHASES.indexOf(status as any);
  const visiblePhases = sprint.duration === "24h" ? SPRINT_PHASES.filter((p) => p !== "validation") : [...SPRINT_PHASES];

  const all = responses ?? [];
  const myResponses = sprint.isPractice ? all.filter((r) => r.userId === user?.id && !r.questionKey.startsWith("nova_")) : all.filter((r) => r.userId === user?.id);
  const partnerResponses = sprint.isPractice ? all.filter((r) => r.questionKey.startsWith("nova_")) : all.filter((r) => r.userId === partnerId);

  const ctx: PhaseCtx = {
    sprint, id: id!, userId: user?.id ?? "", partnerId, partner, me, show, fail, refresh,
    advance: () => advance.mutate(), advancing: advance.isPending,
  };

  return (
    <>
      <Stack.Screen options={{ title: sprint.productName || "Co-founder sprint" }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0} style={{ flex: 1, backgroundColor: colors.canvas }}>
        {/* Header: product, who's in it, and where the sprint is. */}
        <View style={{ backgroundColor: colors.surface, paddingTop: spacing.md, gap: spacing.sm }}>
          <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
            <View style={{ flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" }}>
              <Pill label={sprint.duration} icon="timer-outline" color={colors.textSecondary} />
              {sprint.productStyle ? <Pill label={styleLabel(sprint.productStyle)} color={colors.info} /> : null}
              <Pill label={PHASE_LABELS[status] ?? status} color={colors.primary} solid />
              {sprint.isPractice && <Pill label="Practice" color={colors.novaEmerald} />}
              {/* Only while it's still running: a finished or ended sprint has nothing to leave. */}
              {status !== "completed" && status !== "abandoned" && (
                <Pressable
                  onPress={() => setLeaveOpen(true)}
                  disabled={leave.isPending}
                  accessibilityRole="button"
                  accessibilityLabel="Leave this sprint"
                  style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, marginLeft: "auto", opacity: leave.isPending ? 0.5 : 1 }}
                  testID="button-leave-sprint"
                >
                  <Icon name="exit-outline" size={14} color={colors.textTertiary} />
                  <Text style={[meta, { color: colors.textTertiary }]}>{leave.isPending ? "Leaving…" : "Leave"}</Text>
                </Pressable>
              )}
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Avatar name={me?.firstName || "You"} uri={me?.profileImageUrl} size={28} />
              <Text style={meta}>{me?.firstName || "You"}</Text>
              <Icon name="swap-horizontal" size={16} color={colors.textTertiary} />
              {sprint.isPractice ? <NovaDot size={28} /> : <Avatar name={partner?.firstName || "Partner"} uri={partner?.profileImageUrl} size={28} />}
              <Text style={meta}>{sprint.isPractice ? "Nova (AI)" : partner?.firstName || "Partner"}</Text>
            </View>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: 6, alignItems: "center" }}
            ref={(r) => { if (r && currentIdx > 2) setTimeout(() => r.scrollTo({ x: (currentIdx - 2) * 110, animated: false }), 0); }}>
            {visiblePhases.map((p, i) => {
              const idx = SPRINT_PHASES.indexOf(p);
              const on = status === p;
              const complete = currentIdx > idx;
              return (
                <View key={p} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  {i > 0 && <View style={{ width: 10, height: 1.5, backgroundColor: complete || on ? colors.primary : colors.border }} />}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: on ? colors.primary : complete ? colors.primarySoft : colors.surfaceRaised }}>
                    <Icon name={complete ? "checkmark-circle" : PHASE_ICONS[p]} size={13} color={on ? "#FFFFFF" : complete ? colors.primary : colors.textTertiary} />
                    <Text style={{ fontSize: font.xs, fontFamily: on ? fontFamily.semibold : fontFamily.medium, color: on ? "#FFFFFF" : complete ? colors.primary : colors.textTertiary }}>{PHASE_LABELS[p]}</Text>
                  </View>
                </View>
              );
            })}
          </ScrollView>
          <TabStrip
            options={[{ value: "sprint" as Tab, label: "Sprint" }, { value: "chat" as Tab, label: `Chat${messages?.length ? ` (${messages.length})` : ""}` }]}
            value={tab} onChange={setTab}
          />
        </View>

        {tab === "chat" ? (
          <SprintChat ctx={ctx} messages={messages ?? []} />
        ) : (
          <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl * 2 }} keyboardShouldPersistTaps="handled">
            {sprint.productDescription && status !== "setup" ? (
              <Text style={[meta, { lineHeight: 19, paddingHorizontal: 2 }]}>{sprint.productDescription}</Text>
            ) : null}
            {status === "setup" && <SetupPhase ctx={ctx} />}
            {status === "ideation" && <IdeationPhase ctx={ctx} myResponses={myResponses} partnerResponded={partnerResponses.length > 0} responsesLoaded={!!responses} />}
            {status === "alignment" && <AlignmentPhase ctx={ctx} myResponses={myResponses} partnerResponses={partnerResponses} />}
            {(status === "building" || status === "validation") && <WorkPhase ctx={ctx} tasks={tasks ?? []} deliverables={deliverables ?? []} />}
            {status === "review" && <ReviewPhase ctx={ctx} decisions={decisions ?? []} ratings={ratings ?? []} />}
            {status === "completed" && <CompletedPhase ctx={ctx} decisions={decisions ?? []} report={report} />}
          </ScrollView>
        )}
        <NoticeBanner notice={notice} onDismiss={clear} />
      {/*
        * Leaving, with room to say why.
        *
        * A native alert would have been fewer lines, but it has nowhere to
        * type — and the website asks for a note here, so the phone doing
        * without one would make the same action mean two different things.
        */}
      <Sheet
        visible={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        title="Leave this sprint?"
        subtitle={sprint?.isPractice
          ? "This ends your practice sprint. The work stays here."
          : "A sprint is two people, so leaving ends it for both of you. Your partner will be told, and the work stays on the page."}
      >
        <View style={{ gap: spacing.md }}>
          {!sprint?.isPractice && (
            <Field
              label="Anything you'd like them to know? (optional)"
              value={leaveReason}
              onChangeText={setLeaveReason}
              placeholder="Work got busy this week…"
              multiline
              maxLength={500}
              testID="input-leave-reason"
            />
          )}
          <Btn
            label={leave.isPending ? "Leaving…" : "Leave sprint"}
            onPress={() => leave.mutate()}
            disabled={leave.isPending}
            variant="danger"
            testID="button-leave-confirm"
          />
          <Btn label="Stay" onPress={() => setLeaveOpen(false)} variant="ghost" testID="button-leave-cancel" />
        </View>
      </Sheet>
      </KeyboardAvoidingView>
    </>
  );
}

interface PhaseCtx {
  sprint: any; id: string; userId: string; partnerId: string; partner: any; me: any;
  show: ReturnType<typeof useNotice>["show"];
  fail: (e: unknown, fallback: string, retry?: () => void) => void;
  refresh: (...keys: string[]) => void;
  advance: () => void; advancing: boolean;
}

// ---------------------------------------------------------------- setup

function SetupPhase({ ctx }: { ctx: PhaseCtx }) {
  const { sprint, userId, partner, show, fail, refresh } = ctx;
  const isUser1 = sprint.user1Id === userId;
  const myProposal = isUser1 ? sprint.user1ProposedName : sprint.user2ProposedName;
  const partnerProposal = isUser1 ? sprint.user2ProposedName : sprint.user1ProposedName;
  const [name, setName] = useState(myProposal || "");
  const [useNova, setUseNova] = useState(false);

  const propose = useMutation({
    mutationFn: () => api(`/api/sprints/${sprint.id}/propose-name`, { method: "POST", body: { name: name.trim() } }),
    onSuccess: () => { refresh(""); show({ tone: "success", text: "Name proposed." }); },
    onError: (e) => { refresh(""); fail(e, "Couldn't propose that name."); },
  });
  const choose = useMutation({
    mutationFn: (idea: SprintIdea) => api<any>(`/api/sprints/${sprint.id}/choose-idea`, { method: "POST", body: { idea } }),
    onSuccess: (u) => { refresh(""); show({ tone: "success", text: `Locked in: you're building "${u.productName}".` }); },
    // A 409 means your partner locked one in first; the refresh shows theirs.
    onError: (e) => { refresh(""); fail(e, "Couldn't lock in that idea."); },
  });

  const chosen = !!sprint.productName;
  const agreed = chosen && !!sprint.user1ProposedName && sprint.user1ProposedName === sprint.user2ProposedName;
  const profile = (partner ?? {}) as { headline?: string; bio?: string; skills?: string[] };

  if (sprint.isPractice) {
    return (
      <>
        <PhaseHeading title="Practice sprint" body={`A practice ${sprint.duration} sprint with Nova as your AI co-founder. Go through every phase to get familiar with the process before a real one.`} />
        <TitledCard icon="hardware-chip-outline" title="Nova (AI partner)">
          <Text style={body}>Nova provides AI ideation responses, collaborates on alignment, and gives you feedback at the end. This sprint won't affect your real match history or reputation.</Text>
        </TitledCard>
        <ProductCard name={sprint.productName} description={sprint.productDescription} icon="sparkles" />
        <Btn label="Start practice sprint" icon="arrow-forward" loading={ctx.advancing} onPress={ctx.advance} />
      </>
    );
  }

  return (
    <>
      <PhaseHeading title="Meet your sprint partner" body={`You've been matched for a ${sprint.duration} co-founder trial sprint. Get to know your partner and agree on a product.`} />
      {partner && (
        <TitledCard title={`${partner.firstName ?? ""} ${partner.lastName ?? ""}`.trim() || "Your partner"}>
          <View style={{ flexDirection: "row", gap: spacing.md, alignItems: "center" }}>
            <Avatar name={partner.firstName} uri={partner.profileImageUrl} size={48} />
            <Text style={[body, { flex: 1 }]}>{profile.headline || "No headline yet"}</Text>
          </View>
          {profile.bio ? <Text style={[body, { color: colors.textSecondary }]}>{profile.bio}</Text> : null}
          {!!profile.skills?.length && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {profile.skills.slice(0, 6).map((s) => <Chip key={s} label={s} small />)}
            </View>
          )}
        </TitledCard>
      )}

      {!chosen ? (
        <TitledCard icon="create-outline" title="Agree on a product">
          <Text style={[body, { color: colors.textSecondary }]}>
            Each partner proposes a name independently; once both have, one is picked at random. Or let Nova pitch ideas — picking one settles it for both of you.
          </Text>
          {myProposal ? (
            <Callout tone="success" title={`Your proposal: ${myProposal}`} body={partnerProposal ? `Your partner proposed: ${partnerProposal}` : "Waiting for your partner to propose..."} />
          ) : (
            <>
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <Btn label="Propose a name" icon="create-outline" small variant={useNova ? "outline" : "primary"} style={{ flex: 1 }} onPress={() => setUseNova(false)} />
                <Btn label="Nova pitches" icon="sparkles" small variant={useNova ? "primary" : "outline"} style={{ flex: 1 }} onPress={() => setUseNova(true)} />
              </View>
              {useNova ? (
                <View style={{ gap: spacing.sm }}>
                  <Text style={meta}>Picking an idea here settles the product for both of you — no name coin-flip needed.</Text>
                  <SprintIdeaPicker productStyle={sprint.productStyle || "modern"} partnerId={partner?.id} onChoose={(idea) => choose.mutate(idea)} isSubmitting={choose.isPending} chooseLabel="Lock in" chosenName={sprint.productName} />
                </View>
              ) : (
                <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-end" }}>
                  <View style={{ flex: 1 }}><Field value={name} onChangeText={setName} placeholder="Enter a product name" /></View>
                  <Btn label="Propose" disabled={!name.trim()} loading={propose.isPending} onPress={() => propose.mutate()} />
                </View>
              )}
            </>
          )}
        </TitledCard>
      ) : (
        <ProductCard name={sprint.productName} description={sprint.productDescription} icon={agreed ? "sparkles" : "dice"}
          footnote={agreed ? "Chosen from Nova's pitches. This is your sprint project!" : `Randomly selected from both proposals. This is your sprint project!${sprint.user1ProposedName && sprint.user2ProposedName
            ? `\n${isUser1 ? "You" : partner?.firstName || "Partner"}: ${sprint.user1ProposedName}  vs  ${isUser1 ? partner?.firstName || "Partner" : "You"}: ${sprint.user2ProposedName}` : ""}`} />
      )}

      <Btn label="Start sprint" icon="arrow-forward" disabled={!chosen} loading={ctx.advancing} onPress={ctx.advance} />
      {!chosen && <Text style={[meta, { textAlign: "center" }]}>Both partners must propose a name (or lock in one of Nova's ideas) before you can start.</Text>}
    </>
  );
}

// ------------------------------------------------------------- ideation

function IdeationPhase({ ctx, myResponses, partnerResponded, responsesLoaded }: { ctx: PhaseCtx; myResponses: any[]; partnerResponded: boolean; responsesLoaded: boolean }) {
  const { sprint, fail, refresh } = ctx;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const answered = (k: string) => myResponses.find((r) => r.questionKey === k);
  const allDone = IDEATION_QUESTIONS.every((q) => answered(q.key));

  const submit = useMutation({
    mutationFn: async () => {
      for (const q of IDEATION_QUESTIONS) {
        const a = answers[q.key]?.trim();
        if (a && !answered(q.key)) await api(`/api/sprints/${sprint.id}/responses`, { method: "POST", body: { questionKey: q.key, answer: a } });
      }
    },
    onSuccess: () => refresh("responses"),
    onError: (e) => { refresh("responses"); fail(e, "Couldn't submit your responses."); },
  });

  return (
    <>
      <PhaseHeading title={sprint.isPractice ? "Practice ideation" : "Private ideation"}
        body={sprint.isPractice
          ? partnerResponded || !responsesLoaded
            ? "Answer on your own. Nova has already submitted its answers — you'll compare them in alignment."
            : "Answer on your own. You'll compare your answers with Nova's in the alignment phase."
          : "Answer independently. Your partner won't see your answers until the alignment phase."} />
      {sprint.isPractice && responsesLoaded && !partnerResponded && <NovaAnswersStatus ctx={ctx} />}
      {allDone ? (
        <TitledCard icon="checkmark-circle" tint={colors.success} title="Responses submitted">
          <Text style={[body, { color: colors.textSecondary }]}>
            {sprint.isPractice ? (partnerResponded ? "Your responses are in, and so are Nova's. Advance to compare them." : "Your responses are in. Advance to compare them with Nova's.")
              : partnerResponded ? "You and your partner have both submitted. You can move on to alignment."
              : "Waiting for your partner to submit their responses..."}
          </Text>
          <Btn label="Continue to alignment" icon="arrow-forward" loading={ctx.advancing} onPress={ctx.advance} />
        </TitledCard>
      ) : (
        <>
          {IDEATION_QUESTIONS.map((q, i) => {
            const existing = answered(q.key);
            return (
              <TitledCard key={q.key} icon="bulb-outline" tint={colors.warning} title={`${i + 1}. ${q.label}`}>
                {existing ? (
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    <Icon name="checkmark-circle" size={16} color={colors.success} />
                    <Text style={[body, { flex: 1 }]}>{existing.answer}</Text>
                  </View>
                ) : (
                  <Field value={answers[q.key] ?? ""} onChangeText={(v) => setAnswers({ ...answers, [q.key]: v })} placeholder={q.placeholder} multiline />
                )}
              </TitledCard>
            );
          })}
          <Btn label="Submit all responses" icon="send"
            disabled={IDEATION_QUESTIONS.some((q) => !answered(q.key) && !answers[q.key]?.trim())}
            loading={submit.isPending} onPress={() => submit.mutate()} />
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------ alignment

function AlignmentPhase({ ctx, myResponses, partnerResponses }: { ctx: PhaseCtx; myResponses: any[]; partnerResponses: any[] }) {
  const { sprint, me, partner, show, fail, refresh } = ctx;
  const [form, setForm] = useState({ agreedProblem: "", agreedIcp: "", agreedValueProp: "", validationQuestions: ["", "", ""] });
  useEffect(() => {
    setForm({
      agreedProblem: sprint.agreedProblem || "", agreedIcp: sprint.agreedIcp || "", agreedValueProp: sprint.agreedValueProp || "",
      validationQuestions: Array.isArray(sprint.validationQuestions) && sprint.validationQuestions.length ? sprint.validationQuestions : ["", "", ""],
    });
  }, [sprint.id, sprint.agreedProblem, sprint.agreedIcp, sprint.agreedValueProp]);

  const save = useMutation({
    mutationFn: () => api(`/api/sprints/${sprint.id}/update-alignment`, { method: "POST", body: form }),
    onSuccess: () => { refresh(""); show({ tone: "success", text: "Alignment saved." }); },
    onError: (e) => fail(e, "Couldn't save the alignment."),
  });

  return (
    <>
      <PhaseHeading title="Alignment" body="Compare your independent answers, then agree on shared definitions." />
      <Text style={h3}>Response comparison</Text>
      {IDEATION_QUESTIONS.map((q) => {
        const mine = myResponses.find((r) => r.questionKey === q.key)?.answer;
        const theirs = partnerResponses.find((r) => r.questionKey === (sprint.isPractice ? `nova_${q.key}` : q.key))?.answer;
        return (
          <TitledCard key={q.key} title={q.label}>
            <AnswerBlock who={me?.firstName || "You"} avatar={<Avatar name={me?.firstName || "You"} uri={me?.profileImageUrl} size={20} />} text={mine} />
            <AnswerBlock who={sprint.isPractice ? "Nova (AI)" : partner?.firstName || "Partner"}
              avatar={sprint.isPractice ? <NovaDot size={20} /> : <Avatar name={partner?.firstName || "Partner"} uri={partner?.profileImageUrl} size={20} />} text={theirs} tinted />
          </TitledCard>
        );
      })}

      <Text style={[h3, { marginTop: spacing.sm }]}>Collaborative alignment</Text>
      <TitledCard icon="alert-circle-outline" title="Agreed problem statement">
        <Field value={form.agreedProblem} onChangeText={(v) => setForm({ ...form, agreedProblem: v })} placeholder="What is the core problem you both agree on?" multiline />
      </TitledCard>
      <TitledCard icon="person-outline" title="Ideal customer profile (ICP)">
        <Field value={form.agreedIcp} onChangeText={(v) => setForm({ ...form, agreedIcp: v })} placeholder="Describe your ideal customer together..." multiline />
      </TitledCard>
      <TitledCard icon="diamond-outline" title="Value proposition">
        <Field value={form.agreedValueProp} onChangeText={(v) => setForm({ ...form, agreedValueProp: v })} placeholder="What unique value does your product provide?" multiline />
      </TitledCard>
      <TitledCard icon="help-circle-outline" title="3 validation questions">
        {form.validationQuestions.map((vq, i) => (
          <Field key={i} value={vq} placeholder={`Validation question ${i + 1}`}
            onChangeText={(v) => { const next = [...form.validationQuestions]; next[i] = v; setForm({ ...form, validationQuestions: next }); }} />
        ))}
      </TitledCard>
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Btn label="Save" variant="outline" style={{ flex: 1 }} loading={save.isPending} onPress={() => save.mutate()} />
        <Btn label="Continue to building" icon="arrow-forward" style={{ flex: 1.6 }} loading={ctx.advancing} onPress={ctx.advance} />
      </View>
    </>
  );
}

// ------------------------------------------------ building + validation

const VALIDATION_DELIVERABLES: { type: string; title: string; icon: IconName; placeholder: string }[] = [
  { type: "outreach_email", title: "Outreach email draft", icon: "mail-outline", placeholder: "Draft an outreach email to potential users..." },
  { type: "social_posts", title: "Social media posts", icon: "share-social-outline", placeholder: "Draft 2 community social media posts..." },
  { type: "interview_questions", title: "Interview questions", icon: "help-circle-outline", placeholder: "Write 4 interview questions (2 personal, 2 segmentation)..." },
  { type: "validation_questions", title: "Validation evidence", icon: "camera-outline", placeholder: "Summarize validation evidence — screenshots, interview notes, survey responses..." },
];

function WorkPhase({ ctx, tasks, deliverables }: { ctx: PhaseCtx; tasks: any[]; deliverables: any[] }) {
  const { sprint, userId, me, partner, show, fail, refresh } = ctx;
  const validation = sprint.status === "validation";
  const done = tasks.filter((t) => t.status === "done").length;
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const updateTask = useMutation({
    mutationFn: ({ taskId, data }: { taskId: string; data: any }) => api(`/api/sprints/${sprint.id}/tasks/${taskId}`, { method: "PATCH", body: data }),
    onSuccess: () => refresh("tasks"),
    onError: (e) => fail(e, "Couldn't update that task."),
  });
  const submit = useMutation({
    mutationFn: ({ type, text }: { type: string; text: string }) => api(`/api/sprints/${sprint.id}/deliverables`, { method: "POST", body: { type, content: { text } } }),
    onSuccess: (_r, v) => { setDrafts((d) => ({ ...d, [v.type]: "" })); refresh("deliverables"); show({ tone: "success", text: "Deliverable submitted." }); },
    onError: (e) => fail(e, "Couldn't submit that deliverable."),
  });

  const forms = validation ? VALIDATION_DELIVERABLES : [{ type: "brief", title: "Submit brief", icon: "document-text-outline" as IconName, placeholder: "Compile your product brief — problem statement, ICP, value proposition, validation questions, and any other findings..." }];

  return (
    <>
      <PhaseHeading title={validation ? "Validation (72h)" : "Building"} body={validation ? "Validate the idea with real outreach and evidence." : "Complete the guided tasks and submit your deliverables."} />
      <TitledCard icon="list" title="Task board" action={<Text style={meta}>{done}/{tasks.length} done</Text>}>
        <Progress value={tasks.length ? (done / tasks.length) * 100 : 0} />
        {KANBAN.map((col) => {
          const list = tasks.filter((t) => t.status === col.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
          return (
            <View key={col.id} style={{ gap: 6, marginTop: spacing.xs }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Icon name={col.icon} size={14} color={col.id === "done" ? colors.success : colors.textSecondary} />
                <Text style={[meta, { fontFamily: fontFamily.semibold, color: colors.text }]}>{col.label}</Text>
                <Text style={meta}>{list.length}</Text>
              </View>
              {list.length === 0 && <Text style={[meta, { paddingLeft: 20 }]}>No tasks</Text>}
              {list.map((t) => {
                const assignee = t.assigneeId === userId ? me : t.assigneeId ? partner : null;
                return (
                  <View key={t.id} style={{ borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, gap: 6, backgroundColor: col.id === "done" ? colors.surfaceRaised : colors.surface }}>
                    <Text style={[body, { fontFamily: fontFamily.medium, textDecorationLine: col.id === "done" ? "line-through" : "none" }]}>{t.title}</Text>
                    {t.description && !validation ? <Text style={[meta, { lineHeight: 16 }]}>{t.description}</Text> : null}
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      {t.assigneeId ? <Avatar name={assignee?.firstName || (sprint.isPractice ? "Nova" : "Partner")} uri={assignee?.profileImageUrl} size={20} /> : null}
                      <View style={{ flex: 1 }} />
                      {!t.assigneeId && <Btn label="Claim" icon="person-outline" small variant="outline" onPress={() => updateTask.mutate({ taskId: t.id, data: { assigneeId: userId } })} />}
                      {col.id !== "todo" && <Btn label="Back" small variant="ghost" onPress={() => updateTask.mutate({ taskId: t.id, data: { status: col.id === "done" ? "in-progress" : "todo" } })} />}
                      {col.id !== "done" && <Btn label={col.id === "todo" ? "Start" : "Done"} small variant={col.id === "todo" ? "outline" : "primary"} onPress={() => updateTask.mutate({ taskId: t.id, data: { status: col.id === "todo" ? "in-progress" : "done" } })} />}
                    </View>
                  </View>
                );
              })}
            </View>
          );
        })}
      </TitledCard>

      {forms.map((f) => {
        const submitted = deliverables.filter((d) => d.type === f.type);
        const text = drafts[f.type] ?? "";
        return (
          <TitledCard key={f.type} icon={f.icon} title={f.title}>
            <Field value={text} onChangeText={(v) => setDrafts({ ...drafts, [f.type]: v })} placeholder={f.placeholder} multiline />
            <Btn label="Submit" icon="send" small style={{ alignSelf: "flex-start" }} disabled={!text.trim()}
              loading={submit.isPending && submit.variables?.type === f.type} onPress={() => submit.mutate({ type: f.type, text: text.trim() })} />
            {submitted.length > 0 && (
              <View style={{ gap: 6 }}>
                <Text style={[meta, { fontFamily: fontFamily.semibold }]}>Submitted</Text>
                {submitted.map((d) => (
                  <Text key={d.id} style={[body, { backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, padding: spacing.sm }]}>{d.content?.text ?? JSON.stringify(d.content)}</Text>
                ))}
              </View>
            )}
          </TitledCard>
        );
      })}

      <Btn label={validation || sprint.duration === "24h" ? "Continue to review" : "Continue to validation"} icon="arrow-forward" loading={ctx.advancing} onPress={ctx.advance} />
    </>
  );
}

// --------------------------------------------------------------- review

function ReviewPhase({ ctx, decisions, ratings }: { ctx: PhaseCtx; decisions: any[]; ratings: any[] }) {
  const { sprint, userId, partnerId, show, fail, refresh } = ctx;
  const isPractice = sprint.isPractice;
  const [ratedHere, setRatedHere] = useState(false);
  useEffect(() => {
    readPref(ratedKey(sprint.id)).then((v) => { if (v) setRatedHere(true); }).catch(() => {});
  }, [sprint.id]);
  const [decision, setDecision] = useState("");
  const [reason, setReason] = useState("");
  const [rating, setRating] = useState({ communicationClarity: 3, reliability: 3, wouldBuildLongTerm: false, stressLevel: 3 });

  const novaDecision = isPractice ? decisions.find((d) => d.reason?.startsWith(NOVA_PREFIX)) : null;
  const myDecision = isPractice ? decisions.find((d) => d.userId === userId && !d.reason?.startsWith(NOVA_PREFIX)) : decisions.find((d) => d.userId === userId);
  const partnerDecision = isPractice ? novaDecision : decisions.find((d) => d.userId !== userId);
  const myRating = ratings.find((r) => r.raterId === userId) ?? (ratedHere ? { raterId: userId } : undefined);
  const bothSubmitted = isPractice ? !!myDecision && !!myRating : !!myDecision && !!myRating && !!partnerDecision;

  const sendDecision = useMutation({
    mutationFn: () => api(`/api/sprints/${sprint.id}/decisions`, { method: "POST", body: { decision, reason } }),
    onSuccess: () => { refresh("decisions"); show({ tone: "success", text: "Decision submitted." }); },
    onError: (e) => fail(e, "Couldn't submit your decision."),
  });
  const sendRating = useMutation({
    mutationFn: () => api(`/api/sprints/${sprint.id}/ratings`, { method: "POST", body: { rateeId: partnerId, ...rating } }),
    onSuccess: () => {
      setRatedHere(true);
      writePref(ratedKey(sprint.id), "1").catch(() => {});
      refresh("ratings");
      show({ tone: "success", text: "Rating submitted." });
    },
    onError: (e) => fail(e, "Couldn't submit your rating."),
  });

  return (
    <>
      <PhaseHeading title="Review" body={isPractice ? "Submit your decision and rate the practice experience." : "Submit your decision and rate your partner privately."} />

      <TitledCard icon="locate-outline" title="Your decision">
        {myDecision ? (
          <>
            <Pill label={DECISION_LABEL[myDecision.decision] ?? myDecision.decision} color={DECISION_COLOR[myDecision.decision]} solid />
            <Text style={body}>{myDecision.reason}</Text>
            <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
              <Icon name="checkmark-circle" size={14} color={colors.success} /><Text style={[meta, { color: colors.success }]}>Decision submitted</Text>
            </View>
          </>
        ) : (
          <>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              {([
                { value: "proceed", label: "Proceed", icon: "thumbs-up-outline", body: "Continue building together" },
                { value: "pivot", label: "Pivot", icon: "warning-outline", body: "Change direction" },
                { value: "kill", label: "Kill", icon: "thumbs-down-outline", body: "Stop this project" },
              ] as const).map((o) => (
                <OptionCard key={o.value} compact icon={o.icon} title={o.label} body={o.body} selected={decision === o.value} onPress={() => setDecision(o.value)} style={{ flex: 1, paddingHorizontal: 6 }} />
              ))}
            </View>
            <Field value={reason} onChangeText={setReason} placeholder="Explain your reasoning..." multiline />
            <Btn label="Submit decision" icon="send" disabled={!decision || !reason.trim()} loading={sendDecision.isPending} onPress={() => sendDecision.mutate()} />
          </>
        )}
      </TitledCard>

      <TitledCard icon="star-outline" title={isPractice ? "Rate the experience" : "Rate your partner"}>
        {myRating ? (
          <Callout tone="success" title="Rating submitted" body="Your rating has been recorded privately." />
        ) : (
          <>
            <Stars label="Communication clarity" value={rating.communicationClarity} onChange={(v) => setRating({ ...rating, communicationClarity: v })} />
            <Stars label="Reliability" value={rating.reliability} onChange={(v) => setRating({ ...rating, reliability: v })} />
            <Stars label="Stress level" value={rating.stressLevel} onChange={(v) => setRating({ ...rating, stressLevel: v })} />
            <Text style={[body, { fontFamily: fontFamily.medium }]}>Would you build long-term with this person?</Text>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <Btn label="Yes" icon="thumbs-up-outline" small variant={rating.wouldBuildLongTerm ? "primary" : "outline"} style={{ flex: 1 }} onPress={() => setRating({ ...rating, wouldBuildLongTerm: true })} />
              <Btn label="No" icon="thumbs-down-outline" small variant={!rating.wouldBuildLongTerm ? "primary" : "outline"} style={{ flex: 1 }} onPress={() => setRating({ ...rating, wouldBuildLongTerm: false })} />
            </View>
            <Btn label="Submit rating" icon="send" loading={sendRating.isPending} onPress={() => sendRating.mutate()} />
          </>
        )}
      </TitledCard>

      {!isPractice && !bothSubmitted && (myDecision || myRating) && (
        <Callout icon="hourglass-outline" body="Waiting for your partner to submit their decision and rating...">
          <ActivityIndicator color={colors.primary} size="small" style={{ alignSelf: "flex-start", marginTop: 4 }} />
        </Callout>
      )}
      {bothSubmitted && <Btn label="Complete sprint" icon="checkmark-done" loading={ctx.advancing} onPress={ctx.advance} />}
    </>
  );
}

function Stars({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={[body, { fontFamily: fontFamily.medium }]}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <IconButton key={i} name={i <= value ? "star" : "star-outline"} size={26} color={i <= value ? colors.primary : colors.textTertiary} label={`${i} of 5`} onPress={() => onChange(i)} />
        ))}
        <Text style={[meta, { marginLeft: 6 }]}>{value}/5</Text>
      </View>
    </View>
  );
}

// ------------------------------------------------------------ completed

function CompletedPhase({ ctx, decisions, report }: { ctx: PhaseCtx; decisions: any[]; report: any }) {
  const { sprint, userId, me, partner, show, fail, refresh } = ctx;
  const router = useRouter();
  const qc = useQueryClient();
  const novaDecision = sprint.isPractice ? decisions.find((d) => d.reason?.startsWith(NOVA_PREFIX)) : null;
  const myDecision = sprint.isPractice ? decisions.find((d) => d.userId === userId && !d.reason?.startsWith(NOVA_PREFIX)) : decisions.find((d) => d.userId === userId);
  const partnerDecision = sprint.isPractice ? novaDecision : decisions.find((d) => d.userId !== userId);
  const bothProceeded = myDecision?.decision === "proceed" && partnerDecision?.decision === "proceed";

  const generate = useMutation({
    mutationFn: () => api(`/api/sprints/${sprint.id}/generate-report`, { method: "POST" }),
    onSuccess: () => { refresh("report", ""); qc.invalidateQueries({ queryKey: ["subscription"] }); show({ tone: "success", text: "Compatibility report generated." }); },
    onError: (e) => fail(e, "Couldn't generate the report."),
  });
  const convert = useMutation({
    mutationFn: () => api<any>(`/api/sprints/${sprint.id}/convert`, { method: "POST" }),
    // The server answers with the project itself (the web reads `project.id`, which isn't there).
    onSuccess: (r) => {
      const projectId = r?.id ?? r?.project?.id;
      qc.invalidateQueries({ queryKey: ["projects"] });
      if (projectId) router.replace(`/project/${projectId}`);
      else show({ tone: "success", text: "Sprint converted to a project." });
    },
    onError: (e) => fail(e, "Couldn't convert to a project."),
  });

  const score = report?.overallScore ?? 0;
  const scoreColor = score >= 70 ? colors.success : score >= 40 ? colors.warning : colors.danger;

  return (
    <>
      <View style={{ alignItems: "center", gap: 6, paddingVertical: spacing.sm }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: tintSoft(colors.success), alignItems: "center", justifyContent: "center" }}>
          <Icon name="checkmark-circle" size={32} color={colors.success} />
        </View>
        <Text style={h2}>Sprint complete!</Text>
        <Text style={[meta, { textAlign: "center" }]}>{sprint.isPractice ? "Here's the summary of your practice sprint." : "Here's the summary of your collaboration."}</Text>
      </View>

      <TitledCard icon="locate-outline" title="Decisions">
        {[
          { who: me?.firstName || "You", label: "Your decision", d: myDecision, avatar: <Avatar name={me?.firstName || "You"} uri={me?.profileImageUrl} size={32} /> },
          { who: sprint.isPractice ? "Nova (AI)" : partner?.firstName || "Partner", label: sprint.isPractice ? "Nova's decision" : "Partner's decision", d: partnerDecision,
            avatar: sprint.isPractice ? <NovaDot size={32} /> : <Avatar name={partner?.firstName || "Partner"} uri={partner?.profileImageUrl} size={32} /> },
        ].map((row) => (
          <View key={row.label} style={{ flexDirection: "row", gap: spacing.sm, paddingVertical: 6 }}>
            {row.avatar}
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[body, { fontFamily: fontFamily.semibold }]}>{row.who} — {row.label}</Text>
              {row.d ? (
                <>
                  <Pill label={DECISION_LABEL[row.d.decision] ?? row.d.decision} color={DECISION_COLOR[row.d.decision]} solid />
                  <Text style={[body, { color: colors.textSecondary }]}>{String(row.d.reason ?? "").replace(NOVA_PREFIX, "").trim()}</Text>
                </>
              ) : <Text style={meta}>No decision submitted</Text>}
            </View>
          </View>
        ))}
      </TitledCard>

      <TitledCard icon="shield-checkmark-outline" title="Compatibility report">
        {report ? (
          <>
            <View style={{ alignItems: "center", gap: 4, paddingVertical: spacing.sm }}>
              <View style={{ width: 84, height: 84, borderRadius: 42, borderWidth: 5, borderColor: scoreColor, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontSize: 28, fontFamily: fontFamily.bold, color: colors.text }}>{score}</Text>
              </View>
              <Text style={meta}>Compatibility score</Text>
            </View>
            {Array.isArray(report.strengths) && report.strengths.length > 0 && (
              <ReportList title="Strengths" icon="trending-up" color={colors.success} items={report.strengths} />
            )}
            {Array.isArray(report.risks) && report.risks.length > 0 && (
              <ReportList title="Risks" icon="warning-outline" color={colors.warning} items={report.risks} />
            )}
            {report.recommendation ? (
              <View style={{ gap: 4 }}>
                <Text style={h3}>Recommendation</Text>
                <Text style={[body, { color: colors.textSecondary }]}>{report.recommendation}</Text>
              </View>
            ) : null}
          </>
        ) : (
          <View style={{ alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm }}>
            <Icon name="sparkles" size={28} color={colors.primary} />
            <Text style={[meta, { textAlign: "center" }]}>Generate an AI compatibility report from your sprint data.</Text>
            <Btn label={`Generate report (${credits(SPRINT_CREDIT_COSTS.sprintReport)})`} icon="sparkles" loading={generate.isPending} onPress={() => generate.mutate()} />
          </View>
        )}
      </TitledCard>

      {bothProceeded && !sprint.isPractice && (
        <Callout icon="rocket" tone="success" title="Both of you want to proceed!" body="Convert this sprint into a full project and start building together.">
          <Btn label="Convert to a real project" icon="people" small style={{ alignSelf: "flex-start", marginTop: 6 }} loading={convert.isPending} onPress={() => convert.mutate()} />
        </Callout>
      )}
      {sprint.isPractice && (
        <Callout icon="school" title="Practice sprint complete!" body="Great job completing this practice sprint! You've gone through all the phases of a real co-founder collaboration. When you're ready, try a real sprint with a matched partner.">
          <Btn label="Start a real sprint" small style={{ alignSelf: "flex-start", marginTop: 6 }} onPress={() => router.push("/sprint/new")} />
        </Callout>
      )}
    </>
  );
}

function ReportList({ title, icon, color, items }: { title: string; icon: IconName; color: string; items: any[] }) {
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name={icon} size={15} color={color} /><Text style={h3}>{title}</Text>
      </View>
      {items.map((s, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 6 }}>
          <Icon name={icon === "trending-up" ? "checkmark-circle" : "alert-circle"} size={14} color={color} />
          <Text style={[body, { flex: 1 }]}>{String(s)}</Text>
        </View>
      ))}
    </View>
  );
}

// ----------------------------------------------------------------- chat

function SprintChat({ ctx, messages }: { ctx: PhaseCtx; messages: any[] }) {
  const { sprint, id, userId, fail, refresh } = ctx;
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const scroller = useRef<ScrollView>(null);

  // Nova answering as the practice partner. Costs a credit per reply.
  const novaReply = useMutation({
    mutationFn: () => api(`/api/sprints/${id}/nova-reply`, { method: "POST" }),
    onSuccess: () => { refresh("messages"); qc.invalidateQueries({ queryKey: ["subscription"] }); },
    onError: (e) => fail(e, "Nova couldn't reply right now.", () => novaReply.mutate()),
  });
  const send = useMutation({
    mutationFn: (content: string) => api(`/api/sprints/${id}/messages`, { method: "POST", body: { content } }),
    onSuccess: () => { setText(""); refresh("messages"); if (sprint.isPractice) novaReply.mutate(); },
    onError: (e) => fail(e, "Couldn't send that."),
  });

  return (
    <View style={{ flex: 1 }}>
      <ScrollView ref={scroller} onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
        contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, flexGrow: 1 }}>
        {messages.length === 0 && (
          <Empty icon="chatbubbles-outline" title="No messages yet" body={sprint.isPractice ? "Start the conversation! Talk to Nova about the product — Nova replies as your partner." : "Start the conversation!"} />
        )}
        {messages.map((m) => {
          // In a practice sprint Nova shares the human's userId, so isNova decides the side.
          const isNova = m.isNova === true;
          const mine = !isNova && m.userId === userId;
          return (
            <View key={m.id} style={{ flexDirection: "row", justifyContent: mine ? "flex-end" : "flex-start", gap: 6 }}>
              {!mine && (isNova ? <NovaDot size={26} /> : <Avatar name={m.user?.firstName || "Partner"} uri={m.user?.profileImageUrl} size={26} />)}
              <View style={{
                maxWidth: "78%", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, gap: 2,
                backgroundColor: mine ? colors.primary : colors.surface,
                borderWidth: mine ? 0 : 1, borderColor: isNova ? tintSoft(colors.primary, 0.35) : colors.border,
                borderBottomRightRadius: mine ? 4 : 16, borderBottomLeftRadius: mine ? 16 : 4,
              }}>
                {!mine && <Text style={{ fontSize: font.xs, fontFamily: fontFamily.semibold, color: isNova ? colors.primary : colors.textSecondary }}>{isNova ? "Nova" : m.user?.firstName || "Partner"}</Text>}
                <Text style={{ color: mine ? colors.primaryText : colors.text, fontSize: font.base, lineHeight: 21, fontFamily: fontFamily.regular }}>{isNova ? plain(String(m.content ?? "")) : m.content}</Text>
              </View>
            </View>
          );
        })}
        {novaReply.isPending && (
          <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
            <NovaDot size={26} /><Text style={meta}>Nova is thinking…</Text>
          </View>
        )}
      </ScrollView>
      <View style={{ backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm + insets.bottom, gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.sm }}>
          <TextInput value={text} onChangeText={setText} multiline placeholderTextColor={colors.textTertiary}
            placeholder={sprint.isPractice ? "Talk to Nova about the product…" : "Message your partner…"}
            style={{ flex: 1, maxHeight: 110, backgroundColor: colors.surfaceRaised, borderRadius: 20, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, color: colors.text, fontSize: font.base, fontFamily: fontFamily.regular }} />
          <Pressable disabled={!text.trim() || send.isPending} onPress={() => send.mutate(text.trim())} accessibilityLabel="Send"
            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: text.trim() ? colors.primary : colors.surfaceRaised, alignItems: "center", justifyContent: "center" }}>
            <Icon name="send" size={18} color={text.trim() ? "#FFFFFF" : colors.textTertiary} />
          </Pressable>
        </View>
        {sprint.isPractice && <Text style={[meta, { fontSize: font.xs }]}>Nova replies as your partner · {credits(SPRINT_CREDIT_COSTS.novaPartnerReply)} per reply</Text>}
      </View>
    </View>
  );
}

// ------------------------------------------------- nova's practice answers

/**
 * On a practice sprint Nova's ideation answers are written in the background
 * when the phase opens, and silently skipped when the builder was short on
 * credits. Say which it is, and offer to ask again rather than leaving an
 * alignment phase with nothing to compare against.
 */
function NovaAnswersStatus({ ctx }: { ctx: PhaseCtx }) {
  const { sprint, show, fail, refresh } = ctx;
  const qc = useQueryClient();
  const [, tick] = useState(0);
  const openedAt = sprint.startedAt ? new Date(sprint.startedAt).getTime() : 0;
  const writing = openedAt > 0 && Date.now() - openedAt < NOVA_ANSWER_GRACE_MS;
  useEffect(() => {
    if (!writing) return;
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, [writing]);

  const ask = useMutation({
    mutationFn: () => api(`/api/sprints/${sprint.id}/nova-answers`, { method: "POST", body: { questionKeys: IDEATION_QUESTIONS.map((q) => q.key) } }),
    onSuccess: () => { refresh("responses"); qc.invalidateQueries({ queryKey: ["subscription"] }); show({ tone: "success", text: "Nova's answers are in." }); },
    onError: (e) => fail(e, "Nova couldn't answer right now."),
  });

  if (writing && !ask.isPending) {
    return (
      <Callout icon="sparkles" title="Nova is writing its answers…" body="They'll be ready to compare in the alignment phase.">
        <ActivityIndicator color={colors.primary} size="small" style={{ alignSelf: "flex-start", marginTop: 4 }} />
      </Callout>
    );
  }
  return (
    <Callout tone="warn" icon="hardware-chip-outline" title="Nova hasn't answered yet"
      body="Nova's answers didn't come through — usually because there weren't enough credits when this phase opened. Without them there's nothing to compare in alignment.">
      <Btn label={`Ask Nova to answer (${credits(SPRINT_CREDIT_COSTS.novaPartnerAnswers)})`} icon="sparkles" small style={{ alignSelf: "flex-start", marginTop: 6 }}
        loading={ask.isPending} onPress={() => ask.mutate()} />
    </Callout>
  );
}

// -------------------------------------------------------------- bits

function PhaseHeading({ title, body: text }: { title: string; body: string }) {
  return (
    <View style={{ gap: 2, paddingHorizontal: 2 }}>
      <Text style={h2}>{title}</Text>
      <Text style={[meta, { lineHeight: 19 }]}>{text}</Text>
    </View>
  );
}

function ProductCard({ name, description, icon, footnote }: { name: string; description?: string; icon: IconName; footnote?: string }) {
  return (
    <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: tintSoft(colors.primary, 0.4), backgroundColor: "#FCF8FE", padding: spacing.lg, alignItems: "center", gap: 6 }}>
      <Icon name={icon} size={26} color={colors.primary} />
      <Text style={{ color: colors.text, fontSize: font.xl, fontFamily: fontFamily.bold, textAlign: "center" }}>{name}</Text>
      {description ? <Text style={[body, { color: colors.textSecondary, textAlign: "center" }]}>{description}</Text> : null}
      {footnote ? <Text style={[meta, { textAlign: "center" }]}>{footnote}</Text> : null}
    </View>
  );
}

function AnswerBlock({ who, avatar, text, tinted }: { who: string; avatar: React.ReactNode; text?: string; tinted?: boolean }) {
  return (
    <View style={{ borderRadius: radius.sm, padding: spacing.sm, gap: 4, backgroundColor: tinted ? colors.primarySoft : colors.surfaceRaised }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {avatar}<Text style={[meta, { fontFamily: fontFamily.semibold, color: colors.text }]}>{who}</Text>
      </View>
      <Text style={[body, !text && { color: colors.textTertiary, fontStyle: "italic" }]}>{text || "No response"}</Text>
    </View>
  );
}

function NovaDot({ size }: { size: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
      <Icon name="hardware-chip-outline" size={size * 0.55} color={colors.primary} />
    </View>
  );
}

const h2 = { color: colors.text, fontSize: font.lg, fontFamily: fontFamily.bold } as const;
const h3 = { color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold } as const;
const body = { color: colors.text, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular } as const;
const meta = { color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.regular } as const;
