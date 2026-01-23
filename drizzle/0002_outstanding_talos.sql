CREATE TABLE "reward_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referee_bonus" integer DEFAULT 50,
	"referrer_bonus" integer DEFAULT 50,
	"paparazzi" integer DEFAULT 20,
	"loyal_follower" integer DEFAULT 20,
	"reviewer" integer DEFAULT 10,
	"monthly_lottery" integer DEFAULT 100,
	"updated_at" timestamp DEFAULT now()
);
