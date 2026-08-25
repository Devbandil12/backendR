ALTER TABLE "banners" ADD COLUMN "template_type" text DEFAULT 'standard';--> statement-breakpoint
ALTER TABLE "banners" ADD COLUMN "config" jsonb DEFAULT '{}'::jsonb;