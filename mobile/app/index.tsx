import { useEffect, useRef } from "react";
import { ActivityIndicator, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useAuth } from "../src/auth/AuthContext";
import { api } from "../src/api/client";
import { takePendingDestination } from "../src/pendingDestination";
import { colors } from "../src/theme";

interface NextStepItem { project: { id: string }; track?: { goal: string } | null }

/** How long opening the app waits on "where's my path?" before landing on the feed anyway. */
const PATH_LOOKUP_TIMEOUT_MS = 2500;

/**
 * Entry point. AuthGate in _layout sends signed-out people to sign-in; a
 * signed-in account that never finished its profile goes to the wizard first,
 * as the website does.
 *
 * Everyone else opens on their path — paths are the product: the project
 * section they worked most recently (the first of /api/me/next-steps, which
 * is ordered that way), in the manager, with the feed underneath so Back goes
 * home. No path yet, or the lookup fails or is slow: the feed.
 */
export default function Index() {
  const { user, profile } = useAuth();
  if (!user) return <Redirect href="/(auth)/sign-in" />;
  if (!profile?.isOnboarded) return <Redirect href="/welcome" />;
  return <OpenOnPath />;
}

function OpenOnPath() {
  const router = useRouter();
  const done = useRef(false);
  useEffect(() => {
    const land = (item: NextStepItem | null) => {
      if (done.current) return;
      done.current = true;
      router.replace("/(tabs)/feed");
      if (item?.project?.id) {
        const section = item.track?.goal ? `&section=${encodeURIComponent(item.track.goal)}` : "";
        // Pushed over the feed, so the header's back arrow returns home. `from=launch` keeps Nova's welcome from popping up on every open.
        setTimeout(() => router.push(`/manage/${item.project.id}?from=launch${section}` as any), 0);
      }
    };
    /*
     * Before anything else: where were they going before they had to sign in?
     *
     * An invite or a published artifact is the one screen the app shows signed
     * out, and the account that just came into being usually came into being
     * *because* of it. Opening on the path instead would be correct for every
     * other launch and wrong for this one — the invited person joins nothing,
     * and the artifact's reader never starts the path they tapped. The feed
     * still goes underneath, so Back means home here as everywhere else.
     */
    /*
     * The timer covers both lookups, and starts before either. Reading the
     * device's stored destination is normally instant, but it is still I/O —
     * and a launch that hangs on a spinner because SecureStore didn't answer
     * is the failure this timeout was always there to prevent.
     */
    const timer = setTimeout(() => land(null), PATH_LOOKUP_TIMEOUT_MS);
    void takePendingDestination()
      .then((destination) => {
        if (done.current) return;
        if (destination) {
          clearTimeout(timer);
          done.current = true;
          router.replace("/(tabs)/feed");
          setTimeout(() => router.push(destination as any), 0);
          return;
        }
        return api<{ items: NextStepItem[] }>("/api/me/next-steps")
          .then((r) => land(r.items?.[0] ?? null))
          .catch(() => land(null))
          .finally(() => clearTimeout(timer));
      })
      .catch(() => land(null));
    return () => clearTimeout(timer);
  }, [router]);
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}
