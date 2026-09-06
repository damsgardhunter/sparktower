import { Redirect } from "expo-router";

/** Entry point — AuthGate in _layout redirects to sign-in when needed. */
export default function Index() {
  return <Redirect href="/(tabs)/feed" />;
}
