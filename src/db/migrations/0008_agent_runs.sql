ALTER TABLE "research_runs" ADD COLUMN "agent_phase" text;--> statement-breakpoint
ALTER TABLE "research_runs" ADD COLUMN "agent_options" jsonb;--> statement-breakpoint
ALTER TABLE "research_runs" ADD COLUMN "agent_session_id" text;--> statement-breakpoint
ALTER TABLE "research_runs" ADD COLUMN "agent_container_id" text;--> statement-breakpoint
ALTER TABLE "research_runs" ADD COLUMN "agent_exit_code" integer;--> statement-breakpoint
ALTER TABLE "research_runs" ADD COLUMN "agent_usage" jsonb;--> statement-breakpoint
ALTER TABLE "research_runs" ADD COLUMN "agent_final_message" text;