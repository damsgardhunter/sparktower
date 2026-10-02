/**
 * Being told something when the app is shut.
 *
 * Everything in the bell reaches somebody only while they are looking at it.
 * This is the other half: the server's side is `server/push.ts`, and between
 * them the rule is that the notification row is the record and the push is a
 * courtesy on top of it. Nothing here may stop the app working — a phone that
 * refuses permission, an emulator with no push support, a network that is down
 * mid-registration all end the same way, with the app behaving exactly as it
 * did before any of this existed.
 *
 * ## When permission is asked for
 *
 * Not on first launch. A dialog that appears before somebody knows what the app
 * is gets dismissed, and iOS only lets it be asked once — a "no" there is
 * permanent until they find it in Settings, which they will not. So:
 *
 *  - Already granted (a reinstall, or they said yes earlier): register silently
 *    on every launch, because the token can be reissued and a stale one is an
 *    address that reaches nobody.
 *  - Not asked yet: nothing happens until they tap the card on the
 *    Notifications tab, which is the one screen where the offer makes sense —
 *    they are looking at the list of things they would have been told about.
 *  - Refused: never asked again from here. `openSettings` is the only way back
 *    and the card says so.
 */
import { Linking, Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { api, deviceLabel, readPref, writePref } from "./api/client";

/** Where the last registered address is kept, so sign-out can say goodbye. */
const TOKEN_KEY = "push.token";

/**
 * A foreground notification still shows.
 *
 * Without this the OS hands a notification to the app while it is open and the
 * app, having no handler, swallows it: somebody watching the screen sees
 * nothing, which reads as the feature being broken rather than as a deliberate
 * choice. The banner is the honest default — the bell's badge updates on the
 * next refetch either way.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Expo needs to be told which project a token is for.
 *
 * In a development build this comes from app.json's `extra.eas.projectId`; it
 * is the one piece of configuration without which `getExpoPushTokenAsync`
 * cannot work at all, so its absence is reported rather than retried.
 */
function projectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? null;
}

/**
 * Android shows nothing without a channel.
 *
 * On Android 8 and later a notification with no channel is dropped by the OS,
 * silently, and the send looks successful from every other angle. Created
 * before any token is asked for, because it is cheap and the failure it
 * prevents is invisible.
 */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("default", {
    name: "Notifications",
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: "#9745B5",
  });
}

export type PushPermission = "granted" | "denied" | "undetermined" | "unsupported";

/**
 * Whether this phone could be buzzed, without asking it anything.
 *
 * A simulator cannot: there is no push service behind it, and asking produces a
 * confusing error rather than a dialog. That is "unsupported" and the card that
 * reads this stays hidden, rather than offering something that cannot work.
 */
export async function pushPermission(): Promise<PushPermission> {
  if (!Device.isDevice) return "unsupported";
  try {
    const { status, canAskAgain } = await Notifications.getPermissionsAsync();
    if (status === "granted") return "granted";
    if (status === "undetermined" || canAskAgain) return "undetermined";
    return "denied";
  } catch {
    return "unsupported";
  }
}

/**
 * Tell the server where to reach this installation.
 *
 * Called on every launch when permission is already held, because an Expo push
 * token is not forever: a restored backup or a reinstall can change it, and the
 * old one then points at nothing. The server upserts on the token, so repeating
 * this is free and is what keeps `lastSeenAt` honest.
 */
export async function registerForPush(): Promise<boolean> {
  try {
    if (!Device.isDevice) return false;
    const id = projectId();
    if (!id) {
      console.warn("[push] no EAS project id in the app config, so no token can be issued");
      return false;
    }
    await ensureAndroidChannel();
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    if (!token) return false;
    await api("/api/push/token", {
      method: "POST",
      body: {
        token,
        platform: Platform.OS === "ios" ? "ios" : "android",
        device: deviceLabel(),
      },
    });
    await writePref(TOKEN_KEY, token);
    return true;
  } catch (err) {
    /*
     * Logged and swallowed. Push not working is a quieter app; push throwing on
     * launch would be no app at all.
     */
    console.warn("[push] couldn't register:", err);
    return false;
  }
}

/** Ask, then register if they said yes. Only ever called from a tap. */
export async function askForPush(): Promise<PushPermission> {
  try {
    if (!Device.isDevice) return "unsupported";
    await ensureAndroidChannel();
    const { status, canAskAgain } = await Notifications.requestPermissionsAsync();
    if (status === "granted") {
      await registerForPush();
      return "granted";
    }
    return canAskAgain ? "undetermined" : "denied";
  } catch (err) {
    console.warn("[push] couldn't ask:", err);
    return "unsupported";
  }
}

/**
 * Sign-out, for this device.
 *
 * Done *before* the session is dropped, because it needs an authenticated
 * request — and best-effort, because sign-out must not be blocked by it. The
 * backstop for the case this cannot cover is on the server: the token is
 * unique, so whoever next signs in on this phone takes it over. That matters
 * for a session that expired rather than being signed out, which never gets
 * here at all.
 */
export async function forgetPush(): Promise<void> {
  try {
    const token = await readPref(TOKEN_KEY);
    if (!token) return;
    await api("/api/push/token", { method: "DELETE", body: { token } });
  } catch {
    // Signing out is not conditional on the server agreeing.
  } finally {
    await writePref(TOKEN_KEY, null).catch(() => {});
  }
}

/**
 * Open the OS settings page for this app: the only way back from a refusal.
 *
 * React Native's own, not `expo-notifications` — it has no equivalent, and this
 * lands on the app's settings page where the notification switch lives on both
 * platforms.
 */
export const openPushSettings = () => Linking.openSettings().catch(() => {});
