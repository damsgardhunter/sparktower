import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import { api, uploadFile } from "../src/api/client";
import { useAuth } from "../src/auth/AuthContext";
import { colors, font, fontFamily, radius, spacing } from "../src/theme";
import { Btn, Chip, ErrorNote, Field, Icon, NovaGradient, errText, type IconName } from "../src/components/ui";
import { Callout, OptionCard } from "../src/components/MoreKit";

/**
 * The profile wizard — the web's /onboarding, step for step.
 *
 * It lives outside the (auth) group so a signed-in person can reach it: the
 * root AuthGate sends anyone signed in away from (auth). New accounts arrive
 * here from sign-up and from app launch; everyone else opens it from More →
 * Profile details to change their answers.
 */
const STEPS = ["Basic info", "Skills", "Interests", "Experience", "Co-founder preferences", "Resume", "Links", "Review"];

const COMMON_SKILLS = ["React", "TypeScript", "Node.js", "Python", "Go", "Rust", "Next.js", "Tailwind CSS", "PostgreSQL", "MongoDB", "AWS", "Docker", "Kubernetes", "GraphQL", "Figma"];
const COMMON_INTERESTS = ["Entrepreneurship", "Web Development", "Mobile Apps", "AI/ML", "Fintech", "Healthtech", "SaaS", "Open Source", "Game Dev", "Blockchain"];

type Opt<T extends string> = { value: T; label: string; body: string; icon: IconName };
const EXPERIENCE: Opt<"beginner" | "intermediate" | "expert">[] = [
  { value: "beginner", label: "Beginner", body: "Just starting out, eager to learn and contribute.", icon: "leaf-outline" },
  { value: "intermediate", label: "Intermediate", body: "Comfortable with core concepts and has some project experience.", icon: "trending-up" },
  { value: "expert", label: "Expert", body: "Deep technical knowledge and significant experience leading projects.", icon: "star-outline" },
];
const RISK: Opt<"low" | "moderate" | "high">[] = [
  { value: "low", label: "Low", body: "Proven ideas with stable revenue potential.", icon: "shield-checkmark-outline" },
  { value: "moderate", label: "Moderate", body: "Some uncertainty, calculated bets.", icon: "scale-outline" },
  { value: "high", label: "High", body: "Moonshots and high-uncertainty ventures.", icon: "rocket-outline" },
];
const SPEED: Opt<"speed" | "balanced" | "polish">[] = [
  { value: "speed", label: "Speed", body: "Ship fast, iterate later.", icon: "flash-outline" },
  { value: "balanced", label: "Balanced", body: "Quick, with reasonable quality.", icon: "git-compare-outline" },
  { value: "polish", label: "Polish", body: "Quality over speed.", icon: "diamond-outline" },
];
const SCHEDULE: Opt<"structured" | "flexible" | "hybrid">[] = [
  { value: "structured", label: "Structured", body: "Fixed schedule, clear deadlines.", icon: "calendar-outline" },
  { value: "flexible", label: "Flexible", body: "Work when inspired, async-first.", icon: "cafe-outline" },
  { value: "hybrid", label: "Hybrid", body: "Some check-ins, flexible hours.", icon: "sync-outline" },
];
const CONFLICT: Opt<"direct" | "diplomatic" | "avoidant" | "collaborative">[] = [
  { value: "direct", label: "Direct", body: "Say it plainly.", icon: "arrow-forward-circle-outline" },
  { value: "diplomatic", label: "Diplomatic", body: "Tactful and measured.", icon: "hand-left-outline" },
  { value: "avoidant", label: "Avoidant", body: "Let things settle first.", icon: "pause-circle-outline" },
  { value: "collaborative", label: "Collaborative", body: "Work it out together.", icon: "people-outline" },
];
const BUILDER: Opt<"long-term" | "experimental" | "both">[] = [
  { value: "long-term", label: "Long-term", body: "Committed to growing a product over months or years.", icon: "hourglass-outline" },
  { value: "experimental", label: "Experimental", body: "Build, test, move on.", icon: "flask-outline" },
  { value: "both", label: "Both", body: "Either, depending on the project.", icon: "infinite-outline" },
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

const isUrl = (v: string) => !v.trim() || /^https?:\/\/\S+\.\S+/.test(v.trim());

export default function Welcome() {
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const { refreshUser } = useAuth();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>(EMPTY);
  const [custom, setCustom] = useState("");
  const [resumeName, setResumeName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The profile row exists before onboarding (seeded at sign-up), so fill in what's there.
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
    if (existing.resumeUrl) setResumeName("Résumé on file");
  }, [existing?.id]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggle = (k: "skills" | "interests", v: string) =>
    set(k, form[k].includes(v) ? form[k].filter((x) => x !== v) : [...form[k], v]);

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
      await refreshUser();
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
      // A new account has no projects; the next thing to do is make one.
      if (existing?.isOnboarded) router.back();
      else router.replace("/project/new");
    },
    onError: (e) => setError(errText(e, "Couldn't save your profile.")),
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
      setUploading(true);
      const path = await uploadFile({ uri: file.uri, name: file.name, mimeType: file.mimeType, size: file.size });
      set("resumeUrl", path);
      setResumeName(file.name);
    } catch (e) {
      setError(errText(e, "Upload failed."));
    } finally {
      setUploading(false);
    }
  };

  const validate = (): string | null => {
    if (step === 0 && !form.displayName.trim()) return "Add your name so builders know who you are.";
    if (step === 6 && ![form.githubUrl, form.linkedinUrl, form.websiteUrl].every(isUrl)) return "Links need to start with https://";
    return null;
  };
  const next = () => {
    const problem = validate();
    setError(problem);
    if (!problem) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const last = step === STEPS.length - 1;
  const pct = ((step + 1) / STEPS.length) * 100;

  const group = <T extends string>(title: string, key: keyof Form, opts: Opt<T>[]) => (
    <View style={{ gap: spacing.sm }}>
      <Text style={st.label}>{title}</Text>
      {opts.map((o) => (
        <OptionCard key={o.value} icon={o.icon} title={o.label} body={o.body}
          selected={form[key] === o.value} onPress={() => set(key, (form[key] === o.value ? undefined : o.value) as any)} />
      ))}
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: existing?.isOnboarded ? "Profile details" : "Complete your profile" }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: colors.background }}>
        {/* Progress along the top in Nova's colours. */}
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm }}>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surfaceRaised, overflow: "hidden" }}>
            <NovaGradient style={{ width: `${pct}%`, height: "100%", borderRadius: 3 }} />
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={st.meta}>Step {step + 1} of {STEPS.length}</Text>
            <Text style={st.meta}>{Math.round(pct)}%</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 4 }}>
            <Text style={st.h1}>{STEPS[step]}</Text>
            <Text style={st.sub}>{SUBTITLES[step]}</Text>
          </View>

          {step === 0 && (
            <View style={{ gap: spacing.md }}>
              <Field label="Full name" value={form.displayName} onChangeText={(v) => set("displayName", v)} placeholder="John Doe" autoCapitalize="words" />
              <Field label="Username" value={form.username} onChangeText={(v) => set("username", v.replace(/\s/g, ""))} placeholder="johndoe" autoCapitalize="none" />
              <Field label="Professional headline" value={form.headline} onChangeText={(v) => set("headline", v)} placeholder="Full Stack Developer | AI Enthusiast" />
              <Field label="Bio" value={form.bio} onChangeText={(v) => set("bio", v)} placeholder="Tell us about your background and what you're looking for..." multiline />
              <Field label="Location" value={form.location} onChangeText={(v) => set("location", v)} placeholder="San Francisco, CA" />
            </View>
          )}

          {step === 1 && (
            <View style={{ gap: spacing.md }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
                {[...COMMON_SKILLS, ...form.skills.filter((s) => !COMMON_SKILLS.includes(s))].map((s) => (
                  <Chip key={s} label={s} active={form.skills.includes(s)} onPress={() => toggle("skills", s)} />
                ))}
              </View>
              <AddCustom value={custom} onChange={setCustom} placeholder="e.g. Solidity"
                onAdd={() => { const v = custom.trim(); if (v && !form.skills.includes(v)) set("skills", [...form.skills, v]); setCustom(""); }} />
            </View>
          )}

          {step === 2 && (
            <View style={{ gap: spacing.md }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
                {[...COMMON_INTERESTS, ...form.interests.filter((s) => !COMMON_INTERESTS.includes(s))].map((s) => (
                  <Chip key={s} label={s} active={form.interests.includes(s)} onPress={() => toggle("interests", s)} />
                ))}
              </View>
              <AddCustom value={custom} onChange={setCustom} placeholder="e.g. Climate tech"
                onAdd={() => { const v = custom.trim(); if (v && !form.interests.includes(v)) set("interests", [...form.interests, v]); setCustom(""); }} />
            </View>
          )}

          {step === 3 && (
            <View style={{ gap: spacing.lg }}>
              {group("Experience level", "experienceLevel", EXPERIENCE)}
              <Field label="Hours per week" value={form.hoursPerWeek} onChangeText={(v) => set("hoursPerWeek", v.replace(/\D/g, "").slice(0, 3))} placeholder="e.g. 20" numeric />
            </View>
          )}

          {step === 4 && (
            <View style={{ gap: spacing.lg }}>
              {group("Risk tolerance", "riskTolerance", RISK)}
              {group("Speed vs polish", "speedVsPolish", SPEED)}
              {group("Schedule style", "scheduleStyle", SCHEDULE)}
              {group("Conflict resolution style", "conflictStyle", CONFLICT)}
              {group("Builder type", "builderType", BUILDER)}
            </View>
          )}

          {step === 5 && (
            <View style={{ gap: spacing.md }}>
              <View style={{ alignItems: "center", gap: spacing.sm, padding: spacing.xl, borderRadius: radius.lg, borderWidth: 1.5, borderStyle: "dashed", borderColor: form.resumeUrl ? colors.success : colors.border, backgroundColor: colors.surfaceRaised }}>
                <Icon name={form.resumeUrl ? "checkmark-circle" : "cloud-upload-outline"} size={36} color={form.resumeUrl ? colors.success : colors.primary} />
                <Text style={[st.body, { fontFamily: fontFamily.semibold, textAlign: "center" }]}>
                  {form.resumeUrl ? resumeName || "Résumé uploaded" : "Upload your résumé"}
                </Text>
                <Text style={st.meta}>PDF, DOC, or DOCX up to 10MB</Text>
                <Btn label={form.resumeUrl ? "Replace file" : "Choose a file"} icon="document-attach-outline" small variant="outline" loading={uploading} onPress={pickResume} />
              </View>
              <Callout icon="sparkles" body="Optional. Later, Build my profile lets Nova read it and fill in your experience and education." />
            </View>
          )}

          {step === 6 && (
            <View style={{ gap: spacing.md }}>
              <Field label="GitHub URL" value={form.githubUrl} onChangeText={(v) => set("githubUrl", v)} placeholder="https://github.com/username" autoCapitalize="none" />
              <Field label="LinkedIn URL" value={form.linkedinUrl} onChangeText={(v) => set("linkedinUrl", v)} placeholder="https://linkedin.com/in/username" autoCapitalize="none" />
              <Field label="Personal website" value={form.websiteUrl} onChangeText={(v) => set("websiteUrl", v)} placeholder="https://example.com" autoCapitalize="none" />
            </View>
          )}

          {step === 7 && (
            <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
              {[
                ["Name", form.displayName], ["Username", form.username && `@${form.username}`], ["Headline", form.headline],
                ["Location", form.location], ["Skills", form.skills.join(", ")], ["Interests", form.interests.join(", ")],
                ["Experience", form.experienceLevel], ["Hours per week", form.hoursPerWeek],
                ["Risk", form.riskTolerance], ["Speed vs polish", form.speedVsPolish], ["Schedule", form.scheduleStyle],
                ["Conflict style", form.conflictStyle], ["Builder type", form.builderType],
                ["Résumé", form.resumeUrl ? resumeName || "Uploaded" : ""],
                ["Links", [form.githubUrl, form.linkedinUrl, form.websiteUrl].filter(Boolean).join("\n")],
              ].map(([k, v], i) => (
                <View key={k} style={{ flexDirection: "row", gap: spacing.md, padding: spacing.md, borderTopWidth: i ? 1 : 0, borderColor: colors.borderSubtle }}>
                  <Text style={[st.meta, { width: 104 }]}>{k}</Text>
                  <Text style={[st.body, { flex: 1, textTransform: ENUM_ROWS.includes(k as string) ? "capitalize" : "none", color: v ? colors.text : colors.textTertiary }]}>{v || "Not set"}</Text>
                </View>
              ))}
            </View>
          )}

          {error && <ErrorNote message={error} />}
        </ScrollView>

        <View style={{ flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md + insets.bottom, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.background }}>
          {step > 0 ? (
            <Btn label="Back" icon="arrow-back" variant="outline" style={{ flex: 1 }} onPress={() => { setError(null); setStep(step - 1); }} disabled={save.isPending} />
          ) : (
            <Btn label="Skip for now" variant="ghost" style={{ flex: 1 }} onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/feed"))} />
          )}
          {last ? (
            <Btn label="Complete profile" icon="checkmark" style={{ flex: 1.4 }} loading={save.isPending} onPress={() => { setError(null); save.mutate(); }} />
          ) : (
            <Btn label="Next" style={{ flex: 1.4 }} onPress={next} />
          )}
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const ENUM_ROWS = ["Experience", "Risk", "Speed vs polish", "Schedule", "Conflict style", "Builder type"];

const SUBTITLES = [
  "This is what other builders see first. You can change it any time.",
  "What are you good at? Tap to add, or type your own.",
  "What are you into? It shapes who and what you're matched with.",
  "How much you've built, and how much time you have.",
  "How you like to work. Matches and sprints use this to pair people who'll get along.",
  "A résumé helps partners and teams see your background.",
  "Where people can see your work.",
  "Check it over, then finish.",
];

function AddCustom({ value, onChange, onAdd, placeholder }: { value: string; onChange: (v: string) => void; onAdd: () => void; placeholder: string }) {
  return (
    <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
      <TextInput
        value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.textTertiary}
        onSubmitEditing={onAdd} returnKeyType="done"
        style={{ flex: 1, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 10, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.regular }}
      />
      <Btn label="Add" icon="add" small variant="outline" disabled={!value.trim()} onPress={onAdd} />
    </View>
  );
}

const st = {
  h1: { color: colors.text, fontSize: font.xxl - 2, fontFamily: fontFamily.bold, letterSpacing: -0.4 },
  sub: { color: colors.textSecondary, fontSize: font.base, lineHeight: 21, fontFamily: fontFamily.regular },
  label: { color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold },
  body: { color: colors.text, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular },
  meta: { color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.medium },
};
