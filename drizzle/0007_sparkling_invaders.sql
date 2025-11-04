CREATE TABLE "product_bundles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bundle_variant_id" uuid NOT NULL,
	"content_variant_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"size" integer NOT NULL,
	"oprice" integer NOT NULL,
	"discount" integer DEFAULT 0 NOT NULL,
	"cost_price" integer DEFAULT 0,
	"stock" integer DEFAULT 0 NOT NULL,
	"sold" integer DEFAULT 0,
	"sku" varchar(100),
	CONSTRAINT "product_variants_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
ALTER TABLE "add_to_cart" RENAME COLUMN "product_id" TO "variant_id";--> statement-breakpoint
ALTER TABLE "wishlist_table" RENAME COLUMN "product_id" TO "variant_id";--> statement-breakpoint
ALTER TABLE "add_to_cart" DROP CONSTRAINT "add_to_cart_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "wishlist_table" DROP CONSTRAINT "wishlist_table_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "variant_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "product_bundles" ADD CONSTRAINT "product_bundles_bundle_variant_id_product_variants_id_fk" FOREIGN KEY ("bundle_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_bundles" ADD CONSTRAINT "product_bundles_content_variant_id_product_variants_id_fk" FOREIGN KEY ("content_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "add_to_cart" ADD CONSTRAINT "add_to_cart_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_table" ADD CONSTRAINT "wishlist_table_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "discount";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "oprice";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "size";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "stock";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "cost_price";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "sold";