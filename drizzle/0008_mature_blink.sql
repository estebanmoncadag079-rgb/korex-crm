CREATE TABLE "learning_proposal" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"evidence" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"kb_entry_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "learning_proposal" ADD CONSTRAINT "learning_proposal_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learning_org_status_idx" ON "learning_proposal" USING btree ("organization_id","status");