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

**AI Integration:** OpenAI's gpt-4o model is utilized via Replit AI Integrations for various AI functionalities including chatbot interactions, weighted profile matching, AI storyboard generation, Kanban task generation, customer persona creation, and people recommendations.

**Authentication:** Replit Auth (OIDC) handles user login and signup processes, supporting Google, GitHub, and email.

**Storage:** Replit Object Storage (GCS) is used for media and document uploads, employing a presigned URL flow for direct client-to-storage uploads.

**Payments:** Stripe is integrated for managing donations, subscriptions, and payouts. This includes Stripe Checkout for one-time donations, Stripe Connect Express for project owner payouts (with a 10% platform fee), and `stripe-replit-sync` for managing subscription products and prices.

**Core Features:**

*   **Onboarding & Profile:** A multi-step wizard guides users through profile creation, capturing skills, interests, experience, and project showcasing. Profiles include tabs for About, Projects, Connections, Following, and Earnings.
*   **Weighted Profile Matching:** An algorithm matches users based on skills (30%), interests (25%), experience (15%), projects (15%), and connections (15%), with AI-generated reasons for matches.
*   **Nova AI Chatbot:** An AI project partner named "Nova" assists with guided project creation and provides support within project dashboards. Nova has a friendly personality, a chip/CPU icon, and uses emoji+bold formatting in its responses.
*   **Project Management:** Project owners have a dedicated dashboard featuring an overview, a Kanban board (To Do, In Progress, Review, Done) with AI task generation, and AI-generated customer personas.
*   **Media & Content:** Users can upload images/videos to projects, and AI can generate animated video storyboard slideshows with various visual styles.
*   **Community & Collaboration:** Features include connection requests, real-time private messaging between connected users, project following, and a system for applying to projects with custom questions and resume uploads.
*   **Monetization & Gamification:** Stripe donations for projects, a badge system with rarity tiers, contests/hackathons, and a leaderboard (by visits or donations) are included.
*   **AI Credit System:** A subscription model (Free, Spark Pro, Spark Business, Spark Unlimited) provides monthly AI credits for various AI features, with costs per AI operation (e.g., Chat = 1, Video = 5).

**Routing:** The application uses Wouter for client-side routing, with distinct paths for authenticated and unauthenticated users, onboarding, project creation, management, profiles, and community features. Specific routes are dedicated to Nova AI interactions, project applications, and various Stripe-related flows.

## External Dependencies

*   **OpenAI:** Utilized for various AI functionalities (gpt-4o model) through Replit AI Integrations.
*   **Replit Auth:** For user authentication and authorization.
*   **Replit Object Storage (GCS):** For file storage (images, videos, resumes).
*   **Stripe:** For payment processing (donations via Checkout, subscriptions, payouts via Connect Express, billing portal).
*   **PostgreSQL:** The primary database for all application data, accessed via Drizzle ORM.