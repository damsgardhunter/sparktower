/**
 * What this year will do to the company — on a phone.
 *
 * The same projection the web desk shows, from the same endpoint: the year run
 * with everything the table has filed plus the draft on this screen, and each
 * headline number carrying what the unfiled change here is doing to it. No
 * engine logic lives on the device; the server runs the year and this draws
 * it, so the phone and the web can never disagree about what a plan earns.
 *
 * Colours are the validated data-viz steps the web uses (see `.viz-root` in
 * the web's `index.css`): cash in and out is a blue/orange pair, not the
 * reserved good/bad colours, and the meters are three steps of one blue ramp.
 */
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { colors, font, fontFamily, isDark, radius, spacing } from "../../theme";
import { Card, Icon } from "../ui";
import { SimSectionTitle } from "./SimKit";

const VIZ = isDark
  ? { in: "#3987e5", out: "#d95926", total: "#898781", now: "#3987e5", coming: "#1c5cab", track: "#0d366b", grid: "#2c2c2a", good: "#0ca30c", bad: "#e66767" }
  : { in: "#2a78d6", out: "#eb6834", total: "#898781", now: "#2a78d6", coming: "#86b6ef", track: "#cde2fb", grid: "#e1e0d9", good: "#006300", bad: "#d03b3b" };
const STATUS = { good: "#0ca30c", warning: "#fab219", serious: "#ec835a", critical: "#d03b3b" };

interface Projection {
  year: number;
  customers: number;
  turnedAway: number;
  capacityNow: number;
  capacityNext: number;
  revenue: number;
  profit: number;
  cashStart: number;
  cashEnd: number;
  lines: { label: string; amount: number }[];
  stats: { brand: { now: number; coming: number }; quality: { now: number; coming: number }; service: { now: number }; reputation: { now: number } };
  credit: { score: number; grade: string; rate: number; emergencyDrawn: number };
  target: { amount: number; projected: number; met: boolean; strikes: number; wouldRemove: boolean } | null;
  bankrupt: boolean;
  nextYearDemand: { likely: number; low: number; high: number } | null;
}

function gbp(n: number): string {
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(n);
  if (a >= 1_000_000_000) return `${sign}£${(a / 1_000_000_000).toFixed(1)}bn`;
  if (a >= 1_000_000) return `${sign}£${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}m`;
  if (a >= 1_000) return `${sign}£${Math.round(a / 1_000)}k`;
  return `${sign}£${Math.round(a)}`;
}
const count = (n: number) => Math.round(n).toLocaleString();

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const Swatch = ({ colour }: { colour: string }) => (
  <View style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: colour }} />
);

const small = { color: colors.textSecondary, fontSize: font.xs, fontFamily: fontFamily.regular } as const;
const label = { color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular } as const;

function Tile({ title, value, delta, sub }: { title: string; value: number; delta: number; sub: string }) {
  const moved = Math.abs(delta) >= 1;
  const up = delta > 0;
  return (
    <View style={{ flex: 1, minWidth: 96, gap: 2, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceRaised }}>
      <Text style={label}>{title}</Text>
      <Text style={{ color: value < 0 ? VIZ.bad : colors.text, fontSize: font.lg, fontFamily: fontFamily.bold }}>{gbp(value)}</Text>
      {moved ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          <Icon name={up ? "arrow-up" : "arrow-down"} size={11} color={up ? VIZ.good : VIZ.bad} />
          <Text style={{ color: up ? VIZ.good : VIZ.bad, fontSize: font.xs, fontFamily: fontFamily.semibold }}>
            {up ? "+" : ""}{gbp(delta)}
          </Text>
          <Text style={label}> yours</Text>
        </View>
      ) : (
        <Text style={label} numberOfLines={1}>{sub}</Text>
      )}
    </View>
  );
}

/** Where the money goes: a waterfall, one row per movement, value on the side that has room. */
function Bridge({ p }: { p: Projection }) {
  const [asTable, setAsTable] = useState(false);
  let running = p.cashStart;
  const bars = [{ label: "Start of year", from: 0, to: p.cashStart, kind: "total" as const, amount: p.cashStart }];
  for (const line of p.lines) {
    const next = running + line.amount;
    bars.push({ label: line.label, from: running, to: next, kind: (line.amount >= 0 ? "in" : "out") as any, amount: line.amount });
    running = next;
  }
  bars.push({ label: "End of year", from: 0, to: p.cashEnd, kind: "total", amount: p.cashEnd });
  const lo = Math.min(0, ...bars.flatMap((b) => [b.from, b.to]));
  const hi = Math.max(1, ...bars.flatMap((b) => [b.from, b.to]));
  const pct = (n: number) => ((n - lo) / (hi - lo || 1)) * 100;
  const text = (b: typeof bars[number]) => (b.kind === "total" ? gbp(b.amount) : `${b.amount >= 0 ? "+" : ""}${gbp(b.amount)}`);

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>Where the money goes</Text>
        <Pressable onPress={() => setAsTable(!asTable)} hitSlop={8} testID="projection-bridge-toggle">
          <Text style={{ color: colors.primary, fontSize: font.xs, fontFamily: fontFamily.medium }}>{asTable ? "Chart" : "Table"}</Text>
        </Pressable>
      </View>
      {bars.map((b) => {
        const left = pct(Math.min(b.from, b.to));
        const width = Math.max(1, pct(Math.max(b.from, b.to)) - left);
        const tone = b.kind === "total" ? VIZ.total : b.kind === "in" ? VIZ.in : VIZ.out;
        if (asTable) {
          return (
            <View key={b.label} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 }}>
              <Text style={small}>{b.label}</Text>
              <Text style={{ color: colors.text, fontSize: font.xs, fontFamily: fontFamily.semibold, fontVariant: ["tabular-nums"] }}>{text(b)}</Text>
            </View>
          );
        }
        // The value goes wherever the bar is not: after its end, or before its start.
        const labelLeft = left + width > 70;
        return (
          <View key={b.label} style={{ gap: 2 }}>
            <Text style={label}>{b.label}</Text>
            <View style={{ height: 16, justifyContent: "center" }}>
              <View style={{ position: "absolute", left: `${left}%`, width: `${width}%`, height: 10, borderRadius: 4, backgroundColor: tone }} />
              <Text
                style={{
                  position: "absolute",
                  ...(labelLeft ? { right: `${100 - left}%`, paddingRight: 5 } : { left: `${left + width}%`, paddingLeft: 5 }),
                  color: colors.text, fontSize: 11, fontFamily: fontFamily.medium, fontVariant: ["tabular-nums"],
                }}
              >
                {text(b)}
              </Text>
            </View>
          </View>
        );
      })}
      {!asTable && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
          {[["Money in", VIZ.in], ["Money out", VIZ.out], ["Balance", VIZ.total]].map(([t, c]) => (
            <View key={t} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}><Swatch colour={c} /><Text style={small}>{t}</Text></View>
          ))}
        </View>
      )}
    </View>
  );
}

function Meter({ name, now, coming }: { name: string; now: number; coming?: number }) {
  const n = Math.max(0, Math.min(100, now));
  const c = Math.max(0, Math.min(100 - n, coming ?? 0));
  return (
    <View style={{ gap: 3 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={small}>{name}</Text>
        <Text style={{ color: colors.text, fontSize: font.xs, fontFamily: fontFamily.semibold }}>
          {Math.round(n)}{c >= 0.5 ? <Text style={label}> +{c.toFixed(1)} next year</Text> : null}
        </Text>
      </View>
      <View style={{ flexDirection: "row", height: 7, borderRadius: 4, overflow: "hidden", backgroundColor: VIZ.track, gap: 2 }}>
        <View style={{ width: `${n}%`, backgroundColor: VIZ.now }} />
        {c >= 0.5 ? <View style={{ width: `${c}%`, backgroundColor: VIZ.coming }} /> : null}
      </View>
    </View>
  );
}

const GRADE: Record<string, { tone: string; word: string }> = {
  AAA: { tone: STATUS.good, word: "Excellent" }, AA: { tone: STATUS.good, word: "Strong" }, A: { tone: STATUS.good, word: "Good" },
  BBB: { tone: STATUS.warning, word: "Adequate" }, BB: { tone: STATUS.warning, word: "Speculative" },
  B: { tone: STATUS.serious, word: "Weak" }, CCC: { tone: STATUS.serious, word: "Poor" }, D: { tone: STATUS.critical, word: "Distressed" },
};

export function ProjectionCard({ ventureId, draft, filedStamp }: {
  ventureId: string;
  draft: Record<string, any> | null;
  /** Changes when a teammate files, so the projection re-runs exactly then. */
  filedStamp: string;
}) {
  const debounced = useDebounced(draft, 450);
  const key = debounced && Object.keys(debounced).length ? JSON.stringify(debounced) : "";

  const { data, isFetching } = useQuery({
    queryKey: ["sim-projection", ventureId, key, filedStamp],
    queryFn: () => api<{ year: number; filed: Projection; drafted: Projection; absent: string[] }>(
      `/api/sim/ventures/${ventureId}/projection${key ? `?draft=${encodeURIComponent(key)}` : ""}`,
    ),
    // Hold the last answer while the next is worked out — no flash.
    placeholderData: keepPreviousData,
  });

  if (!data) return null;
  const p = data.drafted;
  const f = data.filed;
  const nd = p.nextYearDemand;
  const wanted = Math.max(1, p.capacityNow, p.customers + p.turnedAway);
  const nextScale = Math.max(1, p.capacityNext, nd?.high ?? 0);
  const grade = GRADE[p.credit.grade] ?? GRADE.BB;
  const t = p.target;

  return (
    <Card>
      <View style={{ gap: spacing.lg, opacity: isFetching ? 0.7 : 1 }} testID="projection-card">
        <View style={{ gap: 2 }}>
          <SimSectionTitle icon="analytics" title={`Year ${data.year}, as it stands`} color={colors.info} />
          <Text style={label}>
            Everything filed{draft && Object.keys(draft).length ? ", plus your changes" : ""} — if the rest of the market holds still.
          </Text>
        </View>

        {p.bankrupt ? (
          <View style={{ flexDirection: "row", gap: 6, alignItems: "center", padding: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: STATUS.critical }}>
            <Icon name="alert-circle" size={16} color={STATUS.critical} />
            <Text style={{ flex: 1, color: colors.text, fontSize: font.xs, fontFamily: fontFamily.semibold }}>
              This plan runs out of money and credit — bankrupt by the end of the year.
            </Text>
          </View>
        ) : null}

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          <Tile title="Revenue" value={p.revenue} delta={p.revenue - f.revenue} sub={`${count(p.customers)} customers`} />
          <Tile title="Profit" value={p.profit} delta={p.profit - f.profit} sub={p.profit >= 0 ? "in the black" : "a loss"} />
          <Tile title="Cash at end" value={p.cashEnd} delta={p.cashEnd - f.cashEnd} sub={`from ${gbp(p.cashStart)}`} />
        </View>

        <Bridge p={p} />

        <View style={{ gap: spacing.sm }}>
          <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>Customers and room</Text>
          <Text style={label}>This year — with the room you already have</Text>
          <View style={{ flexDirection: "row", height: 12, borderRadius: 4, overflow: "hidden", backgroundColor: VIZ.track, gap: 2 }}>
            <View style={{ width: `${(p.customers / wanted) * 100}%`, backgroundColor: VIZ.in }} />
            {p.turnedAway > 0 ? <View style={{ width: `${(p.turnedAway / wanted) * 100}%`, backgroundColor: VIZ.out }} /> : null}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}><Swatch colour={VIZ.in} /><Text style={small}>{count(p.customers)} served</Text></View>
            {p.turnedAway > 0 ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}><Swatch colour={VIZ.out} /><Text style={small}>{count(p.turnedAway)} turned away</Text></View>
            ) : null}
          </View>
          {nd ? (
            <>
              <Text style={[label, { marginTop: spacing.xs }]}>Next year — what you are building, against likely demand</Text>
              <View style={{ height: 12, borderRadius: 4, backgroundColor: VIZ.track }}>
                <View style={{ position: "absolute", top: 0, bottom: 0, left: `${(nd.low / nextScale) * 100}%`, width: `${((nd.high - nd.low) / nextScale) * 100}%`, borderRadius: 4, backgroundColor: VIZ.coming }} />
                <View style={{ position: "absolute", top: -2, bottom: -2, width: 3, borderRadius: 2, backgroundColor: colors.text, left: `${Math.min(99, (p.capacityNext / nextScale) * 100)}%` }} />
              </View>
              <Text style={small}>
                Demand {count(nd.low)}–{count(nd.high)} · room {count(p.capacityNext)}
                {p.capacityNext < nd.low ? " · short, people will be turned away" : p.capacityNext > nd.high * 1.3 ? " · more room than demand, idle room costs money" : ""}
              </Text>
            </>
          ) : null}
        </View>

        <View style={{ gap: spacing.sm }}>
          <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>Where the company stands</Text>
          <Meter name="Brand" now={p.stats.brand.now} coming={p.stats.brand.coming} />
          <Meter name="Quality" now={p.stats.quality.now} coming={p.stats.quality.coming} />
          <Meter name="Service" now={p.stats.service.now} />
          <Meter name="Reputation" now={p.stats.reputation.now} />
          <View style={{ flexDirection: "row", gap: spacing.md }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}><Swatch colour={VIZ.now} /><Text style={small}>This year</Text></View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}><Swatch colour={VIZ.coming} /><Text style={small}>Arriving next year</Text></View>
          </View>
        </View>

        <View style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            {/* The grade, with its word beside it — never the colour alone. */}
            <View style={{ minWidth: 48, height: 40, borderRadius: radius.md, borderWidth: 2, borderColor: grade.tone, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 }}>
              <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.bold }} testID="projection-grade">{p.credit.grade}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>{grade.word} credit</Text>
              <Text style={label}>Borrowing costs {(p.credit.rate * 100).toFixed(1)}% a year</Text>
            </View>
          </View>
          {p.credit.emergencyDrawn > 0 ? (
            <Text style={small}>
              This plan runs out of cash: an emergency loan of {gbp(p.credit.emergencyDrawn)} would cover it, at a punitive rate and a hit to reputation.
            </Text>
          ) : null}
          {t ? (
            <View style={{ gap: 3 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={small}>Investors' target</Text>
                <Text style={{ color: colors.text, fontSize: font.xs, fontFamily: fontFamily.semibold }}>{gbp(t.projected)} / {gbp(t.amount)}</Text>
              </View>
              <View style={{ height: 7, borderRadius: 4, overflow: "hidden", backgroundColor: VIZ.grid }}>
                <View style={{ width: `${Math.min(100, (t.projected / Math.max(1, t.amount)) * 100)}%`, height: "100%", backgroundColor: t.met ? STATUS.good : STATUS.serious }} />
              </View>
              <Text style={small}>
                {t.met ? "On course to meet it." : t.wouldRemove ? "A second miss — the board would remove the chief executive." : "On course to miss it. Two misses remove the chief executive."}
              </Text>
            </View>
          ) : null}
        </View>

        {data.absent.length > 0 ? (
          <Text style={label}>Not filed yet: {data.absent.join(", ")} — running on last year's plan.</Text>
        ) : null}
      </View>
    </Card>
  );
}
