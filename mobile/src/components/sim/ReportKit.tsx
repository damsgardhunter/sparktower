/**
 * The year-end report, drawn for a phone.
 *
 * Five cards in the order a team argues about a bad year — the result, the
 * accounts, the cash, the customers, everybody else — which is the web's order
 * and deliberately identical, because two people in one conversation should be
 * looking at the same thing in the same sequence.
 *
 * The accounts are the reason the screen exists. A cost with no owner is "we lost
 * two million", which is not an argument a table can have; a cost with a seat
 * beside it is "marketing spent 2.1m to win 900k", which is. Each line gets a bar
 * against the year's largest figure too, because a column of numbers in the
 * millions hides which one was the problem.
 *
 * The arithmetic is in `report.ts`, which is free of React Native so the mirror
 * test can reconcile it against accounts the real engine produced. This file
 * draws.
 */
import { Pressable, Text, View } from "react-native";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Card, Icon } from "../ui";
import { Pill, tintSoft } from "../MoreKit";
import { SimSectionTitle } from "./SimKit";
import { exact, money, percent, signed } from "./desk";
import {
  accountLines, biggestMove, resultRead, rivalRead,
  type CashBridge, type ProfitAndLoss, type ReportPayload, type RivalMove, type SegmentBridge,
} from "./report";

type Report = NonNullable<ReportPayload["report"]>;

/** 1. What happened, in one line, so nobody has to hunt for it. */
export function TheResult({ report, voice }: { report: Report; voice?: Record<string, string> }) {
  const read = resultRead(report);
  const tone = report.bankrupt ? colors.danger
    : report.profit > 0 ? colors.success
    : report.shareChange > 0 ? colors.info
    : colors.warning;
  const head = voice?.customers ?? "customers";

  return (
    <Card testID="report-result" accent={tone}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, flexWrap: "wrap" }}>
        <Text style={{ color: colors.text, fontSize: font.lg, fontFamily: fontFamily.bold }}>{read.word}</Text>
        <Pill label={`Year ${report.year}`} color={colors.textTertiary} />
        <Pill label={`#${report.rank}`} color={colors.info} icon="podium-outline" />
      </View>
      <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 20, fontFamily: fontFamily.regular, marginTop: 4 }}>
        {read.means}
      </Text>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md }}>
        <Figure label="Profit" value={money(report.profit)} tone={report.profit < 0 ? colors.danger : colors.success} />
        <Figure label="Sales" value={money(report.revenue)} />
        <Figure label="Cash" value={money(report.cash)} tone={report.cash < 0 ? colors.danger : undefined} />
        <Figure label={head} value={exact(report.customers)} sub={`${signed(report.shareChange * 100, 1)}% share`} />
        {report.founderValue !== undefined ? (
          <Figure label="Owners hold" value={money(report.founderValue)} sub="what the table is ranked by" />
        ) : null}
        {report.turnedAway > 0 ? (
          <Figure label="Turned away" value={exact(report.turnedAway)} tone={colors.danger} sub="they went to a rival" />
        ) : null}
      </View>
    </Card>
  );
}

function Figure({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <View style={{ minWidth: 92, gap: 1 }}>
      <Text style={{ color: colors.textTertiary, fontSize: 10, fontFamily: fontFamily.medium, textTransform: "uppercase", letterSpacing: 0.6 }}>
        {label}
      </Text>
      <Text style={{ color: tone ?? colors.text, fontSize: font.base, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"] }}>
        {value}
      </Text>
      {sub ? (
        <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular, fontVariant: ["tabular-nums"] }}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

/** 2. The accounts, every cost with the seat that spent it. */
export function TheAccounts({ pnl }: { pnl: ProfitAndLoss }) {
  const lines = accountLines(pnl);
  const scale = Math.max(pnl.revenue, ...lines.map((l) => l.amount), 1);
  const planning = Number(pnl.planning ?? 0);

  return (
    <Card testID="report-accounts">
      <SimSectionTitle icon="receipt-outline" title="The accounts" />
      <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular, marginTop: 2 }}>
        Every cost with the seat that spent it. This is what turns "we lost money" into which of the five of you lost it.
      </Text>

      <View style={{ marginTop: spacing.md }}>
        <MoneyRow label="Sales" amount={pnl.revenue} scale={scale} positive strong />
        {lines.map((line) => (
          <MoneyRow
            key={line.label}
            label={line.label}
            note={line.seat}
            help={line.help}
            amount={-line.amount}
            scale={scale}
          />
        ))}
        {/*
          * Planning is the odd one out: not a cost but the effect of the
          * forecast, which saves money when it was close and costs it when it
          * was wide. Its own sign, so the column above reads as costs and still
          * adds up.
          */}
        {planning !== 0 ? (
          <MoneyRow
            label="Planning"
            note="marketing"
            help={planning > 0
              ? "The forecast was close enough to buy at the right volumes."
              : "The forecast was wide, and the year was bought at the wrong volumes."}
            amount={planning}
            scale={scale}
            positive={planning > 0}
          />
        ) : null}

        <View style={{ borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.xs, paddingTop: spacing.xs }}>
          <MoneyRow label="Profit before tax" amount={pnl.operatingProfit} scale={scale} strong />
        </View>
        <MoneyRow
          label="Tax"
          note="at 20%"
          help={pnl.tax === 0 && pnl.operatingProfit > 0 ? "None this year: earlier losses were set against it." : undefined}
          amount={-pnl.tax}
          scale={scale}
        />
        <View style={{ borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.xs, paddingTop: spacing.xs }}>
          <MoneyRow label="Profit" amount={pnl.profit} scale={scale} strong testID="report-profit" />
        </View>
      </View>

      {pnl.lossesCarried > 0 ? (
        <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular, marginTop: spacing.sm }}>
          {money(pnl.lossesCarried)} of losses carried forward: the next {money(pnl.lossesCarried)} of profit is tax-free.
        </Text>
      ) : null}
    </Card>
  );
}

function MoneyRow({ label, note, help, amount, scale, positive, strong, testID }: {
  label: string; note?: string; help?: string; amount: number; scale: number;
  positive?: boolean; strong?: boolean; testID?: string;
}) {
  const width = Math.max(0, Math.min(100, (Math.abs(amount) / Math.max(1, scale)) * 100));
  const tone = positive ? colors.success : amount < 0 ? colors.textSecondary : colors.text;
  return (
    <View testID={testID} style={{ gap: 3, paddingVertical: 5 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: spacing.xs }}>
        <Text style={{
          flex: 1, color: colors.text,
          fontSize: strong ? font.sm : font.xs,
          fontFamily: strong ? fontFamily.semibold : fontFamily.regular,
        }}>
          {label}
          {note ? <Text style={{ color: colors.textTertiary, fontFamily: fontFamily.regular }}>{"  "}{note}</Text> : null}
        </Text>
        <Text style={{
          color: strong && amount < 0 ? colors.danger : tone,
          fontSize: strong ? font.sm : font.xs,
          fontFamily: strong ? fontFamily.bold : fontFamily.medium,
          fontVariant: ["tabular-nums"],
        }}>
          {money(amount)}
        </Text>
      </View>
      {/* The bar, against the year's largest figure: a column of millions hides which one was the problem. */}
      <View style={{ height: 3, borderRadius: 2, backgroundColor: colors.surfaceRaised, overflow: "hidden" }}>
        <View style={{ width: `${width}%`, height: "100%", backgroundColor: positive ? colors.success : tintSoft(colors.textSecondary, 0.6) }} />
      </View>
      {help ? (
        <Text style={{ color: colors.textTertiary, fontSize: 10, lineHeight: 14, fontFamily: fontFamily.regular }}>{help}</Text>
      ) : null}
    </View>
  );
}

/** 3. The cash: what it opened with, every step, what it closed with. */
export function TheCash({ bridge }: { bridge: CashBridge }) {
  return (
    <Card testID="report-cash">
      <SimSectionTitle icon="cash-outline" title="The cash" />
      <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular, marginTop: 2 }}>
        Including the steps that were not trading — a loan, a raise, a lot bought at auction.
      </Text>

      <View style={{ marginTop: spacing.md }}>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: spacing.xs, paddingVertical: 4 }}>
          <Text style={{ flex: 1, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>Started with</Text>
          <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"] }}>
            {money(bridge.opening)}
          </Text>
        </View>
        {bridge.lines.map((line, i) => (
          <View
            key={`${line.label}-${i}`}
            testID={`report-cash-line-${i}`}
            style={{ flexDirection: "row", alignItems: "baseline", gap: spacing.xs, paddingVertical: 4, borderTopWidth: 1, borderTopColor: colors.border }}
          >
            <Icon
              name={line.amount >= 0 ? "arrow-up" : "arrow-down"}
              size={11}
              color={line.amount >= 0 ? colors.success : colors.danger}
            />
            <Text style={{ flex: 1, color: colors.textSecondary, fontSize: font.xs, fontFamily: fontFamily.regular }}>{line.label}</Text>
            <Text style={{
              color: line.amount >= 0 ? colors.success : colors.textSecondary,
              fontSize: font.xs, fontFamily: fontFamily.medium, fontVariant: ["tabular-nums"],
            }}>
              {money(line.amount)}
            </Text>
          </View>
        ))}
        <View style={{
          flexDirection: "row", alignItems: "baseline", gap: spacing.xs,
          paddingTop: spacing.xs, marginTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border,
        }}>
          <Text style={{ flex: 1, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>Ended with</Text>
          <Text
            testID="report-cash-closing"
            style={{
              color: bridge.closing < 0 ? colors.danger : colors.text,
              fontSize: font.sm, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"],
            }}
          >
            {money(bridge.closing)}
          </Text>
        </View>
      </View>
    </Card>
  );
}

/** 4. The customers, segment by segment: who took them, and why. */
export function TheCustomers({ segments, voice }: { segments: SegmentBridge[]; voice?: Record<string, string> }) {
  if (segments.length === 0) return null;
  const head = voice?.customers ?? "customers";

  return (
    <Card testID="report-customers">
      <SimSectionTitle icon="people-outline" title={`Where the ${head} went`} />

      <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
        {segments.map((segment) => {
          const move = biggestMove(segment);
          const net = segment.end - segment.start;
          return (
            <View
              key={segment.segmentId}
              testID={`report-segment-${segment.segmentId}`}
              style={{ gap: 5, padding: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }}
            >
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: spacing.xs, flexWrap: "wrap" }}>
                <Text style={{ flex: 1, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>{segment.name}</Text>
                <Text style={{ color: colors.textSecondary, fontSize: font.xs, fontFamily: fontFamily.regular, fontVariant: ["tabular-nums"] }}>
                  {exact(segment.start)} → {exact(segment.end)}
                </Text>
                <Text style={{
                  color: net > 0 ? colors.success : net < 0 ? colors.danger : colors.textTertiary,
                  fontSize: font.xs, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"],
                }}>
                  {signed(net)}
                </Text>
              </View>

              {move ? (
                <Text style={{ color: colors.textSecondary, fontSize: font.xs, fontFamily: fontFamily.regular }}>
                  Mostly:{" "}
                  <Text style={{ color: move.good ? colors.success : colors.danger, fontFamily: fontFamily.medium }}>
                    {exact(move.count)} {move.label}
                  </Text>
                </Text>
              ) : null}

              {/* The biggest loss in one sentence, written by the engine. */}
              {segment.why ? (
                <Text style={{ color: colors.text, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular }}>
                  {segment.why}
                </Text>
              ) : null}

              {/*
                * And where the company fell short of what these people expect,
                * which is the actionable half: "they wanted quality 60 and you
                * brought 48" is a decision, where "you lost customers" is not.
                */}
              {segment.shortOf.length > 0 ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
                  {segment.shortOf.map((short) => (
                    <Pill
                      key={short.axis}
                      label={`wanted ${short.axis} ${Math.round(short.expected)}, you had ${Math.round(short.expected - short.by)}`}
                      color={colors.warning}
                    />
                  ))}
                </View>
              ) : null}

              {segment.turnedAway > 0 ? (
                <Text style={{ color: colors.danger, fontSize: font.xs, fontFamily: fontFamily.medium, fontVariant: ["tabular-nums"] }}>
                  {exact(segment.turnedAway)} wanted you and could not be served
                  {segment.sentTo.length > 0 ? ` — ${segment.sentTo.map((f) => `${exact(f.count)} went to ${f.name}`).join(", ")}` : ""}.
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
    </Card>
  );
}

/** 5. Everybody else, which is half of why the year went as it did. */
export function EverybodyElse({ rivals }: { rivals: RivalMove[] }) {
  if (rivals.length === 0) return null;
  const ordered = [...rivals].sort((a, b) => b.shareAfter - a.shareAfter);

  return (
    <Card testID="report-rivals">
      <SimSectionTitle icon="flash-outline" title="Everybody else" />
      <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular, marginTop: 2 }}>
        What each of them visibly did. Their accounts are their own business; this is what the market could see.
      </Text>

      <View style={{ marginTop: spacing.md }}>
        {ordered.map((rival) => {
          const did = rivalRead(rival);
          return (
            <View
              key={rival.id}
              testID={`report-rival-${rival.id}`}
              style={{ gap: 3, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, flexWrap: "wrap" }}>
                <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>{rival.name}</Text>
                {rival.kind === "incumbent" ? <Pill label="Incumbent" color={colors.textTertiary} /> : null}
                <View style={{ flex: 1 }} />
                <Text style={{ color: colors.textSecondary, fontSize: font.xs, fontFamily: fontFamily.medium, fontVariant: ["tabular-nums"] }}>
                  {percent(rival.shareAfter, 1)}
                </Text>
              </View>
              <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular }}>
                {/* "Held everything" is information; an empty row reads as a bug. */}
                {did.length > 0 ? did.join(" · ") : "held everything where it was"}
              </Text>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

/** The year's prose, last: it explains what the figures above already showed. */
export function TheNotes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <Card testID="report-notes">
      <SimSectionTitle icon="document-text-outline" title="What the year said" />
      <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
        {notes.map((note, i) => (
          <Text
            key={i}
            style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 18, fontFamily: fontFamily.regular }}
          >
            {note}
          </Text>
        ))}
      </View>
    </Card>
  );
}

/**
 * Which year you are reading, and the others you could.
 *
 * The web has a route per year; a phone has one screen and a row of years, which
 * is fewer taps and means the whole season is one gesture away rather than a
 * back-and-forward through a stack.
 */
export function YearPicker({ years, showing, onPick }: {
  years: number[];
  showing: number;
  onPick: (year: number) => void;
}) {
  if (years.length <= 1) return null;
  return (
    <Card testID="report-years">
      <Text style={{ color: colors.textTertiary, fontSize: 10, fontFamily: fontFamily.semibold, textTransform: "uppercase", letterSpacing: 0.6 }}>
        The season so far
      </Text>
      {/*
        * `Pressable` rather than the `Pill` the rest of this file uses: a pill is
        * a label and these are controls. A tap target also wants to be bigger
        * than a pill's 3pt of vertical padding, which on a phone is a miss.
        */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm }}>
        {[...years].sort((a, b) => a - b).map((year) => {
          const showingThis = year === showing;
          return (
            <Pressable
              key={year}
              testID={`report-year-${year}`}
              accessibilityRole="button"
              accessibilityState={{ selected: showingThis }}
              accessibilityLabel={`Year ${year}${showingThis ? ", showing" : ""}`}
              onPress={() => onPick(year)}
              style={({ pressed }) => ({
                minWidth: 44, alignItems: "center",
                paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill,
                backgroundColor: showingThis ? colors.primary : tintSoft(colors.textSecondary, 0.1),
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{
                color: showingThis ? "#FFFFFF" : colors.textSecondary,
                fontSize: font.sm, fontFamily: fontFamily.semibold, fontVariant: ["tabular-nums"],
              }}>
                {year}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}
