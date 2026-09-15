import { View } from "react-native";
import { useRouter, Stack } from "expo-router";
import { colors, spacing } from "../src/theme";
import { Btn, Body, H1, Icon } from "../src/components/ui";
import { tintSoft } from "../src/components/MoreKit";

export default function NotFound() {
  const router = useRouter();
  return (
    <>
      <Stack.Screen options={{ title: "Not found" }} />
      <View style={{ flex: 1, backgroundColor: colors.canvas, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md }}>
        <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: tintSoft(colors.primary), alignItems: "center", justifyContent: "center" }}>
          <Icon name="compass-outline" size={36} color={colors.primary} />
        </View>
        <H1 style={{ textAlign: "center" }}>This page doesn't exist</H1>
        <Body muted style={{ textAlign: "center", maxWidth: 300 }}>The link may be broken, or the page may have moved or been switched off.</Body>
        <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
          {router.canGoBack() && <Btn label="Go back" icon="arrow-back" variant="outline" onPress={() => router.back()} />}
          <Btn label="Go to the feed" icon="home" onPress={() => router.replace("/(tabs)/feed")} />
        </View>
      </View>
    </>
  );
}
