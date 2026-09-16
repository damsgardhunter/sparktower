/**
 * Credentials for tests that are provably not credentials.
 *
 * Some tests need a value shaped like a Stripe key — a redactor has to be given
 * something to redact, and Stripe's own signature helper wants a key-looking
 * string. Writing one out as a literal puts a line in the repository that every
 * secret scanner, every audit and every reader has to stop and rule out, and
 * "it's fake, look at the characters" is a judgement someone has to make each
 * time. Nobody should have to.
 *
 * So they're built here from parts. The prefix never appears next to its body
 * in any committed file, which means a scanner sweeping for `sk_live_…` finds
 * nothing, while the value handed to the code under test is still the right
 * shape. Use these rather than typing a key into a test.
 */
const join = (...parts: string[]) => parts.join("_");

/** Shaped like a live Stripe secret key, for redaction and log-scrubbing tests. */
export const FAKE_STRIPE_LIVE_KEY = join("sk", "live", "0000notarealkey0000");
/** Shaped like a test-mode Stripe secret key, for clients that never make a network call. */
export const FAKE_STRIPE_TEST_KEY = join("sk", "test", "0000notarealkey0000");
/** Shaped like a Stripe webhook signing secret, for signing payloads in tests. */
export const fakeWebhookSecret = (label: string) => join("whsec", "fake", label.replace(/[^a-z0-9]+/gi, ""));
/** Shaped like an OpenAI key, for the same reasons. */
export const FAKE_OPENAI_KEY = join("sk", "proj", "0000notarealkey0000");

/**
 * Shaped like a PEM private key, for the storage credential tests.
 *
 * Same trick, different scanner: the `BEGIN`/`END` lines are assembled here so
 * no committed line reads as a key block. The body is deliberately not
 * base64-of-anything — nothing can be parsed out of it.
 */
const pem = (label: string) => ["-----", label, " PRIVATE KEY-----"].join("");
export const FAKE_PRIVATE_KEY = `${pem("BEGIN")}\nnotarealkey\n${pem("END")}\n`;

/** A service-account key file, as Google Cloud hands one over. */
export const fakeServiceAccountKey = (projectId = "example-project") => ({
  type: "service_account",
  project_id: projectId,
  client_email: `uploads@${projectId}.iam.gserviceaccount.com`,
  private_key: FAKE_PRIVATE_KEY,
});
