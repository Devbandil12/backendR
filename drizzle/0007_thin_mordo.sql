ALTER TABLE "banners" ALTER COLUMN "config" SET DATA TYPE json;--> statement-breakpoint
ALTER TABLE "banners" ALTER COLUMN "config" SET DEFAULT '{}'::json;