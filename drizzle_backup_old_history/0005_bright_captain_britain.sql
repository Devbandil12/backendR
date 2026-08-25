ALTER TABLE "product_variants" ADD COLUMN "weight" real DEFAULT 0.5 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "length" real DEFAULT 10;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "breadth" real DEFAULT 10;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "height" real DEFAULT 10;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "is_active" boolean DEFAULT true;