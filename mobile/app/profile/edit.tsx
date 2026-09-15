import { useEffect, useState } from "react";
import { Image, Pressable, Text, TextInput, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { api, uploadFile } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import {
  assetUri, Avatar, Btn, Chip, ErrorNote, Field, Icon, Label, ListItem, Loading, Meta, NovaGradient,
  Row, Screen, Section,
} from "../../src/components/ui";
import { NoticeBanner, useNotice } from "../../src/components/Sheet";
import { pickAndUploadImage } from "../../src/components/profilePhoto";

/**
 * Edit profile — everything the web's Edit Profile dialog covers
 * (client/src/pages/profile.tsx): photos, name and username, headline, bio,
 * location and links, experience level, skills and interests, and the
 * co-founder working-style fields. Photos save the moment they're picked, as
 * on the web; the rest saves together. POST /api/profile merges, so only the
 * fields on this screen are sent.
 */

type Choice<T extends string> = { value: T; label: string }[];
const LEVELS: Choice<string> = [
  { value: "beginner", label: "Beginner" }, { value: "intermediate", label: "Intermediate" }, { value: "expert", label: "Expert" },
];
const RISK: Choice<string> = [{ value: "low", label: "Low" }, { value: "moderate", label: "Moderate" }, { value: "high", label: "High" }];
const SPEED: Choice<string> = [{ value: "speed", label: "Speed First" }, { value: "balanced", label: "Balanced" }, { value: "polish", label: "Polish First" }];
const SCHEDULE: Choice<string> = [{ value: "structured", label: "Structured" }, { value: "flexible", label: "Flexible" }, { value: "hybrid", label: "Hybrid" }];
const CONFLICT: Choice<string> = [
  { value: "direct", label: "Direct" }, { value: "diplomatic", label: "Diplomatic" }, { value: "avoidant", label: "Avoidant" }, { value: "collaborative", label: "Collaborative" },
];
const BUILDER: Choice<string> = [{ value: "long-term", label: "Long-Term" }, { value: "experimental", label: "Experimenter" }, { value: "both", label: "Both" }];

const TEXT_FIELDS = ["displayName", "username", "headline", "bio", "location", "websiteUrl", "githubUrl", "linkedinUrl"] as const;
type Form = Record<(typeof TEXT_FIELDS)[number], string> & {
  experienceLevel: string | null;
  skills: string[];
  interests: string[];
  hoursPerWeek: string;
  riskTolerance: string | null;
  speedVsPolish: string | null;
  scheduleStyle: string | null;
  conflictStyle: string | null;
  builderType: string | null;
  resumeUrl: string;
};

function fromProfile(p: any, user: any): Form {
  return {
    displayName: p?.displayName || [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "",
    username: p?.username || "",
    headline: p?.headline || "",
    bio: p?.bio || "",
    location: p?.location || "",
    websiteUrl: p?.websiteUrl || "",
    githubUrl: p?.githubUrl || "",
    linkedinUrl: p?.linkedinUrl || "",
    experienceLevel: p?.experienceLevel ?? null,
    skills: p?.skills ?? [],
    interests: p?.interests ?? [],
    hoursPerWeek: p?.hoursPerWeek != null ? String(p.hoursPerWeek) : "",
    riskTolerance: p?.riskTolerance ?? null,
    speedVsPolish: p?.speedVsPolish ?? null,
    scheduleStyle: p?.scheduleStyle ?? null,
    conflictStyle: p?.conflictStyle ?? null,
    builderType: p?.builderType ?? null,
    resumeUrl: p?.resumeUrl || "",
  };
}

/** Add-a-tag field with removable chips. */
function TagEditor({ label, values, onChange, placeholder, max = 30 }: {
  label: string; values: string[]; onChange: (v: string[]) => void; placeholder: string; max?: number;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const parts = draft.split(",").map((s) => s.trim()).filter(Boolean);
    const next = [...values];
    for (const part of parts) if (!next.some((v) => v.toLowerCase() === part.toLowerCase()) && next.length < max) next.push(part.slice(0, 60));
    onChange(next);
    setDraft("");
  };
  return (
    <View style={{ gap: spacing.sm }}>
      <Label>{label}</Label>
      <Row gap={spacing.sm} center>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={add}
          placeholder={placeholder}
          placeholderTextColor={colors.textTertiary}
          returnKeyType="done"
          blurOnSubmit={false}
          style={inputStyle}
        />
        <Pressable onPress={add} disabled={!draft.trim()} accessibilityLabel={`Add ${label.toLowerCase()}`}
          style={({ pressed }) => [{ width: 42, height: 42, borderRadius: 21, backgroundColor: draft.trim() ? colors.primary : colors.surfaceRaised, alignItems: "center", justifyContent: "center" }, pressed && { opacity: 0.7 }]}>
          <Icon name="add" size={22} color={draft.trim() ? "#FFFFFF" : colors.textTertiary} />
        </Pressable>
      </Row>
      {values.length > 0 && (
        <Row wrap gap={6}>
          {values.map((v) => (
            <Pressable key={v} onPress={() => onChange(values.filter((x) => x !== v))} accessibilityLabel={`Remove ${v}`}
              style={{ flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radius.pill, backgroundColor: colors.primarySoft, paddingLeft: spacing.md, paddingRight: spacing.sm, paddingVertical: 6, maxWidth: "100%" }}>
              <Text style={{ color: colors.primary, fontFamily: fontFamily.medium, fontSize: font.sm, flexShrink: 1 }}>{v}</Text>
              <Icon name="close" size={14} color={colors.primary} />
            </Pressable>
          ))}
        </Row>
      )}
    </View>
  );
}

function ChoiceField({ label, options, value, onChange }: { label: string; options: Choice<string>; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Label>{label}</Label>
      <Row wrap gap={spacing.sm}>
        {options.map((o) => (
          <Chip key={o.value} label={o.label} active={value === o.value} onPress={() => onChange(value === o.value ? null : o.value)} />
        ))}
      </Row>
    </View>
  );
}

export default function EditProfile() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user, refreshUser } = useAuth();
  const { notice, show, clear } = useNotice();
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: profile, isLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: () => api<any>("/api/profile").catch((e) => { if (e?.status === 404) return null; throw e; }),
  });
  const { data: resume } = useQuery({ queryKey: ["resume-status"], queryFn: () => api<any>("/api/profile/resume-status") });

  useEffect(() => { if (!isLoading && !form) setForm(fromProfile(profile, user)); }, [isLoading, profile]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["profile"] });
    void qc.invalidateQueries({ queryKey: ["profile-summary"] });
    void qc.invalidateQueries({ queryKey: ["me"] });
    void qc.invalidateQueries({ queryKey: ["user"] });
    void qc.invalidateQueries({ queryKey: ["resume-status"] });
    void refreshUser();
  };

  const photo = useMutation({
    mutationFn: async (field: "avatarUrl" | "coverUrl" | "clearAvatar" | "clearCover") => {
      if (field === "clearAvatar") { await api("/api/profile", { method: "POST", body: { avatarUrl: null } }); return "Profile photo removed."; }
      if (field === "clearCover") { await api("/api/profile", { method: "POST", body: { coverUrl: null } }); return "Cover photo removed."; }
      if (!profile) throw new Error("Save your name first, then add photos.");
      const path = await pickAndUploadImage();
      if (!path) return null;
      await api("/api/profile", { method: "POST", body: { [field]: path } });
      return field === "avatarUrl" ? "Profile photo updated." : "Cover photo updated.";
    },
    onSuccess: (msg) => { if (msg) { invalidate(); show({ text: msg, tone: "success" }); } },
    onError: (e: any) => show({ text: e?.message || "Couldn't save that photo.", tone: "error" }),
  });

  const resumeUpload = useMutation({
    mutationFn: async () => {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.[0]) return null;
      const file = picked.assets[0];
      const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
      if (![".pdf", ".doc", ".docx"].includes(ext)) throw new Error("Please upload a PDF, DOC, or DOCX file.");
      if (file.size && file.size > 10 * 1024 * 1024) throw new Error("That file is over 10MB.");
      return uploadFile({ uri: file.uri, name: file.name, mimeType: file.mimeType || "application/pdf", size: file.size });
    },
    onSuccess: (path) => {
      if (!path) return;
      set("resumeUrl", path);
      show({ text: "Resume uploaded. Save your changes to keep it.", tone: "success" });
    },
    onError: (e: any) => show({ text: e?.message || "Upload failed", tone: "error" }),
  });

  const save = useMutation({
    mutationFn: () => {
      const f = form!;
      if (!f.displayName.trim()) throw new Error("Your name is required.");
      const hours = f.hoursPerWeek.trim() ? parseInt(f.hoursPerWeek, 10) : null;
      if (hours != null && (isNaN(hours) || hours < 1 || hours > 80)) throw new Error("Hours per week should be between 1 and 80.");
      const body: Record<string, unknown> = {};
      for (const k of TEXT_FIELDS) body[k] = f[k].trim();
      Object.assign(body, {
        experienceLevel: f.experienceLevel, skills: f.skills, interests: f.interests, hoursPerWeek: hours,
        riskTolerance: f.riskTolerance, speedVsPolish: f.speedVsPolish, scheduleStyle: f.scheduleStyle,
        conflictStyle: f.conflictStyle, builderType: f.builderType,
        ...(f.resumeUrl ? { resumeUrl: f.resumeUrl } : {}),
      });
      return api("/api/profile", { method: "POST", body });
    },
    onSuccess: () => { invalidate(); if (router.canGoBack()) router.back(); else router.replace("/(tabs)/profile"); },
    onError: (e: any) => setError(e?.message || "Couldn't save your profile."),
  });

  if (isLoading || !form) return <Loading />;

  const cover = assetUri(profile?.coverUrl);

  return (
    <>
      <Stack.Screen options={{
        title: "Edit Profile",
        headerRight: () => (
          <Pressable onPress={() => save.mutate()} disabled={save.isPending} hitSlop={10} style={{ paddingHorizontal: spacing.sm }}>
            <Text style={{ color: colors.primary, fontFamily: fontFamily.semibold, fontSize: font.base, opacity: save.isPending ? 0.5 : 1 }}>{save.isPending ? "Saving…" : "Save"}</Text>
          </Pressable>
        ),
      }} />
      <Screen canvas contentStyle={{ padding: 0, gap: spacing.sm, paddingBottom: spacing.xxl * 2 }}>
        <Section title="Photos">
          <View style={{ borderRadius: radius.md, overflow: "hidden" }}>
            <Pressable onPress={() => photo.mutate("coverUrl")} accessibilityLabel="Change cover photo">
              {cover ? <Image source={{ uri: cover }} style={{ width: "100%", height: 110 }} /> : <NovaGradient style={{ height: 110, opacity: 0.55 }} />}
              <View style={{ position: "absolute", top: spacing.sm, right: spacing.sm, flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 5 }}>
                <Icon name="camera-outline" size={15} color={colors.text} />
                <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.xs, color: colors.text }}>Cover</Text>
              </View>
            </Pressable>
            <Pressable onPress={() => photo.mutate("avatarUrl")} style={{ marginTop: -44, marginLeft: spacing.md, alignSelf: "flex-start" }} accessibilityLabel="Change profile photo">
              <Avatar name={form.displayName} uri={profile?.avatarUrl ?? user?.profileImageUrl} size={88} ring />
              <View style={{ position: "absolute", right: 0, bottom: 2, width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.surface, alignItems: "center", justifyContent: "center" }}>
                <Icon name="camera" size={14} color="#FFFFFF" />
              </View>
            </Pressable>
          </View>
          <Row gap={spacing.sm} wrap>
            <Btn small variant="outline" icon="person-circle-outline" label="Change photo" loading={photo.isPending && photo.variables === "avatarUrl"} onPress={() => photo.mutate("avatarUrl")} />
            <Btn small variant="outline" icon="image-outline" label="Change cover" loading={photo.isPending && photo.variables === "coverUrl"} onPress={() => photo.mutate("coverUrl")} />
            {profile?.avatarUrl ? <Btn small variant="ghost" label="Remove photo" onPress={() => photo.mutate("clearAvatar")} /> : null}
            {profile?.coverUrl ? <Btn small variant="ghost" label="Remove cover" onPress={() => photo.mutate("clearCover")} /> : null}
          </Row>
          <Meta>Square works best for your photo; the cover is a wide banner behind it. Both save as soon as you pick them.</Meta>
        </Section>

        <Section title="Intro">
          <Field label="Full Name *" value={form.displayName} onChangeText={(v) => set("displayName", v)} autoCapitalize="words" maxLength={80} />
          <Field label="Username" value={form.username} onChangeText={(v) => set("username", v.replace(/\s/g, ""))} autoCapitalize="none" placeholder="maya" maxLength={40} />
          <Field label="Headline" value={form.headline} onChangeText={(v) => set("headline", v)} placeholder="Founder building tools for student clubs" maxLength={120} />
          <Field label="Location" value={form.location} onChangeText={(v) => set("location", v)} placeholder="City, Country" />
          <ChoiceField label="Experience level" options={LEVELS} value={form.experienceLevel} onChange={(v) => set("experienceLevel", v)} />
        </Section>

        <Section title="About">
          <Field label="Bio" value={form.bio} onChangeText={(v) => set("bio", v)} multiline placeholder="What you build, what you're good at, what you're looking for." maxLength={2000} />
          <Meta style={{ textAlign: "right", marginTop: -spacing.sm }}>{form.bio.length}/2000</Meta>
        </Section>

        <Section title="Links">
          <Field label="Website" value={form.websiteUrl} onChangeText={(v) => set("websiteUrl", v)} autoCapitalize="none" placeholder="https://" />
          <Field label="GitHub URL" value={form.githubUrl} onChangeText={(v) => set("githubUrl", v)} autoCapitalize="none" placeholder="https://github.com/…" />
          <Field label="LinkedIn URL" value={form.linkedinUrl} onChangeText={(v) => set("linkedinUrl", v)} autoCapitalize="none" placeholder="https://linkedin.com/in/…" />
        </Section>

        <Section title="Skills and interests">
          <TagEditor label="Skills" values={form.skills} onChange={(v) => set("skills", v)} placeholder="e.g. React Native" />
          <TagEditor label="Interests" values={form.interests} onChange={(v) => set("interests", v)} placeholder="e.g. EdTech" max={20} />
        </Section>

        <Section title="Co-Founder Preferences">
          <Meta style={{ marginTop: -spacing.sm, fontSize: font.sm }}>Used to match you with people who work the way you do.</Meta>
          <Field label="Hours/Week" value={form.hoursPerWeek} onChangeText={(v) => set("hoursPerWeek", v.replace(/[^0-9]/g, ""))} numeric placeholder="e.g. 20" maxLength={2} />
          <ChoiceField label="Risk Tolerance" options={RISK} value={form.riskTolerance} onChange={(v) => set("riskTolerance", v)} />
          <ChoiceField label="Speed vs Polish" options={SPEED} value={form.speedVsPolish} onChange={(v) => set("speedVsPolish", v)} />
          <ChoiceField label="Schedule Style" options={SCHEDULE} value={form.scheduleStyle} onChange={(v) => set("scheduleStyle", v)} />
          <ChoiceField label="Conflict Style" options={CONFLICT} value={form.conflictStyle} onChange={(v) => set("conflictStyle", v)} />
          <ChoiceField label="Builder Type" options={BUILDER} value={form.builderType} onChange={(v) => set("builderType", v)} />
        </Section>

        <Section title="Resume">
          <Row between>
            <Row center gap={spacing.sm} style={{ flex: 1 }}>
              {form.resumeUrl ? (
                <>
                  <Icon name="document-text-outline" size={18} color={colors.textSecondary} />
                  <Text style={{ fontFamily: fontFamily.regular, fontSize: font.sm, color: colors.textSecondary }}>Resume uploaded</Text>
                  <Icon name="checkmark-circle" size={18} color={colors.success} />
                </>
              ) : (
                <Text style={{ fontFamily: fontFamily.regular, fontSize: font.sm, color: colors.textTertiary }}>No resume uploaded</Text>
              )}
            </Row>
            <Btn small variant="outline" icon="cloud-upload-outline" label={form.resumeUrl ? "Replace" : "Upload"} loading={resumeUpload.isPending} onPress={() => resumeUpload.mutate()} />
          </Row>
          <Meta>PDF, DOC or DOCX, up to 10MB.</Meta>
        </Section>

        <View style={{ backgroundColor: colors.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border }}>
          <ListItem icon="hand-left-outline" title="Looking for" subtitle={profile?.lookingFor?.role ? `${profile.lookingFor.role}${profile.lookingFor.isActive ? "" : " · hidden"}` : "Tell people what you need"} onPress={() => router.push("/profile/looking-for")} />
          <ListItem icon="document-text-outline" title="Build with résumé"
            subtitle={resume?.hasResume ? (resume.readable ? "Nova can read your résumé" : "Nova can't read your résumé") : "Let Nova fill in your experience from a résumé"}
            onPress={() => router.push("/profile-builder")} />
        </View>

        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
          {error && <ErrorNote message={error} />}
          <Row gap={spacing.sm}>
            <Btn label="Cancel" variant="ghost" style={{ flex: 1 }} onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/profile"))} />
            <Btn label="Save Changes" loading={save.isPending} style={{ flex: 2 }} onPress={() => { setError(null); save.mutate(); }} />
          </Row>
        </View>
      </Screen>
      <NoticeBanner notice={notice} onDismiss={clear} />
    </>
  );
}

const inputStyle = {
  flex: 1, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
  paddingHorizontal: spacing.md, height: 42, color: colors.text, fontSize: font.base, fontFamily: fontFamily.regular,
} as const;
