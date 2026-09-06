import { useState } from "react";
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../../src/auth/AuthContext";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";

export default function SignIn() {
  const { signIn, signUp, signInWithGoogle, googleAvailable } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signin") {
        await signIn(email.trim(), password);
      } else {
        await signUp({ email: email.trim(), password, firstName: firstName.trim() });
      }
      // Navigation is handled by AuthGate once `user` is set.
    } catch (err: any) {
      setError(err?.message || "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setError(null);
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      setError(err?.message || "Google sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            {/* Same mark and stacked arrangement as the web header. */}
            <Image
              source={require("../../assets/sparktower-logo.png")}
              style={styles.logoMark}
              resizeMode="contain"
              accessibilityLabel="SparkTower"
            />
            <Text style={styles.logo}>SparkTower</Text>
            <Text style={styles.tagline}>
              Tell Nova where you want to go. Nova helps you figure out how to get there.
            </Text>
          </View>

          <View style={styles.card}>
            <View style={styles.tabs}>
              {(["signin", "signup"] as const).map((m) => (
                <Pressable
                  key={m}
                  onPress={() => { setMode(m); setError(null); }}
                  style={[styles.tab, mode === m && styles.tabActive]}
                >
                  <Text style={[styles.tabText, mode === m && styles.tabTextActive]}>
                    {m === "signin" ? "Sign in" : "Create account"}
                  </Text>
                </Pressable>
              ))}
            </View>

            {mode === "signup" && (
              <TextInput
                value={firstName}
                onChangeText={setFirstName}
                placeholder="First name"
                placeholderTextColor={colors.textTertiary}
                style={styles.input}
                autoCapitalize="words"
                autoComplete="given-name"
              />
            )}

            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              inputMode="email"
            />

            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder={mode === "signup" ? "Password (min 6 characters)" : "Password"}
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
              secureTextEntry
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              onSubmitEditing={submit}
              returnKeyType="go"
            />

            {error && <Text style={styles.error}>{error}</Text>}

            <Pressable
              onPress={submit}
              disabled={busy}
              style={({ pressed }) => [styles.primaryButton, (pressed || busy) && styles.pressed]}
            >
              {busy ? (
                <ActivityIndicator color={colors.primaryText} />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {mode === "signin" ? "Sign in" : "Start building"}
                </Text>
              )}
            </Pressable>

            {googleAvailable && (
              <>
                <View style={styles.dividerRow}>
                  <View style={styles.divider} />
                  <Text style={styles.dividerText}>or</Text>
                  <View style={styles.divider} />
                </View>
                <Pressable
                  onPress={google}
                  disabled={busy}
                  style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
                >
                  <Text style={styles.secondaryButtonText}>Continue with Google</Text>
                </Pressable>
              </>
            )}
          </View>

          {!googleAvailable && (
            <Text style={styles.hint}>
              Google sign-in needs client IDs in this build. Email works now.
            </Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1, justifyContent: "center", padding: spacing.xl },
  header: { marginBottom: spacing.xxl, alignItems: "center" },
  logoMark: { width: 96, height: 96, marginBottom: spacing.xs },
  logo: {
    color: colors.text, fontSize: font.xxl, fontFamily: fontFamily.bold,
    letterSpacing: -0.5,
  },
  tagline: {
    color: colors.textSecondary, fontSize: font.base, textAlign: "center",
    marginTop: spacing.sm, lineHeight: 22, maxWidth: 320,
    fontFamily: fontFamily.regular,
  },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.md,
  },
  tabs: { flexDirection: "row", gap: spacing.xs, marginBottom: spacing.xs },
  tab: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.sm, alignItems: "center" },
  tabActive: { backgroundColor: colors.surfaceRaised },
  // Each weight is its own loaded face, so `fontFamily` carries the weight
  // and `fontWeight` is left off — setting both double-bolds on Android.
  tabText: { color: colors.textTertiary, fontSize: font.sm, fontFamily: fontFamily.semibold },
  tabTextActive: { color: colors.text },
  input: {
    backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    color: colors.text, fontSize: font.base, fontFamily: fontFamily.regular,
  },
  error: { color: colors.danger, fontSize: font.sm, fontFamily: fontFamily.regular },
  primaryButton: {
    backgroundColor: colors.primary, borderRadius: radius.sm,
    paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.xs,
  },
  primaryButtonText: { color: colors.primaryText, fontSize: font.base, fontFamily: fontFamily.bold },
  secondaryButton: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    paddingVertical: spacing.md, alignItems: "center",
  },
  secondaryButtonText: { color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold },
  pressed: { opacity: 0.7 },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  divider: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular },
  hint: {
    color: colors.textTertiary, fontSize: font.xs, textAlign: "center",
    marginTop: spacing.lg, paddingHorizontal: spacing.lg,
    fontFamily: fontFamily.regular,
  },
});
