/**
 * What every saved decision is doing to the forecast — on a phone.
 *
 * The same three sections the web draws under its projection
 * (client/src/components/sim/forecast-impact.tsx), from the same endpoint, so
 * the phone and the web cannot tell a table two different stories:
 *
 *   - **What each saved desk is doing.** Each desk that has saved, against the
 *     same year with that desk left on last year's plan. Every seat sees every
 *     desk's row — including a desk Nova planned for somebody.
 *   - **Next year, on this course.** Where research, hiring, training,
 *     efficiency and programmes pay off, instead of reading as money lost.
 *   - **The team.** Loyalty now and after the year, and how hard each seat's
 *     target is set.
 */
import { Text, View } from "react-native";
import { colors, font, fontFamily, isDark, radius, spacing } from "../../theme";
import { Icon } from "../ui";

export interface YearAhead {
  year: number; revenue: number; profit: number; customers: number; cashEnd: number;
  unitCost: number; brand: number; quality: number; service: number; reputation: number;
}
export interface SeatMood { role: string; loyaltyNow: number; loyaltyNext: number; stretch: "easy" | "fair" | "aggressive" }
export interface SeatImpact {
  role: string; revenue: number; profit: number; cashEnd: number; customers: number;
  next: { revenue: number; profit: number; customers: number; unitCost: number; quality: number; brand: number; service: number } | null;
}

const GOOD = isDark ? "#0ca30c" : "#006300";
const BAD = isDark ? "#e66767" : "#d03b3b";

const DESK: Record<string, string> = {
  ceo: "Chief executive", cmo: "Marketing", cfo: "Finance", cto: "Technology", coo: "Operations",
};
const STRETCH: Record<SeatMood["stretch"], string> = { easy: "easy target", fair: "fair target", aggressive: "aggressive target" };

const small = { color: colors.textSecondary, fontSize: font.xs, fontFamily: fontFamily.regular } as const;
const label = { color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular } as const;
const heading = { color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold } as const;
const people = (n: number) => Math.round(n).toLocaleString();
const points = (n: number) => n.toFixed(1);

/** A signed change, with an arrow as well as a colour — never the colour alone. */
function Delta({ value, format, invert = false, testID }: { value: number; format: (n: number) => string; invert?: boolean; testID?: string }) {
  if (Math.abs(value) < 0.5) return <Text style={label} testID={testID}>— none</Text>;
  const good = invert ? value < 0 : value > 0;
  const tone = good ? GOOD : BAD;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }} testID={testID}>
      <Icon name={value > 0 ? "arrow-up" : "arrow-down"} size={11} color={tone} />
      <Text style={{ color: tone, fontSize: font.xs, fontFamily: fontFamily.semibold, fontVariant: ["tabular-nums"] }}>
        {value > 0 ? "+" : ""}{format(value)}
      </Text>
    </View>
  );
}

/** One label and its change, side by side. */
function Row({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 1 }}>
      <Text style={small}>{name}</Text>
      {children}
    </View>
  );
}

export function SeatImpactSection({ impact, yourRole, solo, money }: {
  impact: SeatImpact[]; yourRole: string | null; solo?: boolean; money: (n: number) => string;
}) {
  if (!impact.length) return null;
  return (
    <View style={{ gap: spacing.sm }} testID="projection-seat-impact">
      <View style={{ gap: 2 }}>
        <Text style={heading}>What each saved desk is doing</Text>
        <Text style={label}>Against the same year with that desk left on last year's plan. Updates whenever anyone saves.</Text>
      </View>
      {impact.map((row) => {
        const later: string[] = [];
        if (row.next) {
          if (Math.abs(row.next.unitCost) >= 0.01) later.push(`unit cost ${row.next.unitCost < 0 ? "down" : "up"} ${money(Math.abs(row.next.unitCost))}`);
          if (Math.abs(row.next.quality) >= 0.1) later.push(`quality ${row.next.quality > 0 ? "+" : ""}${points(row.next.quality)}`);
          if (Math.abs(row.next.brand) >= 0.1) later.push(`brand ${row.next.brand > 0 ? "+" : ""}${points(row.next.brand)}`);
          if (Math.abs(row.next.service) >= 0.1) later.push(`service ${row.next.service > 0 ? "+" : ""}${points(row.next.service)}`);
        }
        return (
          <View
            key={row.role}
            style={{ gap: 2, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceRaised }}
            testID={`projection-seat-impact-${row.role}`}
          >
            <Text style={heading}>
              {DESK[row.role] ?? row.role}
              {!solo && row.role === yourRole ? <Text style={label}> · you</Text> : null}
            </Text>
            <Row name="Profit this year"><Delta value={row.profit} format={money} testID={`projection-seat-impact-${row.role}-profit`} /></Row>
            <Row name="Customers"><Delta value={row.customers} format={people} /></Row>
            {row.next ? (
              <>
                <Row name="Revenue next year"><Delta value={row.next.revenue} format={money} /></Row>
                <Row name="Profit next year"><Delta value={row.next.profit} format={money} /></Row>
              </>
            ) : null}
            {later.length ? <Text style={label}>Lands next year: {later.join(", ")}.</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

export function NextYearSection({ p, f, money }: { p: YearAhead | null | undefined; f: YearAhead | null | undefined; money: (n: number) => string }) {
  if (!p) return null;
  const rows: { name: string; value: string; delta: number; format: (n: number) => string; invert?: boolean }[] = [
    { name: "Revenue", value: money(p.revenue), delta: p.revenue - (f?.revenue ?? p.revenue), format: money },
    { name: "Profit", value: money(p.profit), delta: p.profit - (f?.profit ?? p.profit), format: money },
    { name: "Customers", value: people(p.customers), delta: p.customers - (f?.customers ?? p.customers), format: people },
    { name: "Cost of one unit", value: money(p.unitCost), delta: p.unitCost - (f?.unitCost ?? p.unitCost), format: money, invert: true },
    { name: "Quality", value: points(p.quality), delta: p.quality - (f?.quality ?? p.quality), format: points },
    { name: "Service", value: points(p.service), delta: p.service - (f?.service ?? p.service), format: points },
  ];
  return (
    <View style={{ gap: spacing.sm }} testID="projection-next-year">
      <View style={{ gap: 2 }}>
        <Text style={heading}>Year {p.year}, if you hold this course</Text>
        <Text style={label}>Where research, hiring, training, efficiency and programmes pay off. One-off decisions are not repeated.</Text>
      </View>
      {rows.map((r) => (
        <Row key={r.name} name={r.name}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            {Math.abs(r.delta) >= 0.05 ? <Delta value={r.delta} format={r.format} invert={r.invert} /> : null}
            <Text style={{ color: colors.text, fontSize: font.xs, fontFamily: fontFamily.semibold, fontVariant: ["tabular-nums"] }}>{r.value}</Text>
          </View>
        </Row>
      ))}
    </View>
  );
}

export function TeamSection({ team }: { team: SeatMood[] | undefined }) {
  if (!team?.length) return null;
  return (
    <View style={{ gap: spacing.sm }} testID="projection-team">
      <View style={{ gap: 2 }}>
        <Text style={heading}>The team after this year</Text>
        <Text style={label}>Loyalty moves with targets, overrules, pay and whether the year makes money. Below 30 they start looking; at 15 they go.</Text>
      </View>
      {team.map((t) => (
        <Row key={t.role} name={`${DESK[t.role] ?? t.role} · ${STRETCH[t.stretch]}`}>
          <Text style={{ fontSize: font.xs, fontFamily: fontFamily.semibold, fontVariant: ["tabular-nums"], color: t.loyaltyNext < 30 ? BAD : colors.text }}>
            <Text style={label}>{t.loyaltyNow} → </Text>{t.loyaltyNext}
          </Text>
        </Row>
      ))}
    </View>
  );
}
