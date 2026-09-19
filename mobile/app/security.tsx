import { useState } from "react";
import { Clipboard, Linking, ScrollView, Text, View } from "react-native";
import { Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../src/api/client";
import { useAuth } from "../src/auth/AuthContext";
import { colors, font, fontFamily, radius, spacing } from "../src/theme";
import { Btn, ErrorNote, Field, Loading, errText } from "../src/components/ui";
import { Group, MenuRow } from "../src/components/MoreKit";
import { NoticeBanner, useNotice } from "../src/components/Sheet";

interface MfaStatus { required: boolean; enabled: boolean; verified: boolean; recoveryCodesLeft: number }

/**
 * Two-factor authentication, on the phone.
 *
 * The web has the same page (client/src/pages/security-settings.tsx), and
 * until this existed a reviewer or admin who only uses the phone was stuck:
 * the review screens refuse until 2FA is on, and there was nowhere to turn it
 * on. Same endpoints, same wording.
 *
 * There's no QR code here because there's nothing to scan from — the key is
 * copyable, and "open in your authenticator app" hands it to the app directly.
 */
export default function Security() {
  const qc = useQueryClient();
  const { notice, show, clear } = useNotice();
  const { data: status, isLoading } = useQuery<MfaStatus>({ queryKey: ["mfa-status"], queryFn: () => api<MfaStatus>("/api/auth/mfa/status") });
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["mfa-status"] });

  const start = useMutation({
    mutationFn: () => api<{ secret: string; otpauthUrl: string }>("/api/auth/mfa/setup", { method: "POST", body: {} }),
    onSuccess: (r) => { setSetup(r); setCode(""); setError(null); },
    onError: (e) => setError(errText(e, "Couldn't start setting that up.")),
  });

  const enable = useMutation({
    mutationFn: () => api<{ recoveryCodes: string[] }>("/api/auth/mfa/enable", { method: "POST", body: { code: code.trim() } }),
    onSuccess: async (r) => { setCodes(r.recoveryCodes); setSetup(null); setError(null); await refresh(); },
    onError: (e) => setError(errText(e, "That code isn't right.")),
  });

  const regenerate = useMutation({
    mutationFn: () => api<{ recoveryCodes: string[] }>("/api/auth/mfa/recovery-codes", { method: "POST", body: {} }),
    onSuccess: async (r) => { setCodes(r.recoveryCodes); await refresh(); },
    onError: (e) => setError(errText(e, "Couldn't make new codes.")),
  });

  const copy = (text: string, what: string) => { Clipboard.setString(text); show({ tone: "success", text: `${what} copied.` }); };

  if (isLoading || !status) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        <Stack.Screen options={{ title: "Security" }} />
        <Loading />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: "Security" }} />
      <ScrollView style={{ flex: 1, backgroundColor: colors.canvas }} contentContainerStyle={{ paddingVertical: spacing.lg, gap: spacing.lg }}>
        {error && <View style={{ paddingHorizontal: spacing.lg }}><ErrorNote message={error} /></View>}

        <Group
          title="Two-factor authentication"
          footer={status.required
            ? "Your account can review or administer SparkTower, so signing in needs a code from an authenticator app as well as your password."
            : "Ask for a code from an authenticator app as well as your password when you sign in."}
        >
          <MenuRow
            icon={status.enabled ? "shield-checkmark" : "shield-outline"}
            title={status.enabled ? "On" : "Off"}
            subtitle={status.enabled ? `${status.recoveryCodesLeft} recovery code${status.recoveryCodesLeft === 1 ? "" : "s"} left` : "Not set up yet"}
            tint={status.enabled ? colors.success : colors.textSecondary}
            right={<View />}
          />
        </Group>

        {!status.enabled && !setup && (
          <View style={{ paddingHorizontal: spacing.lg }}>
            <Btn label="Set up two-factor" loading={start.isPending} onPress={() => start.mutate()} testID="mfa-start" />
          </View>
        )}

        {setup && (
          <Group title="1. Add the key to your authenticator app" footer="Google Authenticator, 1Password, Authy — any of them.">
            <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm }}>
              <Text selectable style={{ color: colors.text, fontSize: font.base, fontFamily: "Courier", letterSpacing: 1, backgroundColor: colors.surfaceRaised, padding: spacing.md, borderRadius: radius.sm }} testID="mfa-secret">
                {setup.secret.replace(/(.{4})/g, "$1 ").trim()}
              </Text>
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <Btn label="Copy key" variant="outline" style={{ flex: 1 }} onPress={() => copy(setup.secret, "Key")} />
                <Btn label="Open in app" variant="outline" style={{ flex: 1 }} onPress={() => Linking.openURL(setup.otpauthUrl).catch(() => setError("No authenticator app could open that. Copy the key instead."))} />
              </View>
              <Text style={{ color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.semibold, marginTop: spacing.sm }}>2. Enter the 6-digit code it shows</Text>
              <Field label="" value={code} onChangeText={setCode} numeric placeholder="123456" />
              <Btn label="Turn on" loading={enable.isPending} disabled={!code.trim()} onPress={() => enable.mutate()} testID="mfa-enable" />
            </View>
          </Group>
        )}

        {codes && (
          <Group title="Recovery codes" footer="Save these somewhere safe. Each one signs you in once if you lose your phone. They won't be shown again.">
            <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm }}>
              {codes.map((c) => (
                <Text key={c} selectable style={{ color: colors.text, fontSize: font.base, fontFamily: "Courier" }}>{c}</Text>
              ))}
              <Btn label="Copy all" variant="outline" onPress={() => copy(codes.join("\n"), "Recovery codes")} />
            </View>
          </Group>
        )}

        {status.enabled && !codes && (
          <View style={{ paddingHorizontal: spacing.lg }}>
            <Btn
              label="New recovery codes"
              variant="outline"
              loading={regenerate.isPending}
              disabled={!status.verified}
              onPress={() => regenerate.mutate()}
            />
            {!status.verified && (
              <Text style={{ color: colors.textTertiary, fontSize: font.sm, fontFamily: fontFamily.regular, marginTop: spacing.sm }}>
                This sign-in didn't use your authenticator code. Sign out and back in to make new codes.
              </Text>
            )}
          </View>
        )}

        <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular, paddingHorizontal: spacing.lg }}>
          Lost your phone and your recovery codes? Contact support — we can turn it off once we know it's you.
        </Text>

        <Password />
      </ScrollView>
      <NoticeBanner notice={notice} onDismiss={clear} />
    </>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Changing the password, the same form as the web page
 * (client/src/pages/security-settings.tsx) and the same route.
 *
 * The route ends every other session, which is the reason to change a password
 * in the first place, so it's said before the button rather than after. An
 * account that signs in with Google has no password of its own; the provider
 * is on the account row, and the route says so too if the row turns out to
 * have a password after all — someone who set one before linking Google.
 */
function Password() {
  const { user, signOut } = useAuth();
  const [anyway, setAnyway] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [noPassword, setNoPassword] = useState(false);
  const [done, setDone] = useState<{ sessionsEnded: number; devicesSignedOut: number } | null>(null);

  const change = useMutation({
    mutationFn: () => api<{ sessionsEnded: number; devicesSignedOut: number }>("/api/auth/change-password", {
      method: "POST",
      body: { currentPassword: current, newPassword: next },
    }),
    onSuccess: (r) => { setDone(r); setError(null); setCurrent(""); setNext(""); setAgain(""); },
    onError: (e: any) => {
      if (e?.body?.code === "no_password") setNoPassword(true);
      else setError(errText(e, "Couldn't change your password. Nothing was changed."));
    },
  });

  const submit = () => {
    if (next !== again) return setError("The two new passwords don't match.");
    setError(null);
    change.mutate();
  };

  const google = user?.authProvider === "google";
  const explainGoogle = "You sign in to SparkTower with Google, so this account has no password of its own. Your password is your Google account's, and you change it with Google.";

  if (noPassword || (google && !anyway)) {
    return (
      <Group title="Password" footer={explainGoogle}>
        {!noPassword && (
          <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
            <Btn label="I had a password before I linked Google" variant="outline" onPress={() => setAnyway(true)} testID="password-anyway" />
          </View>
        )}
      </Group>
    );
  }

  if (done) {
    return (
      <Group title="Password" footer="Anyone who knew the old password will have to start again.">
        <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm }}>
          <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.regular, lineHeight: 21 }} testID="password-changed">
            Your password is changed, and every session on the account was signed out: {plural(done.sessionsEnded, "browser session", "browser sessions")} ended
            and {plural(done.devicesSignedOut, "phone", "phones")} signed out, this one included. Sign in again with the new password.
          </Text>
          <Btn label="Sign in again" onPress={() => { void signOut(); }} testID="password-signin-again" />
        </View>
      </Group>
    );
  }

  return (
    <Group title="Password" footer={"At least 8 characters \u2014 a few words beat a short scramble. Changing it signs out every session on your account, this phone included, so you'll sign in again here."}>
      <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm }}>
        {error && <ErrorNote message={error} />}
        <Field label="Current password" value={current} onChangeText={setCurrent} secureTextEntry autoCapitalize="none" placeholder="Your password" />
        <Field label="New password" value={next} onChangeText={setNext} secureTextEntry autoCapitalize="none" placeholder="At least 8 characters" />
        <Field label="New password again" value={again} onChangeText={setAgain} secureTextEntry autoCapitalize="none" placeholder="The same again" />
        <Btn
          label="Change password"
          loading={change.isPending}
          disabled={!current || !next || !again}
          onPress={submit}
          testID="password-change"
        />
      </View>
    </Group>
  );
}
