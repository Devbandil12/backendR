CREATE TABLE "pincode_serviceability" (
	"pincode" varchar(6) PRIMARY KEY NOT NULL,
	"is_serviceable" boolean DEFAULT false,
	"cod_available" boolean DEFAULT false,
	"online_payment_available" boolean DEFAULT true,
	"delivery_charge" integer DEFAULT 50
);
