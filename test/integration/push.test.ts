/**
 * Sending a notification to a phone, and learning when an address has died.
 *
 * Push is the only thing in SparkTower that reaches somebody who is not using
 * it, and it has two failure modes that are both silent.
 *
 * The first is that it takes a request down with it. The notification row is
 * the record and the push is a courtesy on top, so Expo being slow or angry
 * must cost a buzz and nothing else — not the notification, not the comment
 * that caused it.
 *
 * The second is the one that rots. A push token belongs to an *installation*,
 * and an uninstalled app never announces itself: Expo reports it once, in a
 * receipt, fifteen minutes later, on a different endpoint. If nobody reads that
 * report the table fills with addresses that reach nobody and every send gets
 * slower for ever. So the receipt sweep is tested as carefully as the send.
 *
 * Expo is stubbed. These tests are about what this code does with each answer,
 * and the one thing worth saying about the network is that it is never reached
 * when the brake is on.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../server/db";
import { notifications, pushReceipts, pushTokens, users } from "@shared/schema";
import {
  forgetDevice, isExpoPushToken, pushToUsers, registerDevice, sweepPushReceipts,
} from "../../server/push";
import { notify } from "../../server/notifications";

const addr = (n: number | string) => `ExponentPushToken[test-${n}]`;

async function makeUser(over: Partial<typeof users.$inferInsert> = {}) {
  const [row] = await db.insert(users).values({
    email: `push-${Math.random().toString(36).slice(2)}@example.test`,
    firstName: "Pushy",
    ...over,
  }).returning();
  return row;
}

/** Every call Expo was asked to make, with the bodies, so order can be checked. */
interface Caught { url: string; body: any }

function stubExpo(reply: (url: string, body: any) => { ok?: boolean; status?: number; json?: any }) {
  const calls: Caught[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: any, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), body });
    const answer = reply(String(url), body);
    return {
      ok: answer.ok ?? true,
      status: answer.status ?? 200,
      json: async () => answer.json ?? {},
      text: async () => JSON.stringify(answer.json ?? {}),
    } as any;
  }));
  return calls;
}

/** Expo's happy answer: one ticket per message, in the order they were sent. */
const allAccepted = (body: any) => ({
  json: { data: (body as any[]).map((_, i) => ({ status: "ok", id: `ticket-${i}` })) },
});

beforeEach(() => {
  delete process.env.PUSH_DISABLED;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.PUSH_DISABLED;
});

describe("the shape of an address", () => {
  it("accepts what Expo issues and refuses what it doesn't", () => {
    expect(isExpoPushToken("ExponentPushToken[abc123]")).toBe(true);
    expect(isExpoPushToken("ExpoPushToken[abc123]")).toBe(true);
    /*
     * Not security — a push token is an address, not a credential — but a typo
     * stored here is an address that is rejected on every send for ever.
     */
    expect(isExpoPushToken("abc123")).toBe(false);
    expect(isExpoPushToken("ExponentPushToken[]")).toBe(false);
    expect(isExpoPushToken(null)).toBe(false);
    expect(isExpoPushToken(12345)).toBe(false);
  });
});

describe("remembering where to reach a phone", () => {
  it("keeps one row per installation and refreshes it on every launch", async () => {
    const me = await makeUser();
    await registerDevice({ userId: me.id, token: addr("launch"), platform: "ios", device: "iPhone" });
    const first = await db.select().from(pushTokens).where(eq(pushTokens.token, addr("launch")));
    expect(first).toHaveLength(1);

    /* The app registers on every launch, because the token can be reissued. */
    await registerDevice({ userId: me.id, token: addr("launch"), platform: "ios", device: "iPhone 15" });
    const again = await db.select().from(pushTokens).where(eq(pushTokens.token, addr("launch")));
    expect(again, "a second launch should not make a second row").toHaveLength(1);
    expect(again[0].device).toBe("iPhone 15");
    expect(again[0].lastSeenAt.getTime()).toBeGreaterThanOrEqual(first[0].lastSeenAt.getTime());
  });

  it("moves a handed-over phone to whoever signed in on it", async () => {
    /*
     * The case sign-out cannot cover: a session that *expired* never says
     * goodbye, so the previous account's address is still registered. Because
     * the token is unique and this upserts on it, the next sign-in takes it
     * over — and the first person stops being buzzed on a phone they no longer
     * have.
     */
    const sold = await makeUser();
    const bought = await makeUser();
    await registerDevice({ userId: sold.id, token: addr("sold"), platform: "android" });
    await registerDevice({ userId: bought.id, token: addr("sold"), platform: "android" });

    const rows = await db.select().from(pushTokens).where(eq(pushTokens.token, addr("sold")));
    expect(rows).toHaveLength(1);
    expect(rows[0].userId, "the phone should belong to whoever signed in last").toBe(bought.id);
  });

  it("refuses anything that isn't an Expo token", async () => {
    const me = await makeUser();
    await expect(registerDevice({ userId: me.id, token: "nonsense", platform: "ios" })).rejects.toThrow();
  });

  it("lets somebody forget their own device and nobody else's", async () => {
    const me = await makeUser();
    const them = await makeUser();
    await registerDevice({ userId: them.id, token: addr("theirs"), platform: "ios" });

    /* Posting a token you happened to learn must not unsubscribe its owner. */
    await forgetDevice({ userId: me.id, token: addr("theirs") });
    expect(await db.select().from(pushTokens).where(eq(pushTokens.token, addr("theirs")))).toHaveLength(1);

    await forgetDevice({ userId: them.id, token: addr("theirs") });
    expect(await db.select().from(pushTokens).where(eq(pushTokens.token, addr("theirs")))).toHaveLength(0);
  });
});

describe("sending", () => {
  it("addresses every one of a person's phones", async () => {
    const me = await makeUser();
    await registerDevice({ userId: me.id, token: addr("phone"), platform: "ios" });
    await registerDevice({ userId: me.id, token: addr("tablet"), platform: "ios" });

    const calls = stubExpo((_url, body) => allAccepted(body));
    await pushToUsers([me.id], { title: "Sam replied", body: "have a look" });

    expect(calls).toHaveLength(1);
    expect(calls[0].body.map((m: any) => m.to).sort()).toEqual([addr("phone"), addr("tablet")].sort());
    expect(calls[0].body[0].title).toBe("Sam replied");
    expect(calls[0].body[0].body).toBe("have a look");
  });

  it("says nothing to somebody who turned push off", async () => {
    const quiet = await makeUser({ pushEnabled: false });
    await registerDevice({ userId: quiet.id, token: addr("quiet"), platform: "ios" });

    const calls = stubExpo((_url, body) => allAccepted(body));
    await pushToUsers([quiet.id], { title: "nope", body: "" });

    expect(calls, "the switch is a column on the account, so no phone of theirs is written to").toHaveLength(0);
    /* And the device row stays, so turning it back on needs no reinstall. */
    expect(await db.select().from(pushTokens).where(eq(pushTokens.token, addr("quiet")))).toHaveLength(1);
  });

  it("says nothing to a suspended or closed account", async () => {
    const suspended = await makeUser({ suspendedAt: new Date() });
    const closed = await makeUser({ deletedAt: new Date() });
    await registerDevice({ userId: suspended.id, token: addr("susp"), platform: "ios" });
    await registerDevice({ userId: closed.id, token: addr("closed"), platform: "ios" });

    const calls = stubExpo((_url, body) => allAccepted(body));
    await pushToUsers([suspended.id, closed.id], { title: "nope", body: "" });
    expect(calls).toHaveLength(0);
  });

  it("breaks a big send into Expo's hundred-at-a-time batches", async () => {
    const me = await makeUser();
    for (let i = 0; i < 230; i++) {
      await registerDevice({ userId: me.id, token: addr(`bulk-${i}`), platform: "android" });
    }
    const calls = stubExpo((_url, body) => allAccepted(body));
    await pushToUsers([me.id], { title: "many", body: "" });

    expect(calls.map((c) => c.body.length)).toEqual([100, 100, 30]);
  });

  it("writes down a ticket for each accepted message, so the receipt can be read later", async () => {
    const me = await makeUser();
    await registerDevice({ userId: me.id, token: addr("ticketed"), platform: "ios" });

    stubExpo(() => ({ json: { data: [{ status: "ok", id: "ticket-abc" }] } }));
    await pushToUsers([me.id], { title: "t", body: "" });

    const [receipt] = await db.select().from(pushReceipts).where(eq(pushReceipts.id, "ticket-abc"));
    expect(receipt, "an accepted push with no ticket written down can never be followed up").toBeTruthy();
    expect(receipt.token).toBe(addr("ticketed"));
  });

  it("forgets an address Expo rejects outright", async () => {
    const me = await makeUser();
    await registerDevice({ userId: me.id, token: addr("gone"), platform: "ios" });

    stubExpo(() => ({ json: { data: [{ status: "error", details: { error: "DeviceNotRegistered" } }] } }));
    await pushToUsers([me.id], { title: "t", body: "" });

    expect(await db.select().from(pushTokens).where(eq(pushTokens.token, addr("gone")))).toHaveLength(0);
  });

  it("keeps an address through an error that is about the send, not the device", async () => {
    const me = await makeUser();
    await registerDevice({ userId: me.id, token: addr("ratelimited"), platform: "ios" });

    /*
     * A rate limit, a message too large, Expo having a bad minute: deleting a
     * token over one of these would quietly unsubscribe somebody for good, and
     * nothing would ever say so.
     */
    stubExpo(() => ({ json: { data: [{ status: "error", details: { error: "MessageRateExceeded" } }] } }));
    await pushToUsers([me.id], { title: "t", body: "" });

    expect(await db.select().from(pushTokens).where(eq(pushTokens.token, addr("ratelimited")))).toHaveLength(1);
  });

  it("swallows a refusal from Expo rather than throwing into its caller", async () => {
    const me = await makeUser();
    await registerDevice({ userId: me.id, token: addr("refused"), platform: "ios" });

    stubExpo(() => ({ ok: false, status: 503, json: {} }));
    /* The notification row is already committed. This may not undo anything. */
    await expect(pushToUsers([me.id], { title: "t", body: "" })).resolves.toBeUndefined();
    expect(await db.select().from(pushTokens).where(eq(pushTokens.token, addr("refused")))).toHaveLength(1);
  });

  it("swallows a network failure too", async () => {
    const me = await makeUser();
    await registerDevice({ userId: me.id, token: addr("offline"), platform: "ios" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("getaddrinfo ENOTFOUND"); }));
    await expect(pushToUsers([me.id], { title: "t", body: "" })).resolves.toBeUndefined();
  });

  it("reaches nothing at all with the brake on", async () => {
    const me = await makeUser();
    await registerDevice({ userId: me.id, token: addr("braked"), platform: "ios" });

    process.env.PUSH_DISABLED = "1";
    const calls = stubExpo((_url, body) => allAccepted(body));
    await pushToUsers([me.id], { title: "t", body: "" });

    expect(calls, "PUSH_DISABLED is the off switch; it has to stop the request, not the delivery").toHaveLength(0);
  });

  it("does nothing, and asks nothing, for somebody with no phone registered", async () => {
    const me = await makeUser();
    const calls = stubExpo((_url, body) => allAccepted(body));
    await pushToUsers([me.id], { title: "t", body: "" });
    expect(calls).toHaveLength(0);
  });
});

describe("reading the receipts, which is the step that gets skipped", () => {
  /** A ticket old enough to be worth asking about (the delay is fifteen minutes). */
  const longAgo = () => new Date(Date.now() - 30 * 60_000);

  it("forgets an address whose app was deleted", async () => {
    const me = await makeUser();
    await registerDevice({ userId: me.id, token: addr("uninstalled"), platform: "ios" });
    await db.insert(pushReceipts).values({ id: "r-dead", token: addr("uninstalled"), createdAt: longAgo() });

    stubExpo(() => ({ json: { data: { "r-dead": { status: "error", details: { error: "DeviceNotRegistered" } } } } }));
    const result = await sweepPushReceipts();

    expect(result.dropped).toBe(1);
    expect(
      await db.select().from(pushTokens).where(eq(pushTokens.token, addr("uninstalled"))),
      "this is the only place DeviceNotRegistered usually shows up; miss it and the table never shrinks",
    ).toHaveLength(0);
    expect(await db.select().from(pushReceipts).where(eq(pushReceipts.id, "r-dead"))).toHaveLength(0);
  });

  it("keeps an address whose delivery failed for some other reason", async () => {
    const me = await makeUser();
    await registerDevice({ userId: me.id, token: addr("hiccup"), platform: "ios" });
    await db.insert(pushReceipts).values({ id: "r-hiccup", token: addr("hiccup"), createdAt: longAgo() });

    stubExpo(() => ({ json: { data: { "r-hiccup": { status: "error", details: { error: "MessageTooBig" } } } } }));
    await sweepPushReceipts();

    expect(await db.select().from(pushTokens).where(eq(pushTokens.token, addr("hiccup")))).toHaveLength(1);
    /* Answered, so done with — whatever it said. */
    expect(await db.select().from(pushReceipts).where(eq(pushReceipts.id, "r-hiccup"))).toHaveLength(0);
  });

  it("leaves a ticket Expo has no answer for yet", async () => {
    await db.insert(pushReceipts).values({ id: "r-pending", token: addr("pending"), createdAt: longAgo() });
    /* Expo omits a ticket it cannot answer; it does not report it as ok. */
    stubExpo(() => ({ json: { data: {} } }));
    await sweepPushReceipts();
    expect(
      await db.select().from(pushReceipts).where(eq(pushReceipts.id, "r-pending")),
      "an unanswered ticket has to survive to be asked about again",
    ).toHaveLength(1);
  });

  it("does not ask about a ticket that is too fresh to have an answer", async () => {
    await db.insert(pushReceipts).values({ id: "r-fresh", token: addr("fresh"), createdAt: new Date() });
    const calls = stubExpo(() => ({ json: { data: {} } }));
    await sweepPushReceipts();
    expect(calls, "Apple and Google report asynchronously; asking at once learns nothing").toHaveLength(0);
    expect(await db.select().from(pushReceipts).where(eq(pushReceipts.id, "r-fresh"))).toHaveLength(1);
  });

  it("throws away tickets older than Expo keeps them", async () => {
    const ancient = new Date(Date.now() - 48 * 60 * 60_000);
    await db.insert(pushReceipts).values({ id: "r-ancient", token: addr("ancient"), createdAt: ancient });
    stubExpo(() => ({ json: { data: {} } }));
    await sweepPushReceipts();
    expect(
      await db.select().from(pushReceipts).where(eq(pushReceipts.id, "r-ancient")),
      "nothing can be learnt about it, so carrying it is a leak",
    ).toHaveLength(0);
  });

  it("asks in hundreds, like the send does", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `r-bulk-${i}`);
    await db.insert(pushReceipts).values(ids.map((id) => ({ id, token: addr(`bulk-r-${id}`), createdAt: longAgo() })));
    const calls = stubExpo(() => ({ json: { data: {} } }));
    await sweepPushReceipts();
    const asked = calls.filter((c) => c.url.includes("getPushNotificationReceipts"));
    expect(asked.map((c) => c.body.ids.length)).toEqual([100, 50]);
    await db.delete(pushReceipts).where(inArray(pushReceipts.id, ids));
  });

  it("swallows a refusal rather than letting a job crash a process", async () => {
    await db.insert(pushReceipts).values({ id: "r-err", token: addr("err"), createdAt: longAgo() });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    await expect(sweepPushReceipts()).resolves.toEqual({ checked: 0, dropped: 0 });
  });

  it("asks nothing with the brake on", async () => {
    await db.insert(pushReceipts).values({ id: "r-braked", token: addr("braked-r"), createdAt: longAgo() });
    process.env.PUSH_DISABLED = "1";
    const calls = stubExpo(() => ({ json: { data: {} } }));
    await sweepPushReceipts();
    expect(calls).toHaveLength(0);
    /* And the ticket survives, rather than being expired away while off. */
    expect(await db.select().from(pushReceipts).where(eq(pushReceipts.id, "r-braked"))).toHaveLength(1);
  });
});

describe("which notifications reach a phone", () => {
  /**
   * The hook is one line in `notify()`, after the block filter, and it is the
   * whole of the integration: every one of the forty-odd emitters goes through
   * there, so a notification kind added next month is covered without anybody
   * remembering to cover it.
   *
   * `notify` deliberately does not await the push — the row is the record and
   * Expo must not hold a request — so these wait for it rather than assuming it
   * has happened by the time `notify` returns.
   */
  async function notifyAndCatch(kind: any, over: Record<string, unknown> = {}) {
    const actor = await makeUser({ firstName: "Sam", lastName: "Reed" });
    const me = await makeUser();
    await registerDevice({ userId: me.id, token: addr(`notify-${kind}-${Math.random()}`), platform: "ios" });
    const calls = stubExpo((_url, body) => allAccepted(body));
    await notify({ recipients: [me.id], actorId: actor.id, kind, targetId: "t1", ...over });
    return { calls, me, actor };
  }

  it("pushes a comment, with the sentence the bell uses and what was said", async () => {
    const { calls } = await notifyAndCatch("comment", { excerpt: "this bit needs a rethink" });
    await vi.waitFor(() => expect(calls.length).toBe(1));
    const [message] = calls[0].body;
    /*
     * `notificationText` is shared so the web bell and the mobile inbox say the
     * same thing. A push that paraphrased it would be a third wording of one
     * event — and the excerpt is the body, because "Sam commented on your post"
     * does not tell somebody whether it needs answering now.
     */
    expect(message.title).toBe("Sam Reed commented on your post");
    expect(message.body).toBe("this bit needs a rethink");
  });

  it("carries where to open, so a tap lands on the thing itself", async () => {
    const { calls, actor } = await notifyAndCatch("comment", { postId: "post-9" });
    await vi.waitFor(() => expect(calls.length).toBe(1));
    const [message] = calls[0].body;
    /* The phone turns this into a screen with `appHref`, the inbox's own mapping. */
    expect(message.data.href).toContain("post-9");
    expect(message.data.actorId).toBe(actor.id);
  });

  it("leaves an acknowledgement in the bell and does not buzz anybody", async () => {
    /*
     * A reaction is the clearest case: worth knowing, not worth interrupting
     * somebody for. A product that pushes all of it trains people to turn push
     * off, and then the twenty-two kinds that mattered do not arrive either.
     */
    const { calls, me } = await notifyAndCatch("post_reaction");
    /* Give the unawaited path the same chance to fire that the test above does. */
    await new Promise((r) => setTimeout(r, 150));
    expect(calls).toHaveLength(0);

    /* But the row is there — this is about push, not about the notification. */
    const rows = await db.select().from(notifications).where(eq(notifications.recipientId, me.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("post_reaction");
  });

  it("pushes money, because that is the other thing worth a buzz", async () => {
    const { calls } = await notifyAndCatch("pledge_received");
    await vi.waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0].body[0].title).toContain("Sam Reed");
  });

  it("records the notification even when Expo is down", async () => {
    const actor = await makeUser({ firstName: "Ann" });
    const me = await makeUser();
    await registerDevice({ userId: me.id, token: addr("down"), platform: "ios" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));

    await notify({ recipients: [me.id], actorId: actor.id, kind: "mention", targetId: "t2" });
    await new Promise((r) => setTimeout(r, 150));

    const rows = await db.select().from(notifications).where(eq(notifications.recipientId, me.id));
    expect(rows, "the row is the record; the push is a courtesy on top of it").toHaveLength(1);
  });
});
