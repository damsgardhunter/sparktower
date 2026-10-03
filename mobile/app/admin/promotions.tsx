import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, spacing } from "../../src/theme";
import { Btn, Empty, Field, Loading, Row, Screen, errText } from "../../src/components/ui";
import { PageIntro, TitledCard } from "../../src/components/MoreKit";
import { Pill } from "../../src/components/nova/Pill";
import { NoticeBanner, Sheet, useNotice } from "../../src/components/Sheet";
import { blockedView, gateView, text, useReviewer } from "../../src/components/more/AdminKit";
import { PROMO_HEADLINE_MAX, PROMO_PERK_MAX } from "../../src/promotions";

/**
 * The tools shown in the feed, and what each one offers — the web's
 * /admin/promotions.
 *
 * The second of the two admin consoles the mobile survey never looked at.
 *
 * The catalog itself is code (`shared/promotions.ts`), so nothing here adds or
 * removes a company. What this edits is the part that changes often and from
 * outside: the video, the referral link, the perk, the headline, and whether
 * it is shown at all. Switching one off is the reason this belongs on a phone
 * — a partner's link breaking is something you hear about away from a desk,
 * and the fix is one toggle.
 *
 * An offer is only an offer with a link to claim it through: the server sets
 * `offer` to the perk only when a referral URL is also stored, so a perk typed
 * without a link shows nobody anything. The screen says so rather than letting
 * somebody wonder.
 */

interface Promotion {
  id: string;
  name: string;
  category: string;
  siteUrl: string | null;
  blurb: string | null;
  headline: string | null;
  videoUrl: string | null;
  referralUrl: string | null;
  logoUrl: string | null;
  offer: string | null;
  perk: string | null;
}

interface Row {
  promotion: Promotion;
  active: boolean;
  youtubeChannelUrl?: string | null;
  perk?: string | null;
}

export default function AdminPromotions() {
  const qc = useQueryClient();
  const { notice, show, clear } = useNotice();
  const { loading, isReviewer } = useReviewer();
  const [editing, setEditing] = useState<Row | null>(null);

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ["admin-promotions"],
    queryFn: () => api<{ promotions: Row[] }>("/api/admin/promotions"),
    enabled: isReviewer,
    retry: false,
  });

  const refreshAll = useMutation({
    mutationFn: () => api("/api/admin/promotions/refresh", { method: "POST", body: {} }),
    onSuccess: () => show({ tone: "success", text: "Fetching the latest videos and logos" }),
    onError: (e) => show({ tone: "error", text: errText(e, "Couldn't start that refresh") }),
  });

  const refreshOne = useMutation({
    mutationFn: (id: string) => api(`/api/admin/promotions/${id}/refresh`, { method: "POST", body: {} }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["admin-promotions"] }); show({ tone: "success", text: "Refreshed" }); },
    onError: (e) => show({ tone: "error", text: errText(e, "Couldn't refresh that one") }),
  });

  const gate = gateView("Promotions", loading, isReviewer);
  if (gate) return gate;
  const blocked = blockedView("Promotions", error);
  if (blocked) return blocked;

  const rows = data?.promotions ?? [];
  const shown = rows.filter((r) => r.active).length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <Stack.Screen options={{ title: "Promotions" }} />
      <Screen canvas onRefresh={() => refetch()} refreshing={isRefetching}>
        <PageIntro
          icon="megaphone"
          title="Promotions"
          body="The tools shown in the feed. The list of companies is code; what you set here is the video, the link, the perk and whether it appears."
        />
        {rows.length ? <Text style={text.small}>{shown} of {rows.length} shown.</Text> : null}

        {isLoading ? <View style={{ height: 200 }}><Loading /></View>
          : error ? <Empty icon="cloud-offline-outline" title="Couldn't load the promotions" body={errText(error)} action="Try again" onAction={() => refetch()} />
          : (
            <>
              <Btn
                variant="outline"
                label="Refresh every video and logo"
                loading={refreshAll.isPending}
                onPress={() => refreshAll.mutate()}
                testID="refresh-all-promotions"
              />
              {rows.map((r) => (
                <TitledCard key={r.promotion.id} title={r.promotion.name} icon="pricetag-outline">
                  <Row wrap gap={6} center>
                    <Pill label={r.active ? "shown" : "hidden"} tone={r.active ? "good" : "neutral"} />
                    <Pill label={r.promotion.category} tone="neutral" />
                    {r.promotion.videoUrl ? <Pill label="video" tone="info" /> : null}
                    {/*
                      * The one state worth calling out. A perk with no referral
                      * link is stored and shows nobody anything, because the
                      * server only turns a perk into an offer when there is a
                      * link to claim it through.
                      */}
                    {(r.perk ?? r.promotion.perk) && !r.promotion.referralUrl
                      ? <Pill label="perk with no link" tone="warn" />
                      : null}
                  </Row>
                  {r.promotion.headline ? <Text style={text.small} numberOfLines={2}>{r.promotion.headline}</Text> : null}
                  {r.promotion.offer ? <Text style={text.small}>Offer: {r.promotion.offer}</Text> : null}
                  <Row gap={spacing.sm} wrap>
                    <Btn small variant="outline" label="Edit" onPress={() => setEditing(r)} testID={`edit-promotion-${r.promotion.id}`} />
                    <Btn
                      small
                      variant="ghost"
                      label="Refresh"
                      loading={refreshOne.isPending}
                      onPress={() => refreshOne.mutate(r.promotion.id)}
                      testID={`refresh-promotion-${r.promotion.id}`}
                    />
                  </Row>
                </TitledCard>
              ))}
            </>
          )}
      </Screen>

      {editing ? (
        <PromotionForm
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { void qc.invalidateQueries({ queryKey: ["admin-promotions"] }); setEditing(null); }}
          notify={show}
        />
      ) : null}
      <NoticeBanner notice={notice} onDismiss={clear} />
    </View>
  );
}

function PromotionForm({
  row, onClose, onSaved, notify,
}: {
  row: Row;
  onClose: () => void;
  onSaved: () => void;
  notify: (n: { text: string; tone: "success" | "error" | "info" }) => void;
}) {
  const [f, setF] = useState({
    headline: row.promotion.headline ?? "",
    videoUrl: row.promotion.videoUrl ?? "",
    referralUrl: row.promotion.referralUrl ?? "",
    logoUrl: row.promotion.logoUrl ?? "",
    perk: row.perk ?? row.promotion.perk ?? "",
    youtubeChannelUrl: row.youtubeChannelUrl ?? "",
    active: row.active,
  });
  const set = (k: keyof typeof f) => (v: any) => setF((p) => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: () => api(`/api/admin/promotions/${row.promotion.id}`, {
      method: "PUT",
      body: {
        headline: f.headline.trim() || null,
        videoUrl: f.videoUrl.trim() || null,
        referralUrl: f.referralUrl.trim() || null,
        logoUrl: f.logoUrl.trim() || null,
        perk: f.perk.trim() || null,
        youtubeChannelUrl: f.youtubeChannelUrl.trim() || null,
        active: f.active,
      },
    }),
    onSuccess: () => { notify({ text: "Saved", tone: "success" }); onSaved(); },
    /*
     * The server's messages are specific about which link is wrong — "Use a
     * YouTube or Vimeo link, or an https link to an .mp4", "The referral link
     * must start with https://" — and name the field.
     */
    onError: (e) => notify({ text: errText(e, "Couldn't save that."), tone: "error" }),
  });

  const perkWithoutLink = !!f.perk.trim() && !f.referralUrl.trim();

  return (
    <Sheet visible onClose={onClose} title={row.promotion.name} subtitle="What the feed shows for this tool">
      <View style={{ gap: spacing.sm }}>
        <Pressable onPress={() => set("active")(!f.active)} testID="promotion-active" style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6 }}>
          <Pill label={f.active ? "shown" : "hidden"} tone={f.active ? "good" : "neutral"} />
          <Text style={[text.small, { flex: 1 }]}>Hidden means it does not appear in the feed at all.</Text>
        </Pressable>

        <Field label="Headline" value={f.headline} onChangeText={set("headline")} maxLength={PROMO_HEADLINE_MAX} testID="promotion-headline" />
        <Field label="Perk" value={f.perk} onChangeText={set("perk")} maxLength={PROMO_PERK_MAX} placeholder="$10 in credits" testID="promotion-perk" />
        <Field label="Referral link" value={f.referralUrl} onChangeText={set("referralUrl")} autoCapitalize="none" placeholder="https://…" testID="promotion-referral" />
        {perkWithoutLink ? (
          <Text style={[text.small, { color: colors.warning }]} testID="perk-without-link">
            A perk without a referral link shows nobody anything — an offer is only an offer with a link to claim it through.
          </Text>
        ) : null}
        <Field label="Video link" value={f.videoUrl} onChangeText={set("videoUrl")} autoCapitalize="none" placeholder="https://www.youtube.com/watch?v=…" testID="promotion-video" />
        <Field label="YouTube channel" value={f.youtubeChannelUrl} onChangeText={set("youtubeChannelUrl")} autoCapitalize="none" placeholder="https://www.youtube.com/@company" testID="promotion-channel" />
        <Field label="Logo link" value={f.logoUrl} onChangeText={set("logoUrl")} autoCapitalize="none" placeholder="https://…" testID="promotion-logo" />

        <Btn label="Save" loading={save.isPending} onPress={() => save.mutate()} testID="save-promotion" />
      </View>
    </Sheet>
  );
}
