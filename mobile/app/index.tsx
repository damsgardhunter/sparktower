import { Redirect } from "expo-router";
import { useAuth } from "../src/auth/AuthContext";

/**
 * Entry point. AuthGate in _layout sends signed-out people to sign-in; a
 * signed-in account that never finished its profile goes to the wizard first,
 * as the website does, and everyone else to the feed.
 */
export default function Index() {
  const { user, profile } = useAuth();
  if (user && !profile?.isOnboarded) return <Redirect href="/welcome" />;
  return <Redirect href="/(tabs)/feed" />;
}
