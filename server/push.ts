/**
 * Sending a notification to a phone that isn't open.
 *
 * Everything in the bell reaches somebody only while they are looking at it.
 * This is the part that reaches them when they are not — the one thing in
 * SparkTower that interrupts a person — so two rules run through the whole
 * file:
 *
 *  1. **The row is the record; the push is a courtesy.** Nothing here may fail a
 *     request, roll back an insert, or throw into `notify()`. A push that does
 *     not arrive costs a buzz. A push that takes a transaction down with it
 *     costs the notification, and whatever else was in that request.
 *  2. **An address that stopped working has to be forgotten.** A push token
 *     belongs to an installation, and an uninstalled app never says so — it is
 *     reported once, asynchronously, and if nobody reads that report the table
 *     fills with addresses pointing nowhere and every send gets slower and
 *     noisier for good. Reading it is `sweepPushReceipts`, below.
 *
 * ## Why this talks to Expo over `fetch` rather than with `expo-server-sdk`
 *
 * The SDK's job is chunking at 100, gzip, and a token-shaped regex. That is a
 * dependency in the server for thirty lines, and the part that actually needs
 * care — deciding what `DeviceNotRegistered` means and making sure somebody
 * reads the receipts — it does not do for you. The HTTP API is two endpoints
 * and is versioned in its path.
 */
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { db } from "./db";
import { pushReceipts, pushTokens, users } from "@shared/schema";
import { JOB, withJobLock } from "./job-lock";

const SEND_URL = "https://exp.host/--/api/v2/push/send";
const RECEIPTS_URL = "https://exp.host/--/api/v2/push/getPushNotificationReceipts";

/** Expo's documented maximum messages per request, and per receipt lookup. */
const CHUNK = 100;

/**
 * Expo accepts anonymous sends unless a project turns on push security, in
 * which case it wants this. Absent is the normal case and not a problem; it is
 * in the env contract as `degraded` so a server that *has* turned security on
 * is told what is missing rather than watching every send fail with a 400.
 */
const accessToken = () => process.env.EXPO_ACCESS_TOKEN?.trim() || null;

/**
 * The brake. `PUSH_DISABLED=1` and nothing leaves the building.
 *
 * Read per call rather than at import, the same way the AI spend ceiling is, so
 * an operator can stop every push without a rebuild — and so a test can switch
 * it off and know no HTTP is attempted. Push is the one thing here that
 * interrupts people at scale, and the first launch day where something goes
 * wrong is not the moment to discover there is no way to stop it. The rows keep
 * being written either way: the bell is unaffected.
 */
const pushDisabled = () => {
  const flag = process.env.PUSH_DISABLED?.trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
};

export interface PushMessage {
  title: string;
  body: string;
  /** Rides along to the app, which uses `href` to decide where a tap lands. */
  data?: Record<string, string | null>;
}

/**
 * The shape of an address, checked before it is stored.
 *
 * Not security — a push token is an address, not a credential — but a typo or a
 * device that handed back something unexpected would otherwise sit in the table
 * and be rejected on every send for ever.
 */
export const isExpoPushToken = (value: unknown): value is string =>
  typeof value === "string" && /^Expo(nent)?PushToken\[[^\]]+\]$/.test(value.trim());

const chunk = <T>(items: T[], size = CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/**
 * Remember where to reach one installation.
 *
 * Upserting on the token rather than on (user, token) is the point: the same
 * phone signing in as somebody else arrives with the same token, and this moves
 * it to them. Without that a handed-over or resold phone keeps buzzing with the
 * previous account's notifications — and that is the case sign-out cannot cover
 * on its own, because a session that *expired* never got to say goodbye.
 */
export async function registerDevice(input: {
  userId: string;
  token: string;
  platform: "ios" | "android";
  device?: string | null;
}): Promise<void> {
  if (!isExpoPushToken(input.token)) throw new Error("not an Expo push token");
  const now = new Date();
  await db.insert(pushTokens)
    .values({
      userId: input.userId, token: input.token.trim(), platform: input.platform,
      device: input.device ?? null, lastSeenAt: now, createdAt: now,
    })
    .onConflictDoUpdate({
      target: pushTokens.token,
      set: { userId: input.userId, platform: input.platform, device: input.device ?? null, lastSeenAt: now },
    });
}

/** Sign-out, from this device only. The person's other phones keep working. */
export async function forgetDevice(input: { userId: string; token: string }): Promise<void> {
  await db.delete(pushTokens).where(and(
    eq(pushTokens.token, input.token.trim()),
    /*
     * Scoped to the owner so one person cannot unsubscribe another's device by
     * posting a token they happened to learn. Harmless if it does not match.
     */
    eq(pushTokens.userId, input.userId),
  ));
}

/** Every address for these people, skipping anyone who has turned push off. */
async function addressesFor(userIds: string[]): Promise<{ token: string }[]> {
  if (!userIds.length) return [];
  return db.select({ token: pushTokens.token })
    .from(pushTokens)
    .innerJoin(users, eq(users.id, pushTokens.userId))
    .where(and(
      inArray(pushTokens.userId, userIds),
      eq(users.pushEnabled, true),
      /*
       * A suspended or closed account's phone stops buzzing. The bell already
       * hides rows whose *actor* was suspended; this is the other side of it,
       * and without it a suspended account goes on being pinged about the
       * place it was suspended from.
       */
      isNull(users.suspendedAt),
      isNull(users.deletedAt),
    ));
}

/**
 * Hand a batch to Expo and write down the tickets.
 *
 * Returns nothing and throws nothing: every exit is a log. The caller is
 * `notify()`, in a path where the useful work has already been committed.
 */
export async function pushToUsers(
  userIds: string[],
  /*
   * A function, when working out the wording costs something. Most
   * notifications go to people with no phone registered — and the sentence a
   * push needs is not the one the caller already has: it takes the actor's name
   * and the project's title, which are two more queries. Passing a thunk means
   * those are not paid for until somebody is actually going to be buzzed.
   */
  message: PushMessage | (() => Promise<PushMessage | null>),
): Promise<void> {
  try {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (!unique.length) return;
    if (pushDisabled()) return;
    const rows = await addressesFor(unique);
    if (!rows.length) return;

    const built = typeof message === "function" ? await message() : message;
    if (!built) return;

    for (const batch of chunk(rows.map((r) => r.token))) {
      await sendBatch(batch, built);
    }
  } catch (err) {
    console.error("[push] couldn't send (non-fatal):", err);
  }
}

async function sendBatch(tokens: string[], message: PushMessage): Promise<void> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  const key = accessToken();
  if (key) headers.authorization = `Bearer ${key}`;

  const response = await fetch(SEND_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(tokens.map((to) => ({
      to,
      title: message.title,
      body: message.body,
      data: message.data ?? {},
      sound: "default",
      /*
       * Collapse to one line in the tray rather than stacking: somebody who
       * has been away for a day should find a notification, not forty.
       */
      _displayInForeground: false,
    }))),
    /* Expo is a courtesy, not a dependency; it does not get to hold a request. */
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    console.error(`[push] Expo refused a batch of ${tokens.length}: ${response.status} ${await response.text().catch(() => "")}`);
    return;
  }

  const answer = await response.json().catch(() => null) as { data?: unknown[] } | null;
  const tickets = Array.isArray(answer?.data) ? answer!.data : [];
  const accepted: { id: string; token: string }[] = [];
  const dead: string[] = [];

  tickets.forEach((ticket, i) => {
    const t = ticket as { status?: string; id?: string; details?: { error?: string } };
    const token = tokens[i];
    if (t?.status === "ok" && typeof t.id === "string") {
      accepted.push({ id: t.id, token });
      return;
    }
    /*
     * The one error worth acting on immediately. The rest — a rate limit, a
     * message too big, Expo having a bad minute — are about this send, not
     * about the address, and deleting a token over one would quietly
     * unsubscribe somebody.
     */
    if (t?.details?.error === "DeviceNotRegistered") dead.push(token);
    else console.error("[push] ticket not ok:", JSON.stringify(ticket));
  });

  if (dead.length) await dropTokens(dead);
  if (accepted.length) {
    await db.insert(pushReceipts)
      .values(accepted.map((a) => ({ id: a.id, token: a.token, createdAt: new Date() })))
      .onConflictDoNothing();
  }
}

async function dropTokens(tokens: string[]): Promise<void> {
  try {
    await db.delete(pushTokens).where(inArray(pushTokens.token, tokens));
    console.log(`[push] forgot ${tokens.length} address(es) Expo says are gone`);
  } catch (err) {
    console.error("[push] couldn't drop dead addresses (non-fatal):", err);
  }
}

/**
 * How long a ticket waits before its receipt is worth asking about.
 *
 * Expo's own guidance is to leave at least fifteen minutes: Apple and Google
 * report asynchronously, and asking immediately gets back a receipt that says
 * nothing yet. Receipts live about a day, so this has to run comfortably
 * inside that.
 */
const RECEIPT_DELAY_MS = 15 * 60_000;

/** Older than Expo keeps them. Nothing can be learnt, so stop carrying them. */
const RECEIPT_EXPIRY_MS = 24 * 60 * 60_000;

/**
 * Read what became of the pushes sent a while ago, and forget dead addresses.
 *
 * This is the step that gets skipped. Without it `DeviceNotRegistered` is never
 * seen — it mostly arrives *here*, not in the ticket — and the table keeps
 * every address of every app that was ever deleted.
 */
export async function sweepPushReceipts(now = new Date()): Promise<{ checked: number; dropped: number }> {
  let checked = 0;
  let dropped = 0;
  try {
    /*
     * With the brake on there is nothing in flight worth asking about, and the
     * expiry delete below would throw away tickets from before it was pulled.
     */
    if (pushDisabled()) return { checked: 0, dropped: 0 };
    /* Too old to be answered: Expo has forgotten them, so we do too. */
    await db.delete(pushReceipts).where(lt(pushReceipts.createdAt, new Date(now.getTime() - RECEIPT_EXPIRY_MS)));

    const due = await db.select().from(pushReceipts)
      .where(lt(pushReceipts.createdAt, new Date(now.getTime() - RECEIPT_DELAY_MS)))
      .limit(1000);
    if (!due.length) return { checked: 0, dropped: 0 };

    const byId = new Map(due.map((r) => [r.id, r.token]));
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
    const key = accessToken();
    if (key) headers.authorization = `Bearer ${key}`;

    for (const batch of chunk(due.map((r) => r.id))) {
      const response = await fetch(RECEIPTS_URL, {
        method: "POST", headers,
        body: JSON.stringify({ ids: batch }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        console.error(`[push] receipts refused: ${response.status}`);
        continue;
      }
      const answer = await response.json().catch(() => null) as { data?: Record<string, { status?: string; details?: { error?: string } }> } | null;
      const receipts = answer?.data ?? {};
      const dead: string[] = [];
      for (const [id, receipt] of Object.entries(receipts)) {
        checked++;
        if (receipt?.status === "error" && receipt.details?.error === "DeviceNotRegistered") {
          const token = byId.get(id);
          if (token) dead.push(token);
        } else if (receipt?.status === "error") {
          console.error(`[push] delivery failed (${receipt.details?.error ?? "unknown"})`);
        }
      }
      if (dead.length) {
        await dropTokens(dead);
        dropped += dead.length;
      }
      /*
       * Answered ones are done with, whatever they said. A receipt Expo has no
       * answer for yet is simply absent from `data`, and stays for next time.
       */
      const answered = Object.keys(receipts);
      if (answered.length) await db.delete(pushReceipts).where(inArray(pushReceipts.id, answered));
    }
  } catch (err) {
    console.error("[push] receipt sweep failed (non-fatal):", err);
  }
  return { checked, dropped };
}

/**
 * Reading the receipts, every ten minutes, on one instance.
 *
 * Ten rather than fifteen because a ticket only becomes *eligible* at fifteen
 * minutes old (RECEIPT_DELAY_MS) and this picks up whatever has crossed that
 * line since it last looked; a slower tick would leave tickets waiting most of
 * an hour for no benefit. Receipts expire in about a day, so there is a wide
 * margin either way.
 *
 * Behind the leader lock for the usual reason — every setInterval in this
 * directory runs in every web process — though this is one of the harmless
 * ones: asking Expo twice about the same ticket is wasted work, not a double
 * charge, and the delete is idempotent.
 */
export function startPushJobs(): void {
  const sweep = () => void withJobLock(JOB.pushReceipts, () => sweepPushReceipts())
    .catch((err) => console.error("[push] receipt job failed:", err));
  setTimeout(sweep, 4 * 60_000).unref();
  setInterval(sweep, 10 * 60_000).unref();
}
