CREATE TABLE "embed_commands" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"session_id" text NOT NULL,
	"run_id" text NOT NULL,
	"status" text NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "embed_commands_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "embed_commands_status" CHECK ("embed_commands"."status" IN ('pending','delivered','completed','failed','expired','cancelled')),
	CONSTRAINT "embed_commands_body" CHECK ("embed_commands"."body"->>'id'="embed_commands"."id" AND "embed_commands"."body"->>'runId'="embed_commands"."run_id" AND "embed_commands"."body"->>'sessionId'="embed_commands"."session_id" AND "embed_commands"."body"->>'status'="embed_commands"."status")
);
--> statement-breakpoint
CREATE TABLE "embed_requests" (
	"user_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"request_id" text NOT NULL,
	"flow_id" text NOT NULL,
	"run_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "embed_requests_user_id_session_id_request_id_pk" PRIMARY KEY("user_id","session_id","request_id")
);
--> statement-breakpoint
CREATE TABLE "embed_sessions" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"flow_id" text NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "embed_sessions_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "embed_sessions_body" CHECK ("embed_sessions"."body"->>'id'="embed_sessions"."id" AND "embed_sessions"."body"->>'flowId'="embed_sessions"."flow_id")
);
--> statement-breakpoint
CREATE TABLE "embed_settings" (
	"user_id" uuid NOT NULL,
	"flow_id" text NOT NULL,
	"body" jsonb NOT NULL,
	CONSTRAINT "embed_settings_user_id_flow_id_pk" PRIMARY KEY("user_id","flow_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "embed_commands_active" ON "embed_commands" USING btree ("user_id","run_id") WHERE "embed_commands"."status" IN ('pending','delivered');--> statement-breakpoint
CREATE UNIQUE INDEX "embed_requests_run" ON "embed_requests" USING btree ("user_id","session_id","run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "embed_sessions_parent" ON "embed_sessions" USING btree ("user_id","id","flow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_parent" ON "runs" USING btree ("user_id","id","flow_id");--> statement-breakpoint
ALTER TABLE "embed_commands" ADD CONSTRAINT "embed_commands_user_id_session_id_run_id_embed_requests_user_id_session_id_run_id_fk" FOREIGN KEY ("user_id","session_id","run_id") REFERENCES "public"."embed_requests"("user_id","session_id","run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embed_requests" ADD CONSTRAINT "embed_requests_user_id_session_id_flow_id_embed_sessions_user_id_id_flow_id_fk" FOREIGN KEY ("user_id","session_id","flow_id") REFERENCES "public"."embed_sessions"("user_id","id","flow_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embed_requests" ADD CONSTRAINT "embed_requests_user_id_run_id_flow_id_runs_user_id_id_flow_id_fk" FOREIGN KEY ("user_id","run_id","flow_id") REFERENCES "public"."runs"("user_id","id","flow_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embed_sessions" ADD CONSTRAINT "embed_sessions_user_id_flow_id_flows_user_id_id_fk" FOREIGN KEY ("user_id","flow_id") REFERENCES "public"."flows"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embed_settings" ADD CONSTRAINT "embed_settings_user_id_flow_id_flows_user_id_id_fk" FOREIGN KEY ("user_id","flow_id") REFERENCES "public"."flows"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "embed_commands_session" ON "embed_commands" USING btree ("user_id","session_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "embed_sessions_expiry" ON "embed_sessions" USING btree ("expires_at");