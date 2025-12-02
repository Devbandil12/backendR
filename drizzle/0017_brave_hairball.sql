ALTER TABLE "ticket_messages" ALTER COLUMN "ticket_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "tickets" ALTER COLUMN "id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "tickets" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "tickets" ALTER COLUMN "subject" SET DEFAULT 'Support Query';