CREATE TABLE "activity_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"name" text NOT NULL,
	"user_id" varchar,
	"visitor_id" varchar NOT NULL,
	"session_id" varchar NOT NULL,
	"path" text NOT NULL,
	"pattern" text NOT NULL,
	"method" varchar,
	"status" integer,
	"duration_ms" integer,
	"project_id" varchar,
	"referrer" text,
	"user_agent" text,
	"props" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backer_badges" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"level" text NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"believer_number" integer,
	"founding_believer" boolean DEFAULT false NOT NULL,
	"image_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"showcase_order" integer,
	"generated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "backer_badges_user_id_project_id_unique" UNIQUE("user_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "badges" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"icon" text NOT NULL,
	"rarity" text DEFAULT 'common' NOT NULL,
	"category" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cofounder_sprints" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user1_id" varchar NOT NULL,
	"user2_id" varchar NOT NULL,
	"duration" text NOT NULL,
	"status" text DEFAULT 'setup' NOT NULL,
	"product_style" text,
	"product_name" text,
	"product_description" text,
	"user1_proposed_name" text,
	"user2_proposed_name" text,
	"is_practice" boolean DEFAULT false NOT NULL,
	"source_project_id" varchar,
	"agreed_problem" text,
	"agreed_icp" text,
	"agreed_value_prop" text,
	"validation_questions" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" varchar NOT NULL,
	"receiver_id" varchar NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_reports" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" varchar NOT NULL,
	"target_type" text NOT NULL,
	"target_id" varchar NOT NULL,
	"target_owner_id" varchar,
	"project_id" varchar,
	"reason" text NOT NULL,
	"note" text,
	"snapshot" text,
	"status" text DEFAULT 'open' NOT NULL,
	"reviewed_by_id" varchar,
	"reviewed_at" timestamp,
	"review_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "content_reports_reporter_id_target_type_target_id_unique" UNIQUE("reporter_id","target_type","target_id")
);
--> statement-breakpoint
CREATE TABLE "contest_participants" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contest_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"submission_url" text,
	"submission_note" text,
	"score" integer,
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contests" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"difficulty" text DEFAULT 'intermediate' NOT NULL,
	"status" text DEFAULT 'upcoming' NOT NULL,
	"prize" text,
	"badge_id" varchar,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"max_participants" integer,
	"promoted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "direct_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" varchar NOT NULL,
	"receiver_id" varchar NOT NULL,
	"content" text NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "donations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"donor_id" varchar NOT NULL,
	"amount" integer NOT NULL,
	"message" text,
	"stripe_session_id" varchar,
	"stripe_payment_intent_id" varchar,
	"stripe_charge_id" varchar,
	"refunded_amount" integer DEFAULT 0 NOT NULL,
	"refunded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "donations_stripe_session_id_unique" UNIQUE("stripe_session_id")
);
--> statement-breakpoint
CREATE TABLE "feed_comments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" varchar NOT NULL,
	"author_id" varchar NOT NULL,
	"content" text NOT NULL,
	"mentions" jsonb DEFAULT '[]'::jsonb,
	"parent_comment_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_posts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" varchar NOT NULL,
	"project_id" varchar,
	"post_type" text NOT NULL,
	"content" text NOT NULL,
	"media_urls" varchar[] DEFAULT '{}',
	"mentions" jsonb DEFAULT '[]'::jsonb,
	"is_system_generated" boolean DEFAULT false NOT NULL,
	"entity_type" text,
	"entity_id" varchar,
	"reaction_count" integer DEFAULT 0 NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"edited_at" timestamp,
	"hidden_at" timestamp,
	"hidden_by_id" varchar,
	"hidden_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_reactions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"reaction" text DEFAULT 'like' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "feed_reactions_post_id_user_id_unique" UNIQUE("post_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "game_leaderboard" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_type" text NOT NULL,
	"user_id" varchar NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_finding_feedback" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"check_id" varchar,
	"user_id" varchar NOT NULL,
	"area" text NOT NULL,
	"finding" text,
	"stance" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investor_artifacts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"kind" text NOT NULL,
	"score" integer,
	"summary" text,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credits_charged" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loop_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"user_id" varchar,
	"project_id" varchar,
	"check_in_id" varchar,
	"session_id" varchar,
	"props" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"token_hash" varchar NOT NULL,
	"label" varchar NOT NULL,
	"prefix" varchar NOT NULL,
	"project_id" varchar,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "mobile_refresh_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"token_hash" varchar NOT NULL,
	"device" varchar,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"last_used_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mobile_refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "mock_interview_turns" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"interview_id" varchar NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"question" text NOT NULL,
	"answer" text,
	"score" integer,
	"feedback" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"answered_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "mock_interviews" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"persona" text NOT NULL,
	"difficulty" text DEFAULT 'skeptical' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"average_score" integer,
	"verdict" text,
	"credits_charged" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "moderation_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" varchar NOT NULL,
	"actor_id" varchar,
	"target_user_id" varchar,
	"target_type" varchar,
	"target_id" varchar,
	"reason" text,
	"reason_code" varchar,
	"previous_state" jsonb,
	"resulting_state" jsonb,
	"details" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nova_guide_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"actions_taken" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "path_pace" (
	"project_id" varchar PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"multiplier" real,
	"projected_at" timestamp,
	"projected_low" timestamp,
	"projected_high" timestamp,
	"last_activity_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "path_pace_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"task_id" varchar,
	"backbone_id" text,
	"title" text NOT NULL,
	"estimate_minutes" integer,
	"actual_minutes" integer,
	"projected_before" timestamp,
	"projected_after" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "path_work" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"task_id" varchar NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"chosen_index" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_activity_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"user_id" varchar,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_analytics_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"event_name" text NOT NULL,
	"category" text DEFAULT 'activation',
	"description" text,
	"tracking_status" text DEFAULT 'planned',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_applications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"resume_url" text,
	"answers" jsonb DEFAULT '[]'::jsonb,
	"message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_backer_tiers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"amount_cents" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"digital_rewards" varchar[] DEFAULT '{}',
	"merch_products" varchar[] DEFAULT '{}',
	"max_backers" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_backing_campaigns" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"headline" text,
	"story" text,
	"goal_cents" integer,
	"merch_config" jsonb DEFAULT '{}'::jsonb,
	"badge_previews" jsonb DEFAULT '{}'::jsonb,
	"started_at" timestamp,
	"review_status" text DEFAULT 'not_submitted' NOT NULL,
	"submitted_for_review_at" timestamp,
	"reviewed_at" timestamp,
	"reviewed_by_id" varchar,
	"review_notes" text,
	"believer_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_backing_campaigns_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "project_backings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"backer_id" varchar NOT NULL,
	"tier_id" varchar,
	"tier_name_at_backing" text,
	"amount_cents" integer NOT NULL,
	"tip_cents" integer DEFAULT 0 NOT NULL,
	"believer_number" integer,
	"message" text,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"stripe_checkout_session_id" varchar,
	"stripe_payment_intent_id" varchar,
	"stripe_charge_id" varchar,
	"stripe_transfer_id" varchar,
	"stripe_refund_id" varchar,
	"shipping_address" jsonb,
	"unclaimed_preference" text DEFAULT 'refund' NOT NULL,
	"refund_due_at" timestamp,
	"released_at" timestamp,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_backings_project_id_believer_number_unique" UNIQUE("project_id","believer_number")
);
--> statement-breakpoint
CREATE TABLE "project_chat_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_check_ins" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"week_start" timestamp NOT NULL,
	"goal" text NOT NULL,
	"proof" text NOT NULL,
	"blocker" text,
	"next_step" text NOT NULL,
	"visibility" text DEFAULT 'unlisted' NOT NULL,
	"needs_feedback" boolean DEFAULT false NOT NULL,
	"hidden_at" timestamp,
	"hidden_by_id" varchar,
	"hidden_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_check_ins_project_id_user_id_week_start_unique" UNIQUE("project_id","user_id","week_start")
);
--> statement-breakpoint
CREATE TABLE "project_code_audits" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"created_by_id" varchar NOT NULL,
	"source" text NOT NULL,
	"source_kind" text NOT NULL,
	"stage" text,
	"completion_percent" integer,
	"summary" text,
	"signals" jsonb DEFAULT '{}'::jsonb,
	"findings" jsonb DEFAULT '{}'::jsonb,
	"operations" jsonb DEFAULT '[]'::jsonb,
	"delta" jsonb,
	"runtime" jsonb,
	"data_shape" jsonb,
	"applied_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_comment_reactions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"reaction" text DEFAULT 'like' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_comment_reactions_comment_id_user_id_unique" UNIQUE("comment_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "project_comments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"author_id" varchar NOT NULL,
	"target_type" text NOT NULL,
	"target_id" varchar NOT NULL,
	"content" text NOT NULL,
	"mentions" jsonb DEFAULT '[]'::jsonb,
	"parent_comment_id" varchar,
	"reaction_count" integer DEFAULT 0 NOT NULL,
	"hidden_at" timestamp,
	"hidden_by_id" varchar,
	"hidden_reason" text,
	"hidden_mode" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_data_shapes" (
	"project_id" varchar PRIMARY KEY NOT NULL,
	"shape" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_decisions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"title" text NOT NULL,
	"decision" text NOT NULL,
	"context" text,
	"status" text DEFAULT 'proposed' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_deploy_checklist_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"item" text NOT NULL,
	"category" text DEFAULT 'other',
	"is_completed" boolean DEFAULT false,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_documents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"created_by_id" varchar NOT NULL,
	"title" text NOT NULL,
	"prompt" text,
	"source_task_id" varchar,
	"kind" text DEFAULT 'document' NOT NULL,
	"status" text DEFAULT 'planning' NOT NULL,
	"outline" jsonb DEFAULT '[]'::jsonb,
	"pages" jsonb DEFAULT '[]'::jsonb,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"file_id" varchar,
	"pdf_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_experiments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"hypothesis" text NOT NULL,
	"method" text,
	"status" text DEFAULT 'planned',
	"result" text,
	"start_date" timestamp,
	"end_date" timestamp,
	"metrics" text,
	"learnings" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_files" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"uploader_id" varchar NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"folder" text DEFAULT 'general',
	"file_type" text,
	"size" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_follows" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_follows_project_id_user_id_unique" UNIQUE("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "project_health_checks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"score" integer NOT NULL,
	"status" text NOT NULL,
	"summary" text NOT NULL,
	"findings" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_interviews" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"interviewee_name" text NOT NULL,
	"interviewee_role" text,
	"date" timestamp,
	"notes" text,
	"key_insights" text,
	"sentiment" text DEFAULT 'neutral',
	"status" text DEFAULT 'planned',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_kanban_tasks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'todo' NOT NULL,
	"assignee_id" varchar,
	"priority" text DEFAULT 'medium' NOT NULL,
	"due_date" timestamp,
	"order" integer DEFAULT 0 NOT NULL,
	"tags" varchar[] DEFAULT '{}',
	"estimate_hours" integer,
	"blocked_by_task_id" varchar,
	"subtasks" jsonb DEFAULT '[]'::jsonb,
	"milestone_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"started_by_id" varchar,
	"completed_at" timestamp,
	"completed_by_id" varchar
);
--> statement-breakpoint
CREATE TABLE "project_launch_tasks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"channel" text NOT NULL,
	"task" text NOT NULL,
	"status" text DEFAULT 'planned',
	"target_date" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_legal_docs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"doc_type" text NOT NULL,
	"title" text NOT NULL,
	"content" text,
	"status" text DEFAULT 'draft',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_links" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"label" text NOT NULL,
	"url" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_live_chat_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"role" text NOT NULL,
	"timezone" text,
	"availability" text,
	"hours_per_week" integer,
	"skills" varchar[]
);
--> statement-breakpoint
CREATE TABLE "project_merch_orders" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"backing_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb,
	"shipping_address" jsonb,
	"printful_order_id" varchar,
	"tracking_url" text,
	"last_error" text,
	"submitted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_milestones" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"target_date" timestamp,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_personas" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"name" text NOT NULL,
	"age" integer,
	"occupation" text,
	"bio" text,
	"goals" varchar[] DEFAULT '{}',
	"pain_points" varchar[] DEFAULT '{}',
	"quote" text,
	"avatar_description" text,
	"is_ai_generated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_pricing_tiers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"name" text NOT NULL,
	"price" integer DEFAULT 0,
	"billing_period" text DEFAULT 'monthly',
	"features" jsonb DEFAULT '[]'::jsonb,
	"limits" jsonb DEFAULT '{}'::jsonb,
	"is_featured" boolean DEFAULT false,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_roadmaps" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"goal" text NOT NULL,
	"summary" text,
	"starting_point" text,
	"target_date" timestamp,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"generated_on_tier" text,
	"last_updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_storyboards" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"style" text NOT NULL,
	"prompt" text,
	"storyboard" text NOT NULL,
	"scenes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"image_model" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_support_tickets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"submitter_email" text,
	"submitter_name" text,
	"subject" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'open',
	"priority" text DEFAULT 'medium',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_task_completions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"task_id" varchar NOT NULL,
	"completed_by_id" varchar,
	"title" text NOT NULL,
	"priority" text,
	"on_time" boolean DEFAULT true NOT NULL,
	"completed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_task_completions_task_id_unique" UNIQUE("task_id")
);
--> statement-breakpoint
CREATE TABLE "project_waitlist_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"source" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" varchar NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"goal" text DEFAULT 'ship_mvp' NOT NULL,
	"subcategory" text DEFAULT 'other' NOT NULL,
	"active_branch" text,
	"rejected_loops" text[] DEFAULT '{}' NOT NULL,
	"nova_notes" text,
	"data_source" text,
	"status" text DEFAULT 'planning' NOT NULL,
	"team_size" integer,
	"estimated_weeks" integer,
	"views" integer DEFAULT 0 NOT NULL,
	"total_donations" integer DEFAULT 0 NOT NULL,
	"media_urls" varchar[] DEFAULT '{}',
	"roles_needed" varchar[] DEFAULT '{}',
	"tech_stack" varchar[] DEFAULT '{}',
	"logo_url" text,
	"cover_url" text,
	"live_url" text,
	"repo_url" text,
	"business_plan_url" text,
	"application_questions" jsonb DEFAULT '[]'::jsonb,
	"problem_statement" text,
	"target_user" text,
	"success_metrics" text,
	"scope" jsonb,
	"one_liner" text,
	"mission" text,
	"value_proposition" text,
	"target_customer_profile" text,
	"public_sections" jsonb DEFAULT '{}'::jsonb,
	"landing_page_config" jsonb,
	"nova_onboarding_complete" boolean DEFAULT false,
	"solo_mode" boolean DEFAULT false,
	"is_private" boolean DEFAULT false NOT NULL,
	"external_traction_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_hits" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"action" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roadmap_phases" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"roadmap_id" varchar NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"estimated_duration" text,
	"outcomes" jsonb DEFAULT '[]'::jsonb,
	"skills_needed" varchar[] DEFAULT '{}',
	"status" text DEFAULT 'upcoming' NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"milestone_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_noise_games" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"scenario" text NOT NULL,
	"difficulty" text DEFAULT 'intermediate' NOT NULL,
	"cards" jsonb DEFAULT '[]'::jsonb,
	"decisions" jsonb DEFAULT '[]'::jsonb,
	"score" integer DEFAULT 0,
	"streak" integer DEFAULT 0,
	"accuracy" integer DEFAULT 0,
	"avg_reaction_ms" integer DEFAULT 0,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sprint_behavioral_metrics" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sprint_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"avg_response_time_minutes" integer DEFAULT 0,
	"tasks_completed" integer DEFAULT 0,
	"total_tasks" integer DEFAULT 0,
	"initiative_score" integer DEFAULT 0,
	"deadlines_respected" integer DEFAULT 0,
	"deadlines_total" integer DEFAULT 0,
	"conflict_markers" integer DEFAULT 0,
	"decision_latency_minutes" integer DEFAULT 0,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sprint_compatibility_reports" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sprint_id" varchar NOT NULL,
	"overall_score" integer DEFAULT 0 NOT NULL,
	"strengths" jsonb DEFAULT '[]'::jsonb,
	"risks" jsonb DEFAULT '[]'::jsonb,
	"recommendation" text,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sprint_compatibility_reports_sprint_id_unique" UNIQUE("sprint_id")
);
--> statement-breakpoint
CREATE TABLE "sprint_decisions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sprint_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"decision" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sprint_deliverables" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sprint_id" varchar NOT NULL,
	"type" text NOT NULL,
	"content" jsonb NOT NULL,
	"user_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sprint_kanban_tasks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sprint_id" varchar NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'todo' NOT NULL,
	"assignee_id" varchar,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sprint_matchmaking_queue" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"duration" text NOT NULL,
	"product_style" text,
	"status" text DEFAULT 'waiting' NOT NULL,
	"matched_sprint_id" varchar,
	"project_id" varchar,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sprint_matchmaking_queue_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "sprint_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sprint_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"content" text NOT NULL,
	"is_nova" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sprint_ratings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sprint_id" varchar NOT NULL,
	"rater_id" varchar NOT NULL,
	"ratee_id" varchar NOT NULL,
	"communication_clarity" integer NOT NULL,
	"reliability" integer NOT NULL,
	"would_build_long_term" boolean NOT NULL,
	"stress_level" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sprint_responses" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sprint_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"question_key" text NOT NULL,
	"answer" text NOT NULL,
	"is_nova" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" varchar PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "surface_flags" (
	"surface_id" varchar PRIMARY KEY NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_by_id" varchar,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tactics_games" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"map_size" integer DEFAULT 8 NOT NULL,
	"map_data" jsonb DEFAULT '{}'::jsonb,
	"current_round" integer DEFAULT 0 NOT NULL,
	"max_rounds" integer DEFAULT 10 NOT NULL,
	"winner_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tactics_moves" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" varchar NOT NULL,
	"round" integer NOT NULL,
	"player_id" varchar NOT NULL,
	"action_type" text NOT NULL,
	"target_position" jsonb,
	"target_player_id" varchar,
	"resolved" boolean DEFAULT false NOT NULL,
	"result" jsonb
);
--> statement-breakpoint
CREATE TABLE "tactics_players" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"team_id" integer NOT NULL,
	"role" text NOT NULL,
	"health" integer DEFAULT 100 NOT NULL,
	"position" jsonb DEFAULT '{"x":0,"y":0}'::jsonb,
	"resources" integer DEFAULT 50 NOT NULL,
	"is_alive" boolean DEFAULT true NOT NULL,
	"buffs" jsonb DEFAULT '[]'::jsonb
);
--> statement-breakpoint
CREATE TABLE "typing_race_players" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"race_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"wpm" integer DEFAULT 0,
	"accuracy" integer DEFAULT 100,
	"progress" integer DEFAULT 0,
	"chars_typed" integer DEFAULT 0,
	"errors" integer DEFAULT 0,
	"finish_time_ms" integer,
	"status" text DEFAULT 'waiting' NOT NULL,
	"score" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "typing_races" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"prompt_text" text NOT NULL,
	"prompt_category" text NOT NULL,
	"max_players" integer DEFAULT 6 NOT NULL,
	"started_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_badges" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"badge_id" varchar NOT NULL,
	"awarded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_follows" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"follower_id" varchar NOT NULL,
	"followee_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_follows_follower_id_followee_id_unique" UNIQUE("follower_id","followee_id")
);
--> statement-breakpoint
CREATE TABLE "user_matches" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"matched_user_id" varchar NOT NULL,
	"score" integer NOT NULL,
	"reasons" varchar[],
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_matches_user_id_matched_user_id_unique" UNIQUE("user_id","matched_user_id")
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"display_name" text,
	"username" text,
	"headline" text,
	"bio" text,
	"skills" varchar[],
	"interests" varchar[],
	"experience_level" text,
	"resume_url" text,
	"is_onboarded" boolean DEFAULT false NOT NULL,
	"github_url" text,
	"linkedin_url" text,
	"website_url" text,
	"location" text,
	"avatar_url" text,
	"cover_url" text,
	"hours_per_week" integer,
	"risk_tolerance" text,
	"speed_vs_polish" text,
	"schedule_style" text,
	"conflict_style" text,
	"builder_type" text,
	"experience" jsonb DEFAULT '[]'::jsonb,
	"education" jsonb DEFAULT '[]'::jsonb,
	"portfolio_projects" jsonb DEFAULT '[]'::jsonb,
	"nova_summary" text,
	"resume_parsed_at" timestamp,
	"looking_for" jsonb,
	CONSTRAINT "user_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "user_reputation_scores" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"execution_score" integer DEFAULT 0 NOT NULL,
	"contribution_score" integer DEFAULT 0 NOT NULL,
	"market_signal_score" integer DEFAULT 0 NOT NULL,
	"strategic_thinking_score" integer DEFAULT 0 NOT NULL,
	"builder_index" integer DEFAULT 0 NOT NULL,
	"details" jsonb,
	"last_calculated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_reputation_scores_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "user_task_stats" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"tasks_completed" integer DEFAULT 0 NOT NULL,
	"tasks_completed_on_time" integer DEFAULT 0 NOT NULL,
	"last_completed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"password_hash" varchar,
	"auth_provider" varchar DEFAULT 'local',
	"google_id" varchar,
	"stripe_customer_id" varchar,
	"stripe_subscription_id" varchar,
	"subscription_tier" varchar DEFAULT 'free',
	"credits_used" integer DEFAULT 0 NOT NULL,
	"credits_reset_at" timestamp,
	"stripe_connect_account_id" varchar,
	"platform_role" varchar DEFAULT 'user' NOT NULL,
	"suspended_at" timestamp,
	"suspended_reason" text,
	"signup_source" varchar,
	"signup_medium" varchar,
	"signup_campaign" varchar,
	"signup_referrer" text,
	"signup_landing_path" text,
	"signup_params" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id")
);
--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backer_badges" ADD CONSTRAINT "backer_badges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backer_badges" ADD CONSTRAINT "backer_badges_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cofounder_sprints" ADD CONSTRAINT "cofounder_sprints_user1_id_users_id_fk" FOREIGN KEY ("user1_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cofounder_sprints" ADD CONSTRAINT "cofounder_sprints_user2_id_users_id_fk" FOREIGN KEY ("user2_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cofounder_sprints" ADD CONSTRAINT "cofounder_sprints_source_project_id_projects_id_fk" FOREIGN KEY ("source_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_receiver_id_users_id_fk" FOREIGN KEY ("receiver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_target_owner_id_users_id_fk" FOREIGN KEY ("target_owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest_participants" ADD CONSTRAINT "contest_participants_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest_participants" ADD CONSTRAINT "contest_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contests" ADD CONSTRAINT "contests_badge_id_badges_id_fk" FOREIGN KEY ("badge_id") REFERENCES "public"."badges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_receiver_id_users_id_fk" FOREIGN KEY ("receiver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_donor_id_users_id_fk" FOREIGN KEY ("donor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_comments" ADD CONSTRAINT "feed_comments_post_id_feed_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."feed_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_comments" ADD CONSTRAINT "feed_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_posts" ADD CONSTRAINT "feed_posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_posts" ADD CONSTRAINT "feed_posts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_reactions" ADD CONSTRAINT "feed_reactions_post_id_feed_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."feed_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_reactions" ADD CONSTRAINT "feed_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_leaderboard" ADD CONSTRAINT "game_leaderboard_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_finding_feedback" ADD CONSTRAINT "health_finding_feedback_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_finding_feedback" ADD CONSTRAINT "health_finding_feedback_check_id_project_health_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."project_health_checks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_finding_feedback" ADD CONSTRAINT "health_finding_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investor_artifacts" ADD CONSTRAINT "investor_artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investor_artifacts" ADD CONSTRAINT "investor_artifacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loop_events" ADD CONSTRAINT "loop_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loop_events" ADD CONSTRAINT "loop_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD CONSTRAINT "mcp_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_refresh_tokens" ADD CONSTRAINT "mobile_refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_interview_turns" ADD CONSTRAINT "mock_interview_turns_interview_id_mock_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."mock_interviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_interviews" ADD CONSTRAINT "mock_interviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_interviews" ADD CONSTRAINT "mock_interviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nova_guide_messages" ADD CONSTRAINT "nova_guide_messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "path_pace" ADD CONSTRAINT "path_pace_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "path_pace_events" ADD CONSTRAINT "path_pace_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "path_work" ADD CONSTRAINT "path_work_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_activity_log" ADD CONSTRAINT "project_activity_log_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_activity_log" ADD CONSTRAINT "project_activity_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_analytics_events" ADD CONSTRAINT "project_analytics_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_applications" ADD CONSTRAINT "project_applications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_applications" ADD CONSTRAINT "project_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_backer_tiers" ADD CONSTRAINT "project_backer_tiers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_backing_campaigns" ADD CONSTRAINT "project_backing_campaigns_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_backing_campaigns" ADD CONSTRAINT "project_backing_campaigns_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_backings" ADD CONSTRAINT "project_backings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_backings" ADD CONSTRAINT "project_backings_backer_id_users_id_fk" FOREIGN KEY ("backer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_backings" ADD CONSTRAINT "project_backings_tier_id_project_backer_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."project_backer_tiers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_chat_messages" ADD CONSTRAINT "project_chat_messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_check_ins" ADD CONSTRAINT "project_check_ins_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_check_ins" ADD CONSTRAINT "project_check_ins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_code_audits" ADD CONSTRAINT "project_code_audits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_code_audits" ADD CONSTRAINT "project_code_audits_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_comment_reactions" ADD CONSTRAINT "project_comment_reactions_comment_id_project_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."project_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_comment_reactions" ADD CONSTRAINT "project_comment_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_comments" ADD CONSTRAINT "project_comments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_comments" ADD CONSTRAINT "project_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_data_shapes" ADD CONSTRAINT "project_data_shapes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_decisions" ADD CONSTRAINT "project_decisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_decisions" ADD CONSTRAINT "project_decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_deploy_checklist_items" ADD CONSTRAINT "project_deploy_checklist_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_experiments" ADD CONSTRAINT "project_experiments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_experiments" ADD CONSTRAINT "project_experiments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_follows" ADD CONSTRAINT "project_follows_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_follows" ADD CONSTRAINT "project_follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_health_checks" ADD CONSTRAINT "project_health_checks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_interviews" ADD CONSTRAINT "project_interviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_interviews" ADD CONSTRAINT "project_interviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_kanban_tasks" ADD CONSTRAINT "project_kanban_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_kanban_tasks" ADD CONSTRAINT "project_kanban_tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_kanban_tasks" ADD CONSTRAINT "project_kanban_tasks_milestone_id_project_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."project_milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_kanban_tasks" ADD CONSTRAINT "project_kanban_tasks_started_by_id_users_id_fk" FOREIGN KEY ("started_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_kanban_tasks" ADD CONSTRAINT "project_kanban_tasks_completed_by_id_users_id_fk" FOREIGN KEY ("completed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_launch_tasks" ADD CONSTRAINT "project_launch_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_legal_docs" ADD CONSTRAINT "project_legal_docs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_links" ADD CONSTRAINT "project_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_live_chat_messages" ADD CONSTRAINT "project_live_chat_messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_live_chat_messages" ADD CONSTRAINT "project_live_chat_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_merch_orders" ADD CONSTRAINT "project_merch_orders_backing_id_project_backings_id_fk" FOREIGN KEY ("backing_id") REFERENCES "public"."project_backings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_merch_orders" ADD CONSTRAINT "project_merch_orders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_personas" ADD CONSTRAINT "project_personas_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_pricing_tiers" ADD CONSTRAINT "project_pricing_tiers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_roadmaps" ADD CONSTRAINT "project_roadmaps_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_storyboards" ADD CONSTRAINT "project_storyboards_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_storyboards" ADD CONSTRAINT "project_storyboards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_support_tickets" ADD CONSTRAINT "project_support_tickets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_task_completions" ADD CONSTRAINT "project_task_completions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_task_completions" ADD CONSTRAINT "project_task_completions_completed_by_id_users_id_fk" FOREIGN KEY ("completed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_waitlist_entries" ADD CONSTRAINT "project_waitlist_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_phases" ADD CONSTRAINT "roadmap_phases_roadmap_id_project_roadmaps_id_fk" FOREIGN KEY ("roadmap_id") REFERENCES "public"."project_roadmaps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_phases" ADD CONSTRAINT "roadmap_phases_milestone_id_project_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."project_milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_noise_games" ADD CONSTRAINT "signal_noise_games_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_behavioral_metrics" ADD CONSTRAINT "sprint_behavioral_metrics_sprint_id_cofounder_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."cofounder_sprints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_behavioral_metrics" ADD CONSTRAINT "sprint_behavioral_metrics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_compatibility_reports" ADD CONSTRAINT "sprint_compatibility_reports_sprint_id_cofounder_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."cofounder_sprints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_decisions" ADD CONSTRAINT "sprint_decisions_sprint_id_cofounder_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."cofounder_sprints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_decisions" ADD CONSTRAINT "sprint_decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_deliverables" ADD CONSTRAINT "sprint_deliverables_sprint_id_cofounder_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."cofounder_sprints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_deliverables" ADD CONSTRAINT "sprint_deliverables_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_kanban_tasks" ADD CONSTRAINT "sprint_kanban_tasks_sprint_id_cofounder_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."cofounder_sprints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_kanban_tasks" ADD CONSTRAINT "sprint_kanban_tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_matchmaking_queue" ADD CONSTRAINT "sprint_matchmaking_queue_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_matchmaking_queue" ADD CONSTRAINT "sprint_matchmaking_queue_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_matchmaking_queue" ADD CONSTRAINT "sprint_matchmaking_queue_matched_sprint_fk" FOREIGN KEY ("matched_sprint_id") REFERENCES "public"."cofounder_sprints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_messages" ADD CONSTRAINT "sprint_messages_sprint_id_cofounder_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."cofounder_sprints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_messages" ADD CONSTRAINT "sprint_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_ratings" ADD CONSTRAINT "sprint_ratings_sprint_id_cofounder_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."cofounder_sprints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_ratings" ADD CONSTRAINT "sprint_ratings_rater_id_users_id_fk" FOREIGN KEY ("rater_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_ratings" ADD CONSTRAINT "sprint_ratings_ratee_id_users_id_fk" FOREIGN KEY ("ratee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_responses" ADD CONSTRAINT "sprint_responses_sprint_id_cofounder_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."cofounder_sprints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_responses" ADD CONSTRAINT "sprint_responses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surface_flags" ADD CONSTRAINT "surface_flags_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tactics_moves" ADD CONSTRAINT "tactics_moves_game_id_tactics_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."tactics_games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tactics_moves" ADD CONSTRAINT "tactics_moves_player_id_tactics_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."tactics_players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tactics_players" ADD CONSTRAINT "tactics_players_game_id_tactics_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."tactics_games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tactics_players" ADD CONSTRAINT "tactics_players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "typing_race_players" ADD CONSTRAINT "typing_race_players_race_id_typing_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."typing_races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "typing_race_players" ADD CONSTRAINT "typing_race_players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_badge_id_badges_id_fk" FOREIGN KEY ("badge_id") REFERENCES "public"."badges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_followee_id_users_id_fk" FOREIGN KEY ("followee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_matches" ADD CONSTRAINT "user_matches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_matches" ADD CONSTRAINT "user_matches_matched_user_id_users_id_fk" FOREIGN KEY ("matched_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_reputation_scores" ADD CONSTRAINT "user_reputation_scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_task_stats" ADD CONSTRAINT "user_task_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_events_seq_idx" ON "activity_events" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "activity_events_created_idx" ON "activity_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "activity_events_visitor_idx" ON "activity_events" USING btree ("visitor_id","created_at");--> statement-breakpoint
CREATE INDEX "IDX_mcp_tokens_user" ON "mcp_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "IDX_mobile_refresh_user" ON "mobile_refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "moderation_log_target_idx" ON "moderation_log" USING btree ("target_user_id","created_at");--> statement-breakpoint
CREATE INDEX "moderation_log_actor_idx" ON "moderation_log" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "moderation_log_content_idx" ON "moderation_log" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "path_work_task_idx" ON "path_work" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "project_follows_user_idx" ON "project_follows" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "rate_limit_hits_lookup_idx" ON "rate_limit_hits" USING btree ("user_id","action","created_at");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "user_follows_followee_idx" ON "user_follows" USING btree ("followee_id");