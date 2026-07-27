ALTER TABLE "user" ADD COLUMN "platform_role" text;--> statement-breakpoint
CREATE UNIQUE INDEX "meta_credentials_display_phone_uq" ON "meta_credentials" USING btree ("display_phone_number");