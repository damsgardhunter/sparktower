-- How much of each prompt the provider served from its cache. Without it,
-- "is caching working" is a belief rather than a query.
ALTER TABLE "ai_spend" ADD COLUMN IF NOT EXISTS "cached_tokens" integer;
