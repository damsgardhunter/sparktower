# SparkTower

SparkTower is a platform for entrepreneurs and freelancers to connect, collaborate, and build projects together. It combines LinkedIn-style networking with Kaggle-style project showcasing, powered by AI.

## Features

- **Replit Auth** - Login/signup with Google, GitHub, email via Replit OIDC
- **Onboarding Wizard** - Multi-step profile setup (skills, interests, experience, links, resume)
- **Weighted Profile Matching** - Algorithmic matching based on skills (30%), interests (25%), experience (15%), projects (15%), and connections (15%), with AI-generated match reasons
- **Nova AI Chatbot** - AI project partner named "Nova" with animated intro, guided project creation flow
- **Media Gallery** - Upload images/videos to showcase projects (via Replit Object Storage)
- **AI Video Storyboard Slideshow** - Generate AI storyboards with 4 visual styles (Professional, Futuristic, Funny, Cartoon), displayed as animated slideshow with auto-advance, navigation, and gradient scene cards
- **Contests** - Compete in hackathons and challenges. Filter by status. Join contests, submit entries, earn badges.
- **Badges** - Earned badges system with 4 rarity tiers (common, rare, epic, legendary)
- **Connections** - Send/accept/reject connection requests. Manage connections from profile page.
- **Live Messaging** - Private chat with connected users. Real-time polling, read indicators, unread count badge.
- **Stripe Donations** - Real Stripe checkout for project donations with preset amounts ($5, $10, $25, $50, custom)
- **Stripe Connect Payouts** - Project owners can connect bank accounts via Stripe Connect Express to receive donation payouts
- **Project Dashboard** - Media gallery, donation widget, stats (views, donations)
- **Profile Tabs** - About, Projects, Connections, Earnings tabs on profile page
- **Resume Upload** - Upload resume (PDF/DOC/DOCX) during onboarding and from edit profile dialog
- **Leaderboard** - Ranked by most visited or most donations (gold/silver/bronze podium)
- **Discover** - Search and find other users by skills/interests
- **Dark/Light Mode** - Full theme support
- **AI Credit Subscription System** - Stripe-powered subscription tiers with monthly credit limits:
  - Free: 20 credits/month
  - Spark Pro ($4.99/mo): 100 credits/month
  - Spark Business ($9.99/mo): 250 credits/month + private projects
  - Spark Unlimited ($29.99/mo): Unlimited credits + private projects + AI roadmap
  - Credit costs: Chat = 1 credit, Video generation = 5 credits
  - Credits reset monthly. Sidebar shows usage bar.

## Stack

- **Frontend**: React + TypeScript + Vite + Wouter + TanStack Query + Shadcn UI + Tailwind CSS + Framer Motion
- **Backend**: Express.js + TypeScript + Drizzle ORM + PostgreSQL
- **AI**: OpenAI via Replit AI Integrations (gpt-5.2 for chat/matching, no API key needed)
- **Auth**: Replit Auth (OIDC)
- **Storage**: Replit Object Storage (GCS presigned URL flow for file uploads)
- **Payments**: Stripe (subscriptions via stripe-replit-sync, donations via Checkout, payouts via Connect Express)

## Project Structure

```
client/src/
  pages/
    landing.tsx         - Public landing page (unauthenticated)
    home.tsx            - Dashboard home (authenticated)
    onboarding.tsx      - Multi-step profile setup wizard
    profile.tsx         - User profile with tabs (About, Projects, Connections, Earnings)
    projects.tsx        - Browse all projects
    nova-intro.tsx      - Futuristic Nova AI intro/transition page
    project-create.tsx  - Nova AI-guided project creation
    project-dashboard.tsx - Individual project page with media gallery
    matches.tsx         - AI-matched users (weighted algorithm)
    leaderboard.tsx     - Project rankings
    discover.tsx        - Discover users
    pricing.tsx         - Subscription plans + credit usage
    contests.tsx        - Contests & hackathons
    messages.tsx        - Private messaging with connections (split view, polling)
  components/
    app-sidebar.tsx     - Navigation sidebar with credit usage + unread message badge
    project-card.tsx    - Project card component
    user-card.tsx       - User/match card component
    skill-badge.tsx     - Skill tag badge
    donation-button.tsx - Stripe checkout donation with preset amounts
    media-gallery.tsx   - Media upload/display gallery with lightbox
    storyboard-slideshow.tsx - AI storyboard slideshow viewer
    ObjectUploader.tsx  - Uppy-based file upload component
    theme-toggle.tsx    - Dark/light mode toggle
    ThemeProvider.tsx    - Theme context
  hooks/
    use-auth.ts         - Auth state hook
    use-upload.ts       - File upload hook (presigned URL flow)

server/
  index.ts              - Express server entry (Stripe webhook before express.json, Stripe init on startup)
  routes.ts             - All API routes (connections, messages, donations, matching, Stripe)
  storage.ts            - Database storage interface + implementation
  db.ts                 - Drizzle DB connection
  stripeClient.ts       - Stripe client (fetches credentials from Replit connection API)
  webhookHandlers.ts    - Stripe webhook processing (subscriptions, donations via checkout)
  seed-stripe.ts        - Script to seed Stripe products/prices
  replit_integrations/
    auth/               - Replit Auth integration
    object_storage/     - Object Storage (GCS) integration

shared/
  schema.ts             - All database schemas + TypeScript types
  models/auth.ts        - Replit Auth user/session models
```

## Database Schema

- `sessions` - Replit Auth sessions
- `users` - Replit Auth users (+ stripeCustomerId, stripeSubscriptionId, subscriptionTier, creditsUsed, creditsResetAt, stripeConnectAccountId)
- `userProfiles` - Extended profile (displayName, username, skills, interests, experience, bio, resumeUrl, links)
- `projects` - Projects with mediaUrls, rolesNeeded, techStack, stats
- `projectMembers` - Team members per project
- `projectChatMessages` - AI chatbot conversation history per project
- `donations` - Donations to projects (in cents), recorded via Stripe webhook
- `userMatches` - Weighted profile matches with scores and reasons
- `badges` - Badge definitions (name, description, icon, rarity, category)
- `userBadges` - Badges awarded to users
- `contests` - Contests/hackathons
- `contestParticipants` - Contest participants with submissions
- `connections` - Connection requests between users (pending/accepted/rejected)
- `directMessages` - Private messages between connected users (with read status)
- `stripe.*` - Auto-managed by stripe-replit-sync

## Key API Routes

- `GET /api/auth/user` - Current authenticated user
- `GET/POST /api/profile` - User profile management
- `POST /api/profile/complete-onboarding` - Mark onboarding complete
- `GET /api/projects` - Browse projects
- `POST /api/projects` - Create project
- `GET /api/projects/:id` - Project details
- `POST /api/projects/:id/media` - Add media URL to project
- `DELETE /api/projects/:id/media/:index` - Remove media item
- `POST /api/projects/:id/generate-video` - Generate AI storyboard (5 credits)
- `POST /api/chat` - Nova AI chatbot for project planning (1 credit)
- `GET/POST /api/projects/:id/chat` - AI chatbot for existing project (1 credit)
- `POST /api/projects/:id/donate` - Legacy donation (internal)
- `POST /api/projects/:id/donate-checkout` - Stripe checkout donation
- `GET /api/user/projects` - Current user's own + member projects
- `GET /api/matches` - Get user matches
- `POST /api/matches/generate` - Generate weighted matches (1 credit for AI reasons)
- `GET /api/leaderboard?sortBy=views|donations` - Leaderboard
- `GET /api/users/search?q=` - Search users
- `GET /api/users/:id` - Public user profile + projects
- `POST /api/uploads/request-url` - Get presigned URL for file upload
- `GET /objects/*` - Serve uploaded objects from storage
- `GET /api/badges` - List all badges
- `GET /api/users/:userId/badges` - Get badges earned by a user
- `GET /api/contests` - List contests
- `GET /api/contests/:id` - Contest details
- `GET /api/contests/:id/participants` - Contest participants
- `POST /api/contests/:id/join` - Join a contest
- `POST /api/contests/:id/submit` - Submit entry
- `POST /api/connections/request` - Send connection request
- `POST /api/connections/:id/accept` - Accept connection
- `POST /api/connections/:id/reject` - Reject connection
- `DELETE /api/connections/:id` - Remove connection
- `GET /api/connections` - Get accepted connections
- `GET /api/connections/requests` - Get pending incoming requests
- `GET /api/connections/status/:userId` - Check connection status
- `GET /api/messages/conversations` - List conversations with latest message + unread count
- `GET /api/messages/:userId` - Get messages with a user
- `POST /api/messages/:userId` - Send message (must be connected)
- `POST /api/messages/:userId/read` - Mark messages as read
- `GET /api/messages/unread-count` - Total unread message count
- `GET /api/subscription` - Subscription info
- `GET /api/plans` - Available subscription plans
- `POST /api/checkout` - Stripe checkout for subscription
- `POST /api/billing-portal` - Stripe billing portal
- `POST /api/stripe/sync-subscription` - Sync subscription status
- `POST /api/stripe/connect-account` - Create Stripe Connect Express account
- `GET /api/stripe/connect-onboarding` - Get Connect onboarding link
- `GET /api/stripe/connect-dashboard` - Get Connect dashboard link
- `GET /api/payouts` - Get donation earnings summary
- `POST /api/stripe/webhook` - Stripe webhook endpoint
- `POST /api/seed` - Seed demo data

## Stripe Integration

- Products/prices seeded via `server/seed-stripe.ts` (run with `npx tsx server/seed-stripe.ts`)
- Webhook route registered BEFORE `express.json()` in server/index.ts (critical for raw Buffer)
- stripe-replit-sync manages the `stripe` schema automatically — never create tables manually
- Subscription tier changes update users.subscriptionTier via webhook events and POST /api/stripe/sync-subscription
- Donations via Stripe Checkout → checkout.session.completed webhook creates donation record
- Stripe Connect Express for project owner payouts — 10% platform fee on donations
- Credits deducted after successful AI calls; 403 returned when insufficient

## Weighted Matching Algorithm

Skills overlap: 30% (Jaccard similarity), Interests: 25% (Jaccard), Experience compatibility: 15% (same=100%, adjacent=70%, far=40%), Project involvement: 15% (shared categories, complementary roles), Connection proximity: 15% (mutual connections). AI generates human-readable match reasons (1 credit).

## Object Storage

Uses Replit Object Storage (GCS) with presigned URL flow:
1. Client requests presigned URL: POST /api/uploads/request-url
2. Client uploads file directly to GCS via presigned URL
3. Client saves the objectPath to the project's mediaUrls or user's resumeUrl

## Routing

- `/` → Landing page (unauthenticated) or Home dashboard (authenticated + onboarded)
- `/onboarding` → Profile setup wizard
- `/projects` → Browse projects
- `/projects/new` → Nova AI intro/transition page
- `/projects/new/create` → Create project (Nova AI-guided)
- `/projects/:id` → Project dashboard
- `/profile` → My profile (tabs: About, Projects, Connections, Earnings)
- `/profile/:id` → Public profile
- `/matches` → AI matches
- `/leaderboard` → Leaderboard
- `/discover` → Discover users
- `/contests` → Contests & hackathons
- `/messages` → Private messaging with connections
- `/pricing` → Subscription plans & credit usage

## Important Notes

- Auth: Always use `<a href="/api/login">` not wouter `<Link>` for login buttons
- AI: gpt-5.2 model for all OpenAI calls
- Query keys: Use array segments like `["/api/projects", id]` for proper cache invalidation
- Nova: Named "Nova", friendly AI partner personality, chip/CPU icon, decryption animation intro, emoji+bold formatting
- Roles: Predefined selectable list (29 roles)
- Categories: 21 categories
- Design: Space Grotesk font, green primary, radius: 0rem
- Stripe: Webhook must be BEFORE express.json() in index.ts; never write to stripe.* schema directly
- Credits: Chat = 1 credit, Video = 5 credits; deducted after successful AI call; 403 if insufficient
- Messaging: Only connected users can message each other; polling every 3s for messages
- Connections: Send request → accept/reject → connected → can message
