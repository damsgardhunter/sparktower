import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  SpaceGrotesk_400Regular, SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold, useFonts,
} from "@expo-google-fonts/space-grotesk";
import { AuthProvider, useAuth } from "../src/auth/AuthContext";
import { colors, fontFamily, isDark } from "../src/theme";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      // Mobile networks are flaky and screens remount often; a short stale
      // window avoids refetching everything on every navigation.
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * The website's routing rules (client/src/App.tsx), applied to the app:
 *
 *   signed out            → the landing / sign-in screen, and nowhere else
 *   signed in, onboarding
 *   not finished          → the profile wizard (/welcome), and nowhere else —
 *                           including an account with no profile row at all,
 *                           which the web also sends to onboarding
 *   signed in, onboarded  → past the auth screens to the feed
 */
function AuthGate() {
  const { user, profile, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const onboarded = Boolean(profile?.isOnboarded);

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === "(auth)";
    const inOnboarding = (segments[0] as string) === "welcome";
    // Shared links the web shows signed out: a published artifact, and an invite —
    // the person an invite is for usually has no account yet, which is the point of it.
    const onPublicPage = ["a", "invite"].includes(segments[0] as string);

    if (!user) {
      if (!inAuthGroup && !onPublicPage) router.replace("/(auth)/sign-in");
    } else if (!onboarded) {
      if (!inOnboarding) router.replace("/welcome");
    } else if (inAuthGroup) {
      // Through the entry point, which opens on the person's path when they have one.
      router.replace("/");
    }
  }, [user, onboarded, loading, segments]);

  if (loading) return <Loading />;

  /*
   * One stack over everything: the tabs and sign-in draw their own chrome, and
   * every screen pushed on top (a project, a chat, a profile) gets the same
   * white header with a back arrow — set per screen with <Stack.Screen options>.
   */
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: { fontFamily: fontFamily.semibold, fontSize: 17, color: colors.text },
        headerShadowVisible: true,
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
    </Stack>
  );
}

function Loading() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}

export default function RootLayout() {
  // Space Grotesk is the web app's typeface. Rendering before it resolves
  // would flash the system font and reflow every label, so hold the splash
  // until it's ready — the auth check is usually still in flight anyway.
  const [fontsLoaded, fontError] = useFonts({
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  });

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          {/* Dark letters on a light phone, light letters on a dark one. The
              header's own StatusBar overrides this to light where it sits on a
              cover photo, in both schemes. */}
          <StatusBar style={isDark ? "light" : "dark"} />
          {/* On a font error, fall through to the system font rather than
              stranding the user on a spinner. */}
          {fontsLoaded || fontError ? <AuthGate /> : <Loading />}
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
