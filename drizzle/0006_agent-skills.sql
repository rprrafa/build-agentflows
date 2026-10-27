CREATE TABLE "skills" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"body" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skills_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "skills_body" CHECK ("skills"."body"->>'id'="skills"."id" AND "skills"."body"->>'name'="skills"."name"),
	CONSTRAINT "skills_size" CHECK (octet_length("skills"."body"::text)<=4194304)
);
--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skills_name" ON "skills" USING btree ("user_id","name");