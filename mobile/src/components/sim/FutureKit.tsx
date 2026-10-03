/**
 * How many people are coming, and what is already on its way — for a phone.
 *
 * The forecast was the sharpest thing missing here. The server has sent
 * `desk.forecast` and `desk.idleCostPerUnit` since the day the forecast existed
 * and nothing in `mobile/` read either, so a phone operations seat typed a
 * capacity number with no idea how many customers the year would bring — while a
 * web player in the same team looked at the range, the room, and what being
 * wrong costs in each direction. Capacity is the one lever that binds both ways,
 * and it was the one the phone asked people to guess at.
 *
 * The decision this draws is an argument between two seats: marketing moves the
 * demand, operations builds to it. So the card says which lever is yours rather
 * than leaving a seat to work out why it is being shown a range.
 *
 * Arithmetic lives in `future.ts`, which is free of React Native so the mirror
 * test can check it against the engine's own `capacityRisk`. This file draws.
 */
import { Text, View } from "react-native";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Card, Icon } from "../ui";
import { Pill, tintSoft } from "../MoreKit";
import { SimSectionTitle } from "./SimKit";
import { exact, money } from "./desk";
import {
  VERDICT_READ, capacityRisk, comingUp, forecastAtPrice, overOrdering,
  type CapacityVerdict, type Forecast,
} from "./future";

const TONE: Record<CapacityVerdict, string> = {
  short: colors.danger,
  tight: colors.warning,
  balanced: colors.success,
  generous: colors.info,
  idle: colors.warning,
};

const ICON: Record<CapacityVerdict, React.ComponentProps<typeof Icon>["name"]> = {
  short: "alert-circle",
  tight: "alert-circle-outline",
  balanced: "checkmark-circle",
  generous: "cube-outline",
  idle: "warning",
};

/**
 * The forecast, and the bet capacity makes against it.
 *
 * Read at the price on the table rather than at the price the forecast was
 * worked out at, so moving the price moves the range — the forecast carries a
 * curve for exactly this. Then the bet is priced both ways in money: what the
 * empty shelves cost if the year comes in low, and what walks to a rival if it
 * comes in high. Until this card existed on the phone, one side of that had no
 * cost attached and the other had no number at all.
 */
export function ForecastCard({ forecast, price, capacity, capacityNext, idleCostPerUnit, yours, voice }: {
  forecast: Forecast;
  /** What the table is charging, as filed or as drafted by whoever holds marketing. */
  price: number;
  /** The room that serves *this* period. A cut is immediate; a build is not. */
  capacity: number;
  /** The room the capacity lever is ordering, which opens next period. */
  capacityNext: number;
  idleCostPerUnit: number;
  yours: "capacity" | "price" | null;
  voice?: Record<string, string> | undefined;
}) {
  const live = forecastAtPrice(forecast, price);
  const risk = capacityRisk({ capacity, forecast: live, price, idleCostPerUnit });
  const read = VERDICT_READ[risk.verdict];
  const head = voice?.customers ?? "customers";
  /*
   * The same question asked of the room being *ordered*, which is the one this
   * screen's lever actually sets. Only when it is more than what exists, because
   * a cut is immediate and already reflected above.
   */
  const ordering = Math.round(capacityNext) > Math.round(capacity);
  const tooMuch = ordering && overOrdering(capacityNext, live);

  return (
    <Card testID="future-forecast" accent={TONE[risk.verdict]}>
      <SimSectionTitle icon="people-outline" title={`How many ${head} are coming`} />

      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, marginTop: spacing.sm }}>
        <Text
          testID="future-forecast-likely"
          style={{ color: colors.text, fontSize: 30, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"] }}
        >
          {exact(live.likely)}
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.regular, paddingBottom: 5 }}>
          at {money(price)} each
        </Text>
      </View>
      {/*
        * The range, said as a range. A single number would be read as a promise
        * and the first year it was wrong it would be read as a bug — most of
        * what decides the answer is what eight rivals file tonight.
        */}
      <Text
        testID="future-forecast-band"
        style={{ color: colors.textSecondary, fontSize: font.xs, fontFamily: fontFamily.regular, fontVariant: ["tabular-nums"] }}
      >
        Somewhere between {exact(live.low)} and {exact(live.high)} — nobody knows what the rest of the market files tonight.
      </Text>

      {/* The verdict, in words and with an icon: colour is never the only thing saying this. */}
      <View
        testID="future-room-verdict"
        style={{
          marginTop: spacing.md, gap: 4, padding: spacing.md, borderRadius: radius.sm,
          backgroundColor: tintSoft(TONE[risk.verdict], 0.08),
          borderWidth: 1, borderColor: tintSoft(TONE[risk.verdict], 0.3),
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Icon name={ICON[risk.verdict]} size={14} color={TONE[risk.verdict]} />
          <Text style={{ flex: 1, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>
            {read.title}
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: font.xs, fontFamily: fontFamily.medium, fontVariant: ["tabular-nums"] }}>
            room for {exact(capacity)}
          </Text>
        </View>
        <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular }}>
          {read.means}
        </Text>
      </View>

      {/* And the cost of being wrong, each way, which is the whole decision. */}
      <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
        <Cost
          testID="future-cost-low"
          label="If it comes in low"
          value={risk.idleAtLow > 0 ? `${exact(risk.idleAtLow)} idle` : "nothing spare"}
          sub={risk.idleCostAtLow > 0 ? `${money(risk.idleCostAtLow)} to keep ready` : "nothing wasted"}
          tone={risk.idleCostAtLow > 0 ? colors.warning : colors.textTertiary}
        />
        <Cost
          testID="future-cost-high"
          label="If it comes in high"
          value={risk.shortAtHigh > 0 ? `${exact(risk.shortAtHigh)} turned away` : "everyone served"}
          sub={risk.revenueLostAtHigh > 0 ? `${money(risk.revenueLostAtHigh)} to a rival` : "nothing walks"}
          tone={risk.revenueLostAtHigh > 0 ? colors.danger : colors.textTertiary}
        />
      </View>

      {/*
        * What the lever is ordering, which is not what the card above is about.
        * Room ordered now opens next period, so none of it can serve the year in
        * front of you — and without this line an order of twenty thousand against
        * sixteen hundred customers moved nothing on the screen and arrived a year
        * later as a company with no cash.
        */}
      {ordering ? (
        <View
          testID="future-ordering"
          style={{
            marginTop: spacing.sm, gap: 4, padding: spacing.md, borderRadius: radius.sm,
            backgroundColor: tintSoft(tooMuch ? colors.danger : colors.info, 0.08),
            borderWidth: 1, borderColor: tintSoft(tooMuch ? colors.danger : colors.info, 0.3),
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Icon name={tooMuch ? "warning" : "hourglass-outline"} size={14} color={tooMuch ? colors.danger : colors.info} />
            <Text style={{ flex: 1, color: colors.text, fontSize: font.xs, fontFamily: fontFamily.semibold }}>
              {tooMuch ? "That is far more room than this market could fill" : "Room being built"}
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: font.xs, fontFamily: fontFamily.medium, fontVariant: ["tabular-nums"] }}>
              {exact(capacityNext)}
            </Text>
          </View>
          <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular }}>
            {tooMuch
              ? `More than three times the most this year could bring. It is paid for when it is ordered, and it opens next year whether anybody comes.`
              : `Opens next year. It cannot serve this one — this year you serve with the room you already have.`}
          </Text>
        </View>
      ) : null}

      {yours ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.sm, flexWrap: "wrap" }}>
          <Pill
            label={yours === "capacity" ? "The room is your lever" : "The price is your lever"}
            color={colors.primary}
            icon={yours === "capacity" ? "cube-outline" : "pricetag-outline"}
          />
          <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular }}>
            {yours === "capacity" ? "the other side of this is marketing's price" : "the other side of this is operations' room"}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

function Cost({ label, value, sub, tone, testID }: {
  label: string; value: string; sub: string; tone: string; testID: string;
}) {
  return (
    <View
      testID={testID}
      style={{ flex: 1, gap: 2, padding: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }}
    >
      <Text style={{ color: colors.textTertiary, fontSize: 10, fontFamily: fontFamily.medium, textTransform: "uppercase", letterSpacing: 0.6 }}>
        {label}
      </Text>
      <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold, fontVariant: ["tabular-nums"] }}>
        {value}
      </Text>
      <Text style={{ color: tone, fontSize: font.xs, fontFamily: fontFamily.regular, fontVariant: ["tabular-nums"] }}>
        {sub}
      </Text>
    </View>
  );
}

/**
 * What is already paid for and has not arrived yet.
 *
 * The lag made visible. A seat that cannot see that this year's engineering
 * lands next year reads a flat quality score as money wasted and stops spending
 * it — which is the single most expensive misreading available on the desk.
 */
export function OnItsWay({ company, outlook, outlookMeans }: {
  company: Parameters<typeof comingUp>[0];
  outlook?: string;
  outlookMeans?: string;
}) {
  const rows = comingUp(company);
  return (
    <Card testID="future-coming">
      <SimSectionTitle icon="telescope-outline" title="What's coming" />
      {outlook ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.sm, flexWrap: "wrap" }}>
          <Pill label={`Next year: ${outlook}`} color={colors.info} icon="partly-sunny-outline" />
          {outlookMeans ? (
            <Text style={{ flex: 1, color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular }}>
              {outlookMeans}
            </Text>
          ) : null}
        </View>
      ) : null}

      {rows.length === 0 ? (
        <Text
          testID="future-nothing-coming"
          style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular, marginTop: spacing.sm }}
        >
          Nothing already paid for is still on its way. What gets decided this year is what lands next.
        </Text>
      ) : (
        <View style={{ marginTop: spacing.md }}>
          <Text style={{ color: colors.textTertiary, fontSize: 10, fontFamily: fontFamily.semibold, textTransform: "uppercase", letterSpacing: 0.6 }}>
            On its way
          </Text>
          {rows.map((row) => (
            <View
              key={row.id}
              testID={`future-coming-${row.id}`}
              style={{
                flexDirection: "row", alignItems: "center", gap: spacing.sm,
                paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border,
              }}
            >
              <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.medium }}>{row.label}</Text>
              <Text
                style={{
                  color: row.warn ? colors.danger : colors.text, fontSize: font.sm,
                  fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"],
                }}
              >
                {row.value}
              </Text>
              <View style={{ flex: 1 }} />
              <Text style={{ color: colors.textSecondary, fontSize: font.xs, fontFamily: fontFamily.regular, textAlign: "right" }}>
                {row.when}
              </Text>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}
