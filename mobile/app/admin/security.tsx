import { Text, View } from "react-native";
import { Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, spacing } from "../../src/theme";
import { Loading, Screen } from "../../src/components/ui";
import { Callout, PageIntro, TitledCard } from "../../src/components/MoreKit";
import { Pill } from "../../src/components/nova/Pill";
import { CountRow, NotFoundScreen, StatBox, StatGrid, gateView, isNotFound, text, useReviewer } from "../../src/components/more/AdminKit";

/**
 * Who has power here, and whether they are protected — the phone's half of
 * `client/src/pages/admin-security.tsx`.
 *
 * The route's own comment names the thing worth seeing at a glance: **power
 * without a second factor**. An admin or reviewer with 2FA off is the whole
 * screen in one row, and it is the one fact here that cannot wait for somebody
 * to be at a desk, so it is first and it is loud.
 *
 * Addresses are masked by the server before they leave it. The phone shows what
 * it is given and has no way to ask for more, which is the right shape for a
 * screen somebody might open on a train.
 *
 * ## Resetting a second factor and signing somebody out are on the web
 *
 * Both routes exist (`/users/:id/reset-mfa`, `/users/:id/sign-out`) and both
 * take a written reason. They are recovery operations on *privileged* accounts
 * — taking a second factor off an admin is the one action on this screen that
 * makes the platform less safe while it is being used to make somebody's day
 * better. That is worth a desk, a keyboard for the reason, and the web's
 * confirmation. Recorded in `docs/mobile-parity.md` rather than quietly absent.
 */

interface Privileged {
  id: string;
  email: string;
  firstName: string | null;
  role: string | null;
  mfaEnabledAt: string | null;
  suspendedAt: string | null;
  emailVerifiedAt: string | null;
  createdAt: string;
  twoFactor: "on" | "OFF";
}
interface Refusal { action: string; n: number; subjects: number }
interface Suspended { id: string; email: string }
interface Overview {
  privileged: Privileged[];
  refusalsLastDay: Refusal[];
  allowedAttemptsLastDay: Refusal[];
  suspended: Suspended[];
  recentActions: unknown[];
}

const TITLE = "Security";

export default function AdminSecurity() {
  const { loading, isReviewer } = useReviewer();
  const overview = useQuery<Overview>({
    queryKey: ["admin-security"],
    queryFn: () => api<Overview>("/api/admin/security/overview"),
    retry: false,
  });

  const gate = gateView(TITLE, loading, isReviewer);
  if (gate) return gate;
  if (isNotFound(overview.error)) return <NotFoundScreen title={TITLE} />;

  if (overview.isLoading || !overview.data) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        <Stack.Screen options={{ title: TITLE }} />
        <Loading />
      </View>
    );
  }

  const d = overview.data;
  const unprotected = d.privileged.filter((p) => p.twoFactor === "OFF");
  const refusals = d.refusalsLastDay.slice(0, 8);
  const worst = refusals.reduce((m, r) => Math.max(m, r.n), 0);

  return (
    <Screen>
      <Stack.Screen options={{ title: TITLE }} />
      <PageIntro icon="shield-checkmark" title={TITLE} body="Who has power here, and whether they are protected." />

      {/* The one fact that cannot wait for a desk. */}
      {unprotected.length > 0 ? (
        <Callout
          icon="warning"
          tone="danger"
          title={`${unprotected.length} ${unprotected.length === 1 ? "account has" : "accounts have"} power without a second factor`}
          body={unprotected.map((p) => `${p.firstName || p.email} (${p.role})`).join(", ")}
        />
      ) : (
        <Callout icon="checkmark-circle" tone="success" body="Every admin and reviewer has a second factor on." />
      )}

      <TitledCard icon="people" title={`Admins and reviewers · ${d.privileged.length}`}>
        {d.privileged.map((p) => (
          <CountRow
            key={p.id}
            label={`${p.firstName || p.email}${p.role ? ` · ${p.role}` : ""}`}
            value={p.twoFactor === "on" ? "2FA on" : "2FA OFF"}
            leading={
              p.suspendedAt ? <Pill label="suspended" tone="bad" />
                : p.twoFactor === "OFF" ? <Pill label="exposed" tone="bad" />
                : <Pill label="ok" tone="good" />
            }
          />
        ))}
        <Text style={text.small}>
          Addresses are masked by the server before they leave it; this screen shows what it is
          given and cannot ask for more.
        </Text>
      </TitledCard>

      <TitledCard icon="hand-left" title="Refused in the last day">
        <Text style={text.meta}>
          Requests a limit turned away, by action. A spike in one row is somebody probing it; a
          spike in all of them is a script.
        </Text>
        {refusals.length === 0 ? (
          <Text style={text.meta}>Nothing was refused.</Text>
        ) : refusals.map((r) => (
          <CountRow
            key={r.action}
            label={r.action}
            value={r.n}
            note={`${r.subjects} ${r.subjects === 1 ? "caller" : "callers"}`}
            share={worst > 0 ? r.n / worst : null}
          />
        ))}
      </TitledCard>

      <StatGrid>
        <StatBox label="Suspended" value={`${d.suspended.length}`} state={d.suspended.length > 0 ? "warn" : "none"} />
        <StatBox
          label="Allowed attempts"
          value={`${d.allowedAttemptsLastDay.reduce((n, r) => n + r.n, 0)}`}
          sub="last day, for scale"
        />
      </StatGrid>

      <Callout
        icon="desktop"
        tone="info"
        body="Resetting somebody's second factor and signing them out of everywhere are on the web console. Both take a written reason, and taking a second factor off an admin is the one action here that makes the platform less safe while it is used — it is worth a desk."
      />

      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}
