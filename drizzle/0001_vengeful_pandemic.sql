CREATE TABLE "launch_waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"user_id" uuid,
	"subscribed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	"status" text DEFAULT 'subscribed' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "launch_waitlist" ADD CONSTRAINT "launch_waitlist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "launch_waitlist_email_unique_idx" ON "launch_waitlist" USING btree (lower("email"));