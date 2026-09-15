/**
 * Setup essentials: logo and cover, the AI profile visuals (draw, redraw one,
 * swap in your own, hide), the brief, scope, and the whole backing setup —
 * campaign, tiers, merch, payouts and badges. The links hub, application
 * questions and business plan upload are still on the web.
 */
import { useEffect, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, uploadFile } from "../../api/client";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Body, Btn, Card, Cost, Icon, Label, ListItem, Meta, Row, assetUri } from "../ui";
import { Area, Bubble, Line, Overline, Well, openWeb, useNotify } from "./bits";
import { BackingSummary } from "./BackingSummary";
import { mkey } from "./shared";

const VISUAL_SLOTS = [
  { slot: "oneLiner", label: "Below the one-liner", shape: "wide" },
  { slot: "about", label: "Below About", shape: "wide" },
  { slot: "success", label: "Below What Success Looks Like", shape: "wide" },
  { slot: "railTop", label: "Right side, first", shape: "square" },
  { slot: "railBottom", label: "Right side, second", shape: "square" },
] as const;

const BRIEF_FIELDS = [
  { key: "oneLiner", label: "One-liner", placeholder: "We help [who] do [what] by [how]", multiline: false },
  { key: "mission", label: "Mission", placeholder: "Why does this project exist?", multiline: true },
  { key: "valueProposition", label: "Value proposition", placeholder: "What unique value do you provide?", multiline: true },
  { key: "targetCustomerProfile", label: "Target customer", placeholder: "Demographics, behaviors, pain points…", multiline: true },
  { key: "problemStatement", label: "Problem", placeholder: "What problem does this project solve?", multiline: true },
  { key: "targetUser", label: "Target user", placeholder: "Who is the target user?", multiline: false },
  { key: "successMetrics", label: "Success metrics", placeholder: "How do you define success?", multiline: true },
] as const;

async function pickImage(): Promise<string | null> {
  const picked = await DocumentPicker.getDocumentAsync({ type: ["image/png", "image/jpeg", "image/webp"], copyToCacheDirectory: true });
  if (picked.canceled || !picked.assets?.[0]) return null;
  const f = picked.assets[0];
  return uploadFile({ uri: f.uri, name: f.name, mimeType: f.mimeType || "image/png", size: f.size });
}

export function Setup({ projectId, project, isOwner }: { projectId: string; project: any; isOwner: boolean }) {
  const qc = useQueryClient();
  const router = useRouter();
  const { notify, fail } = useNotify();
  const refresh = () => { qc.invalidateQueries({ queryKey: mkey(projectId, "project") }); qc.invalidateQueries({ queryKey: mkey(projectId, "briefing") }); };

  const update = useMutation({
    mutationFn: (data: Record<string, unknown>) => api(`/api/projects/${projectId}`, { method: "PATCH", body: data }),
    onSuccess: () => { refresh(); notify("Project updated"); },
    onError: (e) => fail(e),
  });

  const [uploading, setUploading] = useState<string | null>(null);
  const upload = async (field: "logoUrl" | "coverUrl") => {
    try {
      setUploading(field);
      const path = await pickImage();
      if (path) update.mutate({ [field]: path });
    } catch (e) { fail(e, "Upload failed"); } finally { setUploading(null); }
  };

  const [editingBrief, setEditingBrief] = useState(false);
  const [brief, setBrief] = useState<Record<string, string>>({});
  useEffect(() => {
    if (editingBrief) return;
    setBrief(Object.fromEntries(BRIEF_FIELDS.map((f) => [f.key, project?.[f.key] ?? ""])));
  }, [project, editingBrief]);

  const scope: { mvp: string[]; niceToHave: string[] } = { mvp: project?.scope?.mvp ?? [], niceToHave: project?.scope?.niceToHave ?? [] };
  const [scopeItem, setScopeItem] = useState("");
  const [scopeType, setScopeType] = useState<"mvp" | "niceToHave">("mvp");

  return (
    <View style={{ gap: spacing.md }}>
      <Card style={{ gap: spacing.md }}>
        <Row center gap={6}><Icon name="image-outline" size={17} color={colors.primary} /><Text style={{ fontFamily: fontFamily.bold, fontSize: font.lg, color: colors.text }}>Logo & cover</Text></Row>
        <Meta>Your logo also goes on backer merch and badges, so a square transparent PNG travels furthest.</Meta>
        <Pressable disabled={!isOwner} onPress={() => upload("coverUrl")} style={{ height: 120, borderRadius: radius.md, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
          {project?.coverUrl ? <Image source={{ uri: assetUri(project.coverUrl)! }} style={{ position: "absolute", width: "100%", height: "100%" }} resizeMode="cover" /> : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.9)", borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 }}>
            <Icon name="cloud-upload-outline" size={15} color={colors.primary} />
            <Text style={{ fontSize: font.xs + 1, color: colors.primary, fontFamily: fontFamily.semibold }}>{uploading === "coverUrl" ? "Uploading…" : project?.coverUrl ? "Change cover" : "Upload a cover"}</Text>
          </View>
        </Pressable>
        <Row center gap={spacing.md}>
          <Pressable disabled={!isOwner} onPress={() => upload("logoUrl")} style={{ width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
            {project?.logoUrl ? <Image source={{ uri: assetUri(project.logoUrl)! }} style={{ width: 72, height: 72 }} resizeMode="contain" /> : <Icon name="add" size={24} color={colors.textTertiary} />}
          </Pressable>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>Project logo</Text>
            <Meta>Square. Transparent PNG prints best.</Meta>
            {isOwner && <Btn small variant="outline" icon="cloud-upload-outline" label={project?.logoUrl ? "Change logo" : "Upload logo"} loading={uploading === "logoUrl"} onPress={() => upload("logoUrl")} style={{ alignSelf: "flex-start" }} />}
          </View>
        </Row>
        {isOwner && project?.logoUrl && <ProfileVisuals projectId={projectId} project={project} onChanged={refresh} />}
      </Card>

      <Card style={{ gap: spacing.md }}>
        <Row between>
          <Row center gap={6}><Icon name="document-text-outline" size={17} color={colors.primary} /><Text style={{ fontFamily: fontFamily.bold, fontSize: font.lg, color: colors.text }}>Project brief</Text></Row>
          {isOwner && !editingBrief && <Btn small variant="outline" icon="create-outline" label="Edit" onPress={() => setEditingBrief(true)} />}
        </Row>
        {editingBrief ? (
          <>
            {BRIEF_FIELDS.map((f) => (
              <View key={f.key} style={{ gap: spacing.xs }}>
                <Label>{f.label}</Label>
                {f.multiline
                  ? <Area value={brief[f.key] ?? ""} onChangeText={(v) => setBrief({ ...brief, [f.key]: v })} placeholder={f.placeholder} rows={3} />
                  : <Line value={brief[f.key] ?? ""} onChangeText={(v) => setBrief({ ...brief, [f.key]: v })} placeholder={f.placeholder} />}
              </View>
            ))}
            <Row gap={spacing.sm}>
              <Btn small label="Save brief" loading={update.isPending} onPress={() => { update.mutate(brief); setEditingBrief(false); }} />
              <Btn small variant="ghost" label="Cancel" onPress={() => setEditingBrief(false)} />
            </Row>
          </>
        ) : (
          <>
            <Well tone="primary">
              <Overline>One-liner</Overline>
              {project?.oneLiner
                ? <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.base, color: colors.text }}>{project.oneLiner}</Text>
                : <Meta style={{ fontStyle: "italic" }}>Not defined yet</Meta>}
            </Well>
            {BRIEF_FIELDS.slice(1).map((f) => (
              <View key={f.key} style={{ gap: 2 }}>
                <Overline>{f.label}</Overline>
                {project?.[f.key] ? <Body>{project[f.key]}</Body> : <Meta style={{ fontStyle: "italic" }}>Not defined yet</Meta>}
              </View>
            ))}
          </>
        )}
      </Card>

      <Card style={{ gap: spacing.md }}>
        <Text style={{ fontFamily: fontFamily.bold, fontSize: font.lg, color: colors.text }}>Scope</Text>
        {(["mvp", "niceToHave"] as const).map((k) => (
          <View key={k} style={{ gap: spacing.sm }}>
            <Overline>{k === "mvp" ? "MVP (must have)" : "Nice to have"}</Overline>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {scope[k].length === 0 && <Meta style={{ fontStyle: "italic" }}>Nothing yet</Meta>}
              {scope[k].map((item, i) => (
                <Pressable key={`${item}-${i}`} disabled={!isOwner} onPress={() => update.mutate({ scope: { ...scope, [k]: scope[k].filter((_, j) => j !== i) } })}
                  style={{ flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: k === "mvp" ? colors.primary : colors.surfaceRaised, maxWidth: "100%" }}>
                  <Text style={{ fontSize: font.xs + 1, color: k === "mvp" ? "#FFFFFF" : colors.text, fontFamily: fontFamily.medium, flexShrink: 1 }}>{item}</Text>
                  {isOwner && <Icon name="close" size={12} color={k === "mvp" ? "#FFFFFF" : colors.textTertiary} />}
                </Pressable>
              ))}
            </View>
          </View>
        ))}
        {isOwner && (
          <View style={{ gap: spacing.sm }}>
            <Row gap={6}>
              <Bubble small label="MVP" on={scopeType === "mvp"} onPress={() => setScopeType("mvp")} />
              <Bubble small label="Nice to have" on={scopeType === "niceToHave"} onPress={() => setScopeType("niceToHave")} />
            </Row>
            <Row gap={spacing.sm} center>
              <View style={{ flex: 1 }}><Line value={scopeItem} onChangeText={setScopeItem} placeholder="Add a scope item" /></View>
              <Btn small variant="outline" label="Add" disabled={!scopeItem.trim()} onPress={() => { update.mutate({ scope: { ...scope, [scopeType]: [...scope[scopeType], scopeItem.trim()] } }); setScopeItem(""); }} />
            </Row>
          </View>
        )}
      </Card>

      <Card style={{ paddingHorizontal: 0, paddingVertical: spacing.xs, gap: 0 }}>
        <ListItem icon="eye-outline" title="Public page sections" subtitle="Choose what visitors see, and privacy" onPress={() => router.push(`/project/visibility?id=${projectId}` as any)} />
        <ListItem icon="film-outline" title="AI storyboard" subtitle="A showcase reel from your brief" onPress={() => router.push(`/project/storyboards?id=${projectId}` as any)} />
        <ListItem icon="open-outline" title="View public page" subtitle="See it the way visitors do" onPress={() => router.push(`/project/${projectId}` as any)} />
        <ListItem icon="link-outline" title="Links, application questions, business plan" subtitle="Edit these on the web" onPress={() => openWeb(`/projects/${projectId}/manage`)} />
      </Card>

      {/* Backing sits at the foot of Setup on the web too; owner-only. */}
      {isOwner && <BackingSummary projectId={projectId} projectTitle={project?.title} />}
    </View>
  );
}

function ProfileVisuals({ projectId, project, onChanged }: { projectId: string; project: any; onChanged: () => void }) {
  const { notify, fail } = useNotify();
  const visuals = project?.profileVisuals ?? {};
  const hidden: string[] = Array.isArray(visuals.hidden) ? visuals.hidden : [];
  const anyMade = VISUAL_SLOTS.some((s) => typeof visuals[s.slot] === "string" && visuals[s.slot]);
  const hasBrief = !!(project?.oneLiner?.trim() || project?.description?.trim());
  const [busy, setBusy] = useState<string | null>(null);

  const generate = useMutation({
    mutationFn: (slot?: string) => api<{ failed: string[] }>(`/api/projects/${projectId}/visuals`, { method: "POST", body: slot ? { slot } : {} }),
    onSuccess: (r, slot) => { onChanged(); notify(slot ? "Redrawn" : r?.failed?.length ? `Added — ${r.failed.length} couldn't be drawn` : "Visuals added to your project page"); },
    onError: (e) => fail(e, "Couldn't add visuals"),
    onSettled: () => setBusy(null),
  });
  const hide = useMutation({
    mutationFn: (b: { slot: string; hidden: boolean }) => api(`/api/projects/${projectId}/visuals/${b.slot}`, { method: "PATCH", body: { hidden: b.hidden } }),
    onSuccess: onChanged, onError: (e) => fail(e),
  });
  const removeAll = useMutation({
    mutationFn: () => api(`/api/projects/${projectId}/visuals`, { method: "DELETE" }),
    onSuccess: () => { onChanged(); notify("Visuals removed from your page"); }, onError: (e) => fail(e),
  });
  const own = async (slot: string) => {
    try {
      setBusy(slot);
      const imageUrl = await pickImage();
      if (imageUrl) { await api(`/api/projects/${projectId}/visuals/${slot}`, { method: "PUT", body: { imageUrl } }); onChanged(); notify("Your image is in"); }
    } catch (e) { fail(e, "Couldn't use that image"); } finally { setBusy(null); }
  };

  return (
    <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: `${colors.primary}44`, backgroundColor: colors.primarySoft, padding: spacing.md, gap: spacing.sm }}>
      <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>Make your project page less wordy</Text>
      <Meta>{anyMade ? "Redraw any image, swap in your own, or hide it from your page." : "Nova draws 5 images from your logo and places them beside your one-liner, About and success sections. About a minute."}</Meta>
      {!hasBrief && <Meta style={{ color: colors.warning }}>Add a one-liner or description to your brief first, so the images show what you're building.</Meta>}
      <Row center gap={spacing.sm}>
        <Btn small icon="sparkles" variant={anyMade ? "outline" : "primary"} label={generate.isPending && !generate.variables ? "Drawing…" : anyMade ? "Redo all" : "Add visuals to my page"}
          disabled={!hasBrief} loading={generate.isPending && !generate.variables} onPress={() => generate.mutate(undefined)} />
        <Cost credits={5} />
      </Row>
      {anyMade && (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {VISUAL_SLOTS.map((s) => {
              const src = typeof visuals[s.slot] === "string" ? visuals[s.slot] : null;
              const isHidden = hidden.includes(s.slot);
              return (
                <View key={s.slot} style={{ width: "48%", flexGrow: 1, gap: 4 }}>
                  <View style={{ aspectRatio: s.shape === "wide" ? 16 / 9 : 1, maxHeight: 140, borderRadius: radius.sm, backgroundColor: colors.surface, overflow: "hidden", borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", opacity: isHidden ? 0.4 : 1 }}>
                    {src ? <Image source={{ uri: assetUri(src)! }} style={{ width: "100%", height: "100%" }} resizeMode="cover" /> : <Icon name="image-outline" size={20} color={colors.textTertiary} />}
                  </View>
                  <Meta numberOfLines={1}>{s.label}{isHidden ? " · hidden" : ""}</Meta>
                  <Row gap={spacing.md}>
                    <Pressable hitSlop={6} disabled={!hasBrief || generate.isPending} onPress={() => { setBusy(s.slot); generate.mutate(s.slot); }} accessibilityLabel="Redraw"><Icon name={busy === s.slot && generate.isPending ? "hourglass-outline" : "refresh"} size={17} color={colors.primary} /></Pressable>
                    <Pressable hitSlop={6} onPress={() => own(s.slot)} accessibilityLabel="Upload your own"><Icon name={busy === s.slot && !generate.isPending ? "hourglass-outline" : "cloud-upload-outline"} size={17} color={colors.primary} /></Pressable>
                    {src && <Pressable hitSlop={6} onPress={() => hide.mutate({ slot: s.slot, hidden: !isHidden })} accessibilityLabel={isHidden ? "Show" : "Hide"}><Icon name={isHidden ? "eye-off-outline" : "eye-outline"} size={17} color={colors.primary} /></Pressable>}
                  </Row>
                </View>
              );
            })}
          </View>
          <Btn small variant="ghost" icon="trash-outline" label="Remove all from page" loading={removeAll.isPending} onPress={() => removeAll.mutate()} style={{ alignSelf: "flex-start" }} />
        </>
      )}
    </View>
  );
}
