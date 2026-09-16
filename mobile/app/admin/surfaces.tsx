import { useState } from "react";
import { Switch, Text, View } from "react-native";
import { Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, radius, spacing } from "../../src/theme";
import { Empty, Icon, Loading, Screen, errText } from "../../src/components/ui";
import { PageIntro, Pill, TitledCard } from "../../src/components/MoreKit";
import { NoticeBanner, useNotice } from "../../src/components/Sheet";
import { ConfirmSheet, NotFoundScreen, gateView, blockedView, isNotFound, text, useReviewer } from "../../src/components/more/AdminKit";

/** shared/surfaces.ts SURFACE_CLASS_LABEL, in the web's order. */
const ORDER = ["core", "momentum", "later", "network", "off"] as const;
const CLASS_LABEL: Record<string, string> = {
  core: "Core toolkit", momentum: "Momentum", later: "Matures with the project", network: "Needs other people", off: "Sidelined",
};

interface Row {
  id: string;
  label: string;
  cls: string;
  note: string;
  needsPeople?: number | null;
  defaultEnabled: boolean;
  enabled: boolean;
}

/**
 * Turning feature areas on and off without a deploy — the web's /admin/surfaces.
 * Switching one off asks first on the phone, where a stray thumb is easier.
 */
export default function AdminSurfaces() {
  const qc = useQueryClient();
  const { notice, show, clear } = useNotice();
  const { loading, isReviewer } = useReviewer();
  const [pendingOff, setPendingOff] = useState<Row | null>(null);

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ["admin-surfaces"],
    queryFn: () => api<{ surfaces: Row[] }>("/api/admin/surfaces"),
    enabled: isReviewer,
    retry: false,
  });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api<{ id: string; enabled: boolean; label?: string }>(`/api/admin/surfaces/${id}`, { method: "PATCH", body: { enabled } }),
    onSuccess: (r) => {
      setPendingOff(null);
      show({ tone: "success", text: `${r.label ?? r.id} ${r.enabled ? "on" : "off"}` });
      qc.invalidateQueries({ queryKey: ["admin-surfaces"] });
      qc.invalidateQueries({ queryKey: ["surfaces"] });
      // A switch is an action the safety review measures, and changes what it lists as off.
      qc.invalidateQueries({ queryKey: ["safety-review"] });
      qc.invalidateQueries({ queryKey: ["safety-status"] });
    },
    onError: (e) => { setPendingOff(null); show({ tone: "error", text: errText(e, "Couldn't change that") }); },
  });

  const gate = gateView("Feature areas", loading, isReviewer);
  if (gate) return gate;
  // Locked behind a second factor, or simply not this account's page (src/components/more/AdminKit.tsx).
  const blocked = blockedView("Feature areas", error);
  if (blocked) return blocked;

  const rows = data?.surfaces ?? [];
  const onCount = rows.filter((r) => r.enabled).length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <Stack.Screen options={{ title: "Feature areas" }} />
      <Screen canvas onRefresh={() => refetch()} refreshing={isRefetching}>
        <PageIntro
          icon="toggle"
          title="Feature areas"
          body="What's reachable in the product. Switching one off hides its nav, blocks its routes and refuses its API — nothing is deleted, so anything here comes back with one tap."
        />
        {rows.length > 0 ? <Text style={text.small}>{onCount} of {rows.length} on.</Text> : null}

        {isLoading ? <View style={{ height: 200 }}><Loading /></View>
          : error ? <Empty icon="cloud-offline-outline" title="Couldn't load the switches" body={errText(error)} action="Try again" onAction={() => refetch()} />
          : ORDER.map((cls) => {
            const group = rows.filter((r) => r.cls === cls);
            if (group.length === 0) return null;
            return (
              <TitledCard key={cls} title={CLASS_LABEL[cls]}>
                {cls === "network" ? (
                  <Text style={text.small}>
                    These need other people to do anything. The number beside each one is roughly how many active accounts it takes before it stops feeling empty.
                  </Text>
                ) : null}
                {group.map((s) => (
                  <View key={s.id} style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: spacing.sm }}>
                    <View style={{ flex: 1, gap: 3 }}>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                        <Text style={text.strong}>{s.label}</Text>
                        {s.needsPeople != null ? <Pill label={`${s.needsPeople}+`} icon="people" color={colors.textSecondary} /> : null}
                        {s.enabled !== s.defaultEnabled ? <Pill label="changed" color={colors.info} /> : null}
                      </View>
                      <Text style={text.small}>{s.note}</Text>
                    </View>
                    <Switch
                      value={s.enabled}
                      disabled={toggle.isPending}
                      onValueChange={(v) => (v ? toggle.mutate({ id: s.id, enabled: true }) : setPendingOff(s))}
                      trackColor={{ true: colors.primary, false: colors.border }}
                      thumbColor="#FFFFFF"
                      // react-native-web ignores thumbColor for the on state.
                      {...({ activeThumbColor: "#FFFFFF" } as object)}
                      accessibilityLabel={`${s.label} ${s.enabled ? "on" : "off"}`}
                    />
                  </View>
                ))}
              </TitledCard>
            );
          })}

        <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
          <Icon name="warning" size={14} color={colors.warning} />
          <Text style={[text.small, { flex: 1 }]}>
            Turning a surface off returns 404 rather than 403, so a disabled area is indistinguishable from one that was never built. Anyone already on that page sees it disappear on their next request.
          </Text>
        </View>
      </Screen>

      <ConfirmSheet
        visible={!!pendingOff}
        onClose={() => setPendingOff(null)}
        title={`Switch off ${pendingOff?.label ?? ""}?`}
        body="Its nav disappears, its routes and API answer 404 for everyone. Nothing is deleted — switch it back on to restore it."
        confirmLabel="Switch off"
        danger
        loading={toggle.isPending}
        onConfirm={() => pendingOff && toggle.mutate({ id: pendingOff.id, enabled: false })}
      />
      <NoticeBanner notice={notice} onDismiss={clear} />
    </View>
  );
}
