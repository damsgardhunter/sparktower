import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";
import { EXPLORE, trackExplore, type ExploreSource } from "../../src/explore";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import { Btn, Empty, Icon, Loading, NovaGradient } from "../../src/components/ui";
import { FollowButton } from "../../src/components/ConnectActions";
import { NoticeBanner, Sheet, useNotice } from "../../src/components/Sheet";
import { ProjectCard } from "../../src/components/ProjectCard";
import { updateLabel, useExploreUpdates, type ExploreUpdate } from "../../src/networkData";

type View_ = "mine" | "all";

const STATUSES = [
  { value: "all", label: "All Status" },
  { value: "planning", label: "Planning" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
];

/** The list is an Explore surface on the web too; its events say "projects". */
const SOURCE = "projects" as ExploreSource;

/**
 * Projects — off the tab bar since Discover absorbed browsing, but kept as a
 * screen so its deep links still land: My projects and Browse all, Create
 * Project, a search box, the Category and Status filters, and the project
 * cards. Browse all opens with the web's "welcome back" banner when something
 * you looked at has posted since.
 */
export default function Projects() {
  const router = useRouter();
  const params = useLocalSearchParams<{ view?: string; category?: string }>();
  const { user } = useAuth();
  const { notice, show: notify, clear } = useNotice();
  const [view, setView] = useState<View_>(params.view === "explore" || params.view === "all" || params.category ? "all" : "mine");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(params.category ?? "all");
  const [status, setStatus] = useState("all");
  const [picker, setPicker] = useState<"category" | "status" | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  useEffect(() => { if (params.category) { setCategory(params.category); setView("all"); } }, [params.category]);
  useEffect(() => {
    if (params.view === "explore" || params.view === "all") setView("all");
    else if (params.view === "mine") setView("mine");
  }, [params.view]);

  const mine = useQuery({ queryKey: ["my-projects"], queryFn: () => api<any[]>("/api/user/projects") });
  const nextSteps = useQuery({ queryKey: ["next-steps"], queryFn: () => api<{ items: any[] }>("/api/me/next-steps").catch(() => ({ items: [] })), enabled: view === "mine" });
  const all = useQuery({ queryKey: ["projects", "all"], queryFn: () => api<any[]>("/api/projects"), enabled: view === "all" });
  const followed = useQuery({ queryKey: ["followed-projects"], queryFn: () => api<{ projectId: string }[]>("/api/user/followed-projects"), enabled: view === "all" });
  const { updates, byKey } = useExploreUpdates();

  const followedIds = useMemo(() => new Set((followed.data ?? []).map((f) => f.projectId)), [followed.data]);
  // One strip per project card: its primary section's item, else the first section listed for it.
  const pathBy = useMemo(() => {
    const byProject = new Map<string, any>();
    for (const i of nextSteps.data?.items ?? []) {
      const had = byProject.get(i.project.id);
      if (!had || (!had.track?.primary && i.track?.primary)) byProject.set(i.project.id, i);
    }
    return byProject;
  }, [nextSteps.data]);

  const source = view === "mine" ? mine.data : all.data;
  const categories = useMemo(() => Array.from(new Set((source ?? []).map((p) => p.category).filter(Boolean))) as string[], [source]);
  const q = search.trim().toLowerCase();
  const list = (source ?? []).filter((p) =>
    (!q || p.title.toLowerCase().includes(q) || (p.description || "").toLowerCase().includes(q)) &&
    (category === "all" || p.category === category) &&
    (status === "all" || p.status === status));

  const loading = view === "mine" ? mine.isLoading : all.isLoading;
  const refreshing = view === "mine" ? mine.isRefetching : all.isRefetching;
  const refresh = () => {
    if (view === "mine") { void mine.refetch(); void nextSteps.refetch(); }
    else { void all.refetch(); void followed.refetch(); }
  };
  const create = () => router.push("/project/new" as any);

  const header = (
    <View>
      <View style={s.top}>
        <View style={s.titleRow}>
          <Text style={s.h1}>{view === "mine" ? "My Projects" : "Browse Projects"}</Text>
          <Btn small icon="add" label="Create Project" onPress={create} />
        </View>
        <View style={s.tabs} accessibilityRole="tablist">
          {([["mine", "My projects"], ["all", "Browse all"]] as const).map(([v, label]) => (
            <Pressable key={v} accessibilityRole="tab" accessibilityState={{ selected: view === v }} onPress={() => setView(v)}
              style={({ pressed }) => [s.tab, view === v && s.tabOn, pressed && { opacity: 0.7 }]}>
              <Text style={[s.tabText, view === v && s.tabTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={s.search}>
          <Icon name="search" size={17} color={colors.textTertiary} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search projects..."
            placeholderTextColor={colors.textTertiary}
            style={s.searchInput}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {search ? <Pressable onPress={() => setSearch("")} hitSlop={8}><Icon name="close-circle" size={17} color={colors.textTertiary} /></Pressable> : null}
        </View>
        <View style={s.selects}>
          <SelectPill label={category === "all" ? "All Categories" : category} onPress={() => setPicker("category")} />
          <SelectPill label={STATUSES.find((x) => x.value === status)?.label ?? "All Status"} onPress={() => setPicker("status")} />
        </View>
      </View>

      {view === "all" && !bannerDismissed && updates.length > 0 && (
        <ReturnBanner updates={updates} onDismiss={() => setBannerDismissed(true)}
          onSee={(u) => router.push((u.kind === "builder" ? `/user/${u.id}` : `/project/${u.id}`) as any)} />
      )}

      {view === "mine" && (
        <Pressable onPress={create} style={({ pressed }) => [s.startWrap, pressed && { opacity: 0.85 }]}>
          <NovaGradient style={s.start}>
            <View style={s.startIcon}><Icon name="add" size={22} color={colors.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.startTitle}>Start a project</Text>
              <Text style={s.startBody}>Name it, pick a goal — Nova lays out the path.</Text>
            </View>
            <Icon name="chevron-forward" size={20} color="#FFFFFF" />
          </NovaGradient>
        </Pressable>
      )}
      <View style={{ height: spacing.md }} />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <FlatList
        data={loading ? [] : list}
        keyExtractor={(p) => p.id}
        ListHeaderComponent={header}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        contentContainerStyle={{ paddingBottom: spacing.xxl * 3 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
        ListEmptyComponent={loading ? <View style={{ paddingTop: spacing.xxl }}><Loading /></View> : (
          <View style={s.emptyBlock}>
            {view === "mine" && !mine.data?.length ? (
              <Empty icon="rocket-outline" title="You haven't started or joined a project yet." action="Browse all" onAction={() => setView("all")} />
            ) : (
              <Empty icon="search-outline" title="No projects found matching your filters." action="Clear filters" onAction={() => { setSearch(""); setCategory("all"); setStatus("all"); }} />
            )}
          </View>
        )}
        renderItem={({ item, index }) => {
          const own = item.ownerId === user?.id;
          const upd = byKey.get(`project:${item.id}`);
          const path = view === "mine" ? pathBy.get(item.id) : null;
          return (
            <ProjectCard
              project={item}
              isOwner={own}
              update={upd ? updateLabel(upd) : null}
              path={path ? { phase: path.phase, progress: path.progress, next: path.next } : null}
              onContinue={() => router.push(`/manage/${item.id}` as any)}
              onPress={() => {
                if (view === "all") trackExplore(EXPLORE.openProject, { matchType: "project", targetId: item.id, rankPosition: index + 1, source: SOURCE }, "/projects");
                router.push(`/project/${item.id}` as any);
              }}
              follow={view === "all" && !own ? (
                <FollowButton projectId={item.id} title={item.title} following={followedIds.has(item.id)} notify={notify}
                  explore={{ source: SOURCE, rankPosition: index + 1 }} />
              ) : null}
            />
          );
        }}
      />

      <Sheet visible={picker === "category"} onClose={() => setPicker(null)} title="Category">
        <ScrollView style={{ maxHeight: 420 }}>
          {["all", ...categories].map((c) => (
            <Option key={c} label={c === "all" ? "All Categories" : c} on={category === c} onPress={() => { setCategory(c); setPicker(null); }} />
          ))}
        </ScrollView>
      </Sheet>
      <Sheet visible={picker === "status"} onClose={() => setPicker(null)} title="Status">
        {STATUSES.map((st) => (
          <Option key={st.value} label={st.label} on={status === st.value} onPress={() => { setStatus(st.value); setPicker(null); }} />
        ))}
      </Sheet>
      <NoticeBanner notice={notice} onDismiss={clear} />
    </View>
  );
}

function SelectPill({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.select, pressed && { opacity: 0.7 }]}>
      <Text style={s.selectText} numberOfLines={1}>{label}</Text>
      <Icon name="chevron-down" size={15} color={colors.textTertiary} />
    </Pressable>
  );
}

function Option({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.option, pressed && { backgroundColor: colors.surfaceRaised }]}>
      <Text style={[s.optionText, on && { color: colors.primary, fontFamily: fontFamily.semibold }]}>{label}</Text>
      {on ? <Icon name="checkmark" size={18} color={colors.primary} /> : null}
    </Pressable>
  );
}

/** The web's return-banner.tsx: what's new with what you'd looked at. */
function ReturnBanner({ updates, onSee, onDismiss }: { updates: ExploreUpdate[]; onSee: (u: ExploreUpdate) => void; onDismiss: () => void }) {
  return (
    <View style={s.banner}>
      <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }}>
        <Icon name="sparkles" size={18} color={colors.primary} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.bannerTitle}>Welcome back — new since you last looked</Text>
          <Text style={s.bannerBody}>{updates.map((u) => `${u.name}: ${updateLabel(u)}`).join(" · ")}</Text>
        </View>
        <Pressable onPress={onDismiss} hitSlop={8} accessibilityLabel="Dismiss"><Icon name="close" size={18} color={colors.textTertiary} /></Pressable>
      </View>
      <Btn small variant="outline" label={`See ${updates[0].name}`} onPress={() => onSee(updates[0])} style={{ alignSelf: "flex-start" }} />
    </View>
  );
}

const s = StyleSheet.create({
  top: { backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md, gap: spacing.sm + 2, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  h1: { flex: 1, fontSize: font.xl + 2, fontFamily: fontFamily.bold, color: colors.text, letterSpacing: -0.4 },
  tabs: { flexDirection: "row", gap: 4 },
  tab: { borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  tabOn: { backgroundColor: colors.primary },
  tabText: { fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.textSecondary },
  tabTextOn: { color: "#FFFFFF", fontFamily: fontFamily.semibold },
  search: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceRaised,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, height: 40,
  },
  searchInput: { flex: 1, fontSize: font.sm + 1, color: colors.text, fontFamily: fontFamily.regular, paddingVertical: 0 },
  selects: { flexDirection: "row", gap: spacing.sm },
  select: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6, height: 38,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, backgroundColor: colors.surface,
  },
  selectText: { flex: 1, fontSize: font.sm, color: colors.text, fontFamily: fontFamily.regular },
  option: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.md, paddingHorizontal: spacing.xs },
  optionText: { fontSize: font.base, color: colors.text, fontFamily: fontFamily.regular },
  banner: {
    marginHorizontal: spacing.sm, marginTop: spacing.md, padding: spacing.md, gap: spacing.sm, borderRadius: radius.md,
    borderWidth: 1, borderColor: `${colors.primary}66`, backgroundColor: colors.primarySoft,
  },
  bannerTitle: { fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text },
  bannerBody: { fontSize: font.xs + 1, color: colors.textSecondary, fontFamily: fontFamily.regular },
  startWrap: { marginHorizontal: spacing.sm, marginTop: spacing.md, borderRadius: radius.md, overflow: "hidden" },
  start: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
  startIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  startTitle: { color: "#FFFFFF", fontSize: font.base + 1, fontFamily: fontFamily.bold },
  startBody: { color: "rgba(255,255,255,0.92)", fontSize: font.sm, fontFamily: fontFamily.regular },
  emptyBlock: { backgroundColor: colors.surface, marginHorizontal: spacing.sm, borderRadius: radius.md, paddingHorizontal: spacing.lg },
});
