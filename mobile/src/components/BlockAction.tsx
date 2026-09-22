/**
 * Block and unblock, on the phone.
 *
 * The same lever as the web app's `BlockButton`, and it matters more here:
 * the phone is where the notification arrives, which is usually where somebody
 * is standing when they decide they've had enough. Reporting asks a reviewer to
 * look at it later; this stops it now.
 *
 * The confirm spells out what a block does — including that the other person
 * isn't told, which is the thing people actually want to know before they use
 * it — and warns that the connection goes with it, because that's the part
 * that can't be undone by unblocking.
 */
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { colors, font, radius, spacing } from "../theme";
import { Icon } from "./ui";

/** Everything a block can change, dropped so no screen keeps showing them. */
const TOUCHED_BY_A_BLOCK = [
  ["blocks"], ["conversations"], ["unread-count"], ["matches"],
  ["connections"], ["notifications"], ["user"],
];

export function BlockAction({
  userId, name, onBlocked, compact,
}: {
  userId: string;
  name?: string | null;
  /** Called after blocking — screens showing that person should leave. */
  onBlocked?: () => void;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const state = useQuery({
    queryKey: ["block", userId],
    queryFn: () => api<{ blocked: boolean }>(`/api/blocks/${userId}`),
    enabled: !!userId,
  });
  const blocked = !!state.data?.blocked;

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["block", userId] });
    for (const key of TOUCHED_BY_A_BLOCK) void qc.invalidateQueries({ queryKey: key });
  };

  const block = useMutation({
    mutationFn: () => api(`/api/blocks`, { method: "POST", body: { userId } }),
    onSuccess: async () => { await refresh(); onBlocked?.(); },
  });
  const unblock = useMutation({
    mutationFn: () => api(`/api/blocks/${userId}`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  const who = name?.trim() || "this person";

  const confirmBlock = () => {
    Alert.alert(
      `Block ${who}?`,
      `They won't be able to message you, send you a connection request, or see your profile — and you won't see theirs. Any connection between you is removed.\n\nThey are not told that you blocked them. You can undo this from their profile.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try { await block.mutateAsync(); }
            catch { Alert.alert("Couldn't block them", "Try again in a moment."); }
            finally { setBusy(false); }
          },
        },
      ],
    );
  };

  const doUnblock = async () => {
    setBusy(true);
    try { await unblock.mutateAsync(); }
    catch { Alert.alert("Couldn't unblock them", "Try again in a moment."); }
    finally { setBusy(false); }
  };

  if (!userId) return null;

  return (
    <Pressable
      onPress={blocked ? doUnblock : confirmBlock}
      disabled={busy}
      style={[s.button, compact && s.compact, busy && s.busy]}
      accessibilityRole="button"
      accessibilityLabel={blocked ? `Unblock ${who}` : `Block ${who}`}
      testID={blocked ? `button-unblock-${userId}` : `button-block-${userId}`}
    >
      <Icon name="ban-outline" size={compact ? 16 : 18} color={blocked ? colors.textSecondary : colors.danger} />
      <Text style={[s.label, compact && s.labelCompact]}>{blocked ? "Unblock" : "Block"}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  compact: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  busy: { opacity: 0.5 },
  label: { color: colors.textSecondary, fontSize: font.sm, fontWeight: "600" },
  labelCompact: { fontSize: font.xs },
});
