ALTER TABLE "companies" DROP CONSTRAINT "companies_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "company_challenges" DROP CONSTRAINT "company_challenges_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "company_follows" DROP CONSTRAINT "company_follows_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "recruit_invites" DROP CONSTRAINT "recruit_invites_sent_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "companies" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "company_challenges" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "company_follows" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recruit_invites" ALTER COLUMN "sent_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "invite_key_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_challenges" ADD CONSTRAINT "company_challenges_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_follows" ADD CONSTRAINT "company_follows_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruit_invites" ADD CONSTRAINT "recruit_invites_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;