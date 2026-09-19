/**
 * Spending the first million, on a phone.
 *
 * The round the valuation leans on hardest and the one that has to feel best.
 * Same idea as the web: the money is always visible and always moving.
 *
 * One bar holds the whole million and fills with the colour of whichever group
 * you are funding, so the shape of your company appears in it — a bar that is
 * four-fifths hiring looks nothing like one that is half marketing, and you
 * see that before anybody tells you.
 *
 * The number that stays largest is what is **left**, not what is spent.
 * Spending a million is easy and slightly thrilling; watching the remainder
 * fall towards zero is the part that makes people stop and think.
 *
 * On a phone the slider is replaced by steppers. A 6px-wide drag target that
 * has to hit a 10,000 step inside a scroll view is a fight, and the round is
 * six minutes long — tapping a known amount is faster and never overshoots.
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Icon } from "../ui";
import {
  BUDGET_TOTAL, money, summariseBudget, unallocated,
  type Allocation, type SpendOption,
} from "./model";

/**
 * A colour per group, held constant across the bar, the legend and every row.
 * The bar is only readable at a glance if "hiring" means the same colour
 * everywhere else too.
 */
const GROUP_COLOURS: Record<string, string> = {
  Hiring: "#8B5CF6",
  Product: "#0EA5E9",
  "Getting customers": "#10B981",
  "Keeping it standing": "#D97706",
};

const GROUPS = ["Hiring", "Product", "Getting customers", "Keeping it standing"];

function BudgetBar({ allocation, options }: { allocation: Allocation; options: SpendOption[] }) {
  const summary = summariseBudget(allocation, options);
  const left = BUDGET_TOTAL - summary.total;

  return (
    <View style={{ gap: spacing.sm }}>
      <View
        testID="budget-bar"
        style={{ flexDirection: "row", height: 22, borderRadius: radius.pill, overflow: "hidden", backgroundColor: colors.surfaceRaised }}
      >
        {GROUPS.map((group) => {
          const amount = summary.byGroup.find((g) => g.group === group)?.amount ?? 0;
          if (amount <= 0) return null;
          return (
            <View
              key={group}
              style={{ width: `${(amount / BUDGET_TOTAL) * 100}%`, backgroundColor: GROUP_COLOURS[group] }}
            />
          );
        })}
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
        {GROUPS.map((group) => {
          const amount = summary.byGroup.find((g) => g.group === group)?.amount ?? 0;
          return (
            <View key={group} style={{ flexDirection: "row", alignItems: "center", gap: 5, opacity: amount > 0 ? 1 : 0.4 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: GROUP_COLOURS[group] }} />
              <Text style={{ color: colors.textSecondary, fontSize: font.xs }}>{group}</Text>
              <Text style={{ color: colors.text, fontSize: font.xs, fontFamily: fontFamily.medium, fontVariant: ["tabular-nums"] }}>
                {money(amount)}
              </Text>
            </View>
          );
        })}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5, opacity: left > 0 ? 1 : 0.4 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border }} />
          <Text style={{ color: colors.textSecondary, fontSize: font.xs }}>Unspent</Text>
          <Text style={{ color: colors.text, fontSize: font.xs, fontFamily: fontFamily.medium, fontVariant: ["tabular-nums"] }}>
            {money(left)}
          </Text>
        </View>
      </View>
    </View>
  );
}

function Stepper({
  amount, step, remaining, onChange,
}: { amount: number; step: number; remaining: number; onChange: (n: number) => void }) {
  const canAdd = remaining >= step;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
      <Pressable
        onPress={() => onChange(Math.max(0, amount - step))}
        disabled={amount <= 0}
        hitSlop={8}
        style={{
          width: 34, height: 34, borderRadius: radius.md, alignItems: "center", justifyContent: "center",
          backgroundColor: colors.surfaceRaised, opacity: amount <= 0 ? 0.4 : 1,
        }}
      >
        <Icon name="remove" size={18} color={colors.text} />
      </Pressable>
      <Pressable
        onPress={() => canAdd && onChange(amount + step)}
        disabled={!canAdd}
        hitSlop={8}
        style={{
          width: 34, height: 34, borderRadius: radius.md, alignItems: "center", justifyContent: "center",
          backgroundColor: canAdd ? colors.primarySoft : colors.surfaceRaised, opacity: canAdd ? 1 : 0.4,
        }}
      >
        <Icon name="add" size={18} color={canAdd ? colors.primary : colors.textTertiary} />
      </Pressable>
      {amount > 0 ? (
        <Pressable onPress={() => onChange(0)} hitSlop={8} style={{ paddingHorizontal: 4 }}>
          <Icon name="arrow-undo-outline" size={16} color={colors.textTertiary} />
        </Pressable>
      ) : null}
    </View>
  );
}

function SpendRow({
  option, amount, remaining, onChange,
}: { option: SpendOption; amount: number; remaining: number; onChange: (n: number) => void }) {
  const underfunded = amount > 0 && amount < option.minimumUseful;

  return (
    <View
      testID={`spend-${option.id}`}
      style={{
        borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg,
        backgroundColor: amount > 0 ? colors.surface : colors.surface,
        padding: spacing.lg, gap: spacing.sm, opacity: amount > 0 ? 1 : 0.9,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: GROUP_COLOURS[option.group] }} />
            <Text style={{ flex: 1, color: colors.text, fontSize: font.base, fontFamily: fontFamily.medium }}>
              {option.label}
            </Text>
          </View>
          <Text style={{ color: colors.textSecondary, fontSize: font.sm, marginTop: 2 }}>{option.detail}</Text>
        </View>
        <Text style={{
          color: amount > 0 ? GROUP_COLOURS[option.group] : colors.textTertiary,
          fontSize: font.lg, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"],
        }}>
          {money(amount)}
        </Text>
      </View>

      <Stepper amount={amount} step={option.step} remaining={remaining} onChange={onChange} />

      <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 17 }}>{option.consequence}</Text>

      {/* Said out loud rather than counted silently: a line funded below what
          it costs bought nothing, and the player should learn that here rather
          than in the valuation. */}
      {underfunded ? (
        <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
          <Icon name="warning-outline" size={14} color={colors.warning} />
          <Text style={{ flex: 1, color: colors.warning, fontSize: font.xs, lineHeight: 17 }}>
            Under {money(option.minimumUseful)} this doesn't buy the thing it names — an unfilled role
            and a hole in the bank.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function GameBudgetRound({
  allocation, onChange, partnerTotal, options,
}: {
  allocation: Allocation;
  onChange: (next: Allocation) => void;
  partnerTotal: number | null;
  /** From GET /api/games/rules — never a copy pasted into the app. */
  options: SpendOption[];
}) {
  const left = unallocated(allocation);
  const spent = BUDGET_TOTAL - left;
  const set = (id: string, n: number) => onChange({ ...allocation, [id]: n });

  return (
    <View style={{ gap: spacing.lg }}>
      <View style={{
        borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg,
        backgroundColor: colors.surface, padding: spacing.lg, gap: spacing.lg,
      }}>
        <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
          <View>
            <Text style={{ color: colors.textSecondary, fontSize: font.sm }}>Left to spend</Text>
            <Text
              testID="budget-remaining"
              style={{
                color: left === 0 ? colors.primary : left < 100_000 ? colors.warning : colors.text,
                fontSize: 34, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"],
              }}
            >
              {money(left)}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ color: colors.textSecondary, fontSize: font.sm }}>Committed</Text>
            <Text style={{ color: colors.text, fontSize: font.lg, fontFamily: fontFamily.medium, fontVariant: ["tabular-nums"] }}>
              {money(spent)}
            </Text>
          </View>
        </View>

        <BudgetBar allocation={allocation} options={options} />

        {/* The committed budget is the average of both, so knowing they have
            put something in is what makes this a negotiation. */}
        {partnerTotal !== null ? (
          <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 17 }}>
            Your partner has committed {money(partnerTotal)}. What gets spent is the average of your
            two budgets, so talk to them.
          </Text>
        ) : null}
      </View>

      {GROUPS.map((group) => (
        <View key={group} style={{ gap: spacing.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: GROUP_COLOURS[group] }} />
            <Text style={{ color: GROUP_COLOURS[group], fontSize: font.sm, fontFamily: fontFamily.semibold }}>
              {group}
            </Text>
          </View>
          {options.filter((o) => o.group === group).map((option) => (
            <SpendRow
              key={option.id}
              option={option}
              amount={allocation[option.id] ?? 0}
              remaining={left}
              onChange={(n) => set(option.id, n)}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

export { GROUP_COLOURS, GROUPS };
