ALTER TABLE "contact" ALTER COLUMN "phone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "wa_user_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_org_wa_user_id_uq" ON "contact" USING btree ("organization_id","wa_user_id");