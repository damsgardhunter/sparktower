# SparkTower

## Overview

SparkTower is an AI-powered platform designed for entrepreneurs and freelancers to connect, collaborate, and build projects. It merges professional networking akin to LinkedIn with project showcasing features similar to Kaggle. The platform aims to foster project creation, team formation, and collaboration through intelligent matching and AI-guided tools, providing a comprehensive ecosystem for innovators to bring their ideas to life.

## User Preferences

I want iterative development.
Ask before making major changes.
Do not make changes to the folder `shared/`.
Do not make changes to the file `server/seed-stripe.ts`.

## System Architecture

**Frontend:** The user interface is built with React, TypeScript, Vite, Wouter for routing, TanStack Query for data fetching, Shadcn UI, and Tailwind CSS for styling, enhanced with Framer Motion for animations. The design uses the Space Grotesk font, a green primary color, and a border-radius of 0rem. Dark/Light mode is fully supported.

**Backend:** The server-side is implemented using Express.js with TypeScript, Drizzle ORM for database interactions, and PostgreSQL as the primary database.

**AI Integration:** OpenAI's gpt-4o model is utilized via Replit AI Integrations for various AI functionalities including chatbot interactions, weighted profile matching, AI storyboard generation, Kanban task generation, customer persona creation, people recommendations, progress summarization, and gap detection.

**Authentication:** Custom auth system with email/password registration (bcrypt hashing) and Google OAuth 2.0. Uses passport-local and passport-google-oauth20 strategies with PostgreSQL session storage. Google OAuth requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.

**Storage:** Replit Object Storage (GCS) is used for media and document uploads, employing a presigned URL flow for direct client-to-storage uploads.

**Payments:** Stripe is integrated for managing donations, subscriptions, and payouts. This includes Stripe Checkout for one-time donations, Stripe Connect Express for project owner payouts (with a 10% platform fee), and `stripe-replit-sync` for managing subscription products and prices.

**Core Features:**

*   **Onboarding & Profile:** A multi-step wizard guides users through profile creation, capturing skills, interests, experience, and project showcasing. Profiles include tabs for About, Projects, Connections, Following, and Earnings.
*   **Weighted Profile Matching:** An algorithm matches users based on skills (30%), interests (25%), experience (15%), projects (15%), and connections (15%), with AI-generated reasons for matches.
*   **Nova AI Chatbot:** An AI project partner named "Nova" assists with guided project creation and provides support within project dashboards. Nova has a friendly personality, a chip/CPU icon, and uses emoji+bold formatting in its responses.
*   **Nova AI Guide:** An intelligent onboarding assistant and persistent project partner:
    *   **Onboarding Mode:** Full-screen overlay chat on first visit to PM. Walks user through project brief, positioning (one-liner, value prop, target customer), scope, tasks, and milestones. Quick-reply buttons for common starting points.
    *   **Widget Mode:** After onboarding, appears as floating Cpu icon button in bottom-right corner. Expands to chat panel. Context-aware (knows current tab).
    *   **AI Actions:** Nova can directly update project fields (`update_project`), create kanban tasks (`create_tasks`), create milestones (`create_milestones` - premium only), and update scope (`update_scope`). Actions show as inline cards in chat.
    *   **Routes:** GET/POST `/api/projects/:id/nova-guide` (message history), POST `/api/projects/:id/nova-guide/complete-onboarding`
    *   **Table:** `nova_guide_messages` (id, projectId, role, content, actionsTaken jsonb, createdAt)
    *   **Column:** `nova_onboarding_complete` boolean on projects table
    *   **Credit cost:** 1 per message. Welcome message is free (client-side).
    *   **Component:** `client/src/components/nova-guide.tsx`
*   **Project Manager Dashboard:** A comprehensive 13-tab project management suite:
    *   **Setup Tab:** Project brief (one-liner positioning, value proposition, target customer profile, problem statement, target user, success metrics), scope planning (MVP vs Nice-to-Have), links hub (repo, docs, design, drive, notes), business plan upload, application questions, and Nova AI Insights (progress summary + gap detection).
    *   **Tasks Tab:** Kanban board (To Do, In Progress, Review, Done) with AI task generation. Tasks support subtasks (checklist with progress bar), tags (colored chips), hour estimates, blocked-by dependencies (lock icon), assignees, due dates, and priority levels.
    *   **Milestones Tab:** Roadmap timeline view with milestone cards. Milestones have status transitions (planned → in-progress → completed) and target dates.
    *   **Team Tab:** Enhanced member cards with timezone, availability, hours/week, skills, and contribution tracking (completed/in-progress task counts). Includes pending application review and AI people recommendations.
    *   **Files Tab:** File upload with folder categories (general/design/docs/data), file list with metadata (name, type, uploader, date, size), folder filtering.
    *   **Activity Tab:** Three sections — Activity Feed (chronological event log with user avatars), Decision Log (title/context/decision with proposed/accepted/revisited status), Weekly Check-ins (did/doing/blockers format).
    *   **Personas Tab:** AI-generated and manually created customer personas with goals, pain points, and quotes.
    *   **Chat Tab:** Live team chat for project members. Real-time messaging with 3-second polling, message bubbles aligned by sender, user avatars. Only accessible to project owner and members.
*   **Media & Content:** Users can upload images/videos to projects, and AI can generate animated video storyboard slideshows with various visual styles.
*   **Community & Collaboration:** Features include connection requests, real-time private messaging between connected users, project following, and a system for applying to projects with custom questions and resume uploads.
*   **Monetization & Gamification:** Stripe donations for projects, a badge system with rarity tiers, contests/hackathons, and a leaderboard (by visits or donations) are included.
*   **AI Credit System:** A subscription model (Free, Spark Pro, Spark Business, Spark Unlimited) provides monthly AI credits for various AI features, with costs per AI operation (Chat=1, Video=5, Match=1, Kanban AI=1, Persona AI=1, People Rec=1, Summarize=1, Detect Gaps=1).

**Database Tables (new for Project Manager):**
*   `projectMilestones` — id, projectId, title, description, status, targetDate, order, createdAt
*   `projectActivityLog` — id, projectId, userId, action, entityType, entityId, metadata (jsonb), createdAt
*   `projectDecisions` — id, projectId, userId, title, decision, context, status, createdAt
*   `projectCheckIns` — id, projectId, userId, did, doing, blockers, createdAt
*   `projectFiles` — id, projectId, uploaderId, name, url, folder, fileType, size, createdAt
*   `projectLinks` — id, projectId, label, url, category, createdAt
*   `projectLiveChatMessages` — id, projectId, userId (ref users), content, createdAt

**Enhanced columns:**
*   `projects` — added: problemStatement, targetUser, successMetrics, scope (jsonb)
*   `projectKanbanTasks` — added: tags (text[]), estimateHours, blockedByTaskId, subtasks (jsonb)
*   `projectMembers` — added: timezone, availability, hoursPerWeek, skills (text[])

**Games Arena (Contests System):**
Three competitive games integrated into the Contests page, each with leaderboards and badge rewards:

*   **Team Tactics Arena** (`/games/tactics`, `/games/tactics/:id`): Turn-based tactical strategy on an 8x8 grid. 5 roles (Commander, Warrior, Strategist, Scout, Engineer) with asymmetric stats. Teams of 1-5 coordinate via discussion phases. Routes: create, lobby, join, start, move, resolve. Tables: `tacticsGames`, `tacticsPlayers`, `tacticsMoves`. Badges: first-game, veteran, legend.
*   **Velocity Type Arena** (`/games/typing`, `/games/typing/:id`): Competitive typing races with 20+ builder-focused prompts (startup pitches, code snippets, product specs). 2-6 players race with live progress bars. Scoring: WPM × accuracy. Routes: create, lobby, join, start, progress, finish. Tables: `typingRaces`, `typingRacePlayers`. Badges: first-race, speed-demon (80+ WPM), perfect-accuracy.
*   **Signal vs. Noise** (`/games/signal-noise`): Solo decision-making game. Sort cards into Signal (keep) or Noise (discard) under time pressure across 10 scenarios (MVP Launch, Fundraising, Hiring, etc.) with 3 difficulty levels. Routes: scenarios, start, decide, complete. Table: `signalNoiseGames`. Badges: first-game, streak-10, ace (90%+ advanced).
*   **Shared Leaderboard**: `gameLeaderboard` table stores scores for all three games by gameType.

**Routing:** The application uses Wouter for client-side routing, with distinct paths for authenticated and unauthenticated users, onboarding, project creation, management, profiles, and community features. Specific routes are dedicated to Nova AI interactions, project applications, various Stripe-related flows, and the Games Arena.

## External Dependencies

*   **OpenAI:** Utilized for various AI functionalities (gpt-4o model) through Replit AI Integrations.
*   **Google OAuth 2.0:** For Google sign-in (requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars).
*   **Replit Object Storage (GCS):** For file storage (images, videos, resumes, project files).
*   **Stripe:** For payment processing (donations via Checkout, subscriptions, payouts via Connect Express, billing portal).
*   **PostgreSQL:** The primary database for all application data, accessed via Drizzle ORM.
