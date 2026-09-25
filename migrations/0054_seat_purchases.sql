CREATE TABLE "sim_seat_purchases" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"seats" integer NOT NULL,
	"amount" integer NOT NULL,
	"stripe_session_id" text NOT NULL,
	"bought_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sim_seat_purchases_session" UNIQUE("stripe_session_id")
);
--> statement-breakpoint
ALTER TABLE "sim_seat_purchases" ADD CONSTRAINT "sim_seat_purchases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_seat_purchases" ADD CONSTRAINT "sim_seat_purchases_bought_by_users_id_fk" FOREIGN KEY ("bought_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sim_seat_purchases_company_idx" ON "sim_seat_purchases" USING btree ("company_id","created_at");