ALTER TABLE "product_variants" ADD COLUMN "is_archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "is_archived" boolean DEFAULT false NOT NULL;