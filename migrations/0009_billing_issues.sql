ALTER TABLE "users" ADD COLUMN "payment_failed_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "payment_failure_message" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "subscription_refunded_at" timestamp;