import { Redirect } from "expo-router";

/**
 * The profile wizard moved to /welcome: the root AuthGate sends anyone signed
 * in out of the (auth) group, so a wizard in here could never be reached by
 * the people it's for. Old links land in the right place.
 */
export default function Onboarding() {
  return <Redirect href="/welcome" />;
}
