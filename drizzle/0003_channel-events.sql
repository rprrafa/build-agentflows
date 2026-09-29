CREATE TABLE "channel_deliveries" (
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"run_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_deliveries_user_id_job_id_pk" PRIMARY KEY("user_id","job_id"),
	CONSTRAINT "channel_deliveries_status" CHECK ("channel_deliveries"."status" IN ('pending','sending','sent','uncertain','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "channel_events" (
	"user_id" uuid NOT NULL,
	"event_key" text NOT NULL,
	"run_id" text NOT NULL,
	"channel" text NOT NULL,
	"reply_ciphertext" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_events_user_id_event_key_pk" PRIMARY KEY("user_id","event_key"),
	CONSTRAINT "channel_events_channel" CHECK ("channel_events"."channel" IN ('whatsapp','elevenlabs'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "channel_events_run" ON "channel_events" USING btree ("user_id","run_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_run_parent" ON "jobs" USING btree ("user_id","id","run_id");
--> statement-breakpoint
ALTER TABLE "channel_deliveries" ADD CONSTRAINT "channel_deliveries_user_id_job_id_run_id_jobs_user_id_id_run_id_fk" FOREIGN KEY ("user_id","job_id","run_id") REFERENCES "public"."jobs"("user_id","id","run_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "channel_deliveries" ADD CONSTRAINT "channel_deliveries_user_id_run_id_channel_events_user_id_run_id_fk" FOREIGN KEY ("user_id","run_id") REFERENCES "public"."channel_events"("user_id","run_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "channel_events" ADD CONSTRAINT "channel_events_user_id_run_id_runs_user_id_id_fk" FOREIGN KEY ("user_id","run_id") REFERENCES "public"."runs"("user_id","id") ON DELETE cascade ON UPDATE no action;
