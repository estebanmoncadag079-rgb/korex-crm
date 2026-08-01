CREATE TABLE "appointment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"service_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"duration_min" integer NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_service" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"service_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN "appointments_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_staff_id_staff_member_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service" ADD CONSTRAINT "service_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_member" ADD CONSTRAINT "staff_member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_service" ADD CONSTRAINT "staff_service_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_service" ADD CONSTRAINT "staff_service_staff_id_staff_member_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_service" ADD CONSTRAINT "staff_service_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointment_org_staff_starts_idx" ON "appointment" USING btree ("organization_id","staff_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointment_org_contact_idx" ON "appointment" USING btree ("organization_id","contact_id");--> statement-breakpoint
CREATE INDEX "service_org_idx" ON "service" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "staff_org_idx" ON "staff_member" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_service_uq" ON "staff_service" USING btree ("staff_id","service_id");