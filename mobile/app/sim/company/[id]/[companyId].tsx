/**
 * A rival, on the phone.
 *
 * A route rather than a dialog, for the same reason as the seat screen: the web's
 * is a modal with no address, so nothing could link to it.
 *
 * Everything here is already public. The standings publish each company's share
 * and worth to everybody including the company being read, and that is
 * deliberate — a negotiation where only one side can do the arithmetic is not a
 * negotiation, it is a trick played on whoever is newer to the game. So this adds
 * no information to the market; it adds somewhere to read it from.
 */
import { Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { colors, font, fontFamily, spacing } from "../../../../src/theme";
import { Btn, Card, Empty, Loading, Screen, errText } from "../../../../src/components/ui";
import { Pill } from "../../../../src/components/MoreKit";
import { SimSectionTitle } from "../../../../src/components/sim/SimKit";
import { useRivalCompany } from "../../../../src/components/sim/useSim";
import { money } from "../../../../src/components/sim/desk";

export default function RivalCompany() {
  const { id, companyId } = useLocalSearchParams<{ id: string; companyId: string }>();
  const router = useRouter();
  const { data, isLoading, error } = useRivalCompany(id, companyId);

  if (isLoading) {
    return (<><Stack.Screen options={{ title: "Rival" }} /><Loading label="Reading the competition…" /></>);
  }

  if (error || !data) {
    return (
      <>
        <Stack.Screen options={{ title: "Rival" }} />
        <Screen canvas>
          <Empty
            icon="business-outline"
            title="No such company"
            body={errText(error, "It isn't in this market, or this isn't your season.")}
          />
          <Btn label="Back to the market" icon="arrow-back" variant="outline" onPress={() => router.replace(`/sim/market/${id}`)} />
        </Screen>
      </>
    );
  }

  const latest = data.history.at(-1);

  return (
    <>
      <Stack.Screen options={{ title: data.name }} />
      <Screen canvas>
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Text style={{ color: colors.text, fontSize: font.lg, fontFamily: fontFamily.bold }}>{data.name}</Text>
            {/*
              * Which kind of rival, because they behave differently. An incumbent
              * was here first and reacts by posture; another team is five people
              * arguing, and can be bargained with.
              */}
            <Pill
              label={data.kind === "incumbent" ? "Was here first" : "Another table"}
              color={data.kind === "incumbent" ? colors.warning : colors.primary}
            />
          </View>
          {data.product ? (
            <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular, marginTop: 2 }}>
              {data.product}
            </Text>
          ) : null}
          {data.persona?.tagline ? (
            <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular, marginTop: 4 }}>
              {data.persona.tagline}
            </Text>
          ) : null}
        </Card>

        {data.posturedAs ? (
          <Card accent={colors.warning}>
            <SimSectionTitle icon="shield-half-outline" title="How they react" color={colors.warning} />
            <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
              {data.posturedAs}
            </Text>
            {data.persona?.knock ? (
              <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular, marginTop: 4 }}>
                What people say against them: {data.persona.knock}
              </Text>
            ) : null}
          </Card>
        ) : null}

        {latest ? (
          <Card>
            <SimSectionTitle icon="stats-chart-outline" title="Where they stand" />
            <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
              {(latest.share * 100).toFixed(1)}% of the market
              {latest.shareChange ? ` (${latest.shareChange > 0 ? "+" : ""}${(latest.shareChange * 100).toFixed(1)} last period)` : ""}
              {" · "}{Math.round(latest.customers).toLocaleString()} {data.voice?.customers ?? "customers"}
            </Text>
            {typeof data.standing?.value === "number" ? (
              <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular, marginTop: 2 }}>
                Worth about {money(data.standing.value)}.
              </Text>
            ) : null}
          </Card>
        ) : null}

        {/*
          * The readings, which the server works out rather than the screen: the
          * same sentence has to appear on both clients, and arithmetic duplicated
          * in two places is arithmetic that will disagree.
          */}
        {data.reads.length > 0 ? (
          <Card>
            <SimSectionTitle icon="bulb-outline" title="What that means for you" />
            {data.reads.map((read) => (
              <Text key={read} style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
                · {read}
              </Text>
            ))}
          </Card>
        ) : null}

        {data.contested.length > 0 ? (
          <Card>
            <SimSectionTitle icon="git-compare-outline" title="Where you meet them" />
            {data.contested.map((seg) => (
              <View key={seg.id ?? seg.name} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 3 }}>
                <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.regular, flex: 1 }}>{seg.name}</Text>
                {seg.edge ? (
                  <Pill
                    label={seg.edge === "you" ? "You're cheaper" : "They're cheaper"}
                    color={seg.edge === "you" ? colors.success : colors.warning}
                  />
                ) : null}
              </View>
            ))}
          </Card>
        ) : null}

        {data.roster.length > 0 ? (
          <Card>
            <SimSectionTitle icon="people-outline" title="Who runs it" />
            {data.roster.map((seat) => (
              <Text key={seat.role} style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
                {seat.title ?? seat.role.toUpperCase()} · {seat.name ?? "unfilled"}{seat.isBot ? " (stand-in)" : ""}
              </Text>
            ))}
          </Card>
        ) : null}

        <Btn label="Back" icon="arrow-back" variant="outline" onPress={() => router.back()} testID="rival-back" />
        <View style={{ height: spacing.lg }} />
      </Screen>
    </>
  );
}
