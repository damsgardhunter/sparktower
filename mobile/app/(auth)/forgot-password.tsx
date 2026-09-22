/**
 * Forgetting your password, on the phone.
 *
 * The app had no way to ask for a reset link: signing in was the only door,
 * and somebody who had forgotten their password had to find the website on a
 * laptop to get back into an app they had already installed. Every other
 * signed-out path — sign in, sign up, Google, the second factor — is here, so
 * the one people need when they are stuck was the one that wasn't.
 *
 * It mirrors the web page deliberately, including the part that matters most:
 * the answer is the same whether or not there is an account on that address.
 * The server always answers 200 (server/replit_integrations/auth/routes.ts),
 * and a screen that said "no account found" would turn a reset form into a
 * way of asking which of a list of addresses are real.
 *
 * The link in the email opens the website, because setting a password is a
 * one-page job and a deep link into the app would have to be registered,
 * verified per platform, and kept working — for a screen somebody sees once.
 * What the app owes them is the link, and that is what this sends.
 */
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { api } from "../../src/api/client";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import { Btn, Field, Icon, Screen, errText } from "../../src/components/ui";
/*
 * Restated, because Metro doesn't resolve the web app's `@shared` alias — the
 * same reason the other mobile screens restate what they need.
 * test/unit/mobile-restatements.test.ts reads both sides and fails when they
 * drift: the code is the server's refusal code, and the window is how long a
 * reset link lives (shared/moderation.ts, shared/password-reset.ts).
 */
const RATE_LIMITED = "rate_limited";
const RESET_WINDOW = "an hour";

export default function ForgotPassword() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Seconds until another link may be asked for, when the server says to wait. */
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const send = async () => {
    if (!email.trim() || busy || cooldown > 0) return;
    setError(null);
    setBusy(true);
    try {
      await api("/api/auth/forgot-password", { method: "POST", body: { email: email.trim() } });
      setSent(true);
    } catch (e: any) {
      /*
       * A refusal is the one case where nothing was sent, so the confirmation
       * would be a lie. Every limit says when to come back (Retry-After and
       * retryAfterSeconds, server/moderation.ts), so this says it too.
       */
      const wait = Number(e?.body?.retryAfterSeconds ?? 0);
      if (e?.body?.code === RATE_LIMITED || e?.status === 429) {
        if (wait > 0) setCooldown(wait);
        setError(wait > 0
          ? `That's a few requests in a row. Try again in ${wait < 60 ? `${wait} seconds` : `${Math.ceil(wait / 60)} minutes`}.`
          : "That's a few requests in a row. Give it a minute and try again.");
      } else {
        setError(errText(e, "Couldn't send that link. Try again in a moment."));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen contentStyle={s.screen}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.back} testID="button-forgot-back">
          <Icon name="chevron-back" size={20} color={colors.text} />
          <Text style={s.backText}>Back</Text>
        </Pressable>

        <View style={s.card}>
          <Text style={s.title}>{sent ? "Check your inbox" : "Reset your password"}</Text>
          <Text style={s.sub}>
            {sent
              ? "If there's an account for that address, a reset link is on its way."
              : "Enter the address you signed up with and we'll send you a link to set a new password."}
          </Text>

          {error && (
            <View style={s.errorBox} testID="text-forgot-error">
              <Text style={s.error}>{error}</Text>
            </View>
          )}

          {sent ? (
            <View style={{ gap: spacing.md }}>
              <View style={s.noteRow}>
                <Icon name="mail-outline" size={18} color={colors.primary} />
                <Text style={s.note} testID="text-forgot-sent">
                  The link expires in {RESET_WINDOW} and works once. It opens in your browser. Check
                  the spam folder if it isn't there — and if nothing arrives, the address may not have an
                  account on it.
                </Text>
              </View>
              <Btn
                label={cooldown > 0 ? `Send another in ${cooldown}s` : "Send another link"}
                variant="outline"
                onPress={send}
                loading={busy}
                disabled={busy || cooldown > 0}
                testID="button-forgot-resend"
              />
              <Btn label="Back to sign in" variant="ghost" onPress={() => router.back()} testID="button-forgot-done" />
            </View>
          ) : (
            <View style={{ gap: spacing.md }}>
              <Field
                label="Email"
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                testID="input-forgot-email"
              />
              <Btn
                label="Send reset link"
                onPress={send}
                loading={busy}
                disabled={busy || !email.trim() || cooldown > 0}
                testID="button-forgot-send"
              />
            </View>
          )}
        </View>
      </Screen>
    </>
  );
}

const s = StyleSheet.create({
  screen: { padding: spacing.lg, gap: spacing.lg },
  back: { flexDirection: "row", alignItems: "center", gap: 2 },
  backText: { color: colors.text, fontFamily: fontFamily.medium, fontSize: font.sm },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
    gap: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  title: { color: colors.text, fontFamily: fontFamily.bold, fontSize: font.lg },
  sub: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 20 },
  errorBox: {
    backgroundColor: "rgba(230,91,85,0.10)", borderRadius: radius.md,
    padding: spacing.sm, borderWidth: 1, borderColor: "rgba(230,91,85,0.30)",
  },
  error: { color: colors.danger, fontSize: font.sm },
  noteRow: { flexDirection: "row", gap: spacing.sm },
  note: { flex: 1, color: colors.textSecondary, fontSize: font.sm, lineHeight: 20 },
});
