/**
 * What the person sees when a screen throws, on the phone.
 *
 * ## What happened before this existed
 *
 * Nothing caught anything, and React unmounts the whole tree when a render
 * throws — so one bad value anywhere replaced the app with a blank screen. On a
 * phone that is worse than on the web, because there is no reload button and no
 * address bar: the only way out is force-quitting the app, which most people will
 * not think to do and some will read as the app being broken for good. And
 * because nothing reported it, the first anybody heard was somebody saying "it
 * closed on me", with no idea which screen.
 *
 * The shapes that cause it are ordinary and already in this codebase: a
 * `data.things.map()` where the payload arrived without `things`, a date that
 * parsed to `Invalid Date`, a `.toLowerCase()` on a null.
 *
 * ## Two levels, as on the web
 *
 * The app is wrapped, and so is each screen. A screen-level boundary means a
 * broken screen loses *that screen* — the tab bar still works and one tap gets
 * you somewhere else. The outer one is the backstop for a throw in the shell,
 * where there is nothing left to navigate with.
 *
 * ## Try again, then go somewhere that works
 *
 * Most render throws are a bad value rather than a bad build: the query
 * refetches, the payload is fine the second time, and remounting the subtree
 * fixes it. So the first button re-renders. The web offers a reload second; a
 * phone has no equivalent, so the second button goes Home instead, which is the
 * thing a person actually wants — out of here, into something that works.
 *
 * The third offers to report it, which is the one thing only they can do: the
 * automatic report carries the stack, and they can say what they were trying to
 * do. See `app/report-problem.tsx`.
 */
import { Component, useEffect, useRef, type ErrorInfo, type ReactNode } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { API_URL } from "../api/client";
import { errorReportBody } from "../errorReport";
import { colors, radius, spacing } from "../theme";
import { Btn } from "./ui";

interface Props {
  children: ReactNode;
  /** Named so a report says which part of the app went, not just that something did. */
  where?: string;
  /** A compact fallback for a boundary inside a screen, rather than around one. */
  compact?: boolean;
}
interface State { error: Error | null }

/**
 * Tell the server, so somebody hears about it without a customer writing in.
 *
 * The same payload the web sends to the same endpoint, which takes no session on
 * purpose — the report most worth having is from a screen that broke before
 * anybody could sign in. Raw `fetch` rather than `api()` deliberately: `api`
 * fetches an access token first, and a boundary that awaits anything that can
 * itself fail is a boundary that can fail while handling a failure. Everything
 * here is swallowed for the same reason.
 */
function report(error: Error, info: ErrorInfo, where: string | undefined) {
  try {
    /*
     * Built in `src/errorReport.ts`, which is pure and tested — including the
     * rule that the query string never leaves the device, where an invite code
     * and a reset token both live.
     */
    void fetch(`${API_URL}/api/client-errors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(errorReportBody(error, info?.componentStack, where, currentRoute())),
    }).catch(() => {});
  } catch { /* reporting must never be the second failure */ }
}

/** Whatever the router thinks the route is, defensively — this runs mid-failure. */
function currentRoute(): unknown {
  try {
    return (router as unknown as { pathname?: string }).pathname;
  } catch {
    return null;
  }
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Still logged, so it is in the Metro output of whoever is looking.
    console.error("[ui] a screen threw:", error, info?.componentStack);
    report(error, info, this.props.where);
  }

  private retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    /*
     * `reported` because `componentDidCatch` has already sent it, and with the
     * component stack, which is the half expo-router's own convention cannot
     * give. Without this the screen would report the same throw twice.
     */
    return <ErrorScreen error={error} retry={this.retry} compact={this.props.compact} reported />;
  }
}

/**
 * The fallback itself, so there is one of it.
 *
 * Used two ways. The class above renders it after catching; and expo-router has
 * its own convention — a route or layout file that exports a component called
 * `ErrorBoundary` gets it wrapped around that segment, called with `{ error,
 * retry }` — which is how a broken tab can lose only itself and keep the tab bar.
 * Both paths have to look the same and report the same, so neither owns the UI.
 *
 * It reports on mount unless told the caller already has. There is no component
 * stack on the expo-router path, which is a real loss and still much better than
 * hearing nothing.
 */
export function ErrorScreen({
  error, retry, compact, where, reported,
}: {
  error: Error;
  retry: () => void;
  compact?: boolean;
  where?: string;
  /** The caller has already sent this one — don't send it twice. */
  reported?: boolean;
}) {
  const sent = useRef(false);
  useEffect(() => {
    if (reported || sent.current) return;
    sent.current = true;
    console.error("[ui] a screen threw:", error);
    report(error, { componentStack: "" } as ErrorInfo, where);
  }, [error, where, reported]);

  /* Clears the error on the way out, so the screen is not still broken on return. */
  const leave = (to: string) => {
    retry();
    try {
      router.replace(to as never);
    } catch { /* nothing left to navigate with; Try again is still there */ }
  };

  if (compact) {
    return (
      <View
        style={{
          borderWidth: 1, borderColor: colors.danger + "4D", borderRadius: radius.md,
          backgroundColor: colors.danger + "14", padding: spacing.md,
        }}
        testID="error-boundary-compact"
      >
        <Text style={{ color: colors.text, fontWeight: "600" }}>This part didn't load</Text>
        <Text style={{ color: colors.textSecondary, marginTop: spacing.xs }}>
          The rest of the screen is fine. Try it again, or come back to it.
        </Text>
        <View style={{ marginTop: spacing.md }}>
          <Btn label="Try again" variant="outline" onPress={retry} testID="button-error-retry" />
        </View>
      </View>
    );
  }

  return (
    <View
      style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg, backgroundColor: colors.background }}
      testID="error-boundary"
    >
      <View style={{ width: "100%", maxWidth: 420, gap: spacing.md }}>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700", textAlign: "center" }}>
          This screen stopped working
        </Text>
        <Text style={{ color: colors.textSecondary, textAlign: "center" }}>
          Nothing you did caused it and nothing you were working on is lost. It's been reported.
        </Text>
        <Btn label="Try again" onPress={retry} testID="button-error-retry" />
        <Btn label="Go home" variant="outline" onPress={() => leave("/(tabs)/feed")} testID="button-error-home" />
        <Btn
          label="Tell us what you were doing"
          variant="ghost"
          onPress={() => leave("/report-problem")}
          testID="button-error-report"
        />
        {/*
          * The error itself, in development only. In a shipped build it is noise
          * to the person reading it and a hint to anybody else — a stack names
          * files and sometimes what was in them.
          */}
        {__DEV__ && (
          <Text
            style={{ color: colors.textTertiary, fontSize: 11, fontFamily: "monospace" }}
            numberOfLines={12}
          >
            {String(error?.message ?? error)}
          </Text>
        )}
      </View>
    </View>
  );
}
