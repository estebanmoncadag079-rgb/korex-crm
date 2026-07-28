ALTER TABLE "meta_credentials" ADD COLUMN "webhook_secret_cipher" text;--> statement-breakpoint
ALTER TABLE "meta_credentials" ADD COLUMN "webhook_secret_iv" text;--> statement-breakpoint
ALTER TABLE "meta_credentials" ADD COLUMN "webhook_secret_tag" text;