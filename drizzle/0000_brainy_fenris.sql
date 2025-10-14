CREATE TABLE "user_address" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"alt_phone" text DEFAULT null,
	"address" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"postal_code" text NOT NULL,
	"country" text DEFAULT 'India' NOT NULL,
	"landmark" text DEFAULT null,
	"delivery_instructions" text DEFAULT null,
	"address_type" text DEFAULT null,
	"label" text DEFAULT null,
	"latitude" text DEFAULT null,
	"longitude" text DEFAULT null,
	"geo_accuracy" text DEFAULT null,
	"is_default" boolean DEFAULT false,
	"is_verified" boolean DEFAULT false,
	"is_deleted" boolean DEFAULT false,
	"created_at" text DEFAULT 'now()',
	"updated_at" text DEFAULT 'now()'
);
--> statement-breakpoint
CREATE TABLE "add_to_cart" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"added_at" text DEFAULT 'now()'
);
--> statement-breakpoint
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
CREATE TABLE "order_items" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"product_name" varchar(255) NOT NULL,
	"img" varchar(500) NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"price" integer NOT NULL,
	"total_price" integer NOT NULL,
	"size" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"user_address_id" uuid NOT NULL,
	"razorpay_order_id" text,
	"total_amount" integer NOT NULL,
	"status" text DEFAULT 'order placed',
	"progressStep" integer DEFAULT '0',
	"payment_mode" text NOT NULL,
	"transaction_id" text DEFAULT 'null',
	"payment_status" text DEFAULT 'pending',
	"phone" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text DEFAULT 'now()',
	"refund_id" text,
	"refund_amount" integer,
	"refund_status" text,
	"refund_speed" text,
	"refund_initiated_at" timestamp,
	"refund_completed_at" timestamp,
	"coupon_code" varchar(50),
	"discount_amount" integer
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"composition" varchar(255) NOT NULL,
	"description" varchar(255) NOT NULL,
	"fragrance" varchar(255) NOT NULL,
	"fragranceNotes" varchar(255) NOT NULL,
	"discount" integer NOT NULL,
	"oprice" integer NOT NULL,
	"size" integer NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"imageurl" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "query" (
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"message" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rating" integer NOT NULL,
	"comment" text NOT NULL,
	"photo_urls" text[],
	"is_verified_buyer" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "testimonials" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"text" text NOT NULL,
	"rating" integer NOT NULL,
	"avatar" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_id" text NOT NULL,
	"name" text NOT NULL,
	"phone" text DEFAULT null,
	"email" text NOT NULL,
	"role" text DEFAULT 'user',
	"cart_length" integer DEFAULT 0,
	"profile_image" text DEFAULT null,
	"dob" timestamp with time zone DEFAULT null,
	"gender" text DEFAULT null,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "users_clerk_id_unique" UNIQUE("clerk_id")
);
--> statement-breakpoint
CREATE TABLE "wishlist_table" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_address" ADD CONSTRAINT "user_address_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "add_to_cart" ADD CONSTRAINT "add_to_cart_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_address_id_user_address_id_fk" FOREIGN KEY ("user_address_id") REFERENCES "public"."user_address"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_table" ADD CONSTRAINT "wishlist_table_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_reviews_product_id" ON "product_reviews" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_reviews_rating" ON "product_reviews" USING btree ("rating");--> statement-breakpoint
CREATE INDEX "idx_reviews_created_at" ON "product_reviews" USING btree ("created_at");