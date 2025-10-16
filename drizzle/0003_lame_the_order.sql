ALTER TABLE "products" ADD COLUMN "cost_price" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "category" varchar(100) DEFAULT 'Uncategorized';--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "sold" integer DEFAULT 0;