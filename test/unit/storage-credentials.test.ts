/**
 * Which credentials uploads use, and whether a pasted key survives the paste.
 *
 * The storage client used to authenticate through a sidecar on localhost:1106
 * that exists only inside Replit. Anywhere else the credentials resolved to
 * nothing and every upload failed — and because production deliberately refuses
 * the local-disk fallback, that meant avatars, covers, artifacts and merch
 * renders all failed rather than half-working. This is the resolution that
 * replaced it, pinned, because getting it wrong is invisible until somebody
 * tries to change their picture.
 */
import { describe, it, expect } from "vitest";
import { storageCredentialMode, parseServiceAccountKey } from "../../server/replit_integrations/object_storage/objectStorage";

const env = (over: Record<string, string | undefined>) => over as NodeJS.ProcessEnv;

const KEY = {
  type: "service_account",
  project_id: "sparktower-prod",
  client_email: "uploads@sparktower-prod.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n",
};

describe("which credentials the storage client uses", () => {
  it("prefers an explicit service-account key over everything else", () => {
    expect(storageCredentialMode(env({ GCS_SERVICE_ACCOUNT_KEY: JSON.stringify(KEY) }))).toBe("service-account");
    // Even on Replit: if somebody set a key, they meant it.
    expect(storageCredentialMode(env({ GCS_SERVICE_ACCOUNT_KEY: JSON.stringify(KEY), REPL_ID: "abc" }))).toBe("service-account");
    // An empty string is not a key.
    expect(storageCredentialMode(env({ GCS_SERVICE_ACCOUNT_KEY: "   " }))).toBe("default");
  });

  it("uses the sidecar only when this really is Replit", () => {
    expect(storageCredentialMode(env({ REPL_ID: "abc" }))).toBe("replit-sidecar");
    expect(storageCredentialMode(env({ REPLIT_DEPLOYMENT: "1" }))).toBe("replit-sidecar");
    // A container on any other host: default credentials, not a sidecar that isn't there.
    expect(storageCredentialMode(env({ RENDER: "true" }))).toBe("default");
    expect(storageCredentialMode(env({}))).toBe("default");
  });

  it("takes application default credentials when a key file or project is named", () => {
    expect(storageCredentialMode(env({ GOOGLE_APPLICATION_CREDENTIALS: "/etc/secrets/key.json", REPL_ID: "abc" }))).toBe("default");
    expect(storageCredentialMode(env({ GOOGLE_CLOUD_PROJECT: "sparktower-prod" }))).toBe("default");
  });
});

describe("the service-account key, however it was pasted", () => {
  it("reads raw JSON, base64, and whitespace around either", () => {
    const raw = parseServiceAccountKey(JSON.stringify(KEY));
    expect(raw.client_email).toBe(KEY.client_email);
    expect(parseServiceAccountKey(`\n  ${JSON.stringify(KEY)}  \n`).project_id).toBe("sparktower-prod");
    // Dashboards mangle multi-line values, so base64 is the usual way in.
    expect(parseServiceAccountKey(Buffer.from(JSON.stringify(KEY)).toString("base64")).client_email).toBe(KEY.client_email);
  });

  it("puts the newlines back into a key that arrived escaped", () => {
    // A key pasted through a web form comes back with literal \n instead of newlines,
    // and signing fails with an error about the PEM that names nothing useful.
    const escaped = { ...KEY, private_key: KEY.private_key.replace(/\n/g, "\\n") };
    const parsed = parseServiceAccountKey(JSON.stringify(escaped));
    expect(parsed.private_key).toBe(KEY.private_key);
    expect(parsed.private_key).toContain("\n");
    expect(parsed.private_key).not.toContain("\\n");
  });

  it("says what's wrong rather than handing an unusable key to the client", () => {
    expect(() => parseServiceAccountKey(JSON.stringify({ project_id: "x" }))).toThrow(/client_email or private_key/);
    expect(() => parseServiceAccountKey("not json at all")).toThrow();
  });
});
