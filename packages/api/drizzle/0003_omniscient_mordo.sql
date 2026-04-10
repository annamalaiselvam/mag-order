ALTER TABLE "reservations" ALTER COLUMN "table_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "customer_name" varchar(255);--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "call_sid" varchar(64);