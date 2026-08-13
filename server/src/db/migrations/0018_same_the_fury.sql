CREATE TABLE "context_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_kind" text NOT NULL,
	"agent_id" uuid,
	"skill_id" uuid,
	"repo_id" uuid NOT NULL,
	"path" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "context_attachments_one_owner" CHECK (("context_attachments"."agent_id" IS NOT NULL) <> ("context_attachments"."skill_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "context_attachments" ADD CONSTRAINT "context_attachments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_attachments" ADD CONSTRAINT "context_attachments_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_attachments" ADD CONSTRAINT "context_attachments_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_attachments" ADD CONSTRAINT "context_attachments_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "context_attachments_agent_uq" ON "context_attachments" USING btree ("agent_id","repo_id","path") WHERE "context_attachments"."agent_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "context_attachments_skill_uq" ON "context_attachments" USING btree ("skill_id","repo_id","path") WHERE "context_attachments"."skill_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "context_attachments_repo_idx" ON "context_attachments" USING btree ("repo_id");