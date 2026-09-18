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
import { Btn, Icon, NovaGradient } from "../ui";
import { Pill, tintSoft } from "../MoreKit";
import {
  OUTCOME_LABEL, OUTLOOK_LABEL, METRIC_PENDING, bump, capUse, clampToField,
  commitmentLevel, covenantProgress, dissolvableSeats, exact, formatUntil,
  metricRead, money, percent, resolveIsImminent, rewardRead, shortfall, signed,
  targetGoalRead,
  type Challenge, type ChallengeResult, type Commitment, type CompanyReport,
  type Covenant, type DeskDistress, type DeskEconomy, type DeskRival, type DeskRole,
  type DeskTableSeat, type LeverField, type RecoveryKind, type RecoveryOption,
  type TargetProgress, type TargetResult,
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

// --- Your year -----------------------------------------------------------

/**
 * The one thing on this screen that belongs to the person holding the phone.
 *
 * The company's result is four other people as well, and a seat dealt at
 * random can have a quiet fortnight without anybody noticing. This is the
 * answer to "did *I* play this well", so it sits directly under last year's
 * report — above the company, above the levers — and it is drawn as a card
 * about them rather than a section of the company's paperwork.
 *
 * The brief is the server's own sentence and appears whole. It is written
 * against the company's position in the year it was set ("You hold 12,400 of
 * them. The rest are somebody else's"), and paraphrasing it into a target
 * would throw away the only part that makes it feel written for you.
 */
export function ChallengeCard({ challenge, progress, standing, seatTitle }: {
  challenge: Challenge;
  progress: TargetProgress[];
  /** Where it stands, counted — see challengeStanding() in desk.ts. */
  standing: string | null;
  seatTitle: string | null;
}) {
  return (
    <View
      testID="desk-challenge"
      style={{
        borderRadius: radius.md, backgroundColor: colors.surface, padding: spacing.lg, gap: spacing.md,
        borderWidth: 1, borderColor: tintSoft(colors.novaPurple, 0.35),
        borderLeftWidth: 3, borderLeftColor: colors.novaPurple, ...shadow.card,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="trophy" size={16} color={colors.novaPurple} />
        <Text style={{ flex: 1, color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.semibold, letterSpacing: 0.5 }}>
          YOUR YEAR{seatTitle ? ` · ${seatTitle.toUpperCase()}` : ""}
        </Text>
        <Pill label={rewardRead(challenge.reward)} icon="gift" color={colors.novaPurple} />
      </View>

      <View style={{ gap: 5 }}>
        <Text style={{ color: colors.text, fontSize: font.lg, fontFamily: fontFamily.bold, letterSpacing: -0.2 }}>
          {challenge.title}
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 20, fontFamily: fontFamily.regular }}>
          {challenge.brief}
        </Text>
      </View>

      <View style={{ gap: spacing.md, paddingTop: spacing.xs, borderTopWidth: 1, borderColor: colors.borderSubtle }}>
        {progress.map((p) => <TargetRow key={p.target.id} progress={p} />)}
        {standing ? (
          <Text testID="desk-challenge-standing" style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.medium }}>
            {standing}
          </Text>
        ) : null}
      </View>

      {/* What it is worth, and what a near miss is worth. Both, because a
          player deciding whether to chase a target at the cost of the year is
          deciding between exactly these two lines. */}
      <View style={{ gap: 4, paddingTop: spacing.xs, borderTopWidth: 1, borderColor: colors.borderSubtle }}>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <Icon name="gift-outline" size={13} color={colors.novaPurple} />
          <Text style={{ flex: 1, color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular }}>
            {challenge.reward.label}
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <Icon name="remove-circle-outline" size={13} color={colors.textTertiary} />
          <Text style={{ flex: 1, color: colors.textTertiary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular }}>
            One of the two and it's {rewardRead(challenge.partialReward).replace(/^\+/, "")} instead — {challenge.partialReward.label.toLowerCase()}
          </Text>
        </View>
      </View>
    </View>
  );
}

/**
 * One target, with as much of an answer as honestly exists.
 *
 * Three states, and the third one is the point: a target on this year's profit
 * cannot be known until the year runs, and the screen says so rather than
 * quietly showing last year's figure under it. A progress bar that is lying is
 * worse than no progress bar, because it is the same screen that will later
 * tell somebody they missed.
 */
function TargetRow({ progress }: { progress: TargetProgress }) {
  const { target, actual, source, met, fraction } = progress;
  const pending = actual == null;
  const color = pending ? colors.textTertiary : met ? colors.success : colors.warning;

  return (
    <View style={{ gap: 5 }} testID={`desk-target-${target.id}`}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
        <Icon
          name={pending ? "ellipse-outline" : met ? "checkmark-circle" : "alert-circle-outline"}
          size={16}
          color={color}
        />
        <Text style={{ flex: 1, color: colors.text, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.medium, marginTop: -1 }}>
          {target.label}
        </Text>
      </View>

      {pending ? (
        <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular, paddingLeft: 24 }}>
          {METRIC_PENDING[target.metric] ?? "Known when the year resolves"} · needs {targetGoalRead(target)}
        </Text>
      ) : (
        <View style={{ gap: 4, paddingLeft: 24 }}>
          <View style={{ height: 5, borderRadius: 3, backgroundColor: colors.surfaceRaised, overflow: "hidden" }}>
            <View style={{ width: `${Math.round((fraction ?? 0) * 100)}%`, height: "100%", backgroundColor: color }} />
          </View>
          <Text style={{ color: colors.textSecondary, fontSize: font.xs, fontFamily: fontFamily.medium, fontVariant: ["tabular-nums"] }}>
            {source === "committed" ? "Committed so far" : "Now"} {metricRead(target.metric, actual)}
            <Text style={{ color: colors.textTertiary, fontFamily: fontFamily.regular }}>
              {" · needs "}{targetGoalRead(target)}
            </Text>
          </Text>
        </View>
      )}
    </View>
  );
}

/**
 * How last year's went.
 *
 * The engine's `note` is the whole point of this card — it names what fell
 * short rather than announcing a failure ("customers were there, the price was
 * not"), which is the only useful thing a result can say on day four of
 * fourteen. The per-target numbers sit above it so the sentence has something
 * to refer to.
 */
export function LastChallengeCard({ result }: { result: ChallengeResult }) {
  const tone = result.outcome === "met" ? colors.success : result.outcome === "partial" ? colors.warning : colors.textTertiary;
  return (
    <View
      testID="desk-last-challenge"
      style={{
        borderRadius: radius.md, backgroundColor: colors.surface, padding: spacing.md, gap: spacing.sm,
        borderWidth: 1, borderColor: colors.border,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="medal-outline" size={15} color={tone} />
        <Text style={{ flex: 1, color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.semibold, letterSpacing: 0.5 }}>
          YEAR {result.year}, YOUR CHALLENGE
        </Text>
        <Pill label={OUTCOME_LABEL[result.outcome]} color={tone} solid={result.outcome === "met"} />
      </View>

      <View style={{ gap: 4 }}>
        {result.targets.map((t) => <ResultRow key={t.id} target={t} />)}
      </View>

      <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
        {result.note}
      </Text>
    </View>
  );
}

/** What was asked, and what the year actually produced. */
function ResultRow({ target }: { target: TargetResult }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
      <Icon name={target.met ? "checkmark" : "close"} size={14} color={target.met ? colors.success : colors.danger} />
      <Text style={{ flex: 1, color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular }}>
        {target.label}
        <Text style={{ color: target.met ? colors.success : colors.danger, fontFamily: fontFamily.semibold, fontVariant: ["tabular-nums"] }}>
          {"  "}{metricRead(target.metric, target.actual)}
        </Text>
        <Text style={{ color: colors.textTertiary }}>{" of "}{metricRead(target.metric, target.goal)}</Text>
      </Text>
    </View>
  );
}

// --- Trouble -------------------------------------------------------------

/**
 * Where the company stands when standing is the question.
 *
 * Everything here is the server's own copy, unedited. `DISTRESS_COPY` and the
 * options in shared/simulation/recovery.ts are written to be read *before*
 * choosing — each option states its cost in the same breath as what it raises
 * — and a screen that trimmed those sentences to fit would be handing somebody
 * an irreversible decision with the reasons removed.
 *
 * The one piece of editorialising is the order: the covenant goes above the
 * options when there is one, because it is the way out and the options are the
 * ways further in.
 */
export function DistressCard({
  distress, yourRole, seats, spend, chosen, chosenSeat, onChoose, onChooseSeat,
  onFile, onClear, filing, error,
}: {
  distress: DeskDistress;
  yourRole: DeskRole | null;
  seats: DeskRole[] | undefined;
  /** This year's discretionary spend, for the covenant's cap. */
  spend: number | null;
  chosen: RecoveryKind | null;
  chosenSeat: DeskRole | null;
  onChoose: (kind: RecoveryKind) => void;
  onChooseSeat: (seat: DeskRole) => void;
  onFile: () => void;
  onClear: () => void;
  filing: boolean;
  error: string | null;
}) {
  const severe = distress.level === "insolvent" || distress.level === "distressed";
  const tone = distress.level === "insolvent" ? colors.danger
    : distress.level === "distressed" ? colors.danger
      : colors.warning;
  const isCeo = yourRole === "ceo";

  return (
    <View
      testID="desk-distress"
      style={{
        borderRadius: radius.md, backgroundColor: colors.surface, padding: spacing.lg, gap: spacing.md,
        borderWidth: severe ? 2 : 1, borderColor: severe ? tone : colors.border,
        borderLeftWidth: 3, borderLeftColor: tone, ...shadow.card,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name={distress.level === "insolvent" ? "alert-circle" : "warning"} size={18} color={tone} />
        <Text style={{ flex: 1, color: colors.text, fontSize: font.lg, fontFamily: fontFamily.bold }}>
          {distress.title}
        </Text>
      </View>
      <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 20, fontFamily: fontFamily.regular }}>
        {distress.body}
      </Text>

      {distress.covenant ? <CovenantStrip covenant={distress.covenant} spend={spend} /> : null}

      {distress.options.length === 0 ? null : (
        <View style={{ gap: spacing.sm, paddingTop: spacing.xs, borderTopWidth: 1, borderColor: colors.borderSubtle }}>
          <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.semibold, letterSpacing: 0.4 }}>
            WHAT CAN BE DONE
          </Text>
          {/* Said once, at the top, rather than under four disabled buttons:
              four people reading "not yours" four times learn only that the
              screen is scolding them. */}
          {!isCeo ? (
            <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular }}>
              These change what the company is, so they're the chief executive's to file. Worth having the argument before they do.
            </Text>
          ) : null}

          {distress.options.map((option) => (
            <RecoveryOptionCard
              key={option.kind}
              option={option}
              selected={chosen === option.kind}
              filed={distress.filed?.kind === option.kind}
              filedSeat={distress.filed?.kind === option.kind ? distress.filed?.seat ?? null : null}
              selectable={isCeo && !filing}
              onPress={() => onChoose(option.kind)}
            >
              {/* The seat picker lives inside the option it belongs to, and
                  only while that option is the one being considered. */}
              {option.kind === "dissolve_seat" && isCeo && chosen === "dissolve_seat" ? (
                <SeatPicker seats={dissolvableSeats(seats)} chosen={chosenSeat} onChoose={onChooseSeat} />
              ) : null}
            </RecoveryOptionCard>
          ))}

          {error ? (
            <Text testID="desk-recovery-error" style={{ color: colors.danger, fontSize: font.xs, fontFamily: fontFamily.medium }}>
              {error}
            </Text>
          ) : null}

          {isCeo ? (
            <View style={{ gap: spacing.xs }}>
              <Btn
                label={filing ? "Filing…" : distress.filed ? "Change what's committed" : "Commit to this"}
                icon="hand-right-outline"
                variant={severe ? "danger" : "outline"}
                loading={filing}
                disabled={!chosen || filing}
                onPress={onFile}
                testID="desk-recovery-file"
              />
              {distress.filed ? (
                <Btn label="Clear it" icon="close-circle-outline" variant="ghost" small disabled={filing}
                  onPress={onClear} testID="desk-recovery-clear" />
              ) : null}
              <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular, textAlign: "center" }}>
                It takes effect before next year runs, and can be changed until the tick.
              </Text>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

/** One move, with what it raises and — the part that decides it — what it costs. */
function RecoveryOptionCard({ option, selected, filed, filedSeat, selectable, onPress, children }: {
  option: RecoveryOption;
  selected: boolean;
  filed: boolean;
  filedSeat: string | null;
  selectable: boolean;
  onPress: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={selectable ? onPress : undefined}
      disabled={!selectable}
      testID={`desk-recovery-${option.kind}`}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: !selectable }}
      style={({ pressed }) => [{
        borderRadius: radius.sm, padding: spacing.md, gap: 6,
        backgroundColor: selected ? tintSoft(colors.primary, 0.08) : colors.surfaceRaised,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.primary : colors.border,
      }, pressed && { opacity: 0.75 }]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ flex: 1, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>{option.title}</Text>
        {filed ? <Pill label="Committed" icon="checkmark-circle" color={colors.primary} solid /> : null}
        {option.raises > 0 ? (
          <Text style={{ color: colors.success, fontSize: font.sm, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"] }}>
            +{money(option.raises)}
          </Text>
        ) : null}
      </View>

      <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular }}>
        {option.body}
      </Text>

      {/* The cost, in the danger colour and never truncated. This sentence is
          the reason the option list can be a list rather than a warning. */}
      <View style={{ flexDirection: "row", gap: 6 }}>
        <Icon name="alert-circle-outline" size={13} color={colors.danger} />
        <Text style={{ flex: 1, color: colors.danger, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.medium }}>
          {option.cost}
        </Text>
      </View>

      {filed && filedSeat ? (
        <Text style={{ color: colors.primary, fontSize: font.xs, fontFamily: fontFamily.semibold }}>
          Committed: the {filedSeat.toUpperCase()} seat.
        </Text>
      ) : null}

      {children}
    </Pressable>
  );
}

/** Which seat goes. The chair isn't on the list — the server refuses it. */
function SeatPicker({ seats, chosen, onChoose }: {
  seats: DeskRole[];
  chosen: DeskRole | null;
  onChoose: (seat: DeskRole) => void;
}) {
  return (
    <View style={{ gap: 6, paddingTop: spacing.xs, borderTopWidth: 1, borderColor: colors.border }}>
      <Text style={{ color: colors.text, fontSize: font.xs, fontFamily: fontFamily.semibold }}>
        Which seat? Not your own — the chair can't be dissolved.
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
        {seats.length === 0 ? (
          <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular }}>
            There's nothing left to dissolve.
          </Text>
        ) : seats.map((seat) => {
          const active = seat === chosen;
          return (
            <Pressable
              key={seat}
              onPress={() => onChoose(seat)}
              testID={`desk-dissolve-${seat}`}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [{
                paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill,
                borderWidth: 1, borderColor: active ? colors.danger : colors.border,
                backgroundColor: active ? colors.danger : colors.surface,
              }, pressed && { opacity: 0.7 }]}
            >
              <Text style={{ color: active ? "#FFFFFF" : colors.textSecondary, fontSize: font.xs, fontFamily: fontFamily.semibold }}>
                {seat.toUpperCase()}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * The way out, drawn as progress.
 *
 * A covenant is a restriction, and it would be easy to render it as one. It is
 * shown as two years with one of them possibly filled instead, because that is
 * what makes distress an arc: the team can see the end of it from inside it,
 * and "one more year inside the cap and it lifts" is a reason to open the app
 * tomorrow.
 */
export function CovenantStrip({ covenant, spend }: { covenant: Covenant; spend: number | null }) {
  const progress = covenantProgress(covenant);
  const use = capUse(spend ?? 0, covenant);
  const over = spend != null && !!use?.over;

  return (
    <View
      testID="desk-covenant"
      style={{
        borderRadius: radius.sm, padding: spacing.md, gap: spacing.sm,
        backgroundColor: tintSoft(colors.info, 0.08), borderWidth: 1, borderColor: tintSoft(colors.info, 0.3),
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="document-text-outline" size={15} color={colors.info} />
        <Text style={{ flex: 1, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>
          The creditor's terms, since year {covenant.since}
        </Text>
        <Text style={{ color: colors.info, fontSize: font.sm, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"] }}>
          {progress.met}/{progress.of}
        </Text>
      </View>

      {/* Years met, as boxes rather than a bar: two is a countable number and
          "one of two" should be legible without reading a percentage. */}
      <View style={{ flexDirection: "row", gap: 4 }}>
        {Array.from({ length: progress.of }, (_, i) => (
          <View key={i} style={{
            flex: 1, height: 6, borderRadius: 3,
            backgroundColor: i < progress.met ? colors.info : tintSoft(colors.info, 0.25),
          }} />
        ))}
      </View>
      <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular }}>
        {progress.line}
      </Text>

      <View style={{ gap: 3, paddingTop: 3, borderTopWidth: 1, borderColor: tintSoft(colors.info, 0.3) }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Text style={{ flex: 1, color: colors.textSecondary, fontSize: font.xs, fontFamily: fontFamily.medium }}>
            Spending may not go above
          </Text>
          <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"] }}>
            {money(covenant.spendCap)}
          </Text>
        </View>
        {spend != null ? (
          <Text style={{ color: over ? colors.danger : colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: over ? fontFamily.semibold : fontFamily.regular }}>
            {over
              ? `The table is at ${money(spend)} — ${money(-(use?.left ?? 0))} over the cap. File that and the clock resets to ${progress.of} clear years.`
              : `The table is at ${money(spend)}, ${money(use?.left ?? 0)} inside it.`}
          </Text>
        ) : null}
        <Text style={{ color: colors.textTertiary, fontSize: 10, lineHeight: 15, fontFamily: fontFamily.regular }}>
          Counts what marketing, product and operations commit. Borrowing and repayment sit outside it.
        </Text>
      </View>
    </View>
  );
}
