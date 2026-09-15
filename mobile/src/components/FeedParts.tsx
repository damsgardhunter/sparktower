/**
 * The small pieces the feed, a post and its comments share: post text with
 * @mentions, reaction badges and the picker, the report flow, and a text box
 * that can tag people.
 */
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextStyle } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { api, fetchMe } from "../api/client";
import { colors, font, fontFamily, radius, shadow, spacing } from "../theme";
import { Avatar, Btn, Meta, errText } from "./ui";
import { Sheet } from "./Sheet";
import {
  REACTIONS, REPORT_NOTE_MAX, REPORT_REASONS, REPORT_REASON_DETAILS, reactionDef,
  type Mention, type Reaction, type ReportReason, type ReportTarget,
} from "./feedModel";

/** The signed-in user, from the cache the header already fills. */
export function useMe() {
  const { data } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const name = data?.profile?.displayName || [data?.user?.firstName, data?.user?.lastName].filter(Boolean).join(" ") || "You";
  return {
    id: data?.user?.id as string | undefined,
    name,
    headline: data?.profile?.headline as string | undefined,
    avatar: (data?.profile?.avatarUrl ?? data?.user?.profileImageUrl) as string | undefined,
  };
}

// --- Text ------------------------------------------------------------------

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Post or comment text: **bold** spans bold, real @mentions purple and tappable. */
export function FeedText({
  content, mentions, style, numberOfLines, onMentionPress,
}: {
  content: string;
  mentions?: Mention[] | null;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  onMentionPress?: (userId: string) => void;
}) {
  const list = (mentions ?? []).filter((m) => m.name);
  const names = list.map((m) => m.name).sort((a, b) => b.length - a.length);
  const pattern = names.length
    ? new RegExp(`(\\*\\*[^*]+\\*\\*|@(?:${names.map(escape).join("|")}))`, "g")
    : /(\*\*[^*]+\*\*)/g;
  const parts = content.split(pattern).filter((p) => p);
  return (
    <Text style={[s.text, style]} numberOfLines={numberOfLines}>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <Text key={i} style={{ fontFamily: fontFamily.bold }}>{part.slice(2, -2)}</Text>;
        }
        const m = part.startsWith("@") ? list.find((x) => x.name === part.slice(1)) : undefined;
        if (m) {
          return (
            <Text key={i} style={s.mention} onPress={onMentionPress ? () => onMentionPress(m.userId) : undefined}>
              {part}
            </Text>
          );
        }
        return <Text key={i}>{part}</Text>;
      })}
    </Text>
  );
}

// --- Reactions -------------------------------------------------------------

/** One reaction as a small filled circle, the way a professional network stacks them. */
export function ReactionBadge({ reaction, size = 18, ring = true }: { reaction: string; size?: number; ring?: boolean }) {
  const def = reactionDef(reaction);
  if (!def) return null;
  return (
    <View
      style={{
        width: size, height: size, borderRadius: size / 2, backgroundColor: def.color,
        alignItems: "center", justifyContent: "center",
        borderWidth: ring ? 1.5 : 0, borderColor: colors.surface,
      }}
    >
      <Ionicons name={def.icon} size={size * 0.56} color="#FFFFFF" />
    </View>
  );
}

/** The top three reactions, overlapped. */
export function ReactionStack({ breakdown, size = 18 }: { breakdown: { reaction: string; count: number }[]; size?: number }) {
  const top = [...breakdown].filter((r) => r.count > 0).sort((a, b) => b.count - a.count).slice(0, 3);
  if (!top.length) return null;
  return (
    <View style={{ flexDirection: "row" }}>
      {top.map((r, i) => (
        <View key={r.reaction} style={{ marginLeft: i === 0 ? 0 : -size * 0.3, zIndex: 3 - i }}>
          <ReactionBadge reaction={r.reaction} size={size} />
        </View>
      ))}
    </View>
  );
}

/** A floating row of the five reactions. Place it inside a `position: relative` parent. */
export function ReactionPicker({
  current, onPick, onClose, style,
}: {
  current?: string | null;
  onPick: (r: Reaction) => void;
  onClose: () => void;
  style?: object;
}) {
  return (
    <>
      <Pressable style={s.pickerScrim} onPress={onClose} accessibilityLabel="Close reactions" />
      <View style={[s.picker, style]} accessibilityRole="menu">
        {REACTIONS.map((r) => (
          <Pressable
            key={r.reaction}
            onPress={() => onPick(r.reaction)}
            accessibilityLabel={r.label}
            style={({ pressed }) => [s.pickerItem, current === r.reaction && { backgroundColor: colors.primarySoft }, pressed && { transform: [{ scale: 1.15 }] }]}
          >
            <ReactionBadge reaction={r.reaction} size={34} ring={false} />
            <Text style={s.pickerLabel}>{r.label}</Text>
          </Pressable>
        ))}
      </View>
    </>
  );
}

// --- Reporting -------------------------------------------------------------

/**
 * Why → a little more precisely → an optional note, then send. The same three
 * steps as the web's report dialog, in a sheet.
 */
export function ReportSheet({
  visible, onClose, targetType, targetId, onSent,
}: {
  visible: boolean;
  onClose: () => void;
  targetType: ReportTarget;
  targetId: string;
  onSent?: () => void;
}) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const what = targetType === "feed_post" ? "post" : "comment";

  const reset = () => { setReason(null); setDetail(null); setNote(""); setError(null); };
  const close = () => { reset(); onClose(); };

  const send = useMutation({
    mutationFn: () => api("/api/reports", { method: "POST", body: { targetType, targetId, reason, detail, note } }),
    onSuccess: () => { reset(); onSent?.(); onClose(); },
    onError: (e) => setError(errText(e, "Couldn't send that. Try again.")),
  });

  const step = !reason ? "reason" : !detail ? "detail" : "confirm";
  const reasonLabel = REPORT_REASONS.find((r) => r.id === reason)?.label;
  const detailLabel = reason ? REPORT_REASON_DETAILS[reason].find((d) => d.id === detail)?.label : undefined;

  const option = (label: string, onPress: () => void, key: string) => (
    <Pressable key={key} onPress={onPress} style={({ pressed }) => [s.option, pressed && { backgroundColor: colors.surfaceRaised }]}>
      <Text style={s.optionText}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
    </Pressable>
  );

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title={step === "reason" ? `Why are you reporting this ${what}?` : step === "detail" ? reasonLabel ?? "" : "Send this report?"}
      subtitle={step === "reason"
        ? "A person reads every report. Nothing happens to the author automatically."
        : step === "detail" ? "Which is closest?" : "Add anything that would help us judge it — or just send it."}
    >
      {step === "reason" && <View>{REPORT_REASONS.map((r) => option(r.label, () => setReason(r.id), r.id))}</View>}
      {step === "detail" && reason && (
        <View>{REPORT_REASON_DETAILS[reason].map((d) => option(d.label, () => setDetail(d.id), d.id))}</View>
      )}
      {step === "confirm" && (
        <View style={{ gap: spacing.sm }}>
          <View style={s.summary}>
            <Text style={s.optionText}>{reasonLabel}</Text>
            {detailLabel && <Meta>{detailLabel}</Meta>}
          </View>
          <TextInput
            value={note}
            onChangeText={(t) => setNote(t.slice(0, REPORT_NOTE_MAX))}
            placeholder={detail === "something_else" ? "Tell us what's wrong" : "Anything else (optional)"}
            placeholderTextColor={colors.textTertiary}
            multiline
            style={s.noteInput}
          />
          <Meta style={{ alignSelf: "flex-end" }}>{note.length}/{REPORT_NOTE_MAX}</Meta>
        </View>
      )}
      {error && <Text style={s.error}>{error}</Text>}
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.sm }}>
        {step === "reason"
          ? <Btn label="Cancel" variant="ghost" small onPress={close} />
          : <Btn label="Back" icon="arrow-back" variant="ghost" small onPress={() => (step === "confirm" ? setDetail(null) : setReason(null))} />}
        {step === "confirm" && (
          <Btn
            label="Send report"
            small
            loading={send.isPending}
            disabled={detail === "something_else" && !note.trim()}
            onPress={() => send.mutate()}
          />
        )}
      </View>
    </Sheet>
  );
}

// --- Mentions --------------------------------------------------------------

interface Candidate { userId: string; name: string; handle: string | null; headline: string | null; avatarUrl: string | null }

/**
 * A text box where `@` looks people up. Choosing someone writes their name
 * into the text and records their id, which is what the server stores.
 */
export function MentionInput({
  value, onChangeText, mentions, onMentionsChange, placeholder, maxLength, minHeight = 44,
  autoFocus, style, inputRef, borderless,
}: {
  value: string;
  onChangeText: (v: string) => void;
  mentions: Mention[];
  onMentionsChange: (m: Mention[]) => void;
  placeholder?: string;
  maxLength?: number;
  minHeight?: number;
  autoFocus?: boolean;
  style?: StyleProp<TextStyle>;
  inputRef?: React.RefObject<TextInput | null>;
  /** For a full-screen composer, where the page is the box. */
  borderless?: boolean;
}) {
  const sel = useRef({ start: value.length, end: value.length });
  const [trigger, setTrigger] = useState<{ at: number; term: string; caret: number } | null>(null);
  const [debounced, setDebounced] = useState<string | null>(null);

  useEffect(() => {
    if (!trigger) { setDebounced(null); return; }
    const t = setTimeout(() => setDebounced(trigger.term), 180);
    return () => clearTimeout(t);
  }, [trigger?.term, !!trigger]);

  const { data: candidates, isFetching } = useQuery({
    queryKey: ["feed", "mention-search", debounced],
    queryFn: () => api<Candidate[]>(`/api/feed/mention-search?q=${encodeURIComponent(debounced!)}`),
    enabled: !!debounced,
    staleTime: 60_000,
  });

  const detect = (text: string, caret: number) => {
    const match = text.slice(0, caret).match(/@([\w.-]*)$/);
    setTrigger(match ? { at: caret - match[0].length, term: match[1], caret } : null);
  };

  const pick = (c: Candidate) => {
    if (!trigger) return;
    const inserted = `@${c.name} `;
    const next = value.slice(0, trigger.at) + inserted + value.slice(trigger.caret);
    onChangeText(next);
    if (!mentions.some((m) => m.userId === c.userId)) onMentionsChange([...mentions, { userId: c.userId, name: c.name }]);
    const pos = trigger.at + inserted.length;
    sel.current = { start: pos, end: pos };
    setTrigger(null);
  };

  const showList = !!trigger && trigger.term.length > 0;

  return (
    <View style={{ gap: spacing.xs }}>
      <TextInput
        ref={inputRef as any}
        value={value}
        onChangeText={(text) => {
          // The selection event can land after the text change, so work out the caret from the edit.
          const caret = Math.max(0, Math.min(text.length, sel.current.end + (text.length - value.length)));
          sel.current = { start: caret, end: caret };
          onChangeText(text);
          // Mentions whose name was deleted from the text no longer count.
          const kept = mentions.filter((m) => text.includes(`@${m.name}`));
          if (kept.length !== mentions.length) onMentionsChange(kept);
          detect(text, caret);
        }}
        onSelectionChange={(e) => { sel.current = e.nativeEvent.selection; }}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        maxLength={maxLength}
        multiline
        autoFocus={autoFocus}
        textAlignVertical="top"
        style={[borderless ? s.inputBare : s.input, { minHeight }, Platform.OS === "web" && ({ outlineWidth: 0, outlineStyle: "none" } as object), style]}
      />
      {showList && (
        <View style={s.mentionList}>
          {isFetching && !candidates?.length ? (
            <View style={s.mentionRow}><ActivityIndicator size="small" color={colors.primary} /><Meta>Searching people…</Meta></View>
          ) : !candidates?.length ? (
            <View style={s.mentionRow}><Meta>No one called "{trigger!.term}"</Meta></View>
          ) : (
            <ScrollView keyboardShouldPersistTaps="always" style={{ maxHeight: 220 }}>
              {candidates.map((c) => (
                <Pressable key={c.userId} onPress={() => pick(c)} style={({ pressed }) => [s.mentionRow, pressed && { backgroundColor: colors.surfaceRaised }]}>
                  <Avatar name={c.name} uri={c.avatarUrl} size={30} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.mentionName} numberOfLines={1}>{c.name}</Text>
                    {c.headline ? <Meta numberOfLines={1}>{c.headline}</Meta> : null}
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  text: { color: colors.text, fontSize: font.base - 1, lineHeight: 21, fontFamily: fontFamily.regular },
  mention: { color: colors.primary, fontFamily: fontFamily.semibold },
  pickerScrim: { position: "absolute", top: -2000, bottom: -2000, left: -2000, right: -2000, zIndex: 20 },
  picker: {
    position: "absolute", zIndex: 21, flexDirection: "row", gap: 2, padding: 6,
    backgroundColor: colors.surface, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, ...shadow.raised,
  },
  pickerItem: { alignItems: "center", paddingHorizontal: 4, paddingVertical: 2, borderRadius: radius.md, gap: 2 },
  pickerLabel: { fontSize: 9, color: colors.textSecondary, fontFamily: fontFamily.medium },
  option: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm,
    paddingVertical: spacing.md, borderBottomWidth: 1, borderColor: colors.borderSubtle,
  },
  optionText: { color: colors.text, fontSize: font.base, fontFamily: fontFamily.medium, flexShrink: 1 },
  summary: { backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, padding: spacing.md, gap: 2 },
  noteInput: {
    minHeight: 80, backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, color: colors.text, fontSize: font.base, fontFamily: fontFamily.regular, textAlignVertical: "top",
  },
  error: { color: colors.danger, fontSize: font.sm, fontFamily: fontFamily.regular },
  input: {
    backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg,
    paddingHorizontal: spacing.md, paddingTop: 10, paddingBottom: 10,
    color: colors.text, fontSize: font.base, fontFamily: fontFamily.regular,
  },
  inputBare: { color: colors.text, fontSize: font.lg, lineHeight: 25, fontFamily: fontFamily.regular, padding: 0 },
  mentionList: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: "hidden", ...shadow.card,
  },
  mentionRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  mentionName: { color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold },
});
