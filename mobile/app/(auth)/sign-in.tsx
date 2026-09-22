import { useRef, useState } from "react";
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../../src/auth/AuthContext";
import { colors, font, fontFamily, radius, shadow, spacing } from "../../src/theme";
import { Icon, type IconName } from "../../src/components/ui";
import { LandingSections } from "../../src/components/onboarding/LandingSections";

type Tab = "login" | "signup";

/**
 * The signed-out front door — the website's landing page
 * (client/src/pages/landing.tsx) on a phone.
 *
 * Same order as the web: the header with Log In / Sign Up, the Tesla hero with
 * Get Started and Learn More, the auth card that opens from any of those, and
 * the landing sections below. The card is the web's AuthCard: Log In and Sign
 * Up tabs, Google first, then email, with the same fields, checks and copy.
 *
 * On success nothing navigates from here: AuthGate sees the new session and
 * sends a fresh account to onboarding (as the web's "/" redirect does) and a
 * returning, onboarded one to the feed.
 */
export default function SignIn() {
  const params = useLocalSearchParams<{ signup?: string }>();
  // Arriving with ?signup=1 opens straight onto sign up, as on the web.
  const arrivedToSignUp = params.signup === "1";
  const router = useRouter();
  const { signIn, signUp, signInWithGoogle, googleAvailable, mfaPending, verifyMfa, cancelMfa } = useAuth();
  const [code, setCode] = useState("");
  const [tab, setTab] = useState<Tab>(arrivedToSignUp ? "signup" : "login");
  const [showAuth, setShowAuth] = useState(arrivedToSignUp);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const cardY = useRef(0);
  const featuresY = useRef(0);

  const openAuth = (t: Tab) => {
    setTab(t);
    setError(null);
    setShowAuth(true);
    // Bring the card into view once it has laid out.
    setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(cardY.current - spacing.lg, 0), animated: true }), 60);
  };
  const switchTab = (t: Tab) => { setTab(t); setError(null); };

  const submit = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    if (tab === "signup") {
      // The web checks these in this order.
      if (password !== confirm) { setError("Passwords do not match"); return; }
      // shared/passwords.ts, restated: the server refuses the same thing, this just says so sooner.
      if (password.length < 8) { setError("Use at least 8 characters — length is what makes a password hard to guess."); return; }
    }
    setBusy(true);
    try {
      if (tab === "login") {
        await signIn(email.trim(), password);
      } else {
        await signUp({ email: email.trim(), password, firstName: firstName.trim(), lastName: lastName.trim() || undefined });
      }
      // AuthGate moves a signed-in person on: onboarding first for a new account.
    } catch (err: any) {
      setError(err?.message || (tab === "login" ? "Login failed" : "Registration failed"));
    } finally {
      setBusy(false);
    }
  };

  // 2FA on: the password was right; the account's code finishes signing in.
  const submitCode = async () => {
    setError(null);
    if (!code.trim()) { setError("Enter the code from your authenticator app."); return; }
    setBusy(true);
    try {
      await verifyMfa(code);
    } catch (err: any) {
      setError(err?.message || "That code isn't right.");
      setCode("");
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
      {/* The web's fixed header: the stacked mark, Log In and Sign Up. */}
      <View style={styles.topBar}>
        <View style={{ alignItems: "center" }}>
          <Image source={require("../../assets/sparktower-logo.png")} style={styles.logoMark} resizeMode="contain" accessibilityLabel="SparkTower" />
          <Text style={styles.wordmark}>SPARKTOWER</Text>
        </View>
        <View style={styles.topActions}>
          <Pressable onPress={() => openAuth("login")} style={({ pressed }) => [styles.topBtn, styles.topBtnPrimary, pressed && styles.pressed]} testID="button-login">
            <Text style={[styles.topBtnText, { color: colors.primaryText }]}>Log In</Text>
          </Pressable>
          <Pressable onPress={() => openAuth("signup")} style={({ pressed }) => [styles.topBtn, styles.topBtnOutline, pressed && styles.pressed]} testID="button-signup-nav">
            <Text style={styles.topBtnText}>Sign Up</Text>
          </Pressable>
        </View>
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView ref={scrollRef} contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <Text style={styles.quote} testID="text-hero-headline">
              "The present is theirs; the future, for which I really worked, <Text style={{ color: colors.primary }}>is mine.</Text>"
            </Text>
            <View style={styles.attribution}><Text style={styles.attributionText}>— Nikola Tesla</Text></View>
            <Text style={styles.tagline}>
              SparkTower is built for the builders who think ahead. Like Tesla, we believe the future belongs to those who create it — connect with visionary entrepreneurs, collaborate with AI, and launch the projects that shape tomorrow.
            </Text>
            <View style={styles.heroButtons}>
              <Pressable onPress={() => openAuth("signup")} style={({ pressed }) => [styles.primaryButton, styles.heroBtn, pressed && styles.pressed]} testID="button-get-started">
                <Text style={styles.primaryButtonText}>Get Started</Text>
              </Pressable>
              <Pressable onPress={() => scrollRef.current?.scrollTo({ y: featuresY.current, animated: true })}
                style={({ pressed }) => [styles.secondaryButton, styles.heroBtn, pressed && styles.pressed]} testID="link-learn-more">
                <Text style={styles.secondaryButtonText}>Learn More</Text>
              </Pressable>
            </View>
          </View>

          {mfaPending && (
            <View style={styles.cardWrap} onLayout={(e) => { cardY.current = e.nativeEvent.layout.y; }}>
              <View style={styles.card} testID="mfa-card">
                <Text style={[styles.tabText, styles.tabTextActive, { textAlign: "center" }]}>Two-factor authentication</Text>
                <Text style={styles.cardSub}>Enter the 6-digit code from your authenticator app, or one of your recovery codes.</Text>
                {error && (
                  <View style={styles.errorBox} testID="text-mfa-error"><Text style={styles.error}>{error}</Text></View>
                )}
                <LabeledInput label="Code" value={code} onChangeText={setCode} placeholder="123456"
                  autoCapitalize="none" autoComplete="one-time-code" textContentType="oneTimeCode"
                  onSubmitEditing={submitCode} returnKeyType="go" autoFocus testID="input-mfa-code" />
                <Pressable onPress={submitCode} disabled={busy} testID="button-mfa-verify"
                  style={({ pressed }) => [styles.primaryButton, (pressed || busy) && styles.pressed]}>
                  {busy ? <ActivityIndicator color={colors.primaryText} /> : <Text style={styles.primaryButtonText}>Verify</Text>}
                </Pressable>
                <Pressable onPress={() => { cancelMfa(); setCode(""); setError(null); setPassword(""); }} testID="button-mfa-cancel">
                  <Text style={styles.switch}>Start over</Text>
                </Pressable>
              </View>
            </View>
          )}

          {showAuth && !mfaPending && (
            <View style={styles.cardWrap} onLayout={(e) => { cardY.current = e.nativeEvent.layout.y; }}>
              <View style={styles.card}>
                <View style={styles.tabs} accessibilityRole="tablist">
                  {(["login", "signup"] as const).map((t) => (
                    <Pressable key={t} onPress={() => switchTab(t)} style={[styles.tab, tab === t && styles.tabActive]}
                      accessibilityRole="tab" accessibilityState={{ selected: tab === t }} testID={`tab-${t}`}>
                      <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t === "login" ? "Log In" : "Sign Up"}</Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.cardSub}>
                  {tab === "login" ? "Welcome back! Log in to your account." : "Create your SparkTower account."}
                </Text>

                <Pressable onPress={google} disabled={busy || !googleAvailable} testID="button-google-auth"
                  style={({ pressed }) => [styles.secondaryButton, (pressed || !googleAvailable) && styles.pressed]}>
                  <Icon name="logo-google" size={18} color={colors.text} />
                  <Text style={styles.secondaryButtonText}>Continue with Google</Text>
                </Pressable>
                {!googleAvailable && (
                  <Text style={styles.hint}>Google sign-in needs client IDs in this build. Email works now.</Text>
                )}

                <View style={styles.dividerRow}>
                  <View style={styles.divider} />
                  <Text style={styles.dividerText}>OR</Text>
                  <View style={styles.divider} />
                </View>

                {error && (
                  <View style={styles.errorBox} testID={tab === "login" ? "text-login-error" : "text-signup-error"}>
                    <Text style={styles.error}>{error}</Text>
                  </View>
                )}

                {tab === "signup" && (
                  <View style={{ flexDirection: "row", gap: spacing.sm }}>
                    <LabeledInput style={{ flex: 1 }} label="First Name" value={firstName} onChangeText={setFirstName} placeholder="Jane" autoCapitalize="words" autoComplete="given-name" testID="input-signup-firstname" />
                    <LabeledInput style={{ flex: 1 }} label="Last Name" value={lastName} onChangeText={setLastName} placeholder="Doe" autoCapitalize="words" autoComplete="family-name" testID="input-signup-lastname" />
                  </View>
                )}

                <LabeledInput label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com"
                  autoCapitalize="none" keyboardType="email-address" autoComplete="email" testID={tab === "login" ? "input-login-email" : "input-signup-email"} />

                <LabeledInput label="Password" value={password} onChangeText={setPassword}
                  placeholder={tab === "signup" ? "At least 8 characters" : "Your password"}
                  secureTextEntry={!showPassword} autoComplete={tab === "signup" ? "new-password" : "current-password"}
                  onSubmitEditing={tab === "login" ? submit : undefined} returnKeyType={tab === "login" ? "go" : "next"}
                  testID={tab === "login" ? "input-login-password" : "input-signup-password"}
                  trailing={
                    <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={10} accessibilityLabel={showPassword ? "Hide password" : "Show password"} testID="button-toggle-password">
                      <Icon name={showPassword ? "eye-off-outline" : "eye-outline"} size={19} color={colors.textTertiary} />
                    </Pressable>
                  }
                />

                {tab === "signup" && (
                  <LabeledInput label="Confirm Password" value={confirm} onChangeText={setConfirm}
                    placeholder="Confirm your password" secureTextEntry={!showPassword} autoComplete="new-password"
                    onSubmitEditing={submit} returnKeyType="go" testID="input-signup-confirm" />
                )}

                {/*
                  * The way back in when the password is the thing you've lost.
                  * Under the password field, where somebody is already looking
                  * when they realise they don't know it.
                  */}
                {tab === "login" && (
                  <Pressable onPress={() => router.push("/(auth)/forgot-password")} hitSlop={8} testID="link-forgot-password">
                    <Text style={styles.forgot}>Forgot your password?</Text>
                  </Pressable>
                )}

                <Pressable onPress={submit} disabled={busy} testID={tab === "login" ? "button-submit-login" : "button-submit-signup"}
                  style={({ pressed }) => [styles.primaryButton, (pressed || busy) && styles.pressed]}>
                  {busy ? <ActivityIndicator color={colors.primaryText} /> : (
                    <Text style={styles.primaryButtonText}>{tab === "login" ? "Log In" : "Create Account"}</Text>
                  )}
                </Pressable>
              </View>
            </View>
          )}

          <View onLayout={(e) => { featuresY.current = e.nativeEvent.layout.y; }}>
            <LandingSections onJoin={() => openAuth("signup")} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

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
  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderColor: "rgba(0,0,0,0.05)", backgroundColor: colors.background,
  },
  // Pinned right, so the mark stays centred as on the web.
  topActions: { position: "absolute", right: spacing.md, top: 0, bottom: 0, flexDirection: "row", alignItems: "center", gap: 6 },
  topBtn: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: radius.sm },
  topBtnPrimary: { backgroundColor: colors.primary },
  topBtnOutline: { borderWidth: 1, borderColor: colors.border },
  topBtnText: { color: colors.text, fontSize: font.xs + 1, fontFamily: fontFamily.semibold },
  logoMark: { width: 40, height: 40 },
  wordmark: { color: colors.text, fontSize: 10, fontFamily: fontFamily.bold, letterSpacing: 2.5, marginTop: -1 },
  hero: { alignItems: "center", paddingHorizontal: spacing.lg, paddingTop: spacing.xxl, paddingBottom: spacing.xl },
  quote: {
    color: colors.text, fontSize: 28, lineHeight: 35, fontFamily: fontFamily.bold, fontStyle: "italic",
    textAlign: "center", letterSpacing: -0.5, maxWidth: 360,
  },
  attribution: { backgroundColor: colors.text, paddingHorizontal: spacing.lg, paddingVertical: 6, marginTop: spacing.lg },
  attributionText: { color: "#FFFFFF", fontSize: font.sm, fontFamily: fontFamily.semibold, letterSpacing: 0.5 },
  tagline: {
    color: colors.textSecondary, fontSize: font.base + 1, textAlign: "center",
    marginTop: spacing.lg, lineHeight: 25, maxWidth: 360, fontFamily: fontFamily.regular,
  },
  heroButtons: { alignSelf: "stretch", gap: spacing.sm, marginTop: spacing.xl },
  heroBtn: { marginTop: 0 },
  cardWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  errorBox: {
    backgroundColor: "rgba(230,91,85,0.1)", borderWidth: 1, borderColor: "rgba(230,91,85,0.2)",
    borderRadius: radius.sm, padding: spacing.md,
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
  cardSub: { color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.regular, textAlign: "center" },
  inputLabel: { color: colors.text, fontSize: font.sm, fontFamily: fontFamily.medium },
  inputWrap: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.sm, paddingHorizontal: spacing.md,
  },
  inputFocused: { borderColor: colors.primary },
  input: { flex: 1, paddingVertical: 12, color: colors.text, fontSize: font.base, fontFamily: fontFamily.regular, minWidth: 0 },
  error: { color: colors.danger, fontSize: font.sm, fontFamily: fontFamily.medium },
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
  forgot: { color: colors.primary, fontFamily: fontFamily.medium, fontSize: font.sm, textAlign: "right" },
  switch: { color: colors.textSecondary, fontSize: font.sm, textAlign: "center", fontFamily: fontFamily.regular },
  switchLink: { color: colors.primary, fontFamily: fontFamily.semibold },
});
