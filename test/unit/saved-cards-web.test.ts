/**
 * The web's side of cards on file, read as source.
 *
 * The things worth holding here are not "does the form render" — they are the
 * properties that make this safe to ship: the card number must not pass
 * through this product, the hosted page must stay reachable, and a one-tap
 * payment must not be offered on a card that cannot work.
 */
import { describe, it, expect } from "vitest";
import { readSource, withoutComments } from "../helpers/source-parity";

const cards = withoutComments(readSource("client/src/components/saved-cards.tsx"));
const dialog = withoutComments(readSource("client/src/components/payment-dialog.tsx"));
const pricing = withoutComments(readSource("client/src/pages/pricing.tsx"));
const loader = withoutComments(readSource("client/src/lib/stripe.ts"));

describe("the card number never touches this product", () => {
  it("collects it with Stripe's own element", () => {
    /*
     * PaymentElement posts the card to Stripe directly and hands back a pm_ id.
     * A hand-rolled card input would put the number in this app's memory, its
     * logs and its error reports, and move the platform from PCI SAQ A to SAQ D.
     */
    expect(cards).toMatch(/<PaymentElement \/>/);
    expect(cards).toMatch(/from "@stripe\/react-stripe-js"/);
  });

  it("has no field that could collect a card number itself", () => {
    for (const bad of [/name="cardNumber"/, /autoComplete="cc-number"/, /placeholder="\d{4} ?\d{4}/, /\bcvc\b/i]) {
      expect(cards, `nothing here should ask for a card directly (${bad})`).not.toMatch(bad);
    }
  });

  it("says so where somebody paying can read it", () => {
    expect(pricing).toMatch(/held by Stripe, never by SparkTower/);
  });
});

describe("the publishable key comes from the server", () => {
  it("is fetched rather than baked into the bundle", () => {
    /*
     * A build-time VITE_ variable means a key change needs a rebuild, and lets
     * the client disagree with the server about which mode it is in.
     */
    expect(loader).toMatch(/fetch\("\/api\/stripe\/publishable-key"/);
    expect(loader).not.toMatch(/import\.meta\.env\.VITE_STRIPE/);
  });

  it("loads Stripe.js once", () => {
    /* `loadStripe` injects a script tag; calling it per render adds one each time. */
    expect(loader).toMatch(/let pending/);
    expect(loader).toMatch(/if \(!pending\)/);
  });
});

describe("what the payment dialog offers", () => {
  it("pays with the saved card without leaving the page", () => {
    expect(dialog).toMatch(/"\/api\/wallet\/topup\/saved-card"/);
    /* The one-tap path must not redirect — that is the whole reason it exists. */
    const fn = dialog.slice(dialog.indexOf("const payWithSaved"), dialog.indexOf("const payWithSaved") + 2000);
    expect(fn).not.toMatch(/window\.location\.href/);
  });

  it("replays the request that was refused, instead of closing on them", () => {
    /*
     * The dialog's own rule: a person who pays gets the thing they were trying
     * to do. The hosted flow has to remember across a redirect; this one does
     * not have to, so it must not forget.
     */
    const fn = dialog.slice(dialog.indexOf("const payWithSaved"), dialog.indexOf("// The way back from Stripe"));
    /*
     * Both ways the money can land: the ordinary success, and the one that took
     * a bank challenge first. Counting them is the point — an earlier version
     * of this test looked for one `replay.mutate` and passed with the success
     * path gutted, because the challenge path still had its own.
     */
    const replays = fn.match(/replay\.mutate\(detail\.request\)/g) ?? [];
    expect(replays, "every path that takes money has to replay the request").toHaveLength(2);
  });

  it("finishes a bank challenge in place rather than calling it a decline", () => {
    expect(dialog).toMatch(/code === "authentication_required"/);
    expect(dialog).toMatch(/handleNextAction\(\{ clientSecret/);
    /* And it must not be worded as a card problem. */
    const fn = dialog.slice(dialog.indexOf('code === "authentication_required"'));
    expect(fn.slice(0, 600)).not.toMatch(/didn't go through.*authentication/s);
  });

  it("re-reads the wallet rather than assuming the balance moved", () => {
    /* The server credits on the webhook, so the response is not the balance. */
    expect(dialog).toMatch(/invalidateQueries\(\{ queryKey: \["\/api\/nova\/wallet"\] \}\)/);
  });

  it("keeps the hosted page reachable", () => {
    /*
     * Somebody whose saved card is failing needs a way through that is not the
     * card that is failing.
     */
    expect(dialog).toMatch(/Pay another way/);
    expect(dialog).toMatch(/data-testid="button-topup-checkout"/);
  });

  it("never offers one tap on an expired card", () => {
    expect(dialog).toMatch(/c\.isDefault && !c\.expired/);
    expect(dialog).toMatch(/\.find\(\(c\) => !c\.expired\)/);
  });

  it("locks the buttons while a charge is in flight", () => {
    /* Without this, two taps are two charges — the idempotency key narrows that
     * to a minute, and a disabled button is the half that belongs here. */
    expect(dialog).toMatch(/const busy = .*payWithSaved\.isPending/);
  });
});

describe("managing the cards", () => {
  it("shows an expired card rather than hiding it", () => {
    /*
     * It is still the card they think they are paying with, and a list that
     * dropped it makes "no card saved" a lie.
     */
    expect(cards).toMatch(/c\.expired && " — expired"/);
  });

  it("can set a default and forget one", () => {
    expect(cards).toMatch(/\/api\/payment-methods\/\$\{id\}\/default/);
    expect(cards).toMatch(/"DELETE", `\/api\/payment-methods\/\$\{id\}`/);
  });

  it("says when the server has no Stripe configured, instead of looking broken", () => {
    expect(cards).toMatch(/aren't set up on this server yet/);
  });

  it("is reachable from the page that shows the balance", () => {
    expect(pricing).toMatch(/<SavedCardList onAdd=/);
    expect(pricing).toMatch(/<AddCardForm /);
  });
});
