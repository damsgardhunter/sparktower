-- Signing in with Apple, without a second account.
--
-- Apple gives an app a `sub` that is stable for that person in that app and
-- never changes. The email is not a substitute for it: "Hide My Email" hands
-- over a per-app relay address instead of the real one, and even the real one
-- only arrives on the very first authorization — every sign-in after that has
-- the identifier and nothing else. So the identifier is what an account is
-- matched on, exactly as `google_id` is.
--
-- Unique for the obvious reason, and nullable because almost nobody has one:
-- the column is empty for every account that arrived by password or Google.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "apple_id" varchar;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_apple_id_unique" ON "users" ("apple_id");
