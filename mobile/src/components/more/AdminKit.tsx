/**
 * Shared pieces for the reviewer screens under app/admin — the gate, the
 * "not found" answer, number formatting, and the small stat and list rows the
 * web pages draw as tables and cards.
 */
import React from "react";
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "../../api/client";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Btn, Empty, Icon, Loading, type IconName } from "../ui";
import { Sheet } from "../Sheet";

/** The web's check: reviewer or admin, from the signed-in user. */
export function useReviewer() {
  const { data: me, isLoading } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  return { loading: isLoading, isReviewer: ["reviewer", "admin"].includes(me?.user?.platformRole) };
}

/** The API answers a non-reviewer (or non-owner) with 404 — the same as a page that isn't there. */
export const isNotFound = (err: any) => err?.status === 404 || err?.status === 403;

/** What the web renders as <NotFound /> for anyone the page isn't for. */
export function NotFoundScreen({ title }: { title: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, justifyContent: "center" }}>
      <Stack.Screen options={{ title }} />
      <Empty icon="help-circle-outline" title="Page not found" body="This page doesn't exist, or it isn't for your account." />
    </View>
  );
}

/**
 * A 403 from the second-factor gate (server/mfa.ts). The role is right and the
 * session isn't, which is a different thing from a page that isn't yours —
 * telling a reviewer "page not found" when they need to set up 2FA leaves them
 * with nowhere to go.
 */
export const mfaBlock = (err: any): "enrol" | "verify" | null =>
  err?.status !== 403 ? null
  : err?.body?.code === "mfa_enrollment_required" ? "enrol"
  : err?.body?.code === "mfa_required" ? "verify"
  : null;

/** What a reviewer sees when the review tools are locked behind a code they haven't given. */
export function TwoFactorNeeded({ title, mode }: { title: string; mode: "enrol" | "verify" }) {
  const router = useRouter();
  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, justifyContent: "center", paddingHorizontal: spacing.lg, gap: spacing.lg }}>
      <Stack.Screen options={{ title }} />
      <Empty
        icon="shield-checkmark-outline"
        title={mode === "enrol" ? "Two-factor needed" : "Sign in with your code"}
        body={mode === "enrol"
          ? "Review and admin tools need two-factor authentication. It takes a minute to set up."
          : "This sign-in didn't use your authenticator code. Sign out and back in to use the review tools."}
      />
      {mode === "enrol" && <Btn label="Set up two-factor" onPress={() => router.push("/security" as any)} testID="admin-setup-2fa" />}
    </View>
  );
}

/** The screen to show instead, if any: locked behind a code, or not yours at all. */
export function blockedView(title: string, err: any): React.ReactElement | null {
  const block = mfaBlock(err);
  if (block) return <TwoFactorNeeded title={title} mode={block} />;
  if (isNotFound(err)) return <NotFoundScreen title={title} />;
  return null;
}

/** Loading, or not found, before a gated screen renders. Returns null when the screen may render. */
export function gateView(title: string, loading: boolean, allowed: boolean): React.ReactElement | null {
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        <Stack.Screen options={{ title }} />
        <Loading />
      </View>
    );
  }
  if (!allowed) return <NotFoundScreen title={title} />;
  return null;
}

// --- Formatting ------------------------------------------------------------

/** shared/backing.ts money formatting. */
export const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** shared/loop-events.ts formatPercent. */
export const formatPercent = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "—" : `${Math.round(n)}%`;

/** shared/loop-events.ts formatDuration. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem ? `${mins}m ${rem}s` : `${mins}m`;
}

export const text = {
  body: { color: colors.text, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular },
  strong: { color: colors.text, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.semibold },
  meta: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular },
  small: { color: colors.textTertiary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular },
  over: { color: colors.textTertiary, fontSize: 10, fontFamily: fontFamily.semibold, textTransform: "uppercase", letterSpacing: 0.5 },
} as const;

// --- Layout pieces ---------------------------------------------------------

/** A bordered number box: label, value, optional line under it. Tinted when a target is met or missed. */
export function StatBox({ label, value, sub, state, style }: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  state?: "good" | "warn" | "none";
  style?: StyleProp<ViewStyle>;
}) {
  const color = state === "good" ? colors.success : state === "warn" ? colors.warning : colors.text;
  return (
    <View style={[{ flex: 1, minWidth: "45%", borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, gap: 2 }, style]}>
      <Text style={text.over} numberOfLines={2}>{label}</Text>
      <Text style={{ color, fontSize: font.lg, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"] }}>{value}</Text>
      {sub ? <Text style={text.small}>{sub}</Text> : null}
    </View>
  );
}

/** A wrapping grid of StatBoxes, two to a row on a phone. */
export function StatGrid({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>{children}</View>;
}

/** A label and a count on one line, with an optional bar and trailing note — the web's dotted-leader lists. */
export function CountRow({ label, value, note, share, leading }: {
  label: string;
  value: React.ReactNode;
  note?: string;
  /** 0–1: draws a bar under the row. */
  share?: number | null;
  leading?: React.ReactNode;
}) {
  return (
    <View style={{ gap: 4, paddingVertical: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        {leading}
        <Text style={[text.body, { flex: 1 }]} numberOfLines={2}>{label}</Text>
        <Text style={[text.strong, { fontVariant: ["tabular-nums"] }]}>{value}</Text>
        {note != null ? <Text style={[text.small, { minWidth: 56, textAlign: "right" }]}>{note}</Text> : null}
      </View>
      {share != null ? (
        <View style={{ height: 5, borderRadius: 3, backgroundColor: colors.surfaceRaised, overflow: "hidden" }}>
          <View style={{ height: "100%", width: `${Math.max(0, Math.min(100, Math.round(share * 100)))}%`, backgroundColor: colors.primary, opacity: 0.75 }} />
        </View>
      ) : null}
    </View>
  );
}

/** A small pressable pill link, for "Reports queue", "Surfaces" and the like. */
export function LinkPill({ label, icon = "chevron-forward", onPress }: { label: string; icon?: IconName; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      style={({ pressed }) => [{
        flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5,
        borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
      }, pressed && { opacity: 0.65 }]}
    >
      <Text style={{ color: colors.primary, fontSize: font.xs, fontFamily: fontFamily.semibold }}>{label}</Text>
      <Icon name={icon} size={11} color={colors.primary} />
    </Pressable>
  );
}

/** A choice list for a sheet or card: the phone's stand-in for a <select>. */
export function ChoiceList<T extends string>({ options, value, onChange, disabled }: {
  options: { id: T; label: string; detail?: string }[];
  value: T | "";
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <View style={{ gap: 6, opacity: disabled ? 0.5 : 1 }}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable
            key={o.id}
            disabled={disabled}
            onPress={() => onChange(o.id)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={({ pressed }) => [{
              flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 8, paddingHorizontal: spacing.md,
              borderRadius: radius.sm, borderWidth: 1.5, borderColor: on ? colors.primary : colors.border,
              backgroundColor: on ? colors.primarySoft : colors.surface,
            }, pressed && { opacity: 0.75 }]}
          >
            <Icon name={on ? "radio-button-on" : "radio-button-off"} size={18} color={on ? colors.primary : colors.textTertiary} />
            <View style={{ flex: 1 }}>
              <Text style={text.strong}>{o.label}</Text>
              {o.detail ? <Text style={text.small}>{o.detail}</Text> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A yes/no sheet for anything that changes someone else's content or account. */
export function ConfirmSheet({ visible, onClose, title, body, confirmLabel, danger, loading, disabled, onConfirm, children }: {
  visible: boolean;
  onClose: () => void;
  title: string;
  body?: string;
  confirmLabel: string;
  danger?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title={title} subtitle={body}>
      {children}
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Btn label="Cancel" variant="outline" onPress={onClose} style={{ flex: 1 }} />
        <Btn
          label={confirmLabel}
          onPress={onConfirm}
          loading={loading}
          disabled={disabled}
          style={[{ flex: 1 }, danger && { backgroundColor: colors.danger }]}
        />
      </View>
    </Sheet>
  );
}
