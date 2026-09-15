import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import { api, uploadFile } from "../src/api/client";
import { useAuth } from "../src/auth/AuthContext";
import { colors, font, fontFamily, radius, spacing } from "../src/theme";
import { Btn, ErrorNote, Field, Icon, NovaGradient, errText, type IconName } from "../src/components/ui";
import { OptionCard } from "../src/components/MoreKit";

/**
 * The profile wizard — the web's /onboarding (client/src/pages/onboarding.tsx),
 * step for step: the same eight steps in the same order, the same questions,
 * choices and copy, the same two calls at the end (POST /api/profile, then
 * POST /api/profile/complete-onboarding), and the same destination after —
 * Nova's new-project flow, because a new account has no projects yet.
 *
 * It lives outside the (auth) group so a signed-in person can reach it.
 * AuthGate keeps anyone who hasn't finished it here, as the web's router does;
 * people who have finished open it from Settings → Profile details to change
 * their answers.
 */
const STEPS = [
  "Basic Info",
  "Skills",
  "Interests",
  "Experience",
  "Co-Founder Preferences",
  "Resume",
  "Links",
  "Review",
];

const COMMON_SKILLS = [
  "React", "TypeScript", "Node.js", "Python", "Go", "Rust", "Next.js", "Tailwind CSS",
  "PostgreSQL", "MongoDB", "AWS", "Docker", "Kubernetes", "GraphQL", "Figma",
];
const COMMON_INTERESTS = [
  "Entrepreneurship", "Web Development", "Mobile Apps", "AI/ML", "Fintech", "Healthtech",
  "SaaS", "Open Source", "Game Dev", "Blockchain",
];

type Opt<T extends string> = { value: T; label: string; body: string; icon: IconName };
const EXPERIENCE: Opt<"beginner" | "intermediate" | "expert">[] = [
  { value: "beginner", label: "Beginner", body: "Just starting out, eager to learn and contribute.", icon: "leaf-outline" },
  { value: "intermediate", label: "Intermediate", body: "Comfortable with core concepts and has some project experience.", icon: "trending-up" },
  { value: "expert", label: "Expert", body: "Deep technical knowledge and significant experience leading projects.", icon: "star-outline" },
];
const RISK: Opt<"low" | "moderate" | "high">[] = [
  { value: "low", label: "Low Risk", body: "Prefer proven ideas with stable revenue potential. Cautious approach.", icon: "shield-checkmark-outline" },
  { value: "moderate", label: "Moderate Risk", body: "Open to some uncertainty with calculated bets. Balanced approach.", icon: "scale-outline" },
  { value: "high", label: "High Risk", body: "Comfortable with moonshots and high-uncertainty ventures. Bold approach.", icon: "rocket-outline" },
];
const SPEED: Opt<"speed" | "balanced" | "polish">[] = [
  { value: "speed", label: "Speed First", body: "Ship fast, iterate later. Get feedback early even if rough.", icon: "flash-outline" },
  { value: "balanced", label: "Balanced", body: "Move quickly but maintain reasonable quality standards.", icon: "git-compare-outline" },
  { value: "polish", label: "Polish First", body: "Take time to get it right. Quality over speed.", icon: "diamond-outline" },
];
const SCHEDULE: Opt<"structured" | "flexible" | "hybrid">[] = [
  { value: "structured", label: "Structured", body: "Fixed daily/weekly schedule. Clear deadlines and milestones.", icon: "calendar-outline" },
  { value: "flexible", label: "Flexible", body: "Work when inspired. Async-first communication style.", icon: "cafe-outline" },
  { value: "hybrid", label: "Hybrid", body: "Some scheduled check-ins, but flexible work hours.", icon: "sync-outline" },
];
// A select on the web ("Direct — Address issues head-on…"); cards on a phone.
const CONFLICT: Opt<"direct" | "diplomatic" | "avoidant" | "collaborative">[] = [
  { value: "direct", label: "Direct", body: "Address issues head-on with honest feedback", icon: "arrow-forward-circle-outline" },
  { value: "diplomatic", label: "Diplomatic", body: "Navigate disagreements with tact and empathy", icon: "hand-left-outline" },
  { value: "avoidant", label: "Avoidant", body: "Prefer to step back and let things cool down", icon: "pause-circle-outline" },
  { value: "collaborative", label: "Collaborative", body: "Work through issues together as a team", icon: "people-outline" },
];
const BUILDER: Opt<"long-term" | "experimental" | "both">[] = [
  { value: "long-term", label: "Long-Term Builder", body: "Committed to growing a product over months or years.", icon: "hourglass-outline" },
  { value: "experimental", label: "Experimenter", body: "Love trying new ideas quickly. Build, test, move on.", icon: "flask-outline" },
  { value: "both", label: "Both", body: "Happy with either approach depending on the project.", icon: "infinite-outline" },
];

interface Form {
  displayName: string; username: string; headline: string; bio: string; location: string;
  skills: string[]; interests: string[];
  experienceLevel?: string; hoursPerWeek: string;
  riskTolerance?: string; speedVsPolish?: string; scheduleStyle?: string; conflictStyle?: string; builderType?: string;
  resumeUrl: string; githubUrl: string; linkedinUrl: string; websiteUrl: string;
}

const EMPTY: Form = {
  displayName: "", username: "", headline: "", bio: "", location: "", skills: [], interests: [],
  experienceLevel: "beginner", hoursPerWeek: "", resumeUrl: "", githubUrl: "", linkedinUrl: "", websiteUrl: "",
};

export default function Welcome() {
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const { profile: sessionProfile, refreshUser, markOnboarded, signOut } = useAuth();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>(EMPTY);
  const [customSkill, setCustomSkill] = useState("");
  const [resumeName, setResumeName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Someone who already finished is editing; everyone else is onboarding.
  // Read once: finishing onboarding flips the session flag just before this screen leaves.
  const [editing] = useState(() => Boolean(sessionProfile?.isOnboarded));

  /*
   * The profile row exists before onboarding opens, seeded at sign-up with
   * whatever the provider gave us (a Google name, or one from the email), so a
   * new account sees its own name already filled in — and an edit starts from
   * the saved answers.
   */
  const { data: existing } = useQuery({
    queryKey: ["profile"],
    queryFn: () => api<any>("/api/profile").catch(() => null),
    retry: false,
  });
  useEffect(() => {
    if (!existing) return;
    setForm((f) => ({
      ...f,
      ...Object.fromEntries(Object.entries({
        displayName: existing.displayName, username: existing.username, headline: existing.headline, bio: existing.bio,
        location: existing.location, skills: existing.skills, interests: existing.interests,
        experienceLevel: existing.experienceLevel, riskTolerance: existing.riskTolerance, speedVsPolish: existing.speedVsPolish,
        scheduleStyle: existing.scheduleStyle, conflictStyle: existing.conflictStyle, builderType: existing.builderType,
        resumeUrl: existing.resumeUrl, githubUrl: existing.githubUrl, linkedinUrl: existing.linkedinUrl, websiteUrl: existing.websiteUrl,
        hoursPerWeek: existing.hoursPerWeek != null ? String(existing.hoursPerWeek) : undefined,
      }).filter(([, v]) => v != null && v !== "")),
    }));
    if (existing.resumeUrl) setResumeName("Resume uploaded");
  }, [existing?.id]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const add = (k: "skills" | "interests", v: string) => { if (!form[k].includes(v)) set(k, [...form[k], v]); };
  const remove = (k: "skills" | "interests", v: string) => set(k, form[k].filter((x) => x !== v));

  const save = useMutation({
    mutationFn: async () => {
      const hours = parseInt(form.hoursPerWeek, 10);
      const body: Record<string, unknown> = {
        ...form,
        hoursPerWeek: Number.isFinite(hours) ? hours : undefined,
      };
      // The server merges only what's sent: leave out blanks that were already blank,
      // but send a cleared field so removing a headline actually removes it.
      for (const [k, v] of Object.entries(body)) if (v === undefined || (v === "" && !existing?.[k])) delete body[k];
      await api("/api/profile", { method: "POST", body });
      await api("/api/profile/complete-onboarding", { method: "POST" });
    },
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["profile-summary"] });
      if (editing) {
        void refreshUser();
        if (router.canGoBack()) router.back(); else router.replace("/(tabs)/feed");
        return;
      }
      // Let AuthGate wave them through before the refresh lands.
      markOnboarded();
      void refreshUser();
      // A new account has no projects; the next thing to do is make one — with Nova.
      router.replace("/project/new" as any);
    },
    onError: (e) => setError(errText(e, "Failed to complete onboarding")),
  });

  const pickResume = async () => {
    setError(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const file = picked.assets[0];
      if ((file.size ?? 0) > 10 * 1024 * 1024) { setError("That file is over 10MB."); return; }
      setResumeName(file.name);
      setUploading(true);
      const path = await uploadFile({ uri: file.uri, name: file.name, mimeType: file.mimeType, size: file.size });
      set("resumeUrl", path);
    } catch (e) {
      setError(`Upload failed: ${errText(e, "try again.")}`);
      setResumeName("");
    } finally {
      setUploading(false);
    }
  };

  const next = () => { setError(null); setStep((s) => Math.min(s + 1, STEPS.length - 1)); };
  const prev = () => { setError(null); setStep((s) => Math.max(s - 1, 0)); };
  const last = step === STEPS.length - 1;
  const pct = ((step + 1) / STEPS.length) * 100;

  const group = <T extends string>(title: string, key: keyof Form, opts: Opt<T>[], optional = true) => (
    <View style={{ gap: spacing.sm }}>
      {title ? <Text style={st.label}>{title}</Text> : null}
      {opts.map((o) => (
        <OptionCard key={o.value} icon={o.icon} title={o.label} body={o.body}
          selected={form[key] === o.value}
          onPress={() => set(key, (optional && form[key] === o.value ? undefined : o.value) as any)} />
      ))}
    </View>
  );

  const prefsSet = Boolean(form.riskTolerance || form.scheduleStyle || form.hoursPerWeek);

  return (
    <>
      <Stack.Screen options={editing
        ? { title: "Profile details" }
        : { headerShown: false, gestureEnabled: false }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: colors.background }}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: editing ? spacing.lg : insets.top + spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl }}
          keyboardShouldPersistTaps="handled"
        >
          {!editing && (
            // Onboarding can't be skipped, as on the web — but a phone has no
            // sidebar to sign out from, so the way out sits here.
            <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
              <Pressable onPress={() => void signOut()} hitSlop={10} testID="button-onboarding-sign-out">
                <Text style={[st.meta, { fontSize: font.sm, color: colors.textSecondary }]}>Sign out</Text>
              </Pressable>
            </View>
          )}

          <View style={{ gap: spacing.sm }}>
            <Text style={st.h1}>Complete Your Profile</Text>
            <Text style={[st.sub, { textAlign: "center" }]}>Let's get you ready to connect and collaborate.</Text>
            <View style={{ paddingTop: spacing.md, gap: spacing.sm }}>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.surfaceRaised, overflow: "hidden" }} testID="progress-onboarding">
                <NovaGradient style={{ width: `${pct}%`, height: "100%", borderRadius: 4 }} />
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.sm }}>
                <Text style={[st.meta, { fontSize: font.sm, flex: 1 }]}>Step {step + 1} of {STEPS.length}: {STEPS[step]}</Text>
                <Text style={[st.meta, { fontSize: font.sm }]}>{Math.round(pct)}%</Text>
              </View>
            </View>
          </View>

          <View style={st.card}>
            <Text style={st.cardTitle}>{STEPS[step]}</Text>

            {step === 0 && (
              <View style={{ gap: spacing.lg }}>
                <Described text="This will be displayed on your profile.">
                  <Field label="Full Name" value={form.displayName} onChangeText={(v) => set("displayName", v)} placeholder="John Doe" autoCapitalize="words" />
                </Described>
                <Described text="Choose a username. Use this if you prefer to stay anonymous.">
                  <Field label="Username" value={form.username} onChangeText={(v) => set("username", v.replace(/\s/g, ""))} placeholder="johndoe" autoCapitalize="none" />
                </Described>
                <Described text="A short tagline about what you do.">
                  <Field label="Professional Headline" value={form.headline} onChangeText={(v) => set("headline", v)} placeholder="Full Stack Developer | AI Enthusiast" />
                </Described>
                <Field label="Bio" value={form.bio} onChangeText={(v) => set("bio", v)} placeholder="Tell us about your background and what you're looking for..." multiline />
                <IconField label="Location" icon="location-outline" value={form.location} onChangeText={(v) => set("location", v)} placeholder="San Francisco, CA" />
              </View>
            )}

            {step === 1 && (
              <View style={{ gap: spacing.lg }}>
                <Selected items={form.skills} empty="No skills added yet." onRemove={(v) => remove("skills", v)} />
                <View style={{ gap: spacing.sm }}>
                  <Text style={st.label}>Common Skills</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                    {COMMON_SKILLS.filter((s) => !form.skills.includes(s)).map((s) => (
                      <AddPill key={s} label={s} onPress={() => add("skills", s)} />
                    ))}
                  </View>
                </View>
                <View style={{ gap: spacing.xs }}>
                  <Text style={st.label}>Add Custom Skill</Text>
                  <TextInput
                    value={customSkill} onChangeText={setCustomSkill} placeholder="e.g. Solidity" placeholderTextColor={colors.textTertiary}
                    returnKeyType="done" blurOnSubmit={false} autoCorrect={false} testID="input-custom-skill"
                    onSubmitEditing={() => { const v = customSkill.trim(); if (v) add("skills", v); setCustomSkill(""); }}
                    style={st.input}
                  />
                </View>
              </View>
            )}

            {step === 2 && (
              <View style={{ gap: spacing.lg }}>
                <Selected items={form.interests} empty="No interests added yet." onRemove={(v) => remove("interests", v)} />
                <View style={{ gap: spacing.sm }}>
                  <Text style={st.label}>Common Interests</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                    {COMMON_INTERESTS.filter((s) => !form.interests.includes(s)).map((s) => (
                      <AddPill key={s} label={s} onPress={() => add("interests", s)} />
                    ))}
                  </View>
                </View>
              </View>
            )}

            {step === 3 && group("", "experienceLevel", EXPERIENCE, false)}

            {step === 4 && (
              <View style={{ gap: spacing.xl }}>
                <Text style={st.sub}>These preferences help us find your ideal co-founder match. All fields are optional.</Text>
                <Described text="How many hours per week can you dedicate to a co-founder project?">
                  <Field label="Hours per Week" value={form.hoursPerWeek}
                    onChangeText={(v) => { const n = v.replace(/\D/g, "").slice(0, 2); set("hoursPerWeek", n && Number(n) > 80 ? "80" : n); }}
                    placeholder="e.g. 20" numeric />
                </Described>
                {group("Risk Tolerance", "riskTolerance", RISK)}
                {group("Speed vs Polish", "speedVsPolish", SPEED)}
                {group("Schedule Style", "scheduleStyle", SCHEDULE)}
                <View style={{ gap: spacing.xs }}>
                  {group("Conflict Resolution Style", "conflictStyle", CONFLICT)}
                  <Text style={st.meta}>How do you prefer to handle disagreements with a partner?</Text>
                </View>
                {group("Builder Type", "builderType", BUILDER)}
              </View>
            )}

            {step === 5 && (
              <View style={{ gap: spacing.md }}>
                <Text style={st.sub}>
                  Upload your resume so collaborators and project leads can learn more about your background. Accepted formats: PDF, DOC, DOCX.
                </Text>
                {form.resumeUrl ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: "rgba(16,185,129,0.3)", backgroundColor: "#ECFDF5" }}>
                    <Icon name="checkmark-circle" size={22} color="#10B981" />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[st.body, { fontFamily: fontFamily.medium }]} numberOfLines={1}>{resumeName || "Resume uploaded"}</Text>
                      <Text style={st.meta}>Your resume has been uploaded successfully.</Text>
                    </View>
                    <Btn label="Remove" small variant="outline" onPress={() => { set("resumeUrl", ""); setResumeName(""); }} />
                  </View>
                ) : (
                  <Pressable onPress={pickResume} disabled={uploading} testID="button-upload-resume"
                    style={({ pressed }) => ({ alignItems: "center", gap: spacing.sm, padding: spacing.xl, borderRadius: radius.md, borderWidth: 2, borderStyle: "dashed", borderColor: pressed ? colors.primary : colors.border })}>
                    {uploading ? (
                      <Text style={st.meta}>Uploading...</Text>
                    ) : (
                      <>
                        <Icon name="document-text-outline" size={32} color={colors.textTertiary} />
                        <Text style={[st.body, { fontFamily: fontFamily.medium }]}>Tap to upload your resume</Text>
                        <Text style={st.meta}>PDF, DOC, or DOCX up to 10MB</Text>
                      </>
                    )}
                  </Pressable>
                )}
                <Text style={[st.meta, { fontStyle: "italic" }]}>This step is optional — you can always upload or update your resume later.</Text>
              </View>
            )}

            {step === 6 && (
              <View style={{ gap: spacing.lg }}>
                <IconField label="GitHub URL" icon="logo-github" value={form.githubUrl} onChangeText={(v) => set("githubUrl", v)} placeholder="https://github.com/username" url />
                <IconField label="LinkedIn URL" icon="logo-linkedin" value={form.linkedinUrl} onChangeText={(v) => set("linkedinUrl", v)} placeholder="https://linkedin.com/in/username" url />
                <IconField label="Personal Website" icon="globe-outline" value={form.websiteUrl} onChangeText={(v) => set("websiteUrl", v)} placeholder="https://example.com" url />
              </View>
            )}

            {step === 7 && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: spacing.lg }}>
                <ReviewItem label="Name" value={form.displayName} />
                <ReviewItem label="Username" value={form.username ? `@${form.username}` : ""} />
                <ReviewItem label="Headline" value={form.headline} full />
                <ReviewItem label="Location" value={form.location} />
                <ReviewItem label="Experience" badge={form.experienceLevel} />
                <ReviewItem label="Bio" value={form.bio} full lines={3} />
                <View style={{ width: "100%", gap: 4 }}>
                  <Text style={st.reviewLabel}>SKILLS</Text>
                  {form.skills.length > 0 ? (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
                      {form.skills.map((s) => <View key={s} style={st.smallBadge}><Text style={st.smallBadgeText}>{s}</Text></View>)}
                    </View>
                  ) : <Text style={[st.body, { color: colors.textTertiary }]}>None</Text>}
                </View>
                {form.resumeUrl ? (
                  <View style={{ width: "100%", gap: 4 }}>
                    <Text style={st.reviewLabel}>RESUME</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Icon name="document-text-outline" size={16} color="#10B981" />
                      <Text style={st.body}>{resumeName || "Uploaded"}</Text>
                    </View>
                  </View>
                ) : null}
                {prefsSet && (
                  <>
                    <View style={{ width: "100%", paddingTop: spacing.xs }}>
                      <Text style={st.reviewLabel}>CO-FOUNDER PREFERENCES</Text>
                    </View>
                    {form.hoursPerWeek ? <ReviewItem small label="Hours/Week" value={`${form.hoursPerWeek}h`} /> : null}
                    {form.riskTolerance ? <ReviewItem small label="Risk Tolerance" badge={form.riskTolerance} /> : null}
                    {form.speedVsPolish ? <ReviewItem small label="Speed vs Polish" badge={form.speedVsPolish} /> : null}
                    {form.scheduleStyle ? <ReviewItem small label="Schedule" badge={form.scheduleStyle} /> : null}
                    {form.conflictStyle ? <ReviewItem small label="Conflict Style" badge={form.conflictStyle} /> : null}
                    {form.builderType ? <ReviewItem small label="Builder Type" badge={form.builderType} /> : null}
                  </>
                )}
              </View>
            )}

            {error && <ErrorNote message={error} />}
          </View>
        </ScrollView>

        <View style={{ flexDirection: "row", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md + insets.bottom, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.background }}>
          {editing && step === 0 ? (
            <Btn label="Cancel" variant="ghost" style={{ flex: 1 }} onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/feed"))} />
          ) : (
            <Btn label="Back" variant="ghost" style={{ flex: 1 }} onPress={prev} disabled={step === 0 || save.isPending} />
          )}
          {last ? (
            <Btn label={save.isPending ? "Completing..." : "Complete Profile"} style={{ flex: 1.4 }} loading={save.isPending}
              onPress={() => { setError(null); save.mutate(); }} />
          ) : (
            <Btn label="Next Step" style={{ flex: 1.4 }} onPress={next} />
          )}
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

/** A field with the web's FormDescription under it. */
function Described({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      {children}
      <Text style={st.meta}>{text}</Text>
    </View>
  );
}

function IconField({ label, icon, value, onChangeText, placeholder, url }: {
  label: string; icon: IconName; value: string; onChangeText: (v: string) => void; placeholder: string; url?: boolean;
}) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={st.label}>{label}</Text>
      <View style={[st.input, { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 0 }]}>
        <Icon name={icon} size={17} color={colors.textTertiary} />
        <TextInput
          value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.textTertiary}
          autoCapitalize={url ? "none" : "words"} autoCorrect={false} keyboardType={url ? "url" : "default"}
          style={{ flex: 1, minWidth: 0, paddingVertical: 12, color: colors.text, fontSize: font.base, fontFamily: fontFamily.regular }}
        />
      </View>
    </View>
  );
}

/** What's been added, each with a remove button — or the web's empty line. */
function Selected({ items, empty, onRemove }: { items: string[]; empty: string; onRemove: (v: string) => void }) {
  if (items.length === 0) return <Text style={[st.body, { color: colors.textTertiary }]}>{empty}</Text>;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
      {items.map((v) => (
        <View key={v} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 10, paddingRight: 6, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.primarySoft }}>
          <Text style={{ color: colors.primary, fontSize: font.sm, fontFamily: fontFamily.semibold }}>{v}</Text>
          <Pressable onPress={() => onRemove(v)} hitSlop={8} accessibilityLabel={`Remove ${v}`}>
            <Icon name="close" size={14} color={colors.primary} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

function AddPill({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: pressed ? colors.surfaceRaised : colors.background })}>
      <Icon name="add" size={13} color={colors.text} />
      <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.medium }}>{label}</Text>
    </Pressable>
  );
}

function ReviewItem({ label, value, badge, full, lines, small }: {
  label: string; value?: string; badge?: string; full?: boolean; lines?: number; small?: boolean;
}) {
  return (
    <View style={{ width: full ? "100%" : "50%", paddingRight: full ? 0 : spacing.sm, gap: 4 }}>
      <Text style={small ? st.meta : st.reviewLabel}>{small ? label : label.toUpperCase()}</Text>
      {badge !== undefined ? (
        <View style={[st.smallBadge, { alignSelf: "flex-start", backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }]}>
          <Text style={[st.smallBadgeText, { textTransform: "capitalize" }]}>{badge}</Text>
        </View>
      ) : (
        <Text numberOfLines={lines} style={[st.body, { fontFamily: full ? fontFamily.regular : fontFamily.medium, color: value ? colors.text : colors.textTertiary }]}>
          {value || "Not set"}
        </Text>
      )}
    </View>
  );
}

const st = {
  h1: { color: colors.text, fontSize: font.xxl + 2, fontFamily: fontFamily.bold, letterSpacing: -0.5, textAlign: "center" as const },
  sub: { color: colors.textSecondary, fontSize: font.sm + 1, lineHeight: 20, fontFamily: fontFamily.regular },
  label: { color: colors.text, fontSize: font.sm + 1, fontFamily: fontFamily.medium },
  body: { color: colors.text, fontSize: font.sm + 1, lineHeight: 20, fontFamily: fontFamily.regular },
  meta: { color: colors.textTertiary, fontSize: font.xs + 1, lineHeight: 17, fontFamily: fontFamily.regular },
  card: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: spacing.lg, gap: spacing.lg },
  cardTitle: { color: colors.text, fontSize: font.xl, fontFamily: fontFamily.semibold, letterSpacing: -0.3 },
  input: {
    backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, paddingVertical: 12, color: colors.text, fontSize: font.base, fontFamily: fontFamily.regular,
  },
  reviewLabel: { color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.medium, letterSpacing: 0.4 },
  smallBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised },
  smallBadgeText: { color: colors.text, fontSize: font.xs, fontFamily: fontFamily.semibold },
};
