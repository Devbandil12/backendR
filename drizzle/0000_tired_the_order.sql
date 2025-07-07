CREATE TABLE "user_address" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"postal_code" text NOT NULL,
	"country" text NOT NULL,
	"address" text DEFAULT '' NOT NULL
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
CREATE TABLE "address" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"street" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"postal_code" text NOT NULL,
	"country" text NOT NULL,
	"created_at" text DEFAULT 'now()',
	"updated_at" text DEFAULT 'now()'
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"product_id" uuid NOT NULL,
	"product_name" varchar(255) NOT NULL,
	"img" varchar(500) NOT NULL ,
	"quantity" integer DEFAULT 1 NOT NULL,
	"price" integer NOT NULL,
	"total_price" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"total_amount" integer NOT NULL,
	"status" text DEFAULT 'order placed',
	"progressStep" text DEFAULT '0',
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
	"refund_completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"composition" varchar(255) NOT NULL,
	"description" varchar(255) NOT NULL,
	"fragrance" varchar(255) NOT NULL,
	"fragranceNotes" varchar(255) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"discount" integer NOT NULL,
	"oprice" integer NOT NULL,
	"size" integer NOT NULL,
	"imageurl" varchar(500) NOT NULL
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
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text DEFAULT null,
	"email" text NOT NULL,
	"role" text DEFAULT 'user',
	"cart_length" integer DEFAULT 0
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
ALTER TABLE "address" ADD CONSTRAINT "address_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_table" ADD CONSTRAINT "wishlist_table_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;