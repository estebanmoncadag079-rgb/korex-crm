CREATE TABLE "agent_job" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"run_at" timestamp DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_at" timestamp,
	"locked_by" text,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_hit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_job" ADD CONSTRAINT "agent_job_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_job" ADD CONSTRAINT "agent_job_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_job_conv_pendiente_uq" ON "agent_job" USING btree ("conversation_id") WHERE status = 'pendiente';--> statement-breakpoint
CREATE INDEX "agent_job_listos_idx" ON "agent_job" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "agent_job_org_idx" ON "agent_job" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "rate_limit_key_at_idx" ON "rate_limit_hit" USING btree ("key","at");