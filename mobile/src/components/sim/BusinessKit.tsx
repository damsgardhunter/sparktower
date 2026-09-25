/**
 * The parts the three business simulations share.
 *
 * "Simulate a decision", "Test a marketing scheme" and "Ten years from now"
 * all read the same business and are all scored by the same server, so the
 * pieces that say *what the business is* — the fourteen numbers it starts
 * from, and the way money is written — belong in one place rather than three.
 *
 * Nothing here decides anything. Every figure, label, band and verdict comes
 * off the API, because the web client and this one have to agree about a
 * business down to the wording, and the only way two clients agree is by not
 * each having an opinion.
 */
import { useState } from "react";
import { Text, View } from "react-native";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Body, Btn, Card, Field, Label, Meta } from "../ui";

/** One of the fourteen, as the server describes it. */
export interface BaselineField {
  field: string;
  unit: "money" | "percent" | "count";
  label: string;
  hint: string;
}

const SYMBOLS: Record<string, string> = { USD: "$", GBP: "£", EUR: "€", CAD: "$", AUD: "$", NZD: "$", JPY: "¥", INR: "₹" };
export const symbolFor = (code: string | null | undefined) => SYMBOLS[String(code ?? "USD").toUpperCase()] ?? "$";

/** Money the way a business says it out loud: "$14k", not "$14,000.00". */
export function money(n: number, code: string): string {
  const sym = symbolFor(code);
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${sign}${sym}${(a / 1_000_000).toFixed(1)}m`;
  if (a >= 1_000) return `${sign}${sym}${Math.round(a / 1_000)}k`;
  return `${sign}${sym}${Math.round(a)}`;
}

/**
 * A percentage stored as a fraction, shown as a percentage.
 *
 * The baseline keeps `growth`, `taxRate` and the rest as 0–1 because the
 * engine multiplies by them; a person types "12", not "0.12". Converting at
 * the edge keeps that difference out of every screen behind it.
 */
export const toPercent = (n: number) => Math.round(n * 1000) / 10;
export const fromPercent = (n: number) => n / 100;

/**
 * The starting position, in fourteen numbers.
 *
 * Rendered from the server's own field list rather than a copy of it: the
 * labels name a currency ("Kept per extra $1"), and a second hand-written
 * list here would be a second thing to keep in step with the business's own
 * money. Fields the owner has typed are marked, because the rest were read
 * from the weekly check-ins and knowing which is which is the difference
 * between correcting a number and inventing one.
 */
export function BaselineForm({
  fields, baseline, overridden, missing, currency, saving, onSave,
}: {
  fields: BaselineField[];
  baseline: Record<string, number>;
  overridden: string[];
  currency: string;
  /** Fields the check-ins could not answer; the server wants them marked as the owner's. */
  missing: string[];
  saving: boolean;
  onSave: (numbers: Record<string, number>, overridden: string[]) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const f of fields) {
      const raw = Number(baseline?.[f.field] ?? 0);
      out[f.field] = String(f.unit === "percent" ? toPercent(raw) : raw);
    }
    return out;
  });

  /*
   * Which of the fourteen are the owner's own.
   *
   * The rest keep being read from the weekly check-ins, so marking all of them
   * would quietly freeze the business at whatever it looked like the day
   * somebody opened this form. Touched is tracked rather than inferred from a
   * changed value: retyping the same number is still a person saying "this one
   * is mine, stop guessing at it".
   */
  const [touched, setTouched] = useState<string[]>([]);

  const submit = () => {
    const numbers: Record<string, number> = {};
    for (const f of fields) {
      const n = Number(draft[f.field]);
      const clean = Number.isFinite(n) ? n : 0;
      numbers[f.field] = f.unit === "percent" ? fromPercent(clean) : clean;
    }
    onSave(numbers, [...new Set([...overridden, ...touched, ...missing])]);
  };

  const sym = symbolFor(currency);

  return (
    <Card>
      <View style={{ gap: spacing.md }}>
        <View style={{ gap: 4 }}>
          <Text style={{ color: colors.text, fontSize: font.lg, fontFamily: fontFamily.bold }}>
            Where you're starting from
          </Text>
          <Meta>
            Read from your weekly check-ins where they could answer. Correct anything that's wrong — what you type
            is kept, and the rest keeps updating itself.
          </Meta>
        </View>

        {fields.map((f) => (
          <View key={f.field} style={{ gap: 2 }}>
            <Field
              label={`${f.label}${f.unit === "money" ? ` (${sym})` : f.unit === "percent" ? " (%)" : ""}`}
              value={draft[f.field] ?? ""}
              onChangeText={(v) => {
                setDraft((d) => ({ ...d, [f.field]: v }));
                setTouched((t) => (t.includes(f.field) ? t : [...t, f.field]));
              }}
              numeric
              testID={`input-${f.field}`}
            />
            <Meta>
              {f.hint}
              {overridden.includes(f.field) ? " · yours" : ""}
            </Meta>
          </View>
        ))}

        <Btn label="Save these" loading={saving} disabled={saving} onPress={submit} testID="button-save-baseline" />
      </View>
    </Card>
  );
}

/** A verdict badge — the one word the whole answer comes down to. */
export function Verdict({ text, tone = "plain" }: { text: string; tone?: "good" | "bad" | "plain" }) {
  const color = tone === "good" ? colors.success : tone === "bad" ? colors.danger : colors.text;
  return (
    <Text style={{ color, fontSize: font.lg, fontFamily: fontFamily.bold, letterSpacing: -0.2 }}>{text}</Text>
  );
}

/**
 * The bullet points under an answer.
 *
 * These are the whole value of the thing — the arithmetic said in sentences —
 * so they are shown in full rather than truncated to a preview with a "more"
 * nobody presses.
 */
export function Facts({ facts }: { facts: string[] }) {
  if (!facts?.length) return null;
  return (
    <View style={{ gap: spacing.sm }}>
      {facts.map((f, i) => (
        <View key={i} style={{ flexDirection: "row", gap: spacing.sm }}>
          <Text style={{ color: colors.textSecondary, fontSize: font.sm }}>·</Text>
          <Body style={{ flex: 1 }}>{f}</Body>
        </View>
      ))}
    </View>
  );
}

/** A labelled figure, for the two or three numbers that carry an answer. */
export function Stat({ label, value, tone = "plain" }: { label: string; value: string; tone?: "good" | "bad" | "plain" }) {
  const color = tone === "good" ? colors.success : tone === "bad" ? colors.danger : colors.text;
  return (
    <View style={{ flex: 1, minWidth: 96, backgroundColor: colors.canvas, borderRadius: radius.sm, padding: spacing.md, gap: 2 }}>
      <Meta>{label}</Meta>
      <Text style={{ color, fontSize: font.lg, fontFamily: fontFamily.bold }}>{value}</Text>
    </View>
  );
}

/**
 * A score out of a hundred with the band under it.
 *
 * The band is the server's word — "Shaky", "Promising" — and it is what
 * somebody remembers; the number is what they argue with. Both, in that
 * order.
 */
export function Score({ score, band }: { score: number; band?: string | null }) {
  const tone = score >= 70 ? colors.success : score >= 45 ? colors.warning : colors.danger;
  return (
    <View style={{ alignItems: "center", gap: 2 }}>
      <Text style={{ color: tone, fontSize: font.xxl, fontFamily: fontFamily.bold }}>{Math.round(score)}</Text>
      {band ? <Label>{band}</Label> : null}
    </View>
  );
}
