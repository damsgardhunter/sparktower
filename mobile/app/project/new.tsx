import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, readPref, writePref } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";
import { useEntitlementsQuery } from "../../src/hooks/useEntitlements";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import { Btn, ErrorNote, Field, Icon, Meta, NovaGradient, Row, errText, plain } from "../../src/components/ui";
import { ChoicePills } from "../../src/components/ProjectFormSheet";
import {
  AVAILABLE_ROLES, GOAL_ICONS, NEW_PROJECT_STEPS, PROJECT_CATEGORIES, PROJECT_GOALS, PROJECT_SUBCATEGORIES, STEP_LABELS,
  isValidSubcategory, projectGoal, subcategoryQuestion, type NewProjectStep, type ProjectGoal,
} from "../../src/projectData";

interface Draft {
  title: string;
  oneLiner: string;
  description: string;
  category: string;
  goal: ProjectGoal | "";
  subcategory: string;
  soloMode: boolean;
  isPrivate: boolean;
  teamSize: string;
  estimatedWeeks: string;
  rolesNeeded: string[];
  techStack: string[];
  repoUrl: string;
  liveUrl: string;
}

const EMPTY: Draft = {
  title: "", oneLiner: "", description: "", category: "", goal: "", subcategory: "", soloMode: false, isPrivate: false,
  teamSize: "1", estimatedWeeks: "4", rolesNeeded: [], techStack: [], repoUrl: "", liveUrl: "",
};

interface Message { role: "user" | "assistant"; content: string }

/** `oldName` replaced by `newName` as a whole word, any case — shared/project-draft.ts, simplified for Hermes. */
function renameInText(text: string, oldName: string, newName: string): string {
  const from = oldName.trim(); const to = newName.trim();
  if (!text || !from || !to || from.toLowerCase() === to.toLowerCase()) return text;
  return text.replace(new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), to);
}

/**
 * Create a project — the web's stepper (client/src/pages/project-create.tsx):
 * set it up (with Nova if you like), choose the goal, choose the kind, review.
 * Goal and kind are validated as a pair, here and on the server. Creating it
 * lands the owner in the project manager, where Nova's path for that goal is
 * already waiting.
 */
export default function NewProject() {
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { canCreatePrivate, privateLimit } = useEntitlementsQuery();
  const scroll = useRef<ScrollView>(null);

  const [step, setStep] = useState<NewProjectStep>("setup");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [edited, setEdited] = useState<string[]>([]);
  const [novaTitles, setNovaTitles] = useState<string[]>([]);
  const [showDetails, setShowDetails] = useState(false);
  const [techInput, setTechInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Nova, optional: describe the idea and it fills in what you haven't typed.
  const [novaOpen, setNovaOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [novaInput, setNovaInput] = useState("");

  /*
   * A per-user draft, restored once and saved as you type — someone who backs
   * out to check something finds their work when they come back. Cleared when
   * the project is created.
   */
  const draftKey = user?.id ? `new-project-draft.${user.id}` : null;
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (!draftKey || restored) return;
    readPref(draftKey).then((raw) => {
      try {
        if (raw) {
          const d = JSON.parse(raw);
          if (d?.draft) setDraft({ ...EMPTY, ...d.draft });
          if (Array.isArray(d?.edited)) setEdited(d.edited);
        }
      } catch { /* a corrupt draft isn't worth a crash */ }
      setRestored(true);
    }).catch(() => setRestored(true));
  }, [draftKey, restored]);
  useEffect(() => {
    if (!draftKey || !restored) return;
    const t = setTimeout(() => { void writePref(draftKey, JSON.stringify({ draft, edited })).catch(() => {}); }, 400);
    return () => clearTimeout(t);
  }, [draftKey, restored, draft, edited]);

  const edit = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setEdited((e) => (e.includes(key) ? e : [...e, key]));
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const chat = useMutation({
    mutationFn: (message: string) => api<{ reply: string; projectUpdates?: Record<string, any> | null }>("/api/chat", {
      method: "POST",
      body: {
        message,
        history: messages,
        currentProject: { title: draft.title, description: draft.description, category: draft.category, goal: draft.goal, subcategory: draft.subcategory },
        edited,
      },
    }),
    onSuccess: (data) => {
      setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
      const u = { ...(data.projectUpdates || {}) };
      if (!Object.keys(u).length) return;
      for (const k of edited) delete u[k];
      if (typeof u.title === "string" && u.title.trim()) setNovaTitles((t) => (t.includes(u.title) ? t : [...t, u.title.trim()]));
      setDraft((d) => {
        const next = { ...d };
        for (const k of ["title", "description", "category", "repoUrl", "liveUrl"] as const) if (typeof u[k] === "string") next[k] = u[k];
        if (typeof u.goal === "string" && PROJECT_GOALS.some((g) => g.id === u.goal)) next.goal = u.goal as ProjectGoal;
        if (typeof u.subcategory === "string") next.subcategory = u.subcategory;
        if (!isValidSubcategory(next.goal, next.subcategory)) next.subcategory = "";
        if (Array.isArray(u.techStack)) next.techStack = u.techStack.map(String);
        if (typeof u.estimatedWeeks === "number") next.estimatedWeeks = String(u.estimatedWeeks);
        // Nova doesn't know about Solo Builder Mode; don't let it recruit behind the builder's back.
        if (!d.soloMode) {
          if (Array.isArray(u.rolesNeeded)) next.rolesNeeded = u.rolesNeeded.map(String);
          if (typeof u.teamSize === "number") next.teamSize = String(u.teamSize);
        }
        return next;
      });
      void qc.invalidateQueries({ queryKey: ["subscription"] });
    },
    onError: (e: any) => {
      const out = /credit|403|402/i.test(String(e?.message)) ;
      setMessages((m) => [...m, { role: "assistant", content: out ? "You've run out of AI credits for this month. Upgrade on the Pricing page to keep going — or fill the form in yourself." : errText(e, "Nova couldn't answer just now. Try again.") }]);
    },
  });

  const sendNova = () => {
    const text = novaInput.trim();
    if (!text || chat.isPending) return;
    setMessages((m) => [...m, { role: "user", content: text }]);
    setNovaInput("");
    chat.mutate(text);
  };

  const create = useMutation({
    mutationFn: () => {
      const name = draft.title.trim();
      let description = draft.description.trim();
      for (const old of novaTitles) description = renameInText(description, old, name);
      return api<any>("/api/projects", {
        method: "POST",
        body: {
          title: name,
          oneLiner: draft.oneLiner.trim() || undefined,
          description,
          category: draft.category || "Other",
          goal: draft.goal,
          subcategory: draft.subcategory,
          status: "planning",
          soloMode: draft.soloMode,
          isPrivate: draft.isPrivate,
          teamSize: draft.soloMode ? 1 : Math.max(1, Number(draft.teamSize) || 1),
          estimatedWeeks: Math.max(1, Number(draft.estimatedWeeks) || 4),
          rolesNeeded: draft.soloMode ? [] : draft.rolesNeeded,
          techStack: draft.techStack,
          repoUrl: draft.repoUrl.trim() || undefined,
          liveUrl: draft.liveUrl.trim() || undefined,
        },
      });
    },
    onSuccess: (p) => {
      if (draftKey) void writePref(draftKey, null).catch(() => {});
      void qc.invalidateQueries({ queryKey: ["my-projects"] });
      void qc.invalidateQueries({ queryKey: ["projects"] });
      void qc.invalidateQueries({ queryKey: ["next-steps"] });
      // Nova-first: the owner's path starts in the manager.
      router.replace(`/manage/${p.id}` as any);
    },
    onError: (e) => setError(errText(e, "Couldn't create the project.")),
  });

  const index = NEW_PROJECT_STEPS.indexOf(step);
  const canNext =
    step === "setup" ? draft.title.trim().length > 0 && draft.description.trim().length > 0
    : step === "goal" ? !!draft.goal
    : step === "subcategory" ? isValidSubcategory(draft.goal, draft.subcategory)
    : !!draft.title.trim() && !!draft.description.trim() && isValidSubcategory(draft.goal, draft.subcategory);
  const go = (to: NewProjectStep) => { setError(null); setStep(to); scroll.current?.scrollTo({ y: 0, animated: false }); };

  return (
    <>
      <Stack.Screen options={{ title: "New project" }} />
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        {/* The stepper: done steps can be revisited, later ones wait. */}
        <View style={s.stepper}>
          {NEW_PROJECT_STEPS.map((id, i) => {
            const done = i < index; const current = i === index;
            return (
              <Pressable key={id} disabled={!done} onPress={() => go(id)} style={s.stepItem}>
                <View style={[s.stepDot, done && s.stepDone, current && s.stepCurrent]}>
                  {done ? <Icon name="checkmark" size={13} color={colors.primary} /> : <Text style={[s.stepNum, current && { color: "#FFFFFF" }]}>{i + 1}</Text>}
                </View>
                <Text style={[s.stepLabel, current && { color: colors.text, fontFamily: fontFamily.semibold }]}>{STEP_LABELS[id]}</Text>
                {i < NEW_PROJECT_STEPS.length - 1 && <View style={[s.stepLine, done && { backgroundColor: colors.primary }]} />}
              </Pressable>
            );
          })}
        </View>

        <ScrollView ref={scroll} contentContainerStyle={{ paddingBottom: spacing.xxl, gap: spacing.sm, paddingTop: spacing.sm }} keyboardShouldPersistTaps="handled">
          {step === "setup" && (
            <>
              <View style={s.block}>
                <NovaGradient style={s.bar} />
                <Text style={s.h}>What are you building?</Text>
                <Meta style={{ fontSize: font.sm, marginTop: -6 }}>A name and a couple of sentences is enough. You can refine everything later.</Meta>
                <Field label="Project name *" value={draft.title} onChangeText={(v) => edit("title", v)} placeholder="StudyBuddy Match" maxLength={120} />
                <Field label="Description *" value={draft.description} onChangeText={(v) => edit("description", v)} multiline placeholder="What are you building, and who is it for?" />
                <Field label="One-liner (optional)" value={draft.oneLiner} onChangeText={(v) => edit("oneLiner", v)} placeholder="Find the right study partner in minutes." maxLength={160} />
              </View>

              {/* Nova — the web's left pane, folded into a card on the phone. */}
              <View style={s.block}>
                <Pressable onPress={() => setNovaOpen((o) => !o)} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                  <NovaGradient style={s.novaAvatar}><Icon name="hardware-chip-outline" size={18} color="#FFFFFF" /></NovaGradient>
                  <View style={{ flex: 1 }}>
                    <Text style={s.novaTitle}>Shape it with Nova</Text>
                    <Meta style={{ fontSize: font.sm }}>Describe the idea; Nova suggests a name, goal, stack and roles. Uses AI credits.</Meta>
                  </View>
                  <Icon name={novaOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.textTertiary} />
                </Pressable>
                {novaOpen && (
                  <View style={{ gap: spacing.sm }}>
                    {messages.length === 0 && (
                      <View style={s.bubbleNova}><Text style={s.bubbleText}>Hey! I'm Nova, your AI project partner. What kind of project are you thinking about building?</Text></View>
                    )}
                    {messages.slice(-6).map((m, i) => (
                      <View key={i} style={m.role === "user" ? s.bubbleUser : s.bubbleNova}>
                        <Text style={[s.bubbleText, m.role === "user" && { color: "#FFFFFF" }]}>{plain(m.content)}</Text>
                      </View>
                    ))}
                    {chat.isPending && <View style={s.bubbleNova}><Text style={[s.bubbleText, { color: colors.textTertiary }]}>Nova is thinking…</Text></View>}
                    <Row gap={spacing.sm} style={{ alignItems: "flex-end" }}>
                      <TextInput value={novaInput} onChangeText={setNovaInput} placeholder="Tell Nova about your idea…" placeholderTextColor={colors.textTertiary}
                        multiline style={s.novaInput} />
                      <Pressable onPress={sendNova} disabled={!novaInput.trim() || chat.isPending} accessibilityLabel="Send"
                        style={[s.send, (!novaInput.trim() || chat.isPending) && { opacity: 0.4 }]}>
                        <Icon name="send" size={16} color="#FFFFFF" />
                      </Pressable>
                    </Row>
                  </View>
                )}
              </View>

              <View style={s.block}>
                <Text style={s.label}>Category</Text>
                <ChoicePills options={PROJECT_CATEGORIES.map((c) => ({ id: c, label: c }))} value={draft.category} onChange={(v) => edit("category", v)} />
              </View>

              <View style={s.block}>
                <Pressable onPress={() => setShowDetails((o) => !o)} style={{ flexDirection: "row", alignItems: "center" }}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.h2}>More details</Text>
                    <Meta style={{ fontSize: font.sm }}>Team, timeline, roles, stack, links and privacy — all optional.</Meta>
                  </View>
                  <Icon name={showDetails ? "chevron-up" : "chevron-down"} size={18} color={colors.textTertiary} />
                </Pressable>
                {showDetails && (
                  <View style={{ gap: spacing.lg }}>
                    <ToggleRow icon="rocket-outline" title="Solo Builder Mode" body={draft.soloMode ? "Building solo — no roles to recruit." : "Team project"}
                      value={draft.soloMode} onChange={(v) => setDraft((d) => ({ ...d, soloMode: v, ...(v ? { teamSize: "1", rolesNeeded: [] } : {}) }))} />
                    <ToggleRow icon="lock-closed-outline" title="Private project" body={draft.isPrivate ? "Hidden from Discover" : "Visible to everyone"}
                      value={draft.isPrivate} disabled={!canCreatePrivate && !draft.isPrivate} onChange={(v) => edit("isPrivate", v)}
                      note={!canCreatePrivate && !draft.isPrivate ? (privateLimit === 0 ? "Private projects are on Starter and above." : `You've used all ${privateLimit} private projects.`) : undefined}
                      onNote={() => router.push("/pricing" as any)} />
                    <Row gap={spacing.sm}>
                      {!draft.soloMode && <View style={{ flex: 1 }}><Field label="Team size" value={draft.teamSize} onChangeText={(v) => edit("teamSize", v.replace(/\D/g, ""))} numeric /></View>}
                      <View style={{ flex: 1 }}><Field label="Estimated weeks" value={draft.estimatedWeeks} onChangeText={(v) => edit("estimatedWeeks", v.replace(/\D/g, ""))} numeric /></View>
                    </Row>
                    {!draft.soloMode && (
                      <View style={{ gap: spacing.sm }}>
                        <Text style={s.label}>Roles needed</Text>
                        <View style={s.wrap}>
                          {AVAILABLE_ROLES.map((r) => {
                            const on = draft.rolesNeeded.includes(r);
                            return (
                              <Pressable key={r} onPress={() => edit("rolesNeeded", on ? draft.rolesNeeded.filter((x) => x !== r) : [...draft.rolesNeeded, r])}
                                style={[s.pill, on && s.pillOn]}>
                                {on && <Icon name="checkmark" size={13} color="#FFFFFF" />}
                                <Text style={[s.pillText, on && { color: "#FFFFFF" }]}>{r}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      </View>
                    )}
                    <View style={{ gap: spacing.sm }}>
                      <Text style={s.label}>Tech stack</Text>
                      {draft.techStack.length > 0 && (
                        <View style={s.wrap}>
                          {draft.techStack.map((t) => (
                            <Pressable key={t} onPress={() => edit("techStack", draft.techStack.filter((x) => x !== t))} style={[s.pill, s.pillOn]}>
                              <Text style={[s.pillText, { color: "#FFFFFF" }]}>{t}</Text>
                              <Icon name="close" size={13} color="#FFFFFF" />
                            </Pressable>
                          ))}
                        </View>
                      )}
                      <Row gap={spacing.sm} center>
                        <View style={{ flex: 1 }}>
                          <Field value={techInput} onChangeText={setTechInput} placeholder="React Native, Postgres…" autoCapitalize="none" />
                        </View>
                        <Btn small variant="outline" label="Add" disabled={!techInput.trim()} onPress={() => {
                          const v = techInput.trim();
                          if (v && !draft.techStack.includes(v)) edit("techStack", [...draft.techStack, v]);
                          setTechInput("");
                        }} />
                      </Row>
                    </View>
                    <Field label="Repository" value={draft.repoUrl} onChangeText={(v) => edit("repoUrl", v)} placeholder="https://github.com/you/repo" autoCapitalize="none" />
                    <Field label="Live demo" value={draft.liveUrl} onChangeText={(v) => edit("liveUrl", v)} placeholder="https://…" autoCapitalize="none" />
                  </View>
                )}
              </View>
            </>
          )}

          {step === "goal" && (
            <View style={s.block}>
              <Text style={s.h}>What does winning look like?</Text>
              <Meta style={{ fontSize: font.sm, marginTop: -6 }}>Each goal gets its own path — different roadmap, briefings and advice.</Meta>
              {PROJECT_GOALS.map((g) => {
                const on = draft.goal === g.id;
                return (
                  <Pressable key={g.id} onPress={() => setDraft((d) => {
                    setEdited((e) => [...new Set([...e, "goal", "subcategory"])]);
                    return { ...d, goal: g.id, subcategory: isValidSubcategory(g.id, d.subcategory) ? d.subcategory : "" };
                  })} style={({ pressed }) => [s.option, on && s.optionOn, pressed && { opacity: 0.8 }]} accessibilityState={{ selected: on }}>
                    <View style={[s.optionIcon, on && { backgroundColor: colors.primary }]}>
                      <Icon name={GOAL_ICONS[g.id]} size={20} color={on ? "#FFFFFF" : colors.primary} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={s.optionTitle}>{g.label}</Text>
                      <Text style={s.optionBody}>{g.description}</Text>
                    </View>
                    <Icon name={on ? "radio-button-on" : "radio-button-off"} size={20} color={on ? colors.primary : colors.textTertiary} />
                  </Pressable>
                );
              })}
            </View>
          )}

          {step === "subcategory" && draft.goal && (
            <View style={s.block}>
              <Text style={s.h}>{subcategoryQuestion(draft.goal)}</Text>
              <Meta style={{ fontSize: font.sm, marginTop: -6 }}>For {projectGoal(draft.goal).label.toLowerCase()}. Not on the list? "Other" is a fine answer.</Meta>
              {PROJECT_SUBCATEGORIES[draft.goal].map((sc) => {
                const on = draft.subcategory === sc.id;
                return (
                  <Pressable key={sc.id} onPress={() => edit("subcategory", sc.id)} style={({ pressed }) => [s.option, { paddingVertical: spacing.md }, on && s.optionOn, pressed && { opacity: 0.8 }]}>
                    <Text style={[s.optionTitle, { flex: 1 }]}>{sc.label}</Text>
                    <Icon name={on ? "radio-button-on" : "radio-button-off"} size={20} color={on ? colors.primary : colors.textTertiary} />
                  </Pressable>
                );
              })}
            </View>
          )}

          {step === "review" && (
            <View style={s.block}>
              <NovaGradient style={s.bar} />
              <Text style={s.h}>{draft.title}</Text>
              {draft.oneLiner ? <Text style={s.optionTitle}>{draft.oneLiner}</Text> : null}
              <Text style={s.optionBody}>{draft.description}</Text>
              <View style={{ gap: spacing.sm, marginTop: spacing.xs }}>
                <ReviewRow label="Path" value={projectGoal(draft.goal).label} onEdit={() => go("goal")} />
                <ReviewRow label="Kind" value={draft.goal ? PROJECT_SUBCATEGORIES[draft.goal].find((x) => x.id === draft.subcategory)?.label ?? "—" : "—"} onEdit={() => go("subcategory")} />
                <ReviewRow label="Category" value={draft.category || "Other"} onEdit={() => go("setup")} />
                <ReviewRow label="Team" value={draft.soloMode ? "Solo Builder" : `${draft.teamSize || 1}${draft.rolesNeeded.length ? ` · ${draft.rolesNeeded.length} roles` : ""}`} onEdit={() => { setShowDetails(true); go("setup"); }} />
                <ReviewRow label="Timeline" value={`${draft.estimatedWeeks || 4} weeks`} onEdit={() => { setShowDetails(true); go("setup"); }} />
                <ReviewRow label="Visibility" value={draft.isPrivate ? "Private" : "Public"} onEdit={() => { setShowDetails(true); go("setup"); }} />
              </View>
              <View style={s.nextUp}>
                <Icon name="sparkles" size={16} color={colors.primary} />
                <Text style={[s.optionBody, { flex: 1 }]}>Next, Nova lays out your {projectGoal(draft.goal).short.toLowerCase()} path in the project manager. You can change any of this later.</Text>
              </View>
            </View>
          )}
          {error && <View style={{ paddingHorizontal: spacing.lg }}><ErrorNote message={error} /></View>}
        </ScrollView>

        <View style={[s.footer, { paddingBottom: spacing.md + insets.bottom }]}>
          {index > 0 ? <Btn label="Back" variant="outline" icon="arrow-back" onPress={() => go(NEW_PROJECT_STEPS[index - 1])} /> : <View />}
          <View style={{ flex: 1 }} />
          {step !== "review" ? (
            <Btn label="Next" onPress={() => go(NEW_PROJECT_STEPS[index + 1])} disabled={!canNext} style={{ minWidth: 120 }} />
          ) : (
            <Btn label="Create project" icon="sparkles" onPress={() => create.mutate()} disabled={!canNext} loading={create.isPending} />
          )}
        </View>
      </View>
    </>
  );
}

function ToggleRow({ icon, title, body, value, onChange, disabled, note, onNote }: {
  icon: "rocket-outline" | "lock-closed-outline"; title: string; body: string; value: boolean; onChange: (v: boolean) => void;
  disabled?: boolean; note?: string; onNote?: () => void;
}) {
  return (
    <View style={{ gap: 4 }}>
      <Row center gap={spacing.md}>
        <Icon name={icon} size={20} color={colors.textSecondary} />
        <View style={{ flex: 1 }}>
          <Text style={s.optionTitle}>{title}</Text>
          <Meta style={{ fontSize: font.sm }}>{body}</Meta>
        </View>
        <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ false: colors.border, true: colors.primary }} thumbColor="#FFFFFF" />
      </Row>
      {note ? <Pressable onPress={onNote}><Text style={{ fontSize: font.xs + 1, color: colors.primary, fontFamily: fontFamily.medium, marginLeft: 32 }}>{note} See plans</Text></Pressable> : null}
    </View>
  );
}

function ReviewRow({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <Row between>
      <Text style={{ width: 88, fontSize: font.sm, color: colors.textTertiary, fontFamily: fontFamily.regular }}>{label}</Text>
      <Text style={{ flex: 1, fontSize: font.sm, color: colors.text, fontFamily: fontFamily.medium }}>{value}</Text>
      <Pressable onPress={onEdit} hitSlop={8}><Text style={{ fontSize: font.sm, color: colors.primary, fontFamily: fontFamily.semibold }}>Edit</Text></Pressable>
    </Row>
  );
}

const s = StyleSheet.create({
  stepper: {
    flexDirection: "row", backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  stepItem: { flex: 1, alignItems: "center", gap: 4 },
  stepDot: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center", zIndex: 1 },
  stepDone: { backgroundColor: colors.primarySoft },
  stepCurrent: { backgroundColor: colors.primary },
  stepNum: { fontSize: font.xs + 1, fontFamily: fontFamily.semibold, color: colors.textTertiary },
  stepLabel: { fontSize: font.xs + 1, color: colors.textTertiary, fontFamily: fontFamily.medium },
  stepLine: { position: "absolute", top: 12.5, left: "50%", right: "-50%", height: 1.5, backgroundColor: colors.border },
  block: {
    backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, gap: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: "hidden",
  },
  bar: { position: "absolute", top: 0, left: 0, right: 0, height: 4 },
  h: { fontSize: font.xl, fontFamily: fontFamily.bold, color: colors.text, letterSpacing: -0.3 },
  h2: { fontSize: font.base + 1, fontFamily: fontFamily.bold, color: colors.text },
  label: { fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text },
  novaAvatar: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  novaTitle: { fontSize: font.base, fontFamily: fontFamily.bold, color: colors.text },
  bubbleNova: { alignSelf: "flex-start", maxWidth: "88%", backgroundColor: colors.surfaceRaised, borderRadius: radius.lg, borderBottomLeftRadius: 4, padding: spacing.md },
  bubbleUser: { alignSelf: "flex-end", maxWidth: "88%", backgroundColor: colors.primary, borderRadius: radius.lg, borderBottomRightRadius: 4, padding: spacing.md },
  bubbleText: { fontSize: font.sm, lineHeight: 19, color: colors.text, fontFamily: fontFamily.regular },
  novaInput: {
    flex: 1, minHeight: 42, maxHeight: 120, borderWidth: 1, borderColor: colors.border, borderRadius: 21,
    paddingHorizontal: spacing.lg, paddingTop: 11, paddingBottom: 11, fontSize: font.sm, color: colors.text, fontFamily: fontFamily.regular,
  },
  send: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs + 2 },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  pillOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { fontSize: font.sm, color: colors.text, fontFamily: fontFamily.medium },
  option: {
    flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.md,
  },
  optionOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  optionIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  optionTitle: { fontSize: font.base, fontFamily: fontFamily.semibold, color: colors.text },
  optionBody: { fontSize: font.sm, lineHeight: 19, color: colors.textSecondary, fontFamily: fontFamily.regular },
  nextUp: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.xs },
  footer: {
    flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
});
