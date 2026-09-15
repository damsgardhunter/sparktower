/**
 * Turns off two-factor authentication for one account, for someone who has
 * lost both their phone and their recovery codes. There is deliberately no
 * endpoint for this: a stolen password must not be enough to remove the
 * second factor. Confirm who they are some other way first.
 *
 * It also signs the account out everywhere — web sessions and mobile tokens —
 * so nothing signed in under the old factor survives the reset. Reviewers,
 * admins and the owner are asked to set 2FA up again on their next sign-in.
 *
 *   DATABASE_URL=… npm run mfa:reset -- person@example.com            # show
 *   DATABASE_URL=… npm run mfa:reset -- person@example.com --apply    # reset
 */
import pg from "pg";

const email = process.argv.slice(2).find((a) => !a.startsWith("--"));
const apply = process.argv.includes("--apply");

async function main() {
  if (!email || !process.env.DATABASE_URL) {
    console.error("Usage: DATABASE_URL=… npm run mfa:reset -- <email> [--apply]");
    process.exit(2);
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query("SELECT id, email, platform_role, mfa_enabled_at FROM users WHERE lower(email) = lower($1)", [email]);
    const user = rows[0];
    if (!user) { console.error(`No account for ${email}.`); process.exit(1); }
    console.log(`${user.email} (${user.id}), role ${user.platform_role}: 2FA ${user.mfa_enabled_at ? `on since ${user.mfa_enabled_at.toISOString()}` : "off"}.`);
    if (!user.mfa_enabled_at) return;
    if (!apply) { console.log("Run again with --apply to turn it off and sign the account out everywhere."); return; }
    await client.query("BEGIN");
    await client.query(
      "UPDATE users SET mfa_secret = NULL, mfa_pending_secret = NULL, mfa_enabled_at = NULL, mfa_last_step = NULL, mfa_recovery_codes = NULL, access_tokens_revoked_at = now() WHERE id = $1",
      [user.id],
    );
    await client.query("UPDATE mobile_refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [user.id]);
    await client.query("DELETE FROM sessions WHERE sess -> 'passport' ->> 'user' = $1 OR sess -> 'mfaPending' ->> 'userId' = $1", [user.id]);
    await client.query("COMMIT");
    console.log("2FA turned off, and every session and mobile token for the account revoked.");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
