CREATE TABLE "web_handoff_tokens" (
	"token_hash" varchar PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"mfa" boolean DEFAULT false NOT NULL,
	"next" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "web_handoff_tokens" ADD CONSTRAINT "web_handoff_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "web_handoff_user_idx" ON "web_handoff_tokens" USING btree ("user_id");