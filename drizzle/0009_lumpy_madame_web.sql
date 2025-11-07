ALTER TABLE "coupons" ALTER COLUMN "discount_type" SET DATA TYPE varchar(20);--> statement-breakpoint
ALTER TABLE "coupons" ALTER COLUMN "discount_value" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "discount_amount" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "is_automatic" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "cond_required_category" varchar(100);--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "action_target_size" integer;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "action_target_max_price" integer;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "action_buy_x" integer;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "action_get_y" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "offer_discount" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "offer_codes" jsonb;