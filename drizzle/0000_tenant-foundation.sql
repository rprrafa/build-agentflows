CREATE TABLE "action_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_tokens_purpose" CHECK ("action_tokens"."purpose" IN ('verify_email','reset_password'))
);
--> statement-breakpoint
CREATE TABLE "attachment_blobs" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"data" "bytea" NOT NULL,
	CONSTRAINT "attachment_blobs_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "attachment_blobs_size" CHECK (octet_length("attachment_blobs"."data") BETWEEN 1 AND 10485760)
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"flow_id" text NOT NULL,
	"body" jsonb NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "attachments_body" CHECK ("attachments"."body"->>'id'="attachments"."id" AND "attachments"."body"->>'flowId'="attachments"."flow_id")
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"ciphertext" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credentials_user_id_key_pk" PRIMARY KEY("user_id","key"),
	CONSTRAINT "credentials_key" CHECK (length("credentials"."key") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "flows" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"body" jsonb NOT NULL,
	"sequence" bigint GENERATED ALWAYS AS IDENTITY (sequence name "flows_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"revision" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "flows_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "flows_body" CHECK ("flows"."body"->>'id'="flows"."id")
);
--> statement-breakpoint
CREATE TABLE "invite_redemptions" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"invite_id" uuid NOT NULL,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"max_uses" integer NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "invites_capacity" CHECK ("invites"."max_uses">0 AND "invites"."uses">=0 AND "invites"."uses"<="invites"."max_uses")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"resource_id" text NOT NULL,
	"run_id" text,
	"base_id" text,
	"source_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error" text,
	CONSTRAINT "jobs_kind" CHECK ("jobs"."kind" IN ('run','index','extract')),
	CONSTRAINT "jobs_status" CHECK ("jobs"."status" IN ('queued','running','done','failed','cancelled','interrupted')),
	CONSTRAINT "jobs_resource" CHECK (("jobs"."kind"='run' AND "jobs"."run_id" IS NOT NULL AND "jobs"."base_id" IS NULL AND "jobs"."source_id" IS NULL) OR ("jobs"."kind"='index' AND "jobs"."run_id" IS NULL AND "jobs"."base_id" IS NOT NULL AND "jobs"."source_id" IS NULL) OR ("jobs"."kind"='extract' AND "jobs"."run_id" IS NULL AND "jobs"."base_id" IS NOT NULL AND "jobs"."source_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "knowledge_bases" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"body" jsonb NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "knowledge_bases_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "knowledge_bases_body" CHECK ("knowledge_bases"."body"->>'id'="knowledge_bases"."id")
);
--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"user_id" uuid NOT NULL,
	"base_id" text NOT NULL,
	"source_id" text NOT NULL,
	"id" text NOT NULL,
	"body" jsonb NOT NULL,
	CONSTRAINT "knowledge_chunks_user_id_base_id_id_pk" PRIMARY KEY("user_id","base_id","id"),
	CONSTRAINT "knowledge_chunks_body" CHECK ("knowledge_chunks"."body"->>'id'="knowledge_chunks"."id" AND "knowledge_chunks"."body"->>'sourceId'="knowledge_chunks"."source_id")
);
--> statement-breakpoint
CREATE TABLE "knowledge_cleanup" (
	"user_id" uuid NOT NULL,
	"base_id" text NOT NULL,
	"id" text NOT NULL,
	"body" jsonb NOT NULL,
	CONSTRAINT "knowledge_cleanup_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "knowledge_indexes" (
	"user_id" uuid NOT NULL,
	"base_id" text NOT NULL,
	"generation" text NOT NULL,
	"body" jsonb NOT NULL,
	CONSTRAINT "knowledge_indexes_user_id_base_id_pk" PRIMARY KEY("user_id","base_id")
);
--> statement-breakpoint
CREATE TABLE "knowledge_locks" (
	"user_id" uuid NOT NULL,
	"base_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"job_id" uuid,
	"job_token" uuid,
	CONSTRAINT "knowledge_locks_user_id_base_id_pk" PRIMARY KEY("user_id","base_id")
);
--> statement-breakpoint
CREATE TABLE "knowledge_private" (
	"user_id" uuid NOT NULL,
	"base_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"ciphertext" text NOT NULL,
	CONSTRAINT "knowledge_private_user_id_base_id_resource_id_pk" PRIMARY KEY("user_id","base_id","resource_id")
);
--> statement-breakpoint
CREATE TABLE "knowledge_runs" (
	"user_id" uuid NOT NULL,
	"base_id" text NOT NULL,
	"id" text NOT NULL,
	"body" jsonb NOT NULL,
	CONSTRAINT "knowledge_runs_user_id_base_id_id_pk" PRIMARY KEY("user_id","base_id","id"),
	CONSTRAINT "knowledge_runs_body" CHECK ("knowledge_runs"."body"->>'id'="knowledge_runs"."id")
);
--> statement-breakpoint
CREATE TABLE "knowledge_sources" (
	"user_id" uuid NOT NULL,
	"base_id" text NOT NULL,
	"id" text NOT NULL,
	"body" jsonb NOT NULL,
	CONSTRAINT "knowledge_sources_user_id_base_id_id_pk" PRIMARY KEY("user_id","base_id","id"),
	CONSTRAINT "knowledge_sources_body" CHECK ("knowledge_sources"."body"->>'id'="knowledge_sources"."id" AND "knowledge_sources"."body"->>'baseId'="knowledge_sources"."base_id")
);
--> statement-breakpoint
CREATE TABLE "knowledge_vectors" (
	"user_id" uuid NOT NULL,
	"base_id" text NOT NULL,
	"generation" text NOT NULL,
	"chunk_id" text NOT NULL,
	"hash" text NOT NULL,
	"body" jsonb NOT NULL,
	CONSTRAINT "knowledge_vectors_user_id_base_id_generation_chunk_id_pk" PRIMARY KEY("user_id","base_id","generation","chunk_id")
);
--> statement-breakpoint
CREATE TABLE "mail_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"payload_ciphertext" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_id" uuid,
	"lease_until" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"binding_hash" text NOT NULL,
	"payload_ciphertext" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"hits" integer NOT NULL,
	"resets_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limits_hits" CHECK ("rate_limits"."hits">0)
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"flow_id" text NOT NULL,
	"status" text NOT NULL,
	"body" jsonb NOT NULL,
	"sequence" bigint GENERATED ALWAYS AS IDENTITY (sequence name "runs_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	CONSTRAINT "runs_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "runs_status" CHECK ("runs"."status" IN ('running','waiting','completed','failed','cancelled')),
	CONSTRAINT "runs_body" CHECK ("runs"."body"->>'id'="runs"."id" AND "runs"."body"->>'flowId'="runs"."flow_id" AND "runs"."body"->>'status'="runs"."status")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"google_sub" text,
	"email_verified_at" timestamp with time zone,
	"beta_status" text DEFAULT 'pending' NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_google_sub_unique" UNIQUE("google_sub"),
	CONSTRAINT "users_name" CHECK (length("users"."name") BETWEEN 1 AND 120),
	CONSTRAINT "users_email" CHECK ("users"."email"=lower("users"."email") AND length("users"."email")<=254),
	CONSTRAINT "users_beta_status" CHECK ("users"."beta_status" IN ('pending','approved','blocked'))
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeats" (
	"id" uuid PRIMARY KEY NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_tokens" ADD CONSTRAINT "action_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_blobs" ADD CONSTRAINT "attachment_blobs_user_id_id_attachments_user_id_id_fk" FOREIGN KEY ("user_id","id") REFERENCES "public"."attachments"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_user_id_flow_id_flows_user_id_id_fk" FOREIGN KEY ("user_id","flow_id") REFERENCES "public"."flows"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_redemptions" ADD CONSTRAINT "invite_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_redemptions" ADD CONSTRAINT "invite_redemptions_invite_id_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."invites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_run_id_runs_user_id_id_fk" FOREIGN KEY ("user_id","run_id") REFERENCES "public"."runs"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_base_id_knowledge_bases_user_id_id_fk" FOREIGN KEY ("user_id","base_id") REFERENCES "public"."knowledge_bases"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_base_id_source_id_knowledge_sources_user_id_base_id_id_fk" FOREIGN KEY ("user_id","base_id","source_id") REFERENCES "public"."knowledge_sources"("user_id","base_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_user_id_base_id_source_id_knowledge_sources_user_id_base_id_id_fk" FOREIGN KEY ("user_id","base_id","source_id") REFERENCES "public"."knowledge_sources"("user_id","base_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_cleanup" ADD CONSTRAINT "knowledge_cleanup_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_indexes" ADD CONSTRAINT "knowledge_indexes_user_id_base_id_knowledge_bases_user_id_id_fk" FOREIGN KEY ("user_id","base_id") REFERENCES "public"."knowledge_bases"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_locks" ADD CONSTRAINT "knowledge_locks_user_id_base_id_knowledge_bases_user_id_id_fk" FOREIGN KEY ("user_id","base_id") REFERENCES "public"."knowledge_bases"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_private" ADD CONSTRAINT "knowledge_private_user_id_base_id_knowledge_bases_user_id_id_fk" FOREIGN KEY ("user_id","base_id") REFERENCES "public"."knowledge_bases"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_runs" ADD CONSTRAINT "knowledge_runs_user_id_base_id_knowledge_bases_user_id_id_fk" FOREIGN KEY ("user_id","base_id") REFERENCES "public"."knowledge_bases"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_user_id_base_id_knowledge_bases_user_id_id_fk" FOREIGN KEY ("user_id","base_id") REFERENCES "public"."knowledge_bases"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_vectors" ADD CONSTRAINT "knowledge_vectors_user_id_base_id_knowledge_bases_user_id_id_fk" FOREIGN KEY ("user_id","base_id") REFERENCES "public"."knowledge_bases"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_user_id_flow_id_flows_user_id_id_fk" FOREIGN KEY ("user_id","flow_id") REFERENCES "public"."flows"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_tokens_user" ON "action_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "attachments_unused" ON "attachments" USING btree ("user_id","created_at") WHERE "attachments"."used"=false;--> statement-breakpoint
CREATE INDEX "flows_list" ON "flows" USING btree ("user_id","sequence" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "invite_redemptions_invite" ON "invite_redemptions" USING btree ("invite_id");--> statement-breakpoint
CREATE INDEX "jobs_queue" ON "jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "jobs_owner" ON "jobs" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_active_resource" ON "jobs" USING btree ("user_id","kind","resource_id") WHERE "jobs"."status" IN ('queued','running');--> statement-breakpoint
CREATE INDEX "mail_outbox_pending" ON "mail_outbox" USING btree ("available_at") WHERE "mail_outbox"."sent_at" IS NULL AND "mail_outbox"."failed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "rate_limits_expiry" ON "rate_limits" USING btree ("resets_at");--> statement-breakpoint
CREATE INDEX "runs_list" ON "runs" USING btree ("user_id","sequence" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "runs_flow" ON "runs" USING btree ("user_id","flow_id","status","sequence" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sessions_user" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expiry" ON "sessions" USING btree ("expires_at");