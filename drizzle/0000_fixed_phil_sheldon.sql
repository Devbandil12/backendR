/* 1. Create the NEW Tables (Safe) */
CREATE TABLE IF NOT EXISTS "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_id" uuid NOT NULL,
	"referee_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'pending',
	"reward_amount" integer DEFAULT 100,
	"created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "wallet_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"type" varchar(50) NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);

/* 2. Add NEW Columns to 'users' (Safe) */
/* Postgres will fill existing rows with NULL or Default 0 automatically */

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referral_code" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referred_by" uuid;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "wallet_balance" integer DEFAULT 0 NOT NULL;

/* 3. Add Constraints (Wrapped to prevent errors if they exist) */

DO $$ BEGIN
    ALTER TABLE "users" ADD CONSTRAINT "users_referral_code_unique" UNIQUE("referral_code");
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referee_id_users_id_fk" FOREIGN KEY ("referee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;