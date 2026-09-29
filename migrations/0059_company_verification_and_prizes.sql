-- Proving a company is that company, and holding the prize it promises.
--
-- Anyone could create a company called anything and post a challenge under it
-- with a prize that was a sentence in a text box. A builder could spend a
-- fortnight on an entry for a company that did not exist, judged by nobody,
-- for money that was never going to arrive.
--
-- Two halves. `company_verifications` is somebody proving they control a
-- domain — before the company exists, because a company row that exists first
-- is one that can be named "Stripe" and left sitting there. `challenge_prizes`
-- is the safe: the prize comes out of the company's balance when the challenge
-- is posted and sits here until somebody wins it.
--
-- The unique index on companies.verified_domain is the anti-impersonation rule
-- doing most of the work: one domain, one company, enforced by the database
-- rather than by a route anybody could add a second path around.

ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "verified_domain" text;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "verified_at" timestamp;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "verified_method" text;

-- Nulls do not collide in a unique index, so every company that predates
-- verification stays valid and unclaimed.
CREATE UNIQUE INDEX IF NOT EXISTS "companies_verified_domain" ON "companies" ("verified_domain");

CREATE TABLE IF NOT EXISTS "company_verifications" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "domain" text NOT NULL,
  "token" text NOT NULL,
  "method" text,
  "verified_at" timestamp,
  "company_id" varchar REFERENCES "companies"("id") ON DELETE set null,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp NOT NULL
);

CREATE INDEX IF NOT EXISTS "company_verifications_user_idx" ON "company_verifications" ("user_id","created_at");
CREATE INDEX IF NOT EXISTS "company_verifications_domain_idx" ON "company_verifications" ("domain");

CREATE TABLE IF NOT EXISTS "challenge_prizes" (
  "challenge_id" varchar PRIMARY KEY NOT NULL REFERENCES "company_challenges"("id") ON DELETE cascade,
  "company_id" varchar NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "funded_by" varchar REFERENCES "users"("id") ON DELETE set null,
  "amount_cents" integer NOT NULL,
  "fee_cents" integer NOT NULL,
  "state" text DEFAULT 'held' NOT NULL,
  "awarded_to" varchar REFERENCES "users"("id") ON DELETE set null,
  "awarded_at" timestamp,
  "settled_at" timestamp,
  "created_at" timestamp NOT NULL
);

CREATE INDEX IF NOT EXISTS "challenge_prizes_company_idx" ON "challenge_prizes" ("company_id","state");
