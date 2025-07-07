CREATE TABLE "coupons" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(50) NOT NULL,
	"discount_type" varchar(10) NOT NULL,
	"discount_value" integer NOT NULL,
	"description" text,
	"min_order_value" integer DEFAULT 0,
	"min_item_count" integer DEFAULT 0,
	"valid_from" timestamp,
	"valid_until" timestamp,
	"is_first_order_only" boolean DEFAULT false,
	"max_usage_per_user" integer DEFAULT 1,
	CONSTRAINT "coupons_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "product_name" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "img" varchar(500) NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "razorpay_order_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "coupon_code" varchar(50);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount_amount" integer;