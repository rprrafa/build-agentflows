CREATE TABLE "flow_schedules" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"flow_id" text NOT NULL,
	"body" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flow_schedules_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "flow_schedules_body" CHECK ("flow_schedules"."body"->>'id'="flow_schedules"."id" AND "flow_schedules"."body"->>'flowId'="flow_schedules"."flow_id")
);
--> statement-breakpoint
ALTER TABLE "flow_schedules" ADD CONSTRAINT "flow_schedules_user_id_flow_id_flows_user_id_id_fk" FOREIGN KEY ("user_id","flow_id") REFERENCES "public"."flows"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flow_schedules_flow" ON "flow_schedules" USING btree ("user_id","flow_id","created_at");--> statement-breakpoint
CREATE INDEX "flow_schedules_due" ON "flow_schedules" USING btree ("next_run_at") WHERE "flow_schedules"."active";