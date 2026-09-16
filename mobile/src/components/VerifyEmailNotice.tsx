/**
 * Until the address someone signed up with is confirmed, nothing they write
 * reaches another person — the server refuses posts, comments, messages,
 * invites and reports (server/email-verification.ts). This says so where they
 * would otherwise hit that wall, and sends another link.
 */
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { colors, font, fontFamily, radius, spacing } from "../theme";
import type { Notice } from "./Sheet";

export function VerifyEmailNotice({ onNotice }: { onNotice?: (n: Notice) => void }) {
  const { user } = useAuth();
  const [sending, setSending] = useState(false);
  if (!user || user.emailVerifiedAt) return null;

  const resend = async () => {
    setSending(true);
    try {
      const r = await api<{ alreadyVerified?: boolean; sentTo?: string }>("/api/auth/verify-email/send", { method: "POST" });
      onNotice?.({ text: r?.alreadyVerified ? "Your address is already confirmed." : `Link sent to ${r?.sentTo ?? "your inbox"} — check spam too.`, tone: r?.alreadyVerified ? "info" : "success" });
    } catch {
      onNotice?.({ text: "Couldn't send that. Try again in a moment.", tone: "error" });
    } finally {
      setSending(false);
    }
  };

  return (
    <View testID="verify-email-notice" style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: "rgba(245,158,11,0.12)", borderWidth: 1, borderColor: "rgba(245,158,11,0.35)" }}>
      <Ionicons name="mail-unread-outline" size={16} color={colors.warning} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>Confirm your email</Text>
        <Text style={{ fontFamily: fontFamily.regular, fontSize: font.xs + 1, color: colors.textSecondary, lineHeight: 17 }}>
          Posting, commenting, messaging and invites stay locked until you open the link we sent to {user.email}.
        </Text>
        <Pressable onPress={resend} disabled={sending} testID="button-resend-verification" accessibilityRole="button">
          <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.xs + 1, color: colors.primary }}>{sending ? "Sending…" : "Send it again"}</Text>
        </Pressable>
      </View>
    </View>
  );
}
