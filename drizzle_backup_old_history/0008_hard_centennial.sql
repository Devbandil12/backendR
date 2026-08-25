ALTER TABLE "orders" ADD COLUMN "invoice_number" varchar(50);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_invoice_number_unique" UNIQUE("invoice_number");