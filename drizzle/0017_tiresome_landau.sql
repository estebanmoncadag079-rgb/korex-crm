CREATE TABLE "media_asset" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"etiqueta" text NOT NULL,
	"mime_type" text NOT NULL,
	"datos" text NOT NULL,
	"tamano" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_org_idx" ON "media_asset" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_org_etiqueta_uq" ON "media_asset" USING btree ("organization_id","etiqueta");