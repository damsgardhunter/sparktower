/**
 * Registering a signed-in phone, and opening the right screen when one is tapped.
 *
 * Split from `src/push.ts` so that the platform calls stay testable without a
 * router: this file is the part that needs to be inside the app's tree.
 */
import { useEffect, useRef } from "react";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import * as WebBrowser from "expo-web-browser";
import { useQueryClient } from "@tanstack/react-query";
import { appHref, isWebHref, openWebSignedIn } from "../networkData";
import { pushPermission, registerForPush } from "../push";

/** What `server/notifications.ts` puts in a push's `data`. */
interface PushData {
  href?: string;
  actorId?: string;
}

/**
 * Where a tapped notification lands.
 *
 * `appHref` is the inbox's own mapping from the web's URL to a screen here, and
 * reusing it is the point: a tap from the tray and a tap on the row in the bell
 * have to arrive at the same place, and that function is already the one tested
 * against the web's hrefs. A notification about something the phone has no
 * screen for opens the web page, signed in, exactly as the row does.
 */
function useOpenFromPush() {
  const router = useRouter();
  const qc = useQueryClient();

  return (data: PushData | undefined) => {
    /*
     * The badge and the bell are stale the moment a notification arrives, and
     * somebody tapping one is on their way to look at it.
     */
    void qc.invalidateQueries({ queryKey: ["notifications"] });
    const to = appHref(data?.href, data?.actorId ?? "");
    if (isWebHref(to)) void openWebSignedIn(to, (url) => WebBrowser.openBrowserAsync(url)).catch(() => {});
    else router.push(to as any);
  };
}

/**
 * Keep this installation's address current, and act on taps.
 *
 * Registration runs only when permission is already held — asking is a tap on
 * the Notifications tab, never a side effect of launching. It re-runs whenever
 * the signed-in person changes, which is what moves the token from whoever had
 * the phone before to whoever has it now.
 */
export function usePush(userId: string | null | undefined): void {
  const open = useOpenFromPush();
  /*
   * A notification that *launched* the app is delivered once, immediately, and
   * React's effects can run twice in development — so the launch tap is
   * remembered and not followed twice.
   */
  const handledLaunch = useRef(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      if ((await pushPermission()) !== "granted") return;
      if (cancelled) return;
      await registerForPush();
    })();
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;

    /* Tapped while the app was running, or in the background. */
    const tapped = Notifications.addNotificationResponseReceivedListener((response) => {
      open(response.notification.request.content.data as PushData);
    });

    /*
     * Tapped while the app was not running at all. The listener above does not
     * fire for that one — the event happened before it existed — so the launch
     * response is asked for directly.
     */
    void (async () => {
      if (handledLaunch.current) return;
      const last = await Notifications.getLastNotificationResponseAsync();
      if (!last) return;
      handledLaunch.current = true;
      open(last.notification.request.content.data as PushData);
    })();

    return () => tapped.remove();
    // `open` is rebuilt every render; the listener only needs the current one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
}
