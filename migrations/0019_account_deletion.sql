ALTER TABLE "backer_badges" DROP CONSTRAINT "backer_badges_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "cofounder_sprints" DROP CONSTRAINT "cofounder_sprints_source_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "content_reports" DROP CONSTRAINT "content_reports_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "donations" DROP CONSTRAINT "donations_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "feed_posts" DROP CONSTRAINT "feed_posts_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "health_finding_feedback" DROP CONSTRAINT "health_finding_feedback_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "investor_artifacts" DROP CONSTRAINT "investor_artifacts_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "loop_events" DROP CONSTRAINT "loop_events_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "mock_interviews" DROP CONSTRAINT "mock_interviews_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "nova_guide_messages" DROP CONSTRAINT "nova_guide_messages_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_activity_log" DROP CONSTRAINT "project_activity_log_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_analytics_events" DROP CONSTRAINT "project_analytics_events_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_applications" DROP CONSTRAINT "project_applications_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_backer_tiers" DROP CONSTRAINT "project_backer_tiers_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_backing_campaigns" DROP CONSTRAINT "project_backing_campaigns_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_backings" DROP CONSTRAINT "project_backings_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_chat_messages" DROP CONSTRAINT "project_chat_messages_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_check_ins" DROP CONSTRAINT "project_check_ins_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_code_audits" DROP CONSTRAINT "project_code_audits_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_comments" DROP CONSTRAINT "project_comments_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_decisions" DROP CONSTRAINT "project_decisions_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_deploy_checklist_items" DROP CONSTRAINT "project_deploy_checklist_items_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_documents" DROP CONSTRAINT "project_documents_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_experiments" DROP CONSTRAINT "project_experiments_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_files" DROP CONSTRAINT "project_files_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_follows" DROP CONSTRAINT "project_follows_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_health_checks" DROP CONSTRAINT "project_health_checks_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_interviews" DROP CONSTRAINT "project_interviews_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_kanban_tasks" DROP CONSTRAINT "project_kanban_tasks_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_launch_tasks" DROP CONSTRAINT "project_launch_tasks_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_legal_docs" DROP CONSTRAINT "project_legal_docs_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_links" DROP CONSTRAINT "project_links_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_live_chat_messages" DROP CONSTRAINT "project_live_chat_messages_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_members" DROP CONSTRAINT "project_members_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_merch_orders" DROP CONSTRAINT "project_merch_orders_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_milestones" DROP CONSTRAINT "project_milestones_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_personas" DROP CONSTRAINT "project_personas_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_pricing_tiers" DROP CONSTRAINT "project_pricing_tiers_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_roadmaps" DROP CONSTRAINT "project_roadmaps_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_storyboards" DROP CONSTRAINT "project_storyboards_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_support_tickets" DROP CONSTRAINT "project_support_tickets_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_task_completions" DROP CONSTRAINT "project_task_completions_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_waitlist_entries" DROP CONSTRAINT "project_waitlist_entries_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "sprint_matchmaking_queue" DROP CONSTRAINT "sprint_matchmaking_queue_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "backer_badges" ADD CONSTRAINT "backer_badges_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cofounder_sprints" ADD CONSTRAINT "cofounder_sprints_source_project_id_projects_id_fk" FOREIGN KEY ("source_project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_posts" ADD CONSTRAINT "feed_posts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_finding_feedback" ADD CONSTRAINT "health_finding_feedback_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investor_artifacts" ADD CONSTRAINT "investor_artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loop_events" ADD CONSTRAINT "loop_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_interviews" ADD CONSTRAINT "mock_interviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nova_guide_messages" ADD CONSTRAINT "nova_guide_messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_activity_log" ADD CONSTRAINT "project_activity_log_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_analytics_events" ADD CONSTRAINT "project_analytics_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_applications" ADD CONSTRAINT "project_applications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_backer_tiers" ADD CONSTRAINT "project_backer_tiers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_backing_campaigns" ADD CONSTRAINT "project_backing_campaigns_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_backings" ADD CONSTRAINT "project_backings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_chat_messages" ADD CONSTRAINT "project_chat_messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_check_ins" ADD CONSTRAINT "project_check_ins_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_code_audits" ADD CONSTRAINT "project_code_audits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_comments" ADD CONSTRAINT "project_comments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_decisions" ADD CONSTRAINT "project_decisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_deploy_checklist_items" ADD CONSTRAINT "project_deploy_checklist_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_experiments" ADD CONSTRAINT "project_experiments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_follows" ADD CONSTRAINT "project_follows_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_health_checks" ADD CONSTRAINT "project_health_checks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_interviews" ADD CONSTRAINT "project_interviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_kanban_tasks" ADD CONSTRAINT "project_kanban_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_launch_tasks" ADD CONSTRAINT "project_launch_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_legal_docs" ADD CONSTRAINT "project_legal_docs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_links" ADD CONSTRAINT "project_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_live_chat_messages" ADD CONSTRAINT "project_live_chat_messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_merch_orders" ADD CONSTRAINT "project_merch_orders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_personas" ADD CONSTRAINT "project_personas_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_pricing_tiers" ADD CONSTRAINT "project_pricing_tiers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_roadmaps" ADD CONSTRAINT "project_roadmaps_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_storyboards" ADD CONSTRAINT "project_storyboards_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_support_tickets" ADD CONSTRAINT "project_support_tickets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_task_completions" ADD CONSTRAINT "project_task_completions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_waitlist_entries" ADD CONSTRAINT "project_waitlist_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_matchmaking_queue" ADD CONSTRAINT "sprint_matchmaking_queue_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;