ALTER TABLE "banners" ADD COLUMN "type" text DEFAULT 'hero';--> statement-breakpoint
ALTER TABLE "banners" ADD COLUMN "layout" text DEFAULT 'split';--> statement-breakpoint
ALTER TABLE "banners" DROP COLUMN "mobile_image_url";