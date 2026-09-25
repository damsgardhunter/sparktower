-- What the last audit read for one area, and what it concluded. An area whose
-- files have not changed is not read again.
CREATE TABLE "code_audit_memory" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
	"area" varchar NOT NULL,
	"fingerprint" varchar NOT NULL,
	"detail" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "code_audit_memory_area" UNIQUE("project_id","area")
);
