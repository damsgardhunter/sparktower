/**
 * The pages this project has put on the open internet, on the phone.
 *
 * The web's list (client/src/components/section/published-pages.tsx), for the
 * same reason: publishing a finished step creates a page a stranger can read,
 * and without a list there was nowhere to see what of yours is public, how it's
 * doing, or how to take one down.
 */
import { Alert, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { colors, font, fontFamily, spacing } from "../../theme";
import { Btn, Card, Icon, Meta, Row } from "../ui";
import { openWeb, useNotify } from "./bits";
import { mkey } from "./shared";

interface Artifact {
  id: string;
  title: string;
  visibility: "private" | "public";
  views: number;
  signups: number;
}

export function PublishedPages({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { notify, fail } = useNotify();

  const { data } = useQuery({
    queryKey: mkey(projectId, "artifacts"),
    queryFn: () => api<Artifact[]>(`/api/projects/${projectId}/artifacts`),
    enabled: !!projectId,
  });
  const live = (data ?? []).filter((a) => a.visibility === "public");

  const takeDown = useMutation({
    mutationFn: (id: string) => api(`/api/artifacts/${id}/unpublish`, { method: "POST", body: {} }),
    onSuccess: () => {
      notify("The page is down — the link leads nowhere now.");
      qc.invalidateQueries({ queryKey: mkey(projectId, "artifacts") });
    },
    onError: (e) => fail(e, "Couldn't take that page down."),
  });

  const confirm = (a: Artifact) => Alert.alert(
    "Take this page down?",
    "The page stops being reachable. Anyone who opens the link — including people who already have it — gets nothing. Your post about it stays on the feed until you delete it, and you can publish it again later.",
    [
      { text: "Leave it up", style: "cancel" },
      { text: "Take it down", style: "destructive", onPress: () => takeDown.mutate(a.id) },
    ],
  );

  // Nothing published yet needs no card: the path offers publishing where a step is finished.
  if (!live.length) return null;

  return (
    <Card style={{ gap: spacing.sm }}>
      <Row center gap={6}>
        <Icon name="globe-outline" size={16} color={colors.primary} />
        <Text testID="published-pages" style={{ fontFamily: fontFamily.bold, fontSize: font.base, color: colors.text }}>Published pages</Text>
      </Row>
      {live.map((a) => (
        <View key={a.id} style={{ gap: 4, borderTopWidth: 1, borderColor: colors.borderSubtle, paddingTop: spacing.sm }}>
          <Text numberOfLines={2} style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>{a.title}</Text>
          <Meta>{a.views} read{a.views === 1 ? "" : "s"} · {a.signups} joined from it</Meta>
          <Row gap={spacing.sm}>
            <Btn small variant="outline" icon="open-outline" label="Open" onPress={() => openWeb(`/a/${a.id}`)} testID={`button-open-page-${a.id}`} />
            <Btn small variant="danger" label="Take down" onPress={() => confirm(a)} disabled={takeDown.isPending} testID={`button-take-down-${a.id}`} />
          </Row>
        </View>
      ))}
    </Card>
  );
}
