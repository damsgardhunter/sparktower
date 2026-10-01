import { ScrollView, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ContinuePathCard, useNextSteps } from "../src/components/feed/ContinuePathCard";
import { NoticeBanner, useNotice } from "../src/components/Sheet";
import { Body, Btn, Loading } from "../src/components/ui";
import { colors, font, fontFamily, radius, spacing } from "../src/theme";

/**
 * Your path: every project's next step, on one screen.
 *
 * The phone already had this list — `ContinuePathCard` on the feed renders every
 * item, not just the first — but it had nowhere to *send* anybody. The card is
 * behind whatever else is on the feed that day, and it hides itself entirely when
 * the list is empty, which is right on a feed and wrong for a destination: "come
 * back and pick up where you left off" is the whole retention loop, and a loop
 * needs an address.
 *
 * It renders the same rows as the card rather than its own, for the reason the
 * web's `/path` gives: two answers to "what should I do next" would disagree
 * within a week. The card's own heading is turned off because this screen has a
 * title, and the empty state lives here because the card is right to refuse one.
 */
export default function PathScreen() {
  const { items, isLoading } = useNextSteps();
  const { notice, show, clear } = useNotice();

  return (
    <>
      <Stack.Screen options={{ title: "Your path" }} />
      <NoticeBanner notice={notice} onDismiss={clear} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl * 3, gap: spacing.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Ionicons name="compass-outline" size={18} color={colors.primary} />
          <Text style={{ flex: 1, fontSize: font.lg, fontFamily: fontFamily.semibold, color: colors.text }}>
            Your path
          </Text>
          {items.length > 0 && (
            <View
              style={{
                backgroundColor: colors.primarySoft, borderRadius: radius.pill,
                paddingHorizontal: spacing.sm, paddingVertical: 2,
              }}
              testID="path-count"
            >
              <Text style={{ fontSize: font.xs, fontFamily: fontFamily.semibold, color: colors.primary }}>
                {items.length}
              </Text>
            </View>
          )}
        </View>

        {isLoading ? (
          <Loading />
        ) : items.length === 0 ? (
          /*
           * Nothing waiting means one of two things — no project yet, or every
           * path finished — and both are answered the same way: start one.
           */
          <View
            style={{
              borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg,
              padding: spacing.lg, gap: spacing.md, alignItems: "center",
            }}
            testID="path-empty"
          >
            <Text style={{ fontFamily: fontFamily.semibold, color: colors.text, textAlign: "center" }}>
              Nothing waiting on a path right now.
            </Text>
            <Body style={{ color: colors.textSecondary, textAlign: "center" }}>
              A project's path is the sequence Nova works out with you — one step at a time, each with
              something to show at the end of it.
            </Body>
            <Btn
              label="Start a project"
              onPress={() => router.push("/project/new")}
              testID="button-path-new-project"
            />
          </View>
        ) : (
          <ContinuePathCard heading={false} onNotice={show} />
        )}
      </ScrollView>
    </>
  );
}
