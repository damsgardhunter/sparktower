/**
 * One seat at your table, on the phone.
 *
 * A route rather than a modal, and that is the point of it: the web's equivalent
 * is a dialog with no address, so the in-app browser fallback could not reach it
 * and a link in a notification had nowhere to land. `/sim/seat/<venture>/<user>`
 * is somewhere to land.
 *
 * What it answers is one question a desk cannot: has the person you are waiting
 * on been turning up all season, or is this period unusual for them? The desk
 * shows "still deciding" and nothing about the eleven periods before it.
 */
import { Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { colors, font, fontFamily, spacing } from "../../../../src/theme";
import { Btn, Card, Empty, Loading, Screen, errText } from "../../../../src/components/ui";
import { Pill } from "../../../../src/components/MoreKit";
import { SimSectionTitle } from "../../../../src/components/sim/SimKit";
import { useSeat } from "../../../../src/components/sim/useSim";
import { turnoutRead } from "../../../../src/components/sim/profiles";

export default function Seat() {
  const { id, userId } = useLocalSearchParams<{ id: string; userId: string }>();
  const router = useRouter();
  const { data, isLoading, error } = useSeat(id, userId);

  if (isLoading) {
    return (<><Stack.Screen options={{ title: "Seat" }} /><Loading label="Reading the chair…" /></>);
  }

  if (error || !data) {
    return (
      <>
        <Stack.Screen options={{ title: "Seat" }} />
        <Screen canvas>
          <Empty
            icon="person-outline"
            title="That seat isn't here"
            body={errText(error, "Either the company isn't yours or nobody is sitting there.")}
          />
          <Btn label="Back to your desk" icon="arrow-back" variant="outline" onPress={() => router.replace(`/sim/desk/${id}`)} />
        </Screen>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: data.name }} />
      <Screen canvas>
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Text style={{ color: colors.text, fontSize: font.lg, fontFamily: fontFamily.bold }}>{data.name}</Text>
            {data.isYou ? <Pill label="You" color={colors.primary} /> : null}
            {/*
              * Said plainly. A stand-in is not a colleague who is quiet; it is a
              * seat the product is playing, and somebody deciding whether to
              * chase a filing needs to know which they are looking at.
              */}
            {data.isBot ? <Pill label="Stand-in" color={colors.textTertiary} /> : null}
          </View>
          <Text style={{ color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.medium, marginTop: 2 }}>
            {data.title ?? "No seat yet"}
          </Text>
          {data.headline ? (
            <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular, marginTop: 4 }}>
              {data.headline}
            </Text>
          ) : null}
        </Card>

        <Card accent={data.filed ? colors.success : colors.warning}>
          <SimSectionTitle
            icon={data.filed ? "checkmark-circle" : "time-outline"}
            title={data.filed ? "Filed this period" : "Still deciding"}
            color={data.filed ? colors.success : colors.warning}
          />
          <Text testID="seat-turnout" style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
            {turnoutRead(data.turnout)}
          </Text>
        </Card>

        {data.levers.length > 0 ? (
          <Card>
            <SimSectionTitle icon="options-outline" title="What this chair decides" />
            {data.levers.map((lever) => (
              <Text key={lever} style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
                · {lever}
              </Text>
            ))}
          </Card>
        ) : null}

        {data.challenges.length > 0 ? (
          <Card>
            <SimSectionTitle icon="flag-outline" title="What they were asked to do" />
            {data.challenges.map((c) => (
              <View key={`${c.year}-${c.title}`} style={{ paddingVertical: 5, gap: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.medium }}>
                    {c.title ?? `Period ${c.year}`}
                  </Text>
                  {c.met === null ? null : (
                    <Pill label={c.met ? "Met" : "Missed"} color={c.met ? colors.success : colors.danger} />
                  )}
                </View>
                {c.brief ? (
                  <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
                    {c.brief}
                  </Text>
                ) : null}
              </View>
            ))}
          </Card>
        ) : null}

        <Btn label="Back to your desk" icon="arrow-back" variant="outline" onPress={() => router.replace(`/sim/desk/${id}`)} testID="seat-back" />
        <View style={{ height: spacing.lg }} />
      </Screen>
    </>
  );
}
