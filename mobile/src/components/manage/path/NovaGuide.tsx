/**
 * Nova, the project partner — client/src/components/nova-guide.tsx on the
 * phone. A new project opens on Nova's welcome with four quick replies (the
 * web's onboarding overlay); once setup is done or skipped, Nova is a round
 * button on the manager that opens the same conversation, with suggestions
 * for the section you're in. Every message is a credit, and Nova can change
 * the project: tasks, milestones, the brief, the loops — each shown as a card.
 */
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../../../api/client";
import { colors, font, fontFamily, radius, shadow, spacing } from "../../../theme";
import { Btn, Icon, IconButton, Meta, NovaGradient, Row, errText, type IconName } from "../../ui";
import { useNotify } from "../bits";
import { mkey, useRefreshPath } from "../shared";

interface NovaMessage { id: string; role: "user" | "assistant"; content: string; actionsTaken?: { type: string; data: any }[]; createdAt: string }

const WELCOME_MESSAGE = `**Starting a new business or project can be scary, but you are now not alone!**

I'm **Nova**, your AI project partner, and I'm here to walk you through everything you need to bring your idea to life.

I can help you:
- **Define your vision** — one-liner, value proposition, target customer
- **Plan your project** — scope, tasks, milestones, and roadmap
- **Build your business profile** — strategy, pricing, legal basics
- **Prepare for launch** — checklist, landing page, go-to-market plan

Let's start by getting to know your project better. **What would you like to focus on first?**`;

export const QUICK_REPLIES: { label: string; icon: IconName; message: string }[] = [
  { label: "Build my project brief", icon: "document-text-outline", message: "Help me build out my project brief — one-liner, value proposition, target customer, and problem statement." },
  { label: "Create a business plan", icon: "locate-outline", message: "Help me create a business plan for my project. Walk me through the key sections." },
  { label: "Set up starter tasks", icon: "list-outline", message: "Create some starter tasks to help me get going on my project." },
  { label: "Help me get started", icon: "rocket-outline", message: "I'm new to this. Walk me through everything I need to get started step by step." },
];

/** The web's per-tab suggestions, keyed by the manager's tab ids (mobile "tasks" is the web's "kanban"). */
const TAB_SUGGESTIONS: Record<string, string[]> = {
  dashboard: ["What should I work on first?", "Help me write my project brief", "Create starter tasks for my project"],
  setup: ["Help me write my project brief", "Define my target customer", "What should my one-liner be?"],
  tasks: ["Create starter tasks for my project", "What should I work on first?", "Help me prioritize my backlog"],
  milestones: ["Help me plan my roadmap", "What milestones should I set?", "Break down my timeline"],
  roadmap: ["Help me plan my roadmap", "What milestones should I set?", "Break down my timeline"],
  team: ["What roles do I need to hire?", "Help me write a job description", "How should I structure my team?"],
  files: ["What documents should I create?", "Help me organize my files"],
  activity: ["Summarize recent activity", "What decisions need to be made?"],
  personas: ["Help me create user personas", "Who is my ideal customer?"],
  research: ["Plan my user interviews", "Design an experiment to test my idea"],
  strategy: ["Help me set pricing", "What legal docs do I need?", "Review my business model"],
  launch: ["Create my launch checklist", "Write landing page copy", "Plan my go-to-market strategy"],
  analytics: ["What metrics should I track?", "Help me define KPIs", "Set up activation events"],
  support: ["Set up my support workflow", "What FAQs should I prepare?"],
  chat: ["How can I improve team communication?"],
};

const ACTION_LABEL: Record<string, { label: string; icon: IconName }> = {
  update_project: { label: "Updated Project", icon: "create-outline" },
  update_scope: { label: "Updated Scope", icon: "create-outline" },
  create_tasks: { label: "Created Tasks", icon: "list-outline" },
  create_milestones: { label: "Created Milestones", icon: "flag-outline" },
  edit_project: { label: "Edited Your Project", icon: "pencil-outline" },
  complete_onboarding: { label: "Setup Complete", icon: "checkmark-circle-outline" },
  remember: { label: "Nova will keep this in mind", icon: "bookmark-outline" },
  write_loops: { label: "Wrote Your Loops", icon: "repeat-outline" },
};

function actionDetail(a: { type: string; data: any }): string {
  const d = a.data ?? {};
  switch (a.type) {
    case "update_project": return Object.keys(d).join(", ");
    case "create_tasks": return `${d.count} tasks: ${(d.tasks || []).join(", ")}`;
    case "create_milestones": return d.error ? "Needs the Builder plan" : `${d.count} milestones: ${(d.milestones || []).join(", ")}`;
    case "edit_project": return (d.changes || []).map((c: any) => c.description).join(" · ");
    case "write_loops": return d.count ? `${d.count} loop${d.count === 1 ? "" : "s"}: ${(d.loops || []).join(", ")}` : `Nothing written: ${(d.skipped || []).map((x: any) => x.reason).join("; ")}`;
    case "remember": return d.notes ?? "";
    case "update_scope": return `${d.mvp?.length || 0} MVP features, ${d.niceToHave?.length || 0} nice-to-haves`;
    default: return "";
  }
}

/** **bold** and "- " bullets, the two things Nova's replies use. */
function Formatted({ text, color }: { text: string; color: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  return (
    <View style={{ gap: 4 }}>
      {lines.map((line, i) => {
        if (!line.trim()) return <View key={i} style={{ height: 2 }} />;
        const bullet = /^\s*[-•*]\s+/.test(line);
        const body = line.replace(/^\s*[-•*]\s+/, "");
        const parts = body.split(/\*\*(.+?)\*\*/g);
        return (
          <Text key={i} style={{ color, fontSize: font.sm, lineHeight: 20, fontFamily: fontFamily.regular, paddingLeft: bullet ? 12 : 0 }}>
            {bullet ? "•  " : ""}
            {parts.map((p, j) => j % 2 ? <Text key={j} style={{ fontFamily: fontFamily.bold }}>{p}</Text> : p)}
          </Text>
        );
      })}
    </View>
  );
}

function Avatar() {
  return (
    <NovaGradient style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" }}>
      <Icon name="sparkles" size={15} color="#FFFFFF" />
    </NovaGradient>
  );
}

export function useNovaMessages(projectId: string) {
  return useQuery({
    queryKey: mkey(projectId, "nova-guide"),
    queryFn: () => api<NovaMessage[]>(`/api/projects/${projectId}/nova-guide`),
    enabled: !!projectId,
  });
}

export function useCompleteOnboarding(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api(`/api/projects/${projectId}/nova-guide/complete-onboarding`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: mkey(projectId, "project") }),
  });
}

/**
 * The conversation, full screen. `onboarding` is the web's overlay: the
 * welcome, the quick replies, and the ways out ("Skip setup", "I'm done").
 */
export function NovaGuideSheet({ projectId, visible, onClose, onboarding, currentTab, initialMessage, section }: {
  projectId: string; visible: boolean; onClose: () => void; onboarding: boolean; currentTab: string;
  /** The manager section open (ship_mvp / systemize_business / raise_funding): Nova answers about that path. */
  section?: string;
  /** Sent as soon as the sheet opens — a quick reply tapped on the dashboard. */
  initialMessage?: string | null;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const refresh = useRefreshPath(projectId);
  const { notify } = useNotify();
  const scroll = useRef<ScrollView>(null);
  const { data: serverMessages } = useNovaMessages(projectId);
  const [local, setLocal] = useState<NovaMessage[]>([]);
  const [input, setInput] = useState("");
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const complete = useCompleteOnboarding(projectId);

  useEffect(() => {
    if (serverMessages) setLocal(serverMessages);
  }, [serverMessages]);

  const send = useMutation({
    mutationFn: (message: string) => api<{ reply: string; actionsTaken?: { type: string; data: any }[] }>(`/api/projects/${projectId}/nova-guide`, {
      method: "POST", body: { message, currentTab, ...(section ? { section } : {}) },
    }),
    onSuccess: (r) => {
      setError(null);
      setLocal((prev) => [...prev, { id: `assistant-${Date.now()}`, role: "assistant", content: r.reply, actionsTaken: r.actionsTaken, createdAt: new Date().toISOString() }]);
      qc.invalidateQueries({ queryKey: mkey(projectId, "nova-guide") });
      qc.invalidateQueries({ queryKey: ["subscription"] });
      if (r.actionsTaken?.length) {
        refresh();
        qc.invalidateQueries({ queryKey: mkey(projectId, "activity") });
        notify(`Nova updated your project — ${r.actionsTaken.length} action${r.actionsTaken.length === 1 ? "" : "s"} taken`);
      }
    },
    onError: (e: any) => {
      const msg = errText(e, "Nova couldn't respond");
      if (/credit/i.test(msg)) setOutOfCredits(true);
      else setError(msg);
    },
  });

  const handleSend = (text?: string) => {
    const t = (text ?? input).trim();
    if (!t || send.isPending) return;
    setLocal((prev) => [...prev, { id: `user-${Date.now()}`, role: "user", content: t, createdAt: new Date().toISOString() }]);
    setInput("");
    send.mutate(t);
  };

  // A quick reply tapped outside the sheet arrives here once.
  const sentInitial = useRef<string | null>(null);
  useEffect(() => {
    if (visible && initialMessage && sentInitial.current !== initialMessage && serverMessages) {
      sentInitial.current = initialMessage;
      handleSend(initialMessage);
    }
    if (!visible) sentInitial.current = null;
  }, [visible, initialMessage, serverMessages]);

  const finish = () => complete.mutate(undefined, {
    onSuccess: () => { notify("Setup complete — Nova is a tap away whenever you need help"); onClose(); },
    onError: (e) => setError(errText(e, "Couldn't finish setup")),
  });

  const messages: NovaMessage[] = local.length || !onboarding
    ? local
    : [{ id: "welcome", role: "assistant", content: WELCOME_MESSAGE, createdAt: new Date().toISOString() }];
  const suggestions = onboarding
    ? QUICK_REPLIES.map((q) => ({ label: q.label, message: q.message }))
    : (TAB_SUGGESTIONS[currentTab] ?? TAB_SUGGESTIONS.dashboard).map((m) => ({ label: m, message: m }));
  const showSuggestions = messages.length <= 1 && !send.isPending;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: colors.canvas }}>
        <View style={{ paddingTop: Platform.OS === "android" ? insets.top : spacing.md, backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.border }}>
          <Row center gap={spacing.sm} style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
            <Avatar />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fontFamily.bold, fontSize: font.base, color: colors.text }}>{onboarding ? "Nova AI Guide" : "Nova"}</Text>
              <Meta>{onboarding ? "Your project partner" : `Helping with: ${currentTab}`}</Meta>
            </View>
            {onboarding
              ? <Btn small variant="outline" label="Skip setup" loading={complete.isPending} onPress={finish} />
              : <IconButton name="chevron-down" label="Close" onPress={onClose} color={colors.text} />}
            {onboarding && <IconButton name="close" label="Close" onPress={onClose} color={colors.textSecondary} />}
          </Row>
        </View>

        <ScrollView
          ref={scroll}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        >
          {messages.map((m) => (
            m.role === "user" ? (
              <View key={m.id} style={{ alignSelf: "flex-end", maxWidth: "85%", backgroundColor: colors.primary, borderRadius: 18, borderBottomRightRadius: 4, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 }}>
                <Formatted text={m.content} color={colors.primaryText} />
              </View>
            ) : (
              <Row key={m.id} gap={spacing.sm} style={{ alignItems: "flex-start", maxWidth: "92%" }}>
                <Avatar />
                <View style={{ flexShrink: 1, gap: 6 }}>
                  <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 18, borderBottomLeftRadius: 4, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 }}>
                    <Formatted text={m.content} color={colors.text} />
                  </View>
                  {m.actionsTaken?.map((a, i) => {
                    const info = ACTION_LABEL[a.type] ?? { label: a.type, icon: "sparkles-outline" as IconName };
                    const detail = actionDetail(a);
                    return (
                      <Row key={i} gap={spacing.sm} style={{ alignItems: "flex-start", backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: `${colors.primary}33`, borderRadius: radius.sm, padding: spacing.sm + 2 }}>
                        <Icon name={info.icon} size={15} color={colors.primary} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.xs + 1, color: colors.primary }}>{info.label}</Text>
                          {!!detail && <Meta numberOfLines={3}>{detail}</Meta>}
                        </View>
                      </Row>
                    );
                  })}
                </View>
              </Row>
            )
          ))}
          {send.isPending && (
            <Row gap={spacing.sm} center>
              <Avatar />
              <Meta style={{ fontSize: font.sm }}>Nova is thinking…</Meta>
            </Row>
          )}
          {!!error && <Text style={{ color: colors.danger, fontSize: font.sm, fontFamily: fontFamily.regular }}>{error}</Text>}
          {outOfCredits && (
            <View style={{ backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm }}>
              <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>Out of AI credits</Text>
              <Meta>Upgrade your plan for more credits and keep going with Nova.</Meta>
              <Btn small label="See plans" onPress={() => { onClose(); router.push("/pricing" as any); }} style={{ alignSelf: "flex-start" }} />
            </View>
          )}
          {showSuggestions && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, paddingTop: spacing.xs }}>
              {suggestions.map((q) => (
                <Pressable key={q.label} onPress={() => handleSend(q.message)} style={({ pressed }) => [{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 8 }, pressed && { opacity: 0.7 }]}>
                  <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.medium }}>{q.label}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>

        <View style={{ backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm + insets.bottom, gap: 6 }}>
          <Row gap={spacing.sm} style={{ alignItems: "flex-end" }}>
            <TextInput
              value={input} onChangeText={setInput} multiline editable={!send.isPending}
              placeholder={onboarding ? "Ask Nova anything about your project…" : "Ask Nova…"} placeholderTextColor={colors.textTertiary}
              style={{ flex: 1, maxHeight: 140, minHeight: 40, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: spacing.md, paddingTop: 10, paddingBottom: 10, color: colors.text, fontSize: font.sm + 1, fontFamily: fontFamily.regular }}
              testID="input-nova-message"
            />
            <Pressable
              onPress={() => handleSend()} disabled={!input.trim() || send.isPending} accessibilityLabel="Send"
              style={({ pressed }) => [{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }, (!input.trim() || send.isPending) && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}
            >
              <Icon name="send" size={17} color="#FFFFFF" />
            </Pressable>
          </Row>
          <Row between>
            <Meta>1 credit per message{onboarding ? "" : " · Nova can update your project"}</Meta>
            {onboarding && (
              <Pressable onPress={finish} hitSlop={6}>
                <Text style={{ color: colors.primary, fontSize: font.xs, fontFamily: fontFamily.semibold }}>I'm done, let me explore on my own →</Text>
              </Pressable>
            )}
          </Row>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** The widget's round button, bottom right of the manager. */
export function NovaFab({ onPress }: { onPress: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      onPress={onPress} accessibilityLabel="Ask Nova" testID="btn-nova-widget"
      style={({ pressed }) => [{ position: "absolute", right: spacing.lg, bottom: spacing.xl + insets.bottom + 56, borderRadius: 28, ...shadow.raised }, pressed && { opacity: 0.85 }]}
    >
      <NovaGradient style={{ width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" }}>
        <Icon name="sparkles" size={24} color="#FFFFFF" />
      </NovaGradient>
    </Pressable>
  );
}

/** On the dashboard while setup isn't done: Nova's welcome, inline, with the quick replies. */
export function NovaWelcomeCard({ onOpen, onSkip, skipping }: { onOpen: (message?: string) => void; onSkip: () => void; skipping: boolean }) {
  return (
    <View style={{ borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
      <NovaGradient style={{ padding: spacing.lg, gap: 6 }}>
        <Row center gap={spacing.sm}>
          <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(255,255,255,0.25)", alignItems: "center", justifyContent: "center" }}>
            <Icon name="sparkles" size={16} color="#FFFFFF" />
          </View>
          <Text style={{ color: "#FFFFFF", fontFamily: fontFamily.semibold, fontSize: font.sm }}>Nova · your project partner</Text>
        </Row>
        <Text style={{ color: "#FFFFFF", fontFamily: fontFamily.bold, fontSize: font.lg, lineHeight: 23 }}>Starting something new can be scary, but you're not doing it alone.</Text>
      </NovaGradient>
      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        <Text style={{ color: colors.text, fontSize: font.sm, lineHeight: 20, fontFamily: fontFamily.regular }}>
          I'm Nova. I'll help you define the vision, plan the work, build the business side and get ready to launch. What would you like to focus on first?
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {QUICK_REPLIES.map((q) => (
            <Pressable key={q.label} onPress={() => onOpen(q.message)} style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 8 }, pressed && { opacity: 0.7 }]} testID={`quick-reply-${q.label}`}>
              <Icon name={q.icon} size={14} color={colors.primary} />
              <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.medium }}>{q.label}</Text>
            </Pressable>
          ))}
        </View>
        <Row gap={spacing.sm} wrap center>
          <Btn small icon="chatbubbles-outline" label="Chat with Nova" onPress={() => onOpen()} />
          <Btn small variant="ghost" label="Skip setup" loading={skipping} onPress={onSkip} />
          <Meta>1 credit per message</Meta>
        </Row>
      </View>
    </View>
  );
}
