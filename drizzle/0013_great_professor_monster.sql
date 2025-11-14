ALTER TABLE "notifications" ADD COLUMN "notify_order_updates" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "notify_promos" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "notify_pincode" boolean DEFAULT true NOT NULL;