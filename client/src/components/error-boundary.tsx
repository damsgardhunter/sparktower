/**
 * What the person sees when a screen throws.
 *
 * ## What happened before this existed
 *
 * Nothing caught anything. `main.tsx` rendered `<App />` bare, and React
 * unmounts the entire tree when a render throws — so one bad value anywhere,
 * on any screen, replaced the whole product with a permanently blank white
 * page. No message, no navigation, no way back except knowing to reload. And
 * because nothing reported it, the first anybody would hear is a customer
 * saying "the site broke", with no idea which screen or what they were doing.
 *
 * The shapes that cause it are already in this codebase: a `data.things.map()`
 * where the server sent a payload without `things`, a date that parsed to
 * `Invalid Date`, a `.toLowerCase()` on a null. None of those are exotic and
 * none of them should cost somebody their session.
 *
 * ## Two levels, on purpose
 *
 * The app is wrapped, and so is each route. A route-level boundary means a
 * broken screen loses *that screen* — the sidebar, the nav and the rest of the
 * product keep working, and one click gets you somewhere else. The outer one
 * is the backstop for a throw in the shell itself, where there is nothing left
 * to navigate with.
 *
 * ## Try again, before reload
 *
 * Most render throws are a bad *value*, not a bad build: the query refetches,
 * the payload is fine the second time, and remounting the subtree fixes it
 * without losing the page. So the first button re-renders, and reloading is
 * offered second, for when it doesn't.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
  /** Named so a report says which part of the app went, not just that something did. */
  where?: string;
  /** A compact fallback for a boundary inside a page, rather than around one. */
  compact?: boolean;
}
interface State { error: Error | null }

/**
 * Tell the server, so somebody hears about it without a customer writing in.
 *
 * Deliberately thin and deliberately quiet: the message, the component stack
 * and the route pattern, and a failure to report is swallowed. A boundary that
 * throws while handling a throw takes the page down a second time, which is
 * the one outcome worse than the first.
 */
function report(error: Error, info: ErrorInfo, where: string | undefined) {
  try {
    void fetch("/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      // The page may be navigating away; this must not hold it up.
      keepalive: true,
      body: JSON.stringify({
        message: String(error?.message ?? error).slice(0, 500),
        stack: String(error?.stack ?? "").slice(0, 4000),
        componentStack: String(info?.componentStack ?? "").slice(0, 2000),
        where: where ?? null,
        /*
         * The path only, never the query string: a reset token, an invite code
         * and a search someone typed all live there, and this is the one
         * payload on its way off the machine.
         */
        path: typeof window !== "undefined" ? window.location.pathname : null,
      }),
    }).catch(() => {});
  } catch { /* reporting must never be the second failure */ }
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Still logged, so it is in the console of whoever is looking at the tab.
    console.error("[ui] a screen threw:", error, info?.componentStack);
    report(error, info, this.props.where);
  }

  private retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.compact) {
      return (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm" data-testid="error-boundary-compact">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            This part didn't load
          </p>
          <p className="mt-1 text-muted-foreground">The rest of the page is fine. Try it again, or come back to it.</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={this.retry} data-testid="button-error-retry">
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />Try again
          </Button>
        </div>
      );
    }

    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6" data-testid="error-boundary">
        <div className="w-full max-w-md space-y-4 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-5 w-5 text-destructive" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-lg font-semibold">This screen stopped working</h1>
            <p className="text-sm text-muted-foreground">
              Nothing you did caused it and nothing you were working on is lost. It's been reported.
            </p>
          </div>
          <div className="flex justify-center gap-2">
            <Button onClick={this.retry} data-testid="button-error-retry">
              <RotateCcw className="mr-1.5 h-4 w-4" />Try again
            </Button>
            <Button variant="outline" onClick={() => window.location.reload()} data-testid="button-error-reload">
              <RefreshCw className="mr-1.5 h-4 w-4" />Reload
            </Button>
          </div>
          {/*
            * The error itself, in development only. In production it is noise
            * to the person reading it and a hint to anybody else — the stack
            * names files and, sometimes, what was in them.
            */}
          {import.meta.env.DEV && (
            <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 text-left text-[11px] leading-relaxed">
              {error.message}
              {"\n\n"}
              {error.stack}
            </pre>
          )}
        </div>
      </div>
    );
  }
}
