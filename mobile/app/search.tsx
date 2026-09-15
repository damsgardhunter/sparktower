import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View, Platform } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, fetchMe, readPref, writePref } from "../src/api/client";
import { colors, font, fontFamily, radius, spacing } from "../src/theme";
import { Avatar, Empty, Icon, IconButton, Loading, TabStrip } from "../src/components/ui";
import { ConnectActions, FollowButton, useConnectionStates } from "../src/components/ConnectActions";
import { NoticeBanner, useNotice } from "../src/components/Sheet";
import { NetworkBlock, PersonRowItem, ProjectRowItem, ProjectTile, networkStyles } from "../src/components/NetworkCards";
import { EXPLORE, markSeen, trackExplore } from "../src/explore";
import { personAvatar, personName } from "../src/networkData";

type Scope = "all" | "people" | "projects";

interface Recent {
  kind: "builder" | "project";
  id: string;
  name: string;
  subtitle?: string | null;
  avatarUrl?: string | null;
}

const RECENT_MAX = 8;
/** How many of each kind "All" shows before "See all". */
const ALL_LIMIT = 4;

/**
 * Search, from the pill in the header: builders by name, and projects by
 * title, pitch or category. Before typing, what you opened from here last.
 */
export default function Search() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ q?: string }>();
  const [q, setQ] = useState(params.q ?? "");
  const [debounced, setDebounced] = useState(q);
  const [scope, setScope] = useState<Scope>("all");
  const { notice, show, clear } = useNotice();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const meId: string | undefined = me?.user?.id;

  // --- recent ---------------------------------------------------------------
  const recentKey = meId ? `search.recent.${meId}` : null;
  const [recent, setRecent] = useState<Recent[]>([]);
  useEffect(() => {
    if (!recentKey) return;
    readPref(recentKey).then((raw) => {
      try { setRecent(raw ? JSON.parse(raw) : []); } catch { setRecent([]); }
    }).catch(() => {});
  }, [recentKey]);
  const remember = (item: Recent) => {
    const next = [item, ...recent.filter((r) => !(r.kind === item.kind && r.id === item.id))].slice(0, RECENT_MAX);
    setRecent(next);
    if (recentKey) void writePref(recentKey, JSON.stringify(next));
  };
  const clearRecent = () => {
    setRecent([]);
    if (recentKey) void writePref(recentKey, null);
  };

  // --- results ----------------------------------------------------------------
  const searching = debounced.length > 0;
  const people = useQuery({
    queryKey: ["users", "search", debounced],
    queryFn: () => api<any[]>(`/api/users/search?q=${encodeURIComponent(debounced)}`),
    // One letter matches nearly everyone; the server searches names and needs a little more.
    enabled: debounced.length > 1 && scope !== "projects",
  });
  const projects = useQuery({
    queryKey: ["projects", "discover"],
    queryFn: () => api<any[]>("/api/projects"),
    enabled: searching && scope !== "people",
  });
  const followed = useQuery({
    queryKey: ["followed-projects"],
    queryFn: () => api<any[]>("/api/user/followed-projects"),
    enabled: searching && scope !== "people",
  });

  const peopleRows = (people.data ?? []).filter((u) => u.id !== meId);
  const projectRows = useMemo(() => {
    const needle = debounced.toLowerCase();
    if (!needle) return [];
    return (projects.data ?? [])
      .filter((p) => !p.isPrivate || p.ownerId === meId)
      .filter((p) => [p.title, p.oneLiner, p.description, p.category].some((f) => typeof f === "string" && f.toLowerCase().includes(needle)))
      .sort((a, b) => Number(!String(a.title).toLowerCase().includes(needle)) - Number(!String(b.title).toLowerCase().includes(needle)));
  }, [projects.data, debounced, meId]);
  const followedIds = new Set((followed.data ?? []).map((f: any) => f.projectId));
  const { data: states } = useConnectionStates(peopleRows.slice(0, 40).map((u) => u.id));

  const openPerson = (u: any, rank: number) => {
    const name = personName(u, u.profile);
    remember({ kind: "builder", id: u.id, name, subtitle: u.profile?.headline, avatarUrl: personAvatar(u, u.profile) });
    trackExplore(EXPLORE.openProfile, { matchType: "builder", targetId: u.id, rankPosition: rank, source: "discover" });
    markSeen("builder", u.id);
    router.push(`/user/${u.id}`);
  };
  const openProject = (p: any, rank: number) => {
    remember({ kind: "project", id: p.id, name: p.title, subtitle: p.oneLiner || p.category });
    trackExplore(EXPLORE.openProject, { matchType: "project", targetId: p.id, rankPosition: rank, source: "discover" });
    markSeen("project", p.id);
    router.push(`/project/${p.id}`);
  };

  const peopleLimit = scope === "all" ? ALL_LIMIT : undefined;
  const projectLimit = scope === "all" ? ALL_LIMIT : undefined;

  const peopleBlock = (
    <NetworkBlock
      title="People"
      action={scope === "all" && peopleRows.length > ALL_LIMIT ? `See all ${peopleRows.length}` : undefined}
      onAction={() => setScope("people")}
      flush
    >
      {debounced.length < 2 ? (
        <Text style={[networkStyles.rowSub, { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }]}>Keep typing to search builders by name.</Text>
      ) : people.isLoading ? <Loading /> : !peopleRows.length ? (
        <Text style={[networkStyles.rowSub, { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }]}>No builders named "{debounced}".</Text>
      ) : peopleRows.slice(0, peopleLimit).map((u, i) => {
        const name = personName(u, u.profile);
        const meta = [u.profile?.username && `@${u.profile.username}`, u.profile?.location].filter(Boolean).join(" · ");
        return (
          <View key={u.id}>
            {i > 0 && <View style={networkStyles.divider} />}
            <PersonRowItem
              name={name}
              headline={u.profile?.headline}
              meta={meta || null}
              avatarUrl={personAvatar(u, u.profile)}
              onOpen={() => openPerson(u, i + 1)}
              right={
                <View style={{ width: 112 }}>
                  <ConnectActions block userId={u.id} name={name} headline={u.profile?.headline} connection={states?.[u.id]} notify={show} explore={{ source: "discover", rankPosition: i + 1 }} />
                </View>
              }
            />
          </View>
        );
      })}
    </NetworkBlock>
  );

  const projectsBlock = (
    <NetworkBlock
      title="Projects"
      action={scope === "all" && projectRows.length > ALL_LIMIT ? `See all ${projectRows.length}` : undefined}
      onAction={() => setScope("projects")}
      flush
    >
      {projects.isLoading ? <Loading /> : !projectRows.length ? (
        <Text style={[networkStyles.rowSub, { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }]}>No projects match "{debounced}".</Text>
      ) : projectRows.slice(0, projectLimit).map((p, i) => (
        <View key={p.id}>
          {i > 0 && <View style={networkStyles.divider} />}
          <ProjectRowItem
            title={p.title}
            owner={p.profile?.displayName || personName(p.owner, null, "A builder")}
            category={p.category}
            blurb={p.oneLiner || p.description}
            roles={(p.rolesNeeded ?? []).slice(0, 2)}
            onOpen={() => openProject(p, i + 1)}
            action={p.ownerId === meId ? undefined : (
              <FollowButton projectId={p.id} title={p.title} following={followedIds.has(p.id)} notify={show} explore={{ source: "discover", rankPosition: i + 1 }} />
            )}
          />
        </View>
      ))}
    </NetworkBlock>
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        <View style={{ backgroundColor: colors.surface, paddingTop: insets.top + spacing.sm, borderBottomWidth: searching ? 0 : 1, borderColor: colors.border }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm }}>
            <IconButton name="arrow-back" label="Back" color={colors.text} onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/feed"))} />
            <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, paddingHorizontal: spacing.md, height: 38 }}>
              <Icon name="search" size={17} color={colors.textTertiary} />
              <TextInput
                value={q}
                onChangeText={setQ}
                autoFocus
                placeholder="Search builders and projects"
                placeholderTextColor={colors.textTertiary}
                returnKeyType="search"
                autoCapitalize="none"
                autoCorrect={false}
                style={[{ flex: 1, color: colors.text, fontSize: font.base, fontFamily: fontFamily.regular, paddingVertical: 0 }, Platform.OS === "web" && ({ outlineWidth: 0, outlineStyle: "none" } as object)]}
                accessibilityLabel="Search"
              />
              {q.length > 0 && (
                <Pressable onPress={() => setQ("")} hitSlop={8} accessibilityLabel="Clear search">
                  <Icon name="close-circle" size={18} color={colors.textTertiary} />
                </Pressable>
              )}
            </View>
          </View>
          {searching && (
            <TabStrip
              options={[{ value: "all" as Scope, label: "All" }, { value: "people" as Scope, label: "People" }, { value: "projects" as Scope, label: "Projects" }]}
              value={scope}
              onChange={setScope}
            />
          )}
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.xxl * 2, paddingTop: searching ? spacing.sm : 0 }}>
          {!searching ? (
            <View style={{ backgroundColor: colors.surface }}>
              {recent.length ? (
                <>
                  <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xs }}>
                    <Text style={{ flex: 1, color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>Recent</Text>
                    <Pressable onPress={clearRecent} hitSlop={8}>
                      <Text style={{ color: colors.primary, fontSize: font.sm, fontFamily: fontFamily.semibold }}>Clear</Text>
                    </Pressable>
                  </View>
                  {recent.map((r) => (
                    <Pressable
                      key={`${r.kind}:${r.id}`}
                      onPress={() => { remember(r); router.push(r.kind === "builder" ? `/user/${r.id}` : `/project/${r.id}`); }}
                      style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 10 }, pressed && { backgroundColor: colors.surfaceRaised }]}
                    >
                      {r.kind === "builder" ? <Avatar name={r.name} uri={r.avatarUrl} size={40} /> : <ProjectTile title={r.name} size={40} />}
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={networkStyles.rowTitle} numberOfLines={1}>{r.name}</Text>
                        <Text style={networkStyles.meta} numberOfLines={1}>{[r.kind === "builder" ? "Builder" : "Project", r.subtitle].filter(Boolean).join(" · ")}</Text>
                      </View>
                      <Icon name="time-outline" size={18} color={colors.textTertiary} />
                    </Pressable>
                  ))}
                </>
              ) : (
                <Empty icon="search-outline" title="Find builders and projects" body="Search people by name, or projects by title, pitch or category. What you open shows up here next time." />
              )}
              <View style={{ height: 1, backgroundColor: colors.borderSubtle, marginTop: spacing.sm }} />
              {[
                { icon: "people-outline" as const, label: "People you may know", href: "/(tabs)/discover" },
                { icon: "sparkles-outline" as const, label: "Your matches", href: "/matches" },
                { icon: "mail-unread-outline" as const, label: "Invitations", href: "/network/invitations" },
              ].map((l) => (
                <Pressable
                  key={l.href}
                  onPress={() => router.push(l.href as any)}
                  style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md }, pressed && { backgroundColor: colors.surfaceRaised }]}
                >
                  <Icon name={l.icon} size={20} color={colors.textSecondary} />
                  <Text style={[networkStyles.rowSub, { flex: 1, color: colors.text }]}>{l.label}</Text>
                  <Icon name="chevron-forward" size={16} color={colors.textTertiary} />
                </Pressable>
              ))}
            </View>
          ) : scope === "people" ? peopleBlock : scope === "projects" ? projectsBlock : (
            <>
              {peopleBlock}
              {projectsBlock}
            </>
          )}
        </ScrollView>
      </View>
      <NoticeBanner notice={notice} onDismiss={clear} />
    </>
  );
}
