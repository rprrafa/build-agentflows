CREATE TABLE "chatgpt_sessions" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"ciphertext" text,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chatgpt_sessions_size" CHECK ("chatgpt_sessions"."ciphertext" IS NULL OR octet_length("chatgpt_sessions"."ciphertext")<=1048576),
	CONSTRAINT "chatgpt_sessions_lease" CHECK (("chatgpt_sessions"."lease_token" IS NULL)=("chatgpt_sessions"."lease_until" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "chatgpt_sessions" ADD CONSTRAINT "chatgpt_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;