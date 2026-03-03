# SparkTower

## Overview
SparkTower is an AI-powered platform designed for entrepreneurs and freelancers, merging professional networking with project showcasing. It aims to foster project creation, team formation, and collaboration through intelligent matching and AI-guided tools, providing a comprehensive ecosystem for innovators to bring their ideas to life.

## User Preferences
I want iterative development.
Ask before making major changes.
Do not make changes to the folder `shared/`.
Do not make changes to the file `server/seed-stripe.ts`.

## System Architecture
**Frontend:** Built with React, TypeScript, Vite, Wouter, TanStack Query, Shadcn UI, Tailwind CSS, and Framer Motion. Features a green primary color, 0rem border-radius, Space Grotesk font, and full dark/light mode support.

**Backend:** Uses Express.js with TypeScript, Drizzle ORM, and PostgreSQL.

**AI Integration:** Leverages OpenAI's gpt-4o model via Replit AI Integrations for features like weighted profile matching, AI chatbot (Nova), storyboard generation, Kanban task generation, customer persona creation, people recommendations, progress summarization, gap detection, and co-founder sprint assistance.

**Authentication:** Custom system with email/password (bcrypt) and Google OAuth 2.0, utilizing Passport strategies and PostgreSQL session storage.

**Storage:** Replit Object Storage (GCS) handles media and document uploads via presigned URLs.

**Payments:** Stripe is integrated for donations (Checkout), subscriptions, and project owner payouts (Connect Express with a 10% platform fee), managed with `stripe-replit-sync`.

**Core Features:**
*   **Onboarding & Profile:** Multi-step wizard for profile creation, including skills, interests, experience, and project showcasing. Profiles feature tabs for About, Projects, Connections, Following, and Earnings.
*   **Weighted Profile Matching:** An algorithm matches users based on skills, interests, experience, projects, connections, co-founder compatibility, and builder score proximity, with AI-generated reasons.
*   **Nova AI Guide:** An intelligent, context-aware AI assistant (Nova) helps with project creation and management. It can update project fields, create tasks, and manage milestones.
*   **Project Manager Dashboard:** A 13-tab suite for project management, including:
    *   **Setup:** Project brief, scope planning, links hub, business plan upload, and Nova AI Insights.
    *   **Tasks:** Kanban board with AI task generation, subtasks, tags, estimates, dependencies, assignees, due dates, and priority.
    *   **Milestones:** Roadmap timeline view with status transitions and target dates.
    *   **Team:** Enhanced member cards with timezone, availability, skills, contribution tracking, and AI people recommendations.
    *   **Files:** File upload with categories, metadata, and filtering.
    *   **Activity:** Activity Feed, Decision Log, and Weekly Check-ins.
    *   **Personas:** AI-generated and manual customer personas.
    *   **Chat:** Real-time team chat.
*   **Media & Content:** Image/video uploads with AI-generated animated video storyboard slideshows.
*   **Community & Collaboration:** Connection requests, private messaging, project following, and project application system.
*   **Monetization & Gamification:** Stripe donations, badge system, contests/hackathons, and leaderboards.
*   **AI Credit System:** Subscription model (Free, Spark Pro, Spark Business, Spark Unlimited) providing monthly AI credits.
*   **Builder Reputation Index:** A multi-dimensional scoring system (Execution, Contribution, Market Signal, Strategic Thinking) with tiers and solo builder mode.
*   **Co-Founder Matching Engine:** A 3-step system including enhanced profile preferences, builder score comparison, and Trial Collaboration Mini Sprints (24h or 72h) with guided phases (Ideation, Alignment, Building, Validation, Review) and Nova AI assistance. Sprint creation is a 2-step flow (duration + style), then queue-based matchmaking with polling. After matching, each partner sees the other's profile and independently proposes a product name (or asks Nova AI); one is randomly selected. Key routes: POST/GET/DELETE `/api/sprints/queue`, GET `/api/sprints/queue/status`, POST `/api/sprints/:id/propose-name`. Schema includes `user1ProposedName` and `user2ProposedName` on `cofounder_sprints` table. **Practice Sprints:** Solo practice mode where Nova acts as AI co-founder partner (`isPractice: true`, `user1Id === user2Id`). Practice sprints cost 1 credit and Nova generates a product idea based on chosen style. Nova auto-generates ideation responses (with `nova_` prefix questionKeys) and auto-submits a "proceed" decision during review phase. Available from sprints listing (`/sprints/practice`), and contests page. All phases adapted for practice mode (custom text, no partner waiting, Nova avatar/name displayed).
*   **Games Arena:** Three competitive games (Team Tactics Arena, Velocity Type Arena, Signal vs. Noise) with leaderboards and badge rewards.

**Routing:** Uses Wouter for client-side routing, managing paths for authentication, onboarding, project management, profiles, community features, Nova AI, Stripe, and the Games Arena.

## External Dependencies
*   **OpenAI:** Used for AI functionalities (gpt-4o model) via Replit AI Integrations.
*   **Google OAuth 2.0:** For Google sign-in.
*   **Replit Object Storage (GCS):** For storing files (images, videos, documents).
*   **Stripe:** For payment processing (donations, subscriptions, payouts).
*   **PostgreSQL:** The primary database, accessed via Drizzle ORM.