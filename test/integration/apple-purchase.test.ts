/**
 * Money arriving from the App Store.
 *
 * A coverage read found 37 API paths no test file names, and this was the one
 * that moves money. `POST /api/nova/apple-purchase` takes a signed receipt and
 * credits a balance, so every way it can be wrong is either a customer paying
 * and getting nothing or somebody getting a balance they did not pay for.
 *
 * The properties worth holding it to are the ones the route's own comment
 * names, and not one of them was checked by anything:
 *
 *   - the price comes from `APPLE_PRODUCTS` keyed by the *verified* product id,
 *     never from the request, so a client cannot name its own price;
 *   - the transaction id is the idempotency key, because Apple re-delivers
 *     unfinished transactions and StoreKit replays them on reinstall — a
 *     replay must credit once;
 *   - that key is namespaced `apple:`, because it shares a column with
 *     Stripe's session ids and two payment systems must never collide on the
 *     thing that decides whether somebody's money was credited;
 *   - a receipt that is genuinely signed by Apple but belongs to another app
 *     is refused.
 *
 * Apple's verifier is mocked, because the alternative is a real signing key and
 * a sandbox account in CI. What is mocked is only the signature check: the
 * bundle check, the product lookup, the idempotency and the crediting are the
 * route's own and run for real against the database.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";

/** What the fake verifier will say the receipt contains. Set per test. */
let decoded: any = {};
/** Or, when set, what it throws instead — an unverifiable receipt. */
let verifyThrows: Error | null = null;

/*
 * Apple's root certificates are not in the repository — `server/apple-certs`
 * holds a README and nothing else — so `verifier()` returns null on any
 * checkout and the route answers 503 `iap_unconfigured`. That is deliberate and
 * it is the right way round: missing certificates turn the feature off rather
 * than open. It also means the money path cannot be reached in a test without a
 * seam, so this fakes the directory and only that directory: every other path
 * goes to the real filesystem, because the app under test reads plenty of them.
 *
 * The bytes do not matter. The verifier that would inspect them is mocked
 * below; what is being tested is what the route does with a payload, not
 * Apple's signature maths.
 */
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  const isCerts = (p: unknown) => String(p).includes("apple-certs");
  const readdirSync = (p: any, ...rest: any[]) => (isCerts(p) ? (["AppleRootCA-G3.cer"] as any) : (real.readdirSync as any)(p, ...rest));
  const readFileSync = (p: any, ...rest: any[]) => (isCerts(p) ? Buffer.from("not a real certificate") : (real.readFileSync as any)(p, ...rest));
  return { ...real, readdirSync, readFileSync, default: { ...real, readdirSync, readFileSync } };
});

vi.mock("@apple/app-store-server-library", () => ({
  Environment: { Production: "Production", Sandbox: "Sandbox" },
  SignedDataVerifier: class {
    async verifyAndDecodeTransaction(_signed: string) {
      if (verifyThrows) throw verifyThrows;
      return decoded;
    }
  },
}));

const { getTestApp, closeTestApp } = await import("../helpers/app");
const { verifyEmail } = await import("../helpers/verify-email");
const { db } = await import("../../server/db");
const { users } = await import("@shared/schema");

const BUNDLE = "com.sparktower.app";
const savedBundle = process.env.APPLE_BUNDLE_ID;
beforeAll(() => { process.env.APPLE_BUNDLE_ID = BUNDLE; });
afterAll(async () => {
  if (savedBundle === undefined) delete process.env.APPLE_BUNDLE_ID;
  else process.env.APPLE_BUNDLE_ID = savedBundle;
  await closeTestApp();
});

let n = 0;
async function buyer(app: any) {
  n += 1;
  const agent = request.agent(app);
  const email = `iap-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.214.${(n % 200) + 20}`)
    .send({ email, password: "a-good-passphrase-here", firstName: `B${n}` });
  expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
  await verifyEmail(app, email);
  return { agent, id: res.body.id as string };
}

const balanceOf = async (userId: string) => {
  const [row] = await db.select({ cents: users.balanceCents }).from(users).where(eq(users.id, userId));
  return row?.cents ?? 0;
};

/** A receipt Apple would vouch for, for this app, for something we sell. */
const goodReceipt = (transactionId: string, productId = "com.sparktower.topup.500") => ({
  bundleId: BUNDLE, productId, transactionId,
});

describe("a purchase made in the App Store", () => {
  it("credits the price of the product, once, however many times the receipt arrives", async () => {
    const app = await getTestApp();
    const me = await buyer(app);
    verifyThrows = null;
    decoded = goodReceipt(`txn-${Date.now()}-a`);

    const before = await balanceOf(me.id);
    const first = await me.agent.post("/api/nova/apple-purchase").send({ signedTransaction: "signed-blob" });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.credited, "the first delivery is the purchase").toBe(true);
    expect(await balanceOf(me.id)).toBe(before + 500);

    /*
     * The same receipt again. Apple re-delivers unfinished transactions and
     * StoreKit replays them on reinstall, so this is the ordinary case rather
     * than an attack — and it must not pay twice.
     */
    const again = await me.agent.post("/api/nova/apple-purchase").send({ signedTransaction: "signed-blob" });
    expect(again.status).toBe(200);
    expect(again.body.credited, "a replay is not a second purchase").toBe(false);
    expect(await balanceOf(me.id), "and the balance did not move").toBe(before + 500);
  }, 120_000);

  /*
   * The price is the product's, not the caller's. A body that names an amount
   * must be ignored — the client naming its own price is the whole reason the
   * lookup is keyed on the verified payload.
   */
  it("takes the price from the verified product, not from anything the caller sent", async () => {
    const app = await getTestApp();
    const me = await buyer(app);
    verifyThrows = null;
    decoded = goodReceipt(`txn-${Date.now()}-b`, "com.sparktower.topup.1000");

    const before = await balanceOf(me.id);
    const res = await me.agent.post("/api/nova/apple-purchase")
      .send({ signedTransaction: "signed-blob", cents: 50_000, amountCents: 50_000, productId: "com.sparktower.topup.2000" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await balanceOf(me.id), "£10 of product, whatever the body asked for").toBe(before + 1000);
  }, 120_000);

  it("refuses a receipt that is signed for another app", async () => {
    const app = await getTestApp();
    const me = await buyer(app);
    verifyThrows = null;
    decoded = { ...goodReceipt(`txn-${Date.now()}-c`), bundleId: "com.someone.else" };

    const before = await balanceOf(me.id);
    const res = await me.agent.post("/api/nova/apple-purchase").send({ signedTransaction: "signed-blob" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("bad_receipt");
    expect(await balanceOf(me.id), "nothing was credited").toBe(before);
  }, 120_000);

  it("refuses a product this app does not sell", async () => {
    const app = await getTestApp();
    const me = await buyer(app);
    verifyThrows = null;
    decoded = goodReceipt(`txn-${Date.now()}-d`, "com.sparktower.topup.999999");

    const before = await balanceOf(me.id);
    const res = await me.agent.post("/api/nova/apple-purchase").send({ signedTransaction: "signed-blob" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("unknown_product");
    expect(await balanceOf(me.id)).toBe(before);
  }, 120_000);

  it("refuses a receipt Apple will not vouch for, and one that is missing", async () => {
    const app = await getTestApp();
    const me = await buyer(app);
    const before = await balanceOf(me.id);

    verifyThrows = new Error("certificate chain did not verify");
    decoded = {};
    const bad = await me.agent.post("/api/nova/apple-purchase").send({ signedTransaction: "not-really-signed" });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("bad_receipt");

    verifyThrows = null;
    const missing = await me.agent.post("/api/nova/apple-purchase").send({});
    expect(missing.status).toBe(400);

    expect(await balanceOf(me.id), "neither refusal credited anything").toBe(before);
  }, 120_000);

  /*
   * A transaction with no id has nothing to be idempotent on, so it is refused
   * rather than credited on a key of "apple:undefined" — which would pay once
   * and then silently refuse every later purchase that also lacked an id.
   */
  it("refuses a receipt with no transaction id, rather than crediting one without a key", async () => {
    const app = await getTestApp();
    const me = await buyer(app);
    verifyThrows = null;
    decoded = { bundleId: BUNDLE, productId: "com.sparktower.topup.500" };

    const before = await balanceOf(me.id);
    const res = await me.agent.post("/api/nova/apple-purchase").send({ signedTransaction: "signed-blob" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("bad_receipt");
    expect(await balanceOf(me.id)).toBe(before);
  }, 120_000);

  /*
   * The reason the key is namespaced, tested rather than trusted.
   *
   * `creditTopUp` keys on a shared column: Stripe writes its checkout session
   * ids there and Apple writes its transaction ids. If Apple's went in bare, a
   * transaction id that happened to equal a session id already used would be
   * read as "already credited" and the customer would pay and get nothing.
   *
   * Contrived on purpose. The two id spaces are not supposed to overlap, which
   * is exactly why nothing would notice if the namespace were dropped — the
   * bug would wait for a coincidence and then look like a support ticket about
   * one missing top-up.
   */
  it("does not collide with a Stripe session id that happens to match", async () => {
    const app = await getTestApp();
    const me = await buyer(app);
    const shared = `cs_test_collide_${Date.now()}`;

    /* Stripe's side first, on the bare id, as the webhook credits it. */
    const { creditTopUp } = await import("../../server/wallet");
    const viaStripe = await creditTopUp(me.id, 2000, shared, "Added to your balance (card)");
    expect(viaStripe.credited).toBe(true);
    const afterStripe = await balanceOf(me.id);

    /* Then Apple's, with a transaction id that is the same string. */
    verifyThrows = null;
    decoded = goodReceipt(shared, "com.sparktower.topup.500");
    const res = await me.agent.post("/api/nova/apple-purchase").send({ signedTransaction: "signed-blob" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.credited, "a different payment system is a different purchase").toBe(true);
    expect(await balanceOf(me.id), "and it was paid on top").toBe(afterStripe + 500);
  }, 120_000);

  it("is not something a signed-out caller can reach", async () => {
    const app = await getTestApp();
    verifyThrows = null;
    decoded = goodReceipt(`txn-${Date.now()}-e`);
    const res = await request(app).post("/api/nova/apple-purchase")
      .set("x-forwarded-for", "198.51.214.240").send({ signedTransaction: "signed-blob" });
    expect(res.status).toBe(401);
  }, 120_000);
});
