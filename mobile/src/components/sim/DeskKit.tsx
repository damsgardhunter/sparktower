/**
 * The pieces the decision desk is made of.
 *
 * Sits beside SimKit the way SimKit sits on ui.tsx — the room and the desk are
 * the same product and share the gradient, the section headings and the seat
 * rows; what lives here is only what the desk needs and the room has no use
 * for: the commitment meter, the levers, and last year's report.
 */
import React, { useEffect, useRef } from "react";
import { Animated, Pressable, Text, TextInput, View } from "react-native";
import { colors, font, fontFamily, radius, shadow, spacing } from "../../theme";
import { Icon, NovaGradient } from "../ui";
import { Pill, tintSoft } from "../MoreKit";
import {
  OUTLOOK_LABEL, bump, clampToField, commitmentLevel, exact, formatUntil, money,
  percent, resolveIsImminent, shortfall, signed,
  type Commitment, type CompanyReport, type DeskEconomy, type DeskRival,
  type DeskTableSeat, type LeverField,
} from "./desk";

type IconName = React.ComponentProps<typeof Icon>["name"];

/**
 * The top of the desk: which year it is, and how long is left to change your mind.
 *
 * Nova's gradient, as the room uses it, so arriving here from the lobby feels
 * like the next screen of the same thing rather than a different app.
 */
export function DeskBanner({ company, product, year, totalYears, title, seconds, submitted, finished }: {
  company: string;
  product: string | null;
  year: number;
  totalYears: number;
  title: string | null;
  seconds: number | null;
  submitted: boolean;
  finished: boolean;
}) {
  const urgent = !finished && resolveIsImminent(seconds);
  return (
    <NovaGradient style={{ borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm, ...shadow.card }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: font.xs, fontFamily: fontFamily.semibold, letterSpacing: 0.6 }}>
            {finished ? "SEASON OVER" : `YEAR ${year} OF ${totalYears}`}
          </Text>
          <Text style={{ color: "#FFFFFF", fontSize: font.xl, fontFamily: fontFamily.bold, letterSpacing: -0.3 }}>{company}</Text>
          <Text style={{ color: "rgba(255,255,255,0.92)", fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
            {title ? `You're the ${title}` : "You're at the table"}
            {product ? ` · ${product}` : ""}
          </Text>
        </View>
        {!finished && (
          <View
            testID="desk-countdown"
            accessibilityLabel={seconds == null ? "No deadline" : `${formatUntil(seconds)} until the year resolves`}
            style={{
              alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
              borderRadius: radius.sm, backgroundColor: "rgba(0,0,0,0.18)", minWidth: 86,
            }}
          >
            <Text style={{ color: "#FFFFFF", fontSize: 20, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"], opacity: urgent ? 1 : 0.92 }}>
              {formatUntil(seconds)}
            </Text>
            <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 10, fontFamily: fontFamily.semibold, letterSpacing: 0.4 }}>
              {urgent ? "TO FILE" : "TO THE TICK"}
            </Text>
          </View>
        )}
      </View>
      {!finished && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Icon name={submitted ? "checkmark-circle" : "ellipse-outline"} size={14} color="#FFFFFF" />
          <Text style={{ color: "rgba(255,255,255,0.92)", fontSize: font.xs, fontFamily: fontFamily.medium }}>
            {submitted
              ? "You've filed. You can still change it until the tick."
              : "You haven't filed this year yet."}
          </Text>
        </View>
      )}
    </NovaGradient>
  );
}

// --- The number that matters ---------------------------------------------

/**
 * What the five of them have committed, against what the company has.
 *
 * This is the reason the desk shows the whole table's draft at all. Each
 * person can see their own spend; nobody can see the sum, and the sum is what
 * bankrupts the company. So it is the largest thing on the screen, it moves as
 * you type rather than after you file, and going over is a state — colour,
 * wording and a bar that visibly runs off its own end — rather than a note.
 *
 * The bar is drawn past 100%: a segment beyond the line, in the danger colour,
 * so "we are 8% over" and "we are 80% over" don't look identical.
 */
export function CommitmentMeter({ commitment, live, titleOf }: {
  commitment: Commitment;
  /** True while this is the phone's own arithmetic rather than the server's last word. */
  live: boolean;
  titleOf: (role: string) => string;
}) {
  const level = commitmentLevel(commitment.ratio);
  const color = level === "over" ? colors.danger : level === "tight" ? colors.warning : colors.success;
  const total = commitment.spend + commitment.fixed;
  const over = shortfall(commitment);

  // The filled portion, capped at the bar; the overflow gets its own segment
  // so the size of the mistake is visible rather than just its existence.
  const ratio = Number.isFinite(commitment.ratio) ? commitment.ratio : 2;
  const filled = Math.min(1, ratio);
  const spill = Math.max(0, Math.min(1, ratio - 1));

  const width = useRef(new Animated.Value(filled)).current;
  useEffect(() => {
    // Native driver can't animate width, and a 200ms JS-driven interpolation on
    // one bar is not the thing that will drop a frame here.
    Animated.timing(width, { toValue: filled, duration: 220, useNativeDriver: false }).start();
  }, [filled]);

  return (
    <View
      testID="desk-commitment"
      accessibilityLabel={`The table has committed ${exact(total)} against ${exact(commitment.available)} available`}
      style={{
        borderRadius: radius.md, padding: spacing.lg, gap: spacing.md,
        backgroundColor: colors.surface, borderWidth: level === "over" ? 2 : 1,
        borderColor: level === "over" ? colors.danger : colors.border, ...shadow.card,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="wallet" size={16} color={color} />
        <Text style={{ flex: 1, color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>
          What the table has committed
        </Text>
        {live ? <Pill label="Live" icon="flash" color={colors.primary} /> : null}
      </View>

      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6 }}>
        <Text style={{ color, fontSize: 34, lineHeight: 38, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"] }}>
          {money(total)}
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: font.base, fontFamily: fontFamily.medium, paddingBottom: 5 }}>
          of {money(commitment.available)} available
        </Text>
      </View>

      <View style={{ flexDirection: "row", height: 12, borderRadius: 6, backgroundColor: colors.surfaceRaised, overflow: "hidden" }}>
        <Animated.View style={{
          flexGrow: 0,
          width: width.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
          backgroundColor: color,
        }} />
        {spill > 0 ? (
          <View style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: `${Math.max(6, spill * 100)}%`, backgroundColor: colors.danger, opacity: 0.55 }} />
        ) : null}
      </View>

      <Text style={{ color: level === "clear" ? colors.textSecondary : color, fontSize: font.sm, lineHeight: 19, fontFamily: level === "clear" ? fontFamily.regular : fontFamily.semibold }}>
        {level === "over"
          ? `${money(over)} more than the company has. The year still runs — the shortfall comes out of credit, and past that the company is insolvent.`
          : level === "tight"
            ? `${money(-over)} left over. A bad year after this one has nothing to absorb it.`
            : `${money(-over)} still unspent, at ${percent(Number.isFinite(commitment.ratio) ? commitment.ratio : 1, 0)} of what's available.`}
      </Text>

      {/* Whose money it is. Without this the total is a mystery to argue with
          rather than a position to argue about. */}
      <View style={{ gap: 5, paddingTop: spacing.xs, borderTopWidth: 1, borderColor: colors.borderSubtle }}>
        {commitment.bySeat.map((seat) => (
          <View key={seat.role} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Text style={{ width: 44, color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.bold }}>
              {seat.role.toUpperCase()}
            </Text>
            <Text style={{ flex: 1, color: colors.textSecondary, fontSize: font.xs, fontFamily: fontFamily.regular }} numberOfLines={1}>
              {titleOf(seat.role)}
            </Text>
            <Text style={{
              color: seat.spend > 0 ? colors.text : colors.textTertiary, fontSize: font.sm,
              fontFamily: fontFamily.semibold, fontVariant: ["tabular-nums"],
            }}>
              {seat.spend > 0 ? money(seat.spend) : "—"}
            </Text>
          </View>
        ))}
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingTop: 3 }}>
          <Text style={{ width: 44, color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.bold }}>FIXED</Text>
          <Text style={{ flex: 1, color: colors.textSecondary, fontSize: font.xs, fontFamily: fontFamily.regular }}>
            Salaries and seats, owed whatever anyone decides
          </Text>
          <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold, fontVariant: ["tabular-nums"] }}>
            {money(commitment.fixed)}
          </Text>
        </View>
      </View>

      <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
        Available counts cash plus the unused credit line, less anything finance has held back.
      </Text>
    </View>
  );
}

// --- The levers ----------------------------------------------------------

/**
 * One numeric lever: steppers first, keyboard second.
 *
 * The steppers are the primary control on purpose. Typing 1500000 into a phone
 * keyboard is how a CMO commits ten times what they meant to and only finds
 * out on the tick — the field's own `step` is the increment the engine was
 * designed around, so tapping it can only produce sensible numbers. The text
 * field stays for the person who knows exactly what they want.
 */
export function NumberField({ field, value, error, onChange, disabled }: {
  field: LeverField;
  value: any;
  error?: string;
  onChange: (next: any) => void;
  disabled?: boolean;
}) {
  const shown = value === undefined || value === null ? "" : String(value);
  const numeric = Number(value);
  const prefix = field.kind === "money" ? money(Number.isFinite(numeric) ? numeric : 0) : null;

  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ flex: 1, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>{field.label}</Text>
        {prefix ? (
          <Text style={{ color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.semibold, fontVariant: ["tabular-nums"] }}>
            {prefix}
          </Text>
        ) : null}
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <StepButton
          icon="remove"
          label={`Decrease ${field.label}`}
          disabled={disabled}
          onPress={() => onChange(bump(field, value, -1))}
          testID={`desk-step-down-${field.id}`}
        />
        <TextInput
          testID={`desk-field-${field.id}`}
          value={shown}
          onChangeText={(text) => onChange(text.replace(/[^0-9.\-]/g, ""))}
          onBlur={() => onChange(clampToField(field, Number(shown)))}
          editable={!disabled}
          keyboardType="number-pad"
          placeholder="0"
          placeholderTextColor={colors.textTertiary}
          accessibilityLabel={field.label}
          style={{
            flex: 1, textAlign: "center",
            backgroundColor: colors.surfaceRaised,
            borderWidth: 1, borderColor: error ? colors.danger : colors.border,
            borderRadius: radius.sm, paddingVertical: spacing.md, paddingHorizontal: spacing.sm,
            color: colors.text, fontSize: font.lg, fontFamily: fontFamily.semibold,
            fontVariant: ["tabular-nums"],
          }}
        />
        <StepButton
          icon="add"
          label={`Increase ${field.label}`}
          disabled={disabled}
          onPress={() => onChange(bump(field, value, 1))}
          testID={`desk-step-up-${field.id}`}
        />
      </View>

      <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
        {field.help}
      </Text>
      {error ? (
        <Text testID={`desk-error-${field.id}`} style={{ color: colors.danger, fontSize: font.xs, fontFamily: fontFamily.medium }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function StepButton({ icon, label, onPress, disabled, testID }: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [{
        width: 46, height: 46, borderRadius: radius.sm, alignItems: "center", justifyContent: "center",
        backgroundColor: tintSoft(colors.primary), borderWidth: 1, borderColor: tintSoft(colors.primary, 0.3),
      }, pressed && { opacity: 0.6 }, disabled && { opacity: 0.4 }]}
    >
      <Icon name={icon} size={20} color={colors.primary} />
    </Pressable>
  );
}

/** A lever with a handful of answers rather than a number. */
export function ChoiceField({ field, value, error, onChange, disabled }: {
  field: LeverField;
  value: any;
  error?: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const options = field.options ?? [];
  const chosen = options.find((o) => o.value === value);
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>{field.label}</Text>
      <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>{field.help}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
        {options.map((option) => {
          const active = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              disabled={disabled}
              testID={`desk-choice-${field.id}-${option.value}`}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [{
                paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: active ? colors.primary : colors.border,
                backgroundColor: active ? colors.primary : colors.surface,
              }, pressed && { opacity: 0.7 }, disabled && { opacity: 0.5 }]}
            >
              <Text style={{
                color: active ? colors.primaryText : colors.textSecondary,
                fontSize: font.sm, fontFamily: fontFamily.semibold,
              }}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {/* The chosen option's own sentence, rather than four of them at once —
          the picker is the question, this is the consequence. */}
      {chosen ? (
        <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
          {chosen.help}
        </Text>
      ) : null}
      {error ? (
        <Text testID={`desk-error-${field.id}`} style={{ color: colors.danger, fontSize: font.xs, fontFamily: fontFamily.medium }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

// --- Where the company stands --------------------------------------------

/** One figure, with the word that says whether it's good news. */
export function Stat({ label, value, hint, tone }: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <View style={{
      flexGrow: 1, flexBasis: "30%", gap: 2, padding: spacing.sm,
      borderRadius: radius.sm, backgroundColor: colors.surfaceRaised,
    }}>
      <Text style={{ color: colors.textTertiary, fontSize: 10, fontFamily: fontFamily.semibold, letterSpacing: 0.4 }}>
        {label.toUpperCase()}
      </Text>
      <Text style={{ color: tone ?? colors.text, fontSize: font.lg, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"] }}>
        {value}
      </Text>
      {hint ? (
        <Text style={{ color: colors.textTertiary, fontSize: 10, fontFamily: fontFamily.regular }}>{hint}</Text>
      ) : null}
    </View>
  );
}

/** A 0–100 engine score, drawn so three of them are comparable at a glance. */
export function ScoreBar({ label, value, color, hint }: {
  label: string;
  value: number;
  color: string;
  hint?: string;
}) {
  return (
    <View style={{ gap: 3 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Text style={{ flex: 1, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.medium }}>{label}</Text>
        <Text style={{ color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.semibold, fontVariant: ["tabular-nums"] }}>
          {Math.round(value)}
        </Text>
      </View>
      <View style={{ height: 5, borderRadius: 3, backgroundColor: colors.surfaceRaised, overflow: "hidden" }}>
        <View style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: "100%", backgroundColor: color }} />
      </View>
      {hint ? <Text style={{ color: colors.textTertiary, fontSize: 10, fontFamily: fontFamily.regular }}>{hint}</Text> : null}
    </View>
  );
}

// --- Last year -----------------------------------------------------------

/**
 * What happened, before what to do about it.
 *
 * First on the screen because that is the order a person actually wants it: a
 * player opens this on the train to find out how yesterday went, and only then
 * decides today. The engine's own `notes` are the interesting part — they are
 * the causal sentences ("marketing outran what you could deliver") that turn a
 * profit figure into something you can act on — so they get room rather than a
 * "details" disclosure.
 */
export function ReportCard({ report }: { report: CompanyReport }) {
  const good = report.profit >= 0;
  return (
    <View style={{
      borderRadius: radius.md, backgroundColor: colors.surface, padding: spacing.lg, gap: spacing.md,
      borderWidth: 1, borderColor: colors.border,
      borderLeftWidth: 3, borderLeftColor: report.bankrupt ? colors.danger : good ? colors.success : colors.warning,
      ...shadow.card,
    }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="newspaper" size={16} color={colors.primary} />
        <Text style={{ flex: 1, color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>
          Year {report.year}, in the books
        </Text>
        <Pill label={`#${report.rank} in the market`} color={report.rank <= 2 ? colors.success : colors.info} />
      </View>

      {report.bankrupt ? (
        <Text style={{ color: colors.danger, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.semibold }}>
          The company was insolvent at the end of the year.
        </Text>
      ) : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
        <Stat label="Profit" value={money(report.profit)} tone={good ? colors.success : colors.danger}
          hint={`${money(report.revenue)} in, ${money(report.costs)} out`} />
        <Stat label="Customers" value={money(report.customers)} hint={`${percent(report.marketShare)} of the market`} />
        <Stat label="Share change" value={`${signed(report.shareChange * 100, 1)}pp`}
          tone={report.shareChange >= 0 ? colors.success : colors.danger} />
        <Stat label="Cash" value={money(report.cash)} hint={`${money(report.debt)} owed`}
          tone={report.cash <= 0 ? colors.danger : undefined} />
        <Stat label="Reputation" value={String(Math.round(report.reputation))}
          hint={`${signed(report.reputationChange)} on the year`}
          tone={report.reputationChange < 0 ? colors.warning : undefined} />
        {/* Turned-away customers are the single most expensive thing a team can
            do to itself without noticing, so it gets its own figure rather than
            living inside a note. */}
        <Stat label="Turned away" value={report.turnedAway > 0 ? money(report.turnedAway) : "None"}
          tone={report.turnedAway > 0 ? colors.danger : colors.success}
          hint={report.turnedAway > 0 ? "Wanted you, couldn't be served" : "Everyone who wanted you got served"} />
      </View>

      {report.notes.length > 0 && (
        <View style={{ gap: 6, paddingTop: spacing.xs, borderTopWidth: 1, borderColor: colors.borderSubtle }}>
          <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.semibold, letterSpacing: 0.4 }}>
            WHY
          </Text>
          {report.notes.map((note, i) => (
            <View key={`${i}-${note.slice(0, 12)}`} style={{ flexDirection: "row", gap: 6 }}>
              <Icon name="ellipse" size={6} color={colors.primary} />
              <Text style={{ flex: 1, color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular, marginTop: -5 }}>
                {note}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// --- The rest of the table -----------------------------------------------

/** One seat, and whether it has filed this year. */
export function FiledRow({ seat, spend }: { seat: DeskTableSeat; spend?: number }) {
  return (
    <View
      testID={`desk-filed-${seat.role ?? seat.userId}`}
      style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 7 }}
    >
      <Icon
        name={seat.filed ? "checkmark-circle" : "time-outline"}
        size={18}
        color={seat.filed ? colors.success : colors.textTertiary}
      />
      <View style={{ flex: 1, gap: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>{seat.name}</Text>
          {seat.isYou ? <Pill label="You" color={colors.primary} /> : null}
        </View>
        <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular }}>
          {seat.title ?? seat.role?.toUpperCase() ?? "No seat"} · {seat.filed ? "filed" : "still deciding"}
        </Text>
      </View>
      {seat.filed && spend !== undefined ? (
        <Text style={{ color: spend > 0 ? colors.text : colors.textTertiary, fontSize: font.sm, fontFamily: fontFamily.semibold, fontVariant: ["tabular-nums"] }}>
          {spend > 0 ? money(spend) : "—"}
        </Text>
      ) : null}
    </View>
  );
}

/** A company you're up against, as it stood at the end of last year. */
export function RivalRow({ rival, yourCustomers }: { rival: DeskRival; yourCustomers: number }) {
  const ahead = rival.customers > yourCustomers;
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingVertical: 6 }}>
      <View style={{ width: 54, alignItems: "flex-end" }}>
        <Text style={{ color: ahead ? colors.text : colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"] }}>
          {money(rival.customers)}
        </Text>
        <Text style={{ color: colors.textTertiary, fontSize: 10, fontFamily: fontFamily.regular, fontVariant: ["tabular-nums"] }}>
          at {exact(rival.price)}
        </Text>
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.medium }}>{rival.name}</Text>
          {rival.kind === "player" ? <Pill label="Another table" color={colors.novaPurple} /> : null}
        </View>
        {rival.posturedAs ? (
          <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
            {rival.posturedAs}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** The weather, which the CFO is the only one who can act on directly. */
export function EconomyStrip({ economy }: { economy: DeskEconomy }) {
  const tone = economy.outlook === "expansion" ? colors.success : economy.outlook === "tightening" ? colors.warning : colors.info;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" }}>
        <Pill label={OUTLOOK_LABEL[economy.outlook] ?? economy.outlook} icon="partly-sunny-outline" color={tone} />
        <Pill label={`Demand ${economy.demand.toFixed(2)}×`} icon="trending-up-outline" color={colors.info} />
        <Pill label={`Borrowing at ${percent(economy.interestRate, 1)}`} icon="cash-outline" color={colors.warning} />
        <Pill label={`Costs ${economy.costIndex.toFixed(2)}×`} icon="pricetag-outline" color={colors.textSecondary} />
      </View>
      <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular }}>
        {economy.outlookMeans}
      </Text>
    </View>
  );
}
