import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";
import { EXPLORE, trackExplore, type ExploreSource } from "../../src/explore";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import { Btn, Empty, Icon, Loading, NovaGradient, TabStrip } from "../../src/components/ui";
import { FollowButton } from "../../src/components/ConnectActions";
import { NoticeBanner, useNotice } from "../../src/components/Sheet";
import { ExploreProjectCard, MyProjectCard } from "../../src/components/ProjectCard";
import { updateLabel, useExploreUpdates } from "../../src/networkData";

type View_ = "mine" | "explore";

const STATUSES = [
  { value: "all", label: "Any status" },
  { value: "planning", label: "Planning" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
];

/** The list is an Explore surface on the web too; its events say "projects". */
const SOURCE = "projects" as ExploreSource;

/**
 * Projects: yours, with where each path stands, and every public project to
 * search, filter and follow — the native counterpart of
 * client/src/pages/projects.tsx and the home rail's "Your projects".
 */
export default function Projects() {
  const router = useRouter();
  const params = useLocalSearchParams<{ view?: string; category?: string }>();
  const { user } = useAuth();
  const { notice, show: notify, clear } = useNotice();
  const [view, setView] = useState<View_>(params.view === "explore" || params.category ? "explore" : "mine");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(params.category ?? "all");
  const [status, setStatus] = useState("all");
  useEffect(() => { if (params.category) { setCategory(params.category); setView("explore"); } }, [params.category]);
  useEffect(() => { if (params.view === "explore" || params.view === "mine") setView(params.view); }, [params.view]);

  const mine = useQuery({ queryKey: ["my-projects"], queryFn: () => api<any[]>("/api/user/projects") });
  const nextSteps = useQuery({ queryKey: ["next-steps"], queryFn: () => api<{ items: any[] }>("/api/me/next-steps").catch(() => ({ items: [] })) });
  const checkIns = useQuery({ queryKey: ["check-in-status"], queryFn: () => api<{ projects: any[] }>("/api/me/check-in-status").catch(() => ({ projects: [] })) });
  const all = useQuery({ queryKey: ["projects", "all"], queryFn: () => api<any[]>("/api/projects"), enabled: view === "explore" });
  const followed = useQuery({ queryKey: ["followed-projects"], queryFn: () => api<{ projectId: string }[]>("/api/user/followed-projects"), enabled: view === "explore" });
  const { byKey } = useExploreUpdates();

  const followedIds = useMemo(() => new Set((followed.data ?? []).map((f) => f.projectId)), [followed.data]);
  const pathBy = useMemo(() => new Map((nextSteps.data?.items ?? []).map((i) => [i.project.id, i])), [nextSteps.data]);
  const checkInBy = useMemo(() => new Map((checkIns.data?.projects ?? []).map((p) => [p.id, p])), [checkIns.data]);

  const source = view === "mine" ? mine.data : all.data;
  const categories = useMemo(() => Array.from(new Set((all.data ?? []).map((p) => p.category).filter(Boolean))).sort(), [all.data]);
  const q = search.trim().toLowerCase();
  const list = (source ?? []).filter((p) =>
    (!q || p.title.toLowerCase().includes(q) || (p.description || "").toLowerCase().includes(q) || (p.oneLiner || "").toLowerCase().includes(q)) &&
    (view === "mine" || category === "all" || p.category === category) &&
    (view === "mine" || status === "all" || p.status === status));

  const loading = view === "mine" ? mine.isLoading : all.isLoading;
  const refreshing = (view === "mine" ? mine.isRefetching : all.isRefetching);
  const refresh = () => {
    if (view === "mine") { void mine.refetch(); void nextSteps.refetch(); void checkIns.refetch(); }
    else { void all.refetch(); void followed.refetch(); }
  };

  const header = (
    <View>
      <TabStrip
        options={[{ value: "mine", label: `My projects${mine.data?.length ? ` ${mine.data.length}` : ""}` }, { value: "explore", label: "Explore" }]}
        value={view}
        onChange={setView}
      />
      <View style={s.tools}>
        <View style={s.search}>
          <Icon name="search" size={17} color={colors.textTertiary} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={view === "mine" ? "Search your projects" : "Search projects"}
            placeholderTextColor={colors.textTertiary}
            style={s.searchInput}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {search ? <Pressable onPress={() => setSearch("")} hitSlop={8}><Icon name="close-circle" size={17} color={colors.textTertiary} /></Pressable> : null}
        </View>
        {view === "explore" && (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
              {["all", ...categories].map((c) => (
                <FilterChip key={c} label={c === "all" ? "All categories" : c} on={category === c} onPress={() => setCategory(c)} />
              ))}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
              {STATUSES.map((st) => <FilterChip key={st.value} small label={st.label} on={status === st.value} onPress={() => setStatus(st.value)} />)}
            </ScrollView>
          </>
        )}
      </View>

      {view === "mine" && (
        <Pressable onPress={() => router.push("/project/new" as any)} style={({ pressed }) => [s.startWrap, pressed && { opacity: 0.85 }]}>
          <NovaGradient style={s.start}>
            <View style={s.startIcon}><Icon name="add" size={24} color={colors.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.startTitle}>Start a project</Text>
              <Text style={s.startBody}>Name it, pick a goal — Nova lays out the path.</Text>
            </View>
            <Icon name="chevron-forward" size={20} color="#FFFFFF" />
          </NovaGradient>
        </Pressable>
      )}

      {list.length > 0 && (
        <Text style={s.listLabel}>
          {view === "mine" ? "Owned and joined" : `${list.length} project${list.length === 1 ? "" : "s"}${category !== "all" ? ` in ${category}` : ""}`}
        </Text>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <FlatList
        data={loading ? [] : list}
        keyExtractor={(p) => p.id}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingBottom: spacing.xxl * 3 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
        ListEmptyComponent={loading ? <View style={{ paddingTop: spacing.xxl }}><Loading /></View> : (
          <View style={s.emptyBlock}>
            {view === "mine" && !mine.data?.length ? (
              <Empty icon="rocket-outline" title="No projects yet" body="Start one, or join a team from Explore. Post a check-in each week and it shows here." action="Explore projects" onAction={() => setView("explore")} />
            ) : (
              <Empty icon="search-outline" title="Nothing matches" body="Try another search or category." action="Clear filters" onAction={() => { setSearch(""); setCategory("all"); setStatus("all"); }} />
            )}
          </View>
        )}
        renderItem={({ item, index }) => view === "mine" ? (
          <MyProjectCard
            project={item}
            isOwner={item.ownerId === user?.id}
            path={pathBy.get(item.id)}
            checkIn={checkInBy.get(item.id)}
            onOpen={() => router.push(`/project/${item.id}` as any)}
            onManage={() => router.push(`/manage/${item.id}` as any)}
          />
        ) : (
          <ExploreProjectCard
            project={item}
            update={byKey.get(`project:${item.id}`) ? updateLabel(byKey.get(`project:${item.id}`)!) : null}
            onPress={() => {
              trackExplore(EXPLORE.openProject, { matchType: "project", targetId: item.id, rankPosition: index + 1, source: SOURCE }, "/projects");
              router.push(`/project/${item.id}` as any);
            }}
            follow={item.ownerId !== user?.id ? (
              <FollowButton projectId={item.id} title={item.title} following={followedIds.has(item.id)} notify={notify}
                explore={{ source: SOURCE, rankPosition: index + 1 }} />
            ) : <Btn small variant="ghost" label="Yours" disabled />}
          />
        )}
      />
      <NoticeBanner notice={notice} onDismiss={clear} />
    </View>
  );
}

function FilterChip({ label, on, onPress, small }: { label: string; on: boolean; onPress: () => void; small?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.chip, small && { paddingVertical: 4 }, on && s.chipOn, pressed && { opacity: 0.7 }]}>
      <Text style={[s.chipText, small && { fontSize: font.xs + 1 }, on && { color: "#FFFFFF", fontFamily: fontFamily.semibold }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  tools: { backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  search: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: "#EEF3F8",
    borderRadius: radius.sm, paddingHorizontal: spacing.md, height: 38,
  },
  searchInput: { flex: 1, fontSize: font.sm + 1, color: colors.text, fontFamily: fontFamily.regular, paddingVertical: 0 },
  chips: { gap: spacing.xs + 2, paddingVertical: 2 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: font.sm, color: colors.textSecondary, fontFamily: fontFamily.medium },
  startWrap: { marginHorizontal: spacing.md, marginTop: spacing.md, borderRadius: radius.md, overflow: "hidden" },
  start: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
  startIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  startTitle: { color: "#FFFFFF", fontSize: font.base + 1, fontFamily: fontFamily.bold },
  startBody: { color: "rgba(255,255,255,0.92)", fontSize: font.sm, fontFamily: fontFamily.regular },
  listLabel: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, fontSize: font.xs, color: colors.textTertiary, fontFamily: fontFamily.semibold, textTransform: "uppercase", letterSpacing: 0.5 },
  emptyBlock: { backgroundColor: colors.surface, marginTop: spacing.sm, paddingHorizontal: spacing.lg },
});
