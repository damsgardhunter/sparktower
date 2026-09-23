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
  OUTCOME_LABEL, OUTLOOK_LABEL, METRIC_PENDING, RAISE_VALUATION_FLOOR, bump, capUse,
  citiesOpening, clampToField,
  commitmentLevel, covenantProgress, debtCostRead, debtSeverity, debtWorthSaying,
  dilutionPreview, dissolvableSeats, exact, formatUntil,
  metricRead, money, openingCost, percent, qualityRead, reachOf, reachRead, researchLanding,
  resolveIsImminent, rewardRead, selectedCities, shareOwnedRead, shortfall, signed,
  targetGoalRead, toggleCity,
  type BufferCut, type Challenge, type ChallengeResult, type Commitment, type CompanyReport,
  type Covenant, type DeskCity, type DeskDistress, type DeskEconomy, type DeskRival, type DeskRole,
  type DeskTableSeat, type LeverField, type RecoveryKind, type RecoveryOption, type ReportEvent,
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
        {/* Inside the marketing line above, and named: it is the one item in
            the total that buys no customers this year, only permission to have
            some next year. A CMO looking at a marketing line twice the size
            they expected should not have to work out which half is which. */}
        {commitment.openingCost > 0 ? (
          <View testID="desk-commitment-opening" style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Text style={{ width: 44, color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.bold }} />
            <Text style={{ flex: 1, color: colors.textSecondary, fontSize: font.xs, fontFamily: fontFamily.regular }}>
              of which opening new places, charged once
            </Text>
            <Text style={{ color: colors.warning, fontSize: font.sm, fontFamily: fontFamily.semibold, fontVariant: ["tabular-nums"] }}>
              {money(commitment.openingCost)}
            </Text>
          </View>
        ) : null}
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
export function NumberField({ field, value, error, onChange, disabled, allowEmpty }: {
  field: LeverField;
  value: any;
  error?: string;
  onChange: (next: any) => void;
  disabled?: boolean;
  /**
   * Leave an emptied box empty rather than settling it on nought. For a price
   * tier, empty means "the list price" and nought means "free" — tapping in
   * and out of a box must not quietly give a segment away.
   */
  allowEmpty?: boolean;
}) {
  const shown = value === undefined || value === null ? "" : String(value);
  const numeric = Number(value);
  const prefix = field.kind === "money" ? money(Number.isFinite(numeric) ? numeric : 0)
    : field.kind === "percent" ? `${Number.isFinite(numeric) ? numeric : 0}%`
      : null;

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
          onBlur={() => onChange(allowEmpty && shown.trim() === "" ? "" : clampToField(field, Number(shown)))}
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

/**
 * A number for each of several things: a price per segment, or a share of the
 * budget per seat. Each row is a NumberField of its own, so it steps and
 * clamps exactly as every other lever does.
 *
 * For tiers an empty row is a real answer — that segment pays the list price —
 * so a row can be cleared back to it. For the budget split the rows are
 * summed, because the one rule is that they cannot come to more than 100%.
 */
export function MapField({ field, value, error, onChange, disabled, listPrice }: {
  field: LeverField;
  value: any;
  error?: string;
  onChange: (next: Record<string, any>) => void;
  disabled?: boolean;
  /** For tiers: what a segment with no tier pays. */
  listPrice?: number;
}) {
  const map: Record<string, any> = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const tiers = field.kind === "tiers";
  const total = Object.values(map).reduce((sum: number, v) => sum + (Number.isFinite(Number(v)) ? Number(v) : 0), 0);
  const set = (key: string, next: any) => {
    const copy = { ...map };
    if (next === "" || next === null || next === undefined) delete copy[key];
    else copy[key] = next;
    onChange(copy);
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ flex: 1, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>{field.label}</Text>
        {!tiers ? (
          <Text
            testID={`desk-map-total-${field.id}`}
            style={{ color: total > 100 ? colors.danger : colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.semibold, fontVariant: ["tabular-nums"] }}
          >
            {`${Math.round(total)}% of 100%`}
          </Text>
        ) : null}
      </View>
      <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
        {field.help}
      </Text>

      {(field.options ?? []).map((option) => {
        const has = map[option.value] !== undefined && map[option.value] !== "";
        return (
          <View key={option.value} style={{ gap: 4, paddingLeft: spacing.sm, borderLeftWidth: 2, borderLeftColor: colors.border }}>
            <NumberField
              field={{
                id: `${field.id}-${option.value}`,
                label: option.label,
                help: tiers
                  ? `${option.help}${has ? "" : ` No tier: pays the list price${listPrice ? ` of ${exact(listPrice)}` : ""}.`}${has && Number(map[option.value]) === 0 ? " Free: advertising money, word of mouth, and every paying tier leaks towards it." : ""}`
                  : option.help,
                kind: tiers ? "price" : "percent",
                min: 0,
                max: field.max,
                step: field.step,
              }}
              value={map[option.value]}
              disabled={disabled}
              allowEmpty={tiers}
              onChange={(next) => set(option.value, next)}
            />
            {tiers && has ? (
              <Pressable
                onPress={() => set(option.value, "")}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={`Use the list price for ${option.label}`}
                testID={`desk-map-clear-${field.id}-${option.value}`}
                hitSlop={6}
              >
                <Text style={{ color: colors.primary, fontSize: font.xs, fontFamily: fontFamily.semibold }}>Use the list price instead</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}

      {error ? (
        <Text testID={`desk-error-${field.id}`} style={{ color: colors.danger, fontSize: font.xs, fontFamily: fontFamily.medium }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * One answer per seat — easy, fair or aggressive — for the chief executive's
 * targets. Each row carries the seat's loyalty, because that is what an
 * aggressive target is spending.
 */
export function LevelsField({ field, value, error, onChange, disabled }: {
  field: LeverField;
  value: any;
  error?: string;
  onChange: (next: Record<string, string>) => void;
  disabled?: boolean;
}) {
  const map: Record<string, string> = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>{field.label}</Text>
      <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>{field.help}</Text>
      {(field.options ?? []).map((o) => (
        <View key={o.value} style={{ gap: 6, paddingLeft: spacing.sm, borderLeftWidth: 2, borderLeftColor: colors.border }}>
          <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.medium }}>{o.label}</Text>
          <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular }}>{o.help}</Text>
          <View style={{ flexDirection: "row", gap: 6 }} accessibilityRole="radiogroup">
            {(field.choices ?? []).map((c) => {
              const chosen = (map[o.value] ?? field.defaultChoice) === c.value;
              return (
                <Pressable
                  key={c.value}
                  onPress={() => onChange({ ...map, [o.value]: c.value })}
                  disabled={disabled}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: chosen }}
                  accessibilityLabel={`${o.label}: ${c.label}. ${c.help}`}
                  testID={`desk-level-${field.id}-${o.value}-${c.value}`}
                  style={({ pressed }) => [{
                    flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.sm, borderWidth: 1,
                    borderColor: chosen ? colors.primary : colors.border,
                    backgroundColor: chosen ? tintSoft(colors.primary) : "transparent",
                  }, pressed && { opacity: 0.6 }, disabled && { opacity: 0.4 }]}
                >
                  <Text style={{ color: chosen ? colors.primary : colors.textSecondary, fontSize: font.sm, fontFamily: chosen ? fontFamily.semibold : fontFamily.regular }}>{c.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
      {error ? (
        <Text testID={`desk-error-${field.id}`} style={{ color: colors.danger, fontSize: font.xs, fontFamily: fontFamily.medium }}>{error}</Text>
      ) : null}
    </View>
  );
}

/**
 * What arrived on this seat this year, and what arrives next.
 *
 * Responsibilities come a year at a time (UNLOCKS in
 * shared/simulation/responsibilities.ts). A new control that simply appears is
 * easy to scroll past; one announced a year ahead is one the table has already
 * started arguing about.
 */
export function NewLeversNote({ fresh, coming }: { fresh: string[]; coming: string[] }) {
  if (fresh.length === 0 && coming.length === 0) return null;
  const list = (xs: string[]) => (xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  return (
    <View
      testID="desk-new-levers"
      style={{ gap: 4, padding: spacing.md, borderRadius: radius.sm, backgroundColor: tintSoft(colors.primary), borderWidth: 1, borderColor: tintSoft(colors.primary, 0.3) }}
    >
      {fresh.length > 0 ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Icon name="sparkles" size={14} color={colors.primary} />
          <Text style={{ flex: 1, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>
            {`New this year: ${list(fresh)}`}
          </Text>
        </View>
      ) : null}
      {coming.length > 0 ? (
        <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
          {`Next year this seat also gets ${list(coming)}.`}
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
export function ChoiceField({ field, value, error, onChange, disabled, emptyNote }: {
  field: LeverField;
  value: any;
  error?: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  /** What to say when the server sent no options — see the empty branch below. */
  emptyNote?: string;
}) {
  const options = field.options ?? [];
  const chosen = options.find((o) => o.value === value);

  /*
   * A choice the season has nothing to offer for.
   *
   * The rehire lever is empty for every table that has not dissolved a seat,
   * which is most of them. An empty row of pills reads as a control that is
   * broken or still loading; a sentence saying there is nothing to choose is
   * the true state, and it also explains what would put something there. The
   * server skips validating an optionless choice for the same reason.
   */
  if (options.length === 0) {
    return (
      <View style={{ gap: 6 }} testID={`desk-choice-empty-${field.id}`}>
        <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>{field.label}</Text>
        <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>{field.help}</Text>
        <View style={{
          flexDirection: "row", gap: 6, padding: spacing.sm, borderRadius: radius.sm,
          backgroundColor: colors.surfaceRaised,
        }}>
          <Icon name="remove-circle-outline" size={14} color={colors.textTertiary} />
          <Text style={{ flex: 1, color: colors.textTertiary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular }}>
            {emptyNote ?? "Nothing to choose here this year."}
          </Text>
        </View>
      </View>
    );
  }

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

/**
 * Where the company sells, which decides whether anything else matters.
 *
 * Every other lever on this desk is a multiplier. This one is the gate: a
 * person who lives somewhere the company has not opened cannot choose it at
 * any price, with any product, however loudly it is advertised — so a team
 * with the best product in the market and one city out of six is invisible to
 * five sixths of it. That is the sentence the control has to carry, and it is
 * why the reach figure is at the top rather than under the list.
 *
 * Three things the picker says out loud, because each of them is a decision
 * somebody would otherwise make by accident:
 *
 * **Open cities are locked.** There is no closing lever. Opening somewhere is
 * a one-way door, and a checkbox that appears to offer the way back would be
 * the control lying about the game.
 *
 * **Entry costs are shown per city and totalled.** They are charged once, in
 * the year it happens, and they land on the marketing seat's line in the
 * table's commitment total — so the other four can see a city being opened
 * while it is happening rather than at the tick.
 *
 * **The ongoing half is said separately from the one-off half.** The fee is
 * paid once; the fixed-cost base goes up for ever (the footprint term in
 * shared/simulation/decisions.ts). Teams that only hear the first number
 * expand once and wonder why every following year is tighter.
 */
export function CitiesField({ field, cities, value, error, onChange, disabled }: {
  field: LeverField;
  cities: DeskCity[] | undefined;
  value: any;
  error?: string;
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const all = cities ?? [];
  const chosen = selectedCities(all, value);
  const chosenSet = new Set(chosen);
  const opening = citiesOpening(all, value);
  const cost = openingCost(all, value);
  const now = reachOf(all);
  const after = reachOf(all, chosen);

  if (all.length === 0) {
    return (
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>{field.label}</Text>
        <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular }}>
          This market hasn't sent its map. Nothing to choose until it does.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.sm }} testID="desk-cities">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ flex: 1, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>{field.label}</Text>
        <Pill label={`${percent(after, 0)} reach`} icon="map-outline" color={after >= 0.999 ? colors.success : colors.info} />
      </View>

      <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular }}>
        {field.help}
      </Text>

      {/* The ceiling, in the plainest words available: this is how much of the
          market is even allowed to pick you. */}
      <Text
        testID="desk-cities-reach"
        style={{ color: after >= 0.999 ? colors.textSecondary : colors.text, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.medium }}
      >
        {reachRead(after)}
      </Text>

      <View style={{ gap: spacing.xs }}>
        {all.map((city) => (
          <CityRow
            key={city.id}
            city={city}
            selected={chosenSet.has(city.id)}
            disabled={!!disabled}
            onPress={() => onChange(toggleCity(all, value, city.id))}
          />
        ))}
      </View>

      {opening.length > 0 ? (
        <View
          testID="desk-cities-cost"
          style={{
            gap: 4, padding: spacing.md, borderRadius: radius.sm,
            backgroundColor: tintSoft(colors.warning, 0.08),
            borderWidth: 1, borderColor: tintSoft(colors.warning, 0.3),
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Text style={{ flex: 1, color: colors.text, fontSize: font.xs, fontFamily: fontFamily.semibold }}>
              Opening {opening.map((c) => c.name).join(", ")}
            </Text>
            <Text style={{ color: colors.warning, fontSize: font.base, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"] }}>
              {money(cost)}
            </Text>
          </View>
          <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular }}>
            {exact(cost)} out of cash once, in the year it happens, and it's on your line in the table's commitment above.
            Reach goes from {percent(now, 0)} to {percent(after, 0)}, and the fixed bill that comes with it is owed every year after.
          </Text>
        </View>
      ) : (
        <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
          Nothing new selected. Staying where you are costs nothing and keeps the ceiling where it is.
        </Text>
      )}

      {error ? (
        <Text testID={`desk-error-${field.id}`} style={{ color: colors.danger, fontSize: font.xs, fontFamily: fontFamily.medium }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** One place, with what it is worth, what it costs, and whether it is already yours. */
function CityRow({ city, selected, disabled, onPress }: {
  city: DeskCity;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const locked = city.open;
  const tone = locked ? colors.success : selected ? colors.primary : colors.border;

  return (
    <Pressable
      onPress={locked || disabled ? undefined : onPress}
      disabled={locked || disabled}
      testID={`desk-city-${city.id}`}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled: locked || disabled }}
      accessibilityLabel={
        locked
          ? `${city.name}, already open, ${percent(city.weight, 0)} of the market`
          : `${city.name}, ${percent(city.weight, 0)} of the market, ${exact(city.entryCost)} to open`
      }
      style={({ pressed }) => [{
        flexDirection: "row", alignItems: "flex-start", gap: spacing.sm,
        padding: spacing.md, borderRadius: radius.sm,
        backgroundColor: locked
          ? tintSoft(colors.success, 0.06)
          : selected ? tintSoft(colors.primary, 0.08) : colors.surfaceRaised,
        borderWidth: selected && !locked ? 2 : 1,
        borderColor: tone,
      }, pressed && { opacity: 0.75 }, disabled && !locked && { opacity: 0.6 }]}
    >
      <Icon
        name={locked ? "lock-closed" : selected ? "checkmark-circle" : "ellipse-outline"}
        size={17}
        color={locked ? colors.success : selected ? colors.primary : colors.textTertiary}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>{city.name}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: font.xs, fontFamily: fontFamily.medium, fontVariant: ["tabular-nums"] }}>
            {percent(city.weight, 0)} of the market
          </Text>
          {locked ? <Pill label="Already open" color={colors.success} /> : null}
        </View>
        <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
          {city.note}
        </Text>
      </View>
      {/* An open city's entry fee is history, and printing it beside a row
          nobody can act on invites somebody to read it as a bill. */}
      {locked ? null : (
        <Text style={{
          color: selected ? colors.primary : colors.textSecondary, fontSize: font.sm,
          fontFamily: fontFamily.semibold, fontVariant: ["tabular-nums"],
        }}>
          {money(city.entryCost)}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * What a raise costs, in the only unit that measures it.
 *
 * The lever's own help says dilution is the price; this says the price. An
 * investor buys a share of everything the company becomes, priced against what
 * it is worth today — so the identical two million is a tenth of the company
 * in year eleven and half of it in year two, and no amount of prose conveys
 * that as well as watching the percentage move while you hold the stepper.
 *
 * Priced against the desk's own `valuation`, which is the engine's arithmetic
 * rather than the client's guess, and which is there in year one — when a
 * company is worth least, the same money costs most, and this is the only
 * screen that will ever say so before the tick.
 */
export function DilutionNote({ founderShare, worth, raise }: {
  founderShare: number | undefined;
  worth: number | null | undefined;
  raise: any;
}) {
  const preview = dilutionPreview({ founderShare: founderShare ?? 1, worth, raise });
  if (!preview) return null;

  return (
    <View
      testID="desk-dilution"
      style={{
        gap: 3, padding: spacing.md, borderRadius: radius.sm,
        backgroundColor: tintSoft(colors.novaPurple, 0.08),
        borderWidth: 1, borderColor: tintSoft(colors.novaPurple, 0.3),
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Icon name="pie-chart-outline" size={14} color={colors.novaPurple} />
        <Text style={{ flex: 1, color: colors.text, fontSize: font.xs, fontFamily: fontFamily.semibold }}>
          The founders would go to
        </Text>
        <Text style={{ color: colors.novaPurple, fontSize: font.base, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"] }}>
          {shareOwnedRead(preview.nextShare)}
        </Text>
      </View>
      <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular }}>
        From {shareOwnedRead(founderShare ?? 1)} — {shareOwnedRead(preview.given)} of everything this company ever becomes,
        gone for good. It never has to be repaid, which is the point, and it is priced against what the company is worth
        today: {money(Math.max(RAISE_VALUATION_FLOOR, worth ?? 0))}. Raise the same money a year from now, worth more, and it
        costs a fraction of this.
      </Text>
    </View>
  );
}

/**
 * The one lever that buys nothing this year, with what it does buy named.
 *
 * Research is the only decision in the game that asks a team to be behind on
 * purpose, and the failure it invites is specific: somebody spends a million,
 * reads next morning's report, sees quality barely moved, and concludes the
 * lever is broken. "Nothing this year" is only half the answer — the other
 * half is how much, and when — so this shows the points the spend will land
 * next year, computed from the same `lift` the engine uses and scaled by this
 * market's pace. A CTO can then weigh a real number against a real wait.
 *
 * Two figures, kept apart on purpose: what is already in the pipeline arrives
 * whatever happens today, and what is being committed arrives a year later
 * still. Merging them into one total would tell somebody they were about to
 * get both next year.
 */
export function PipelineNote({ pipeline, spend, innovationPace }: {
  pipeline: number | undefined;
  spend: any;
  innovationPace: number | undefined;
}) {
  const waiting = Number.isFinite(Number(pipeline)) ? Number(pipeline) : 0;
  const committing = Number(spend) > 0;
  const landing = researchLanding(spend, innovationPace);
  if (waiting <= 0 && !committing) return null;

  return (
    <View
      testID="desk-pipeline-note"
      style={{
        gap: 4, padding: spacing.md, borderRadius: radius.sm,
        backgroundColor: tintSoft(colors.info, 0.08),
        borderWidth: 1, borderColor: tintSoft(colors.info, 0.3),
      }}
    >
      {committing ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Icon name="hourglass-outline" size={14} color={colors.info} />
          <Text style={{ flex: 1, color: colors.text, fontSize: font.xs, fontFamily: fontFamily.semibold }}>
            This buys, landing in two years
          </Text>
          <Text
            testID="desk-research-landing"
            style={{ color: colors.info, fontSize: font.base, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"] }}
          >
            +{qualityRead(landing)} quality
          </Text>
        </View>
      ) : null}

      <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular }}>
        {committing
          ? "None of it arrives for two years. Shipping features lands next year; research the year after — and buys around half again as much quality per pound for the wait."
          : "No research is in flight."}
      </Text>

      {waiting > 0 ? (
        <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
          +{qualityRead(waiting)} quality is already built and reaches customers next year, whatever you decide today.
        </Text>
      ) : null}
    </View>
  );
}

/**
 * What the product owes itself, next to the lever that clears it.
 *
 * The paydown lever is the one decision on the desk that is guaranteed to
 * disappoint the person who makes it: it costs real money and buys nothing
 * visible in the year it is spent. Left unexplained it reads as strictly
 * worse than ignoring it — which is exactly what it used to be, and is no
 * longer. So the note says what carrying the debt is costing *now*, in the
 * engine's own two percentages, and says the silence out loud rather than
 * letting a CTO discover it in tomorrow's report and conclude the lever is
 * broken.
 *
 * Shown from 40 up, which is where the web desk starts saying it; past 55 it
 * reads as a warning, which is the engine's own threshold for writing the
 * company a note about it.
 */
export function TechDebtNote({ techDebt, cost }: {
  techDebt: number | undefined;
  cost: { product: number; unitCost: number } | undefined;
}) {
  if (!debtWorthSaying(techDebt)) return null;
  const severe = debtSeverity(techDebt) === "severe";
  const color = severe ? colors.danger : colors.warning;

  return (
    <View
      testID="desk-tech-debt-note"
      style={{
        gap: 4, padding: spacing.md, borderRadius: radius.sm,
        backgroundColor: tintSoft(color, 0.08),
        borderWidth: 1, borderColor: tintSoft(color, 0.3),
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Icon name={severe ? "warning" : "construct-outline"} size={14} color={color} />
        <Text style={{ flex: 1, color: colors.text, fontSize: font.xs, fontFamily: fontFamily.semibold }}>
          {severe ? "The product has got hard to work in" : "The product owes itself"}
        </Text>
        <Text style={{ color, fontSize: font.base, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"] }}>
          {Math.round(Number(techDebt) || 0)}
        </Text>
      </View>
      <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular }}>
        {debtCostRead(cost)} Shipping features adds to it; reliability work doesn't.
      </Text>
      <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
        Paying it down shows up in no number this year and in every number after it. Roughly a point for every 70,000.
      </Text>
    </View>
  );
}

/**
 * The finance seat's ring-fence, next to the lever that sets it.
 *
 * This lever used to be advice: the preview subtracted it and the tick spent
 * the money anyway. It now binds, and the difference between "a number I moved
 * on my own screen" and "the only authority this seat has over the other four"
 * is worth a sentence at the point the number is set — including the part that
 * makes it usable, which is that nobody else finds out unless they are told.
 */
export function BufferHoldNote({ buffer }: { buffer: any }) {
  const held = Number(buffer) > 0 ? Number(buffer) : 0;
  return (
    <View
      testID="desk-buffer-note"
      style={{
        gap: 4, padding: spacing.md, borderRadius: radius.sm,
        backgroundColor: tintSoft(colors.novaEmerald, 0.08),
        borderWidth: 1, borderColor: tintSoft(colors.novaEmerald, 0.3),
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Icon name="lock-closed-outline" size={14} color={colors.novaEmerald} />
        <Text style={{ flex: 1, color: colors.text, fontSize: font.xs, fontFamily: fontFamily.semibold }}>
          {held > 0 ? "This holds" : "Nothing is held back"}
        </Text>
        {held > 0 ? (
          <Text style={{ color: colors.novaEmerald, fontSize: font.base, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"] }}>
            {money(held)}
          </Text>
        ) : null}
      </View>
      <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular }}>
        {held > 0
          ? "It isn't a suggestion: if marketing, product and operations together ask for more than the cash left above this, every seat's spending is cut back by the same fraction when the year runs. Salaries are outside it — they're owed whatever anyone decided."
          : "Set this and the others cannot spend past it: anything above the cash it leaves is cut back, everyone's by the same fraction. It's the only authority this seat has over the other four."}
      </Text>
      <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
        Worth telling them before the tick rather than after it.
      </Text>
    </View>
  );
}

/**
 * The warning for the other four: your year is about to get smaller.
 *
 * The commitment meter is not enough on its own, and the reason is worth
 * keeping: the meter counts the unused credit line as money the company has,
 * because for every other purpose it is. The cut does not — the engine
 * measures against cash plus what finance actually drew down — so a table can
 * read comfortably clear on the meter and still lose a fifth of the year.
 * That is precisely the gap this card exists to close.
 *
 * It names the seat's own number, not just the table's, because "spending is
 * cut by 23%" is a mechanic and "your 1.2m becomes 920,000" is a decision.
 */
export function BufferCutWarning({ cut, yours, isFinance }: {
  cut: BufferCut;
  /** What this seat's own draft has in the sum that gets cut. */
  yours: number;
  /** The seat that set the buffer gets told it is working, not warned. */
  isFinance: boolean;
}) {
  const lost = Math.round((1 - cut.allowed) * 100);
  const color = isFinance ? colors.novaEmerald : colors.warning;

  return (
    <View
      testID="desk-buffer-cut"
      accessibilityLabel={`Finance is holding ${exact(cut.buffer)} back, cutting every seat's spending by ${lost}%`}
      style={{
        gap: 5, padding: spacing.lg, borderRadius: radius.md,
        backgroundColor: tintSoft(color, 0.08),
        borderWidth: 1, borderColor: tintSoft(color, 0.35),
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Icon name={isFinance ? "lock-closed" : "cut"} size={16} color={color} />
        <Text style={{ flex: 1, color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>
          {isFinance ? "Your buffer is biting" : "Finance is holding this year back"}
        </Text>
        <Text style={{ color, fontSize: font.lg, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"] }}>
          −{lost}%
        </Text>
      </View>

      <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
        {money(cut.buffer)} is ring-fenced, which leaves {money(cut.spendable)} for marketing, product and operations
        together. They've asked for {money(cut.wanted)}, so {money(cut.cut)} of it doesn't happen — and the cut falls on
        every seat by the same fraction, not on whoever asked last.
      </Text>

      {yours > 0 ? (
        <Text testID="desk-buffer-cut-yours" style={{ color: colors.text, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.semibold }}>
          Your {money(yours)} would become {money(yours * cut.allowed)}.
        </Text>
      ) : (
        <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular }}>
          Nothing of yours is in that sum this year, but everyone else's is.
        </Text>
      )}

      <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
        Measured against cash, the drawdown and the credit still unused, as the year counts it. Salaries and the cost
        of opening a city sit outside it.
      </Text>
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
/**
 * The year something happened.
 *
 * A season without events is fourteen copies of the same year — the numbers
 * move and nothing ever *happens* — so when one lands it is the most
 * interesting thing on the screen and it goes at the top of the report,
 * above the figures it explains.
 *
 * Two things the copy is careful about.
 *
 * **It is earned, not rolled.** Every event is drawn from the state of the
 * market: the company with a poor reputation gets the scandal, the one that
 * has been quietly excellent gets the write-up. The dice choose which of the
 * things you had coming arrives, never whether you deserved one. A card that
 * read as bad luck would make the game feel like it was cheating; one that
 * reads as the game paying attention is the same event, landing completely
 * differently.
 *
 * **There is always something to do about it.** The engine writes `advice`
 * for exactly that, and it gets its own line rather than being folded into
 * the body, because a player reading this on the train is deciding today.
 *
 * Whether it happened to *you* changes the framing and not the prominence: a
 * rival's supply failure is news you can act on, which is most of the reason
 * events are visible to everybody.
 */
export function EventCard({ event, year }: { event: ReportEvent; year: number }) {
  const tone = event.mine ? colors.warning : colors.info;
  return (
    <View
      testID="desk-event"
      style={{
        borderRadius: radius.md, backgroundColor: colors.surface, padding: spacing.lg, gap: spacing.sm,
        borderWidth: 1, borderColor: colors.border,
        borderLeftWidth: 3, borderLeftColor: tone, ...shadow.card,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="megaphone" size={16} color={tone} />
        <Text style={{ flex: 1, color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.semibold, letterSpacing: 0.5 }}>
          YEAR {year} · {event.scope === "market" ? "THE MARKET" : event.mine ? "YOUR COMPANY" : "SOMEBODY ELSE"}
        </Text>
        {event.mine ? <Pill label="You" color={tone} solid /> : null}
      </View>

      <Text style={{ color: colors.text, fontSize: font.lg, lineHeight: 24, fontFamily: fontFamily.bold, letterSpacing: -0.2 }}>
        {event.headline}
      </Text>
      <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 20, fontFamily: fontFamily.regular }}>
        {event.body}
      </Text>

      {/* The part a team can act on today. Its own line, in the accent, because
          it is the difference between news and a decision. */}
      <View style={{ flexDirection: "row", gap: 6, paddingTop: spacing.xs, borderTopWidth: 1, borderColor: colors.borderSubtle }}>
        <Icon name="arrow-forward-circle-outline" size={14} color={tone} />
        <Text style={{ flex: 1, color: colors.text, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.medium }}>
          {event.advice}
        </Text>
      </View>

      {/* Why this one and not another. Small, and worth the two lines: an event
          that reads as a dice roll reads as the game cheating, and every one of
          these was earned by something the market could already see. */}
      <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
        {event.scope === "market"
          ? "Market events hit everyone at once. What they cost depends on the position each company was already in."
          : event.mine
            ? "Events are drawn from where a company already stood, not out of the air. The year chose which of them arrived, not whether one was owed."
            : "You can see it happening to them, which is most of the point of it being a market."}
      </Text>
    </View>
  );
}

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
        {/* The rank is by founder-owned value now, and saying which is not a
            detail: a team that gained customers and slipped a place would
            otherwise read the number as broken. */}
        <Pill label={`#${report.rank} by what you own`} color={report.rank <= 2 ? colors.success : colors.info} />
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

      {/* What the five of them own, which is what the table is ordered by.
          Its own row rather than two more tiles in the grid above: the value
          and the share are one sentence — a big number and the fraction of it
          that is actually yours — and splitting them across a wrapping grid is
          how somebody reads the first and not the second. Absent on reports
          written before the scoreboard changed, which is a real state and not
          a zero. */}
      {report.founderValue != null ? (
        <View
          testID="desk-report-founder-value"
          style={{
            gap: 3, padding: spacing.md, borderRadius: radius.sm,
            backgroundColor: colors.surfaceRaised,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6 }}>
            <Text style={{ color: colors.text, fontSize: font.xl, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"] }}>
              {money(report.founderValue)}
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: font.xs, fontFamily: fontFamily.medium, paddingBottom: 4 }}>
              yours, of a {money(report.value ?? report.founderValue)} business
            </Text>
          </View>
          <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
            {report.founderShare != null && report.founderShare < 0.999
              ? `The founders hold ${shareOwnedRead(report.founderShare)}. This is the number the market is ranked by — growing the company while selling it off can move you down the table.`
              : "The founders still hold all of it. This is the number the market is ranked by, not customers."}
          </Text>
        </View>
      ) : null}

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
          {seat.isBot ? <Pill label="Bot" color={colors.textTertiary} /> : null}
        </View>
        <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular }}>
          {seat.title ?? seat.role?.toUpperCase() ?? "No seat"} · {seat.filed ? "filed" : "still deciding"}
          {seat.person ? ` · loyalty ${seat.person.loyalty}` : ""}
        </Text>
        {seat.person?.warning ? (
          <Text testID={`desk-loyalty-warning-${seat.role}`} style={{ color: colors.warning, fontSize: font.xs, fontFamily: fontFamily.medium }}>
            Thinking about leaving. At 15 they resign.
          </Text>
        ) : null}
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
            {source === "committed" ? (target.metric === "price" ? "In the draft" : "Committed so far") : "Now"} {metricRead(target.metric, actual)}
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
          Counts what marketing, product and operations commit. Borrowing, repayment, research and the cost of opening
          somewhere new all sit outside it — they're on the meter above, and the creditor doesn't count them.
        </Text>
      </View>
    </View>
  );
}
