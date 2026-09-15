import { useState } from "react";
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../../src/auth/AuthContext";
import { colors, font, fontFamily, radius, shadow, spacing } from "../../src/theme";
import { Icon, NovaGradient, type IconName } from "../../src/components/ui";

/**
 * Sign in and sign up, in the website's light landing look: the SparkTower
 * mark, the Tesla line with its purple ending, and one white card holding
 * both forms — the same fields and checks as the web's AuthCard.
 */
export default function SignIn() {
  const router = useRouter();
  const { signIn, signUp, signInWithGoogle, googleAvailable } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchMode = (m: "signin" | "signup") => { setMode(m); setError(null); };

  const submit = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    if (mode === "signup") {
      if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
      if (password !== confirm) { setError("Passwords do not match."); return; }
    }
    setBusy(true);
    try {
      if (mode === "signin") {
        await signIn(email.trim(), password);
        // AuthGate moves a signed-in person on.
      } else {
        await signUp({ email: email.trim(), password, firstName: firstName.trim(), lastName: lastName.trim() || undefined });
        // A new account starts with its profile, as on the website.
        router.replace("/welcome");
      }
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
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <NovaGradient style={{ height: 4 }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            {/* The web header's stacked mark and wordmark. */}
            <Image source={require("../../assets/sparktower-logo.png")} style={styles.logoMark} resizeMode="contain" accessibilityLabel="SparkTower" />
            <Text style={styles.wordmark}>SPARKTOWER</Text>
            <Text style={styles.quote}>
              "The present is theirs; the future, for which I really worked, <Text style={{ color: colors.primary }}>is mine.</Text>"
            </Text>
            <View style={styles.attribution}><Text style={styles.attributionText}>— Nikola Tesla</Text></View>
            <Text style={styles.tagline}>
              Tell Nova where you want to go. Nova helps you figure out how to get there.
            </Text>
          </View>

          <View style={styles.card}>
            <View style={styles.tabs} accessibilityRole="tablist">
              {(["signin", "signup"] as const).map((m) => (
                <Pressable key={m} onPress={() => switchMode(m)} style={[styles.tab, mode === m && styles.tabActive]}
                  accessibilityRole="tab" accessibilityState={{ selected: mode === m }} testID={`tab-${m}`}>
                  <Text style={[styles.tabText, mode === m && styles.tabTextActive]}>{m === "signin" ? "Log in" : "Sign up"}</Text>
                </Pressable>
              ))}
            </View>

            <View style={{ gap: 2 }}>
              <Text style={styles.cardTitle}>{mode === "signin" ? "Welcome back" : "Create your account"}</Text>
              <Text style={styles.cardSub}>
                {mode === "signin" ? "Log in to pick up where you left off." : "Start building with Nova and the builders around you."}
              </Text>
            </View>

            {mode === "signup" && (
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <LabeledInput style={{ flex: 1 }} label="First name" value={firstName} onChangeText={setFirstName} placeholder="Jane" autoCapitalize="words" autoComplete="given-name" />
                <LabeledInput style={{ flex: 1 }} label="Last name" value={lastName} onChangeText={setLastName} placeholder="Doe" autoCapitalize="words" autoComplete="family-name" />
              </View>
            )}

            <LabeledInput label="Email" icon="mail-outline" value={email} onChangeText={setEmail} placeholder="you@example.com"
              autoCapitalize="none" keyboardType="email-address" autoComplete="email" testID="input-email" />

            <LabeledInput label="Password" icon="lock-closed-outline" value={password} onChangeText={setPassword}
              placeholder={mode === "signup" ? "At least 6 characters" : "Your password"}
              secureTextEntry={!showPassword} autoComplete={mode === "signup" ? "new-password" : "current-password"}
              onSubmitEditing={mode === "signin" ? submit : undefined} returnKeyType={mode === "signin" ? "go" : "next"} testID="input-password"
              trailing={
                <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={10} accessibilityLabel={showPassword ? "Hide password" : "Show password"}>
                  <Icon name={showPassword ? "eye-off-outline" : "eye-outline"} size={19} color={colors.textTertiary} />
                </Pressable>
              }
            />

            {mode === "signup" && (
              <LabeledInput label="Confirm password" icon="lock-closed-outline" value={confirm} onChangeText={setConfirm}
                placeholder="Type it again" secureTextEntry={!showPassword} autoComplete="new-password" onSubmitEditing={submit} returnKeyType="go" />
            )}

            {error && (
              <View style={styles.errorRow}>
                <Icon name="alert-circle" size={16} color={colors.danger} />
                <Text style={styles.error}>{error}</Text>
              </View>
            )}

            <Pressable onPress={submit} disabled={busy} testID="button-submit"
              style={({ pressed }) => [styles.primaryButton, (pressed || busy) && styles.pressed]}>
              {busy ? <ActivityIndicator color={colors.primaryText} /> : (
                <Text style={styles.primaryButtonText}>{mode === "signin" ? "Log in" : "Get started"}</Text>
              )}
            </Pressable>

            <View style={styles.dividerRow}>
              <View style={styles.divider} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.divider} />
            </View>
            <Pressable onPress={google} disabled={busy || !googleAvailable}
              style={({ pressed }) => [styles.secondaryButton, (pressed || !googleAvailable) && styles.pressed]}>
              <Icon name="logo-google" size={18} color={colors.text} />
              <Text style={styles.secondaryButtonText}>Continue with Google</Text>
            </Pressable>
            {!googleAvailable && (
              <Text style={styles.hint}>Google sign-in needs client IDs in this build. Email works now.</Text>
            )}

            <Text style={styles.switch}>
              {mode === "signin" ? "New to SparkTower? " : "Already have an account? "}
              <Text style={styles.switchLink} onPress={() => switchMode(mode === "signin" ? "signup" : "signin")}>
                {mode === "signin" ? "Create an account" : "Log in"}
              </Text>
            </Text>
          </View>

          <View style={styles.features}>
            {FEATURES.map((f) => (
              <View key={f.label} style={styles.feature}>
                <View style={styles.featureIcon}><Icon name={f.icon} size={16} color={colors.primary} /></View>
                <Text style={styles.featureText}>{f.label}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const FEATURES: { icon: IconName; label: string }[] = [
  { icon: "sparkles", label: "Nova plans it" },
  { icon: "people", label: "Find co-founders" },
  { icon: "rocket", label: "Ship and show" },
];

function LabeledInput({ label, icon, trailing, style, ...input }: React.ComponentProps<typeof TextInput> & {
  label: string;
  icon?: IconName;
  trailing?: React.ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[{ gap: 6 }, style]}>
      <Text style={styles.inputLabel}>{label}</Text>
      <View style={[styles.inputWrap, focused && styles.inputFocused]}>
        {icon && <Icon name={icon} size={18} color={focused ? colors.primary : colors.textTertiary} />}
        <TextInput
          {...input}
          placeholderTextColor={colors.textTertiary}
          autoCorrect={false}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={styles.input}
        />
        {trailing}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: spacing.lg, paddingVertical: spacing.xl },
  header: { marginBottom: spacing.xl, alignItems: "center" },
  logoMark: { width: 64, height: 64 },
  wordmark: { color: colors.text, fontSize: font.xs, fontFamily: fontFamily.bold, letterSpacing: 3, marginTop: 2 },
  quote: {
    color: colors.text, fontSize: 21, lineHeight: 28, fontFamily: fontFamily.bold, fontStyle: "italic",
    textAlign: "center", marginTop: spacing.lg, letterSpacing: -0.3, maxWidth: 340,
  },
  attribution: { backgroundColor: colors.text, paddingHorizontal: spacing.md, paddingVertical: 4, marginTop: spacing.md },
  attributionText: { color: "#FFFFFF", fontSize: font.xs, fontFamily: fontFamily.semibold, letterSpacing: 0.5 },
  tagline: {
    color: colors.textSecondary, fontSize: font.sm, textAlign: "center",
    marginTop: spacing.md, lineHeight: 20, maxWidth: 300, fontFamily: fontFamily.regular,
  },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, gap: spacing.md, ...shadow.card,
  },
  tabs: { flexDirection: "row", backgroundColor: colors.surfaceRaised, borderRadius: radius.pill, padding: 4 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: radius.pill, alignItems: "center" },
  tabActive: { backgroundColor: colors.surface, ...shadow.card },
  // Each weight is its own loaded face, so `fontFamily` carries the weight.
  tabText: { color: colors.textTertiary, fontSize: font.sm, fontFamily: fontFamily.semibold },
  tabTextActive: { color: colors.text },
  cardTitle: { color: colors.text, fontSize: font.lg, fontFamily: fontFamily.bold },
  cardSub: { color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.regular },
  inputLabel: { color: colors.text, fontSize: font.sm, fontFamily: fontFamily.medium },
  inputWrap: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.sm, paddingHorizontal: spacing.md,
  },
  inputFocused: { borderColor: colors.primary },
  input: { flex: 1, paddingVertical: 12, color: colors.text, fontSize: font.base, fontFamily: fontFamily.regular, minWidth: 0 },
  errorRow: { flexDirection: "row", gap: 6, alignItems: "center" },
  error: { flex: 1, color: colors.danger, fontSize: font.sm, fontFamily: fontFamily.medium },
  primaryButton: {
    backgroundColor: colors.primary, borderRadius: radius.pill,
    paddingVertical: 14, alignItems: "center", marginTop: spacing.xs,
  },
  primaryButtonText: { color: colors.primaryText, fontSize: font.base, fontFamily: fontFamily.bold },
  secondaryButton: {
    flexDirection: "row", gap: spacing.sm, justifyContent: "center",
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill,
    paddingVertical: 12, alignItems: "center",
  },
  secondaryButtonText: { color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold },
  pressed: { opacity: 0.6 },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  divider: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular },
  hint: { color: colors.textTertiary, fontSize: font.xs, textAlign: "center", fontFamily: fontFamily.regular },
  switch: { color: colors.textSecondary, fontSize: font.sm, textAlign: "center", fontFamily: fontFamily.regular },
  switchLink: { color: colors.primary, fontFamily: fontFamily.semibold },
  features: { flexDirection: "row", justifyContent: "center", gap: spacing.md, marginTop: spacing.xl, flexWrap: "wrap" },
  feature: { flexDirection: "row", alignItems: "center", gap: 6 },
  featureIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  featureText: { color: colors.textSecondary, fontSize: font.xs, fontFamily: fontFamily.medium },
});
