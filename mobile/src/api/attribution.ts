/**
 * Where this install came from, held until there's an account to attach it to.
 *
 * The web captures this in a cookie stamped on the visitor's first page. There
 * is no first page in an app — someone taps a link, the store opens, they
 * install, and days later they open the app and sign up. So the app has to
 * catch the URL that opened it and keep it itself.
 *
 * Kept in SecureStore rather than memory because the gap between "opened via a
 * tagged link" and "finished signing up" routinely spans several app launches.
 *
 * First touch, and it never overwrites: the link that first brought someone
 * here is the one that did the work, even if they opened three more before
 * registering.
 */
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";

const KEY = "signup_attribution";

export interface StoredAttribution {
  /** The deep link that opened the app, query string and all. */
  landingUrl?: string;
  /** Where that link was, when the platform tells us. */
  referrer?: string;
}

/**
 * Records the opening link, once.
 *
 * Safe to call on every launch — the existing value wins, so only the first
 * one is ever kept. Never throws: not knowing where someone came from is not a
 * reason to fail to start the app.
 */
export async function captureAttribution(): Promise<void> {
  try {
    if (await SecureStore.getItemAsync(KEY)) return;

    const url = await Linking.getInitialURL();
    if (!url) return;

    // Only worth storing if the link actually carries something.
    if (!url.includes("?")) return;

    const value: StoredAttribution = { landingUrl: url.slice(0, 500) };
    await SecureStore.setItemAsync(KEY, JSON.stringify(value));
  } catch {
    /* never surfaces */
  }
}

/** What to send with a registration, if anything was captured. */
export async function pendingAttribution(): Promise<StoredAttribution | undefined> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as StoredAttribution;
    return parsed?.landingUrl || parsed?.referrer ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Forgets it, once an account has been stamped with it.
 *
 * Attribution belongs to the first account created on this install; leaving it
 * behind would attribute a second, unrelated signup on a shared device to a
 * link that had nothing to do with them.
 */
export async function clearAttribution(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    /* never surfaces */
  }
}
