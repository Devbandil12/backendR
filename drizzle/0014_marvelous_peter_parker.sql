ALTER TABLE "users" ADD COLUMN "notify_order_updates" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_promos" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_pincode" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" DROP COLUMN "notify_order_updates";--> statement-breakpoint
ALTER TABLE "notifications" DROP COLUMN "notify_promos";--> statement-breakpoint
ALTER TABLE "notifications" DROP COLUMN "notify_pincode";