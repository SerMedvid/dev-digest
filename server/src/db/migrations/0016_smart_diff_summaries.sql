CREATE TABLE "pr_file_summary" (
	"pr_id" uuid NOT NULL,
	"path" text NOT NULL,
	"head_sha" text NOT NULL,
	"summary" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pr_file_summary_pr_id_path_pk" PRIMARY KEY("pr_id","path")
);
--> statement-breakpoint
ALTER TABLE "pr_file_summary" ADD CONSTRAINT "pr_file_summary_pr_id_pull_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;