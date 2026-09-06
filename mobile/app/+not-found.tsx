import { useRouter, Stack } from "expo-router";
import { Btn, Empty, Screen } from "../src/components/ui";

export default function NotFound() {
  const router = useRouter();
  return (
    <>
      <Stack.Screen options={{ title: "Not found" }} />
      <Screen contentStyle={{ flex: 1, justifyContent: "center" }}>
        <Empty
          title="This screen doesn't exist"
          body="The link may be broken, or the page may have moved."
          action="Go to the feed"
          onAction={() => router.replace("/(tabs)/feed")}
        />
      </Screen>
    </>
  );
}
