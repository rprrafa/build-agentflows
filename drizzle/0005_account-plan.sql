CREATE TABLE "usage_months" (
	"user_id" uuid NOT NULL,
	"month" text NOT NULL,
	"runs" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_months_user_id_month_pk" PRIMARY KEY("user_id","month"),
	CONSTRAINT "usage_months_month" CHECK ("usage_months"."month" ~ '^[0-9]{4}-[0-9]{2}$'),
	CONSTRAINT "usage_months_runs" CHECK ("usage_months"."runs">=0)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan" text DEFAULT 'beta' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_months" ADD CONSTRAINT "usage_months_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_plan" CHECK ("users"."plan" IN ('beta','ai_action'));