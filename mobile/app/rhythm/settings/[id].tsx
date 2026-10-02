import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../src/api/client";
import { colors, font, fontFamily, radius, spacing } from "../../../src/theme";
import { Btn, Icon, Loading, Screen, errText } from "../../../src/components/ui";
import { Callout, PageIntro, TitledCard } from "../../../src/components/MoreKit";
import { NoticeBanner, useNotice } from "../../../src/components/Sheet";
import { ChoiceList, NotFoundScreen, isNotFound, text } from "../../../src/components/more/AdminKit";

/**
 * When the check-in is due, and who gets reminded.
 *
 * This is the one piece of the rhythm's setup that belongs on a phone rather
 * than at a desk, and the reason is who uses it: a reminder is a thing that
 * arrives *on the phone*, so the person who wants it moved to Sunday, or wants
 * to stop being the one chased, is holding the device it arrives on. Everything
 * else in the rhythm's setup — which numbers the project tracks, what the
 * recurring jobs are — is the project's shape and stays where it was.
 *
 * ## The empty list is not "nobody"
 *
 * `remindUserIds` empty means *every member*, which is the server's default and
 * the sensible one for a company that has just started. A screen with checkboxes
 * would read that as "nobody is reminded" and show an unticked list, so the two
 * states are drawn differently: either everyone, or exactly the people named.
 * Unticking the last person puts it back to everyone rather than to silence,
 * which is also what the server would do with the list it was sent.
 */

interface Member { id: string; name: string; profileImageUrl: string | null }
interface Settings { checkinDay: number; remindUserIds: string[]; members: Member[] }

/** 0 = Monday … 6 = Sunday, which is the server's numbering and not JavaScript's. */
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function RhythmSettings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const { notice, show, clear } = useNotice();

  const q = useQuery<Settings>({
    queryKey: ["rhythm", id, "settings"],
    queryFn: () => api<Settings>(`/api/projects/${id}/rhythm/settings`),
    enabled: !!id,
    retry: false,
  });

  const [day, setDay] = useState<number | null>(null);
  const [remind, setRemind] = useState<string[] | null>(null);

  /* Seeded once the server has answered, so the form starts from what is set. */
  useEffect(() => {
    if (!q.data) return;
    setDay(q.data.checkinDay);
    setRemind(q.data.remindUserIds);
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => api(`/api/projects/${id}/rhythm/settings`, {
      method: "PUT",
      body: { checkinDay: day, remindUserIds: remind ?? [] },
    }),
    onSuccess: () => {
      /* The week's screen shows the due day, so it is stale the moment this changes. */
      void qc.invalidateQueries({ queryKey: ["rhythm", id] });
      show({ text: "Saved.", tone: "success" });
    },
    onError: (e) => show({ text: errText(e, "Couldn't save that."), tone: "error" }),
  });

  if (isNotFound(q.error)) return <NotFoundScreen title="Check-in day" />;
  if (q.isLoading || !q.data || day === null || remind === null) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        <Stack.Screen options={{ title: "Check-in day" }} />
        <Loading />
      </View>
    );
  }

  const everyone = remind.length === 0;
  const changed = day !== q.data.checkinDay
    || remind.length !== q.data.remindUserIds.length
    || remind.some((r) => !q.data!.remindUserIds.includes(r));

  const toggle = (userId: string) => {
    setRemind((list) => {
      const current = list ?? [];
      /*
       * Coming from "everyone", the first tap means "only this person" rather
       * than "everyone except" — otherwise the first tap would have to expand
       * the implicit list, and somebody picking one name would silently sign
       * the rest of the team up by name.
       */
      if (current.length === 0) return [userId];
      const next = current.includes(userId) ? current.filter((r) => r !== userId) : [...current, userId];
      return next;
    });
  };

  return (
    <>
      <Screen>
        <Stack.Screen options={{ title: "Check-in day" }} />
        <PageIntro
          icon="alarm"
          title="When the week is filed"
          body="The day the check-in is due, and who gets the reminder. Both arrive on a phone, which is why they can be changed from one."
        />

        <TitledCard icon="calendar" title="Check-in day">
          <ChoiceList
            options={DAYS.map((label, i) => ({ id: String(i), label }))}
            value={String(day)}
            onChange={(v) => setDay(Number(v))}
            disabled={save.isPending}
          />
        </TitledCard>

        <TitledCard icon="notifications" title="Who gets reminded">
          <Text style={text.meta}>
            {everyone
              ? "Everyone on the project. Pick names to narrow it."
              : `${remind.length} of ${q.data.members.length} on the project.`}
          </Text>
          {q.data.members.map((m) => {
            const on = everyone || remind.includes(m.id);
            return (
              <Pressable
                key={m.id}
                onPress={() => toggle(m.id)}
                disabled={save.isPending}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                style={({ pressed }) => [{
                  flexDirection: "row", alignItems: "center", gap: spacing.sm,
                  paddingVertical: spacing.sm, paddingHorizontal: spacing.sm,
                  borderRadius: radius.sm,
                  backgroundColor: pressed ? colors.surfaceRaised : "transparent",
                }]}
                testID={`remind-${m.id}`}
              >
                <Icon
                  name={on ? "checkbox" : "square-outline"}
                  size={20}
                  color={on ? colors.primary : colors.textTertiary}
                />
                <Text style={{ flex: 1, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.regular }}>{m.name}</Text>
                {everyone ? <Text style={text.small}>by default</Text> : null}
              </Pressable>
            );
          })}
          {!everyone ? (
            <Btn
              label="Remind everyone instead"
              small
              variant="ghost"
              style={{ marginTop: spacing.sm }}
              onPress={() => setRemind([])}
              testID="remind-everyone"
            />
          ) : null}
        </TitledCard>

        <Btn
          label="Save"
          loading={save.isPending}
          disabled={!changed || save.isPending}
          onPress={() => save.mutate()}
          testID="save-rhythm-settings"
        />

        <Callout
          icon="information-circle"
          tone="info"
          body="Nobody on the list means everyone on the project, which is the default. The recurring jobs and the numbers a project tracks are part of its setup, and those are still on the web."
        />
        <View style={{ height: spacing.xl }} />
      </Screen>
      <NoticeBanner notice={notice} onDismiss={clear} />
    </>
  );
}
