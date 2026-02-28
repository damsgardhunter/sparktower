# SparkTower

SparkTower is a platform for entrepreneurs and freelancers to connect, collaborate, and build projects together. It combines LinkedIn-style networking with Kaggle-style project showcasing, powered by AI.

## Features

- **Replit Auth** - Login/signup with Google, GitHub, email via Replit OIDC
- **Onboarding Wizard** - Multi-step profile setup (skills, interests, experience, links)
- **AI Matchmaking** - OpenAI-powered user matching based on skills/interests/experience
- **Nova AI Chatbot** - AI project partner named "Nova" with animated intro, guided project creation flow
- **Media Gallery** - Upload images/videos to showcase projects (via Replit Object Storage)
- **AI Video Generation** - Generate AI showcase storyboards for projects
- **Project Dashboard** - Media gallery, donation widget, stats (views, donations)
- **Leaderboard** - Ranked by most visited or most donations (gold/silver/bronze podium)
- **Discover** - Search and find other users by skills/interests
- **Dark/Light Mode** - Full theme support

## Stack

- **Frontend**: React + TypeScript + Vite + Wouter + TanStack Query + Shadcn UI + Tailwind CSS + Framer Motion
- **Backend**: Express.js + TypeScript + Drizzle ORM + PostgreSQL
- **AI**: OpenAI via Replit AI Integrations (gpt-5.2 for chat/matching, no API key needed)
- **Auth**: Replit Auth (OIDC)
- **Storage**: Replit Object Storage (GCS presigned URL flow for file uploads)

## Project Structure

```
client/src/
  pages/
    landing.tsx         - Public landing page (unauthenticated)
    home.tsx            - Dashboard home (authenticated)
    onboarding.tsx      - Multi-step profile setup wizard
    profile.tsx         - User profile page (own + public)
    projects.tsx        - Browse all projects
    project-create.tsx  - Nova AI-guided project creation
    project-dashboard.tsx - Individual project page with media gallery
    matches.tsx         - AI-matched users
    leaderboard.tsx     - Project rankings
    discover.tsx        - Search users
  components/
    app-sidebar.tsx     - Navigation sidebar
    project-card.tsx    - Project card component
    user-card.tsx       - User/match card component
    skill-badge.tsx     - Skill tag badge
    donation-button.tsx - Donation modal + button
    media-gallery.tsx   - Media upload/display gallery with lightbox
    ObjectUploader.tsx  - Uppy-based file upload component
    theme-toggle.tsx    - Dark/light mode toggle
    ThemeProvider.tsx    - Theme context
  hooks/
    use-auth.ts         - Auth state hook
    use-upload.ts       - File upload hook (presigned URL flow)

server/
  index.ts              - Express server entry
  routes.ts             - All API routes
  storage.ts            - Database storage interface + implementation
  db.ts                 - Drizzle DB connection
  replit_integrations/
    auth/               - Replit Auth integration
    object_storage/     - Object Storage (GCS) integration

shared/
  schema.ts             - All database schemas + TypeScript types
  models/auth.ts        - Replit Auth user/session models
```

## Database Schema

- `sessions` - Replit Auth sessions
- `users` - Replit Auth users
- `userProfiles` - Extended profile (skills, interests, experience, bio, links)
- `projects` - Projects with mediaUrls (text[]), tech stack, stats
- `projectMembers` - Team members per project
- `projectChatMessages` - AI chatbot conversation history per project
- `donations` - Donations to projects (in cents)
- `userMatches` - AI-generated user matches with scores and reasons

## Key API Routes

- `GET /api/auth/user` - Current authenticated user
- `GET/POST /api/profile` - User profile management
- `POST /api/profile/complete-onboarding` - Mark onboarding complete
- `GET /api/projects` - Browse projects (filter by category, status, techStack)
- `POST /api/projects` - Create project
- `GET /api/projects/:id` - Project details (auto-increments views)
- `POST /api/projects/:id/media` - Add media URL to project
- `DELETE /api/projects/:id/media/:index` - Remove media item
- `POST /api/projects/:id/generate-video` - Generate AI video storyboard
- `POST /api/chat` - Nova AI chatbot for project planning (pre-creation)
- `GET/POST /api/projects/:id/chat` - AI chatbot for existing project
- `POST /api/projects/:id/donate` - Donate to a project
- `GET /api/matches` - Get user matches
- `POST /api/matches/generate` - Generate AI matches
- `GET /api/leaderboard?sortBy=views|donations` - Leaderboard
- `GET /api/users/search?q=` - Search users
- `GET /api/users/:id` - Public user profile + projects
- `POST /api/uploads/request-url` - Get presigned URL for file upload
- `GET /objects/*` - Serve uploaded objects from storage
- `POST /api/seed` - Seed demo data

## Object Storage

Uses Replit Object Storage (GCS) with presigned URL flow:
1. Client requests presigned URL: POST /api/uploads/request-url (JSON metadata)
2. Client uploads file directly to GCS via presigned URL
3. Client saves the objectPath to the project's mediaUrls via POST /api/projects/:id/media

Environment variables: DEFAULT_OBJECT_STORAGE_BUCKET_ID, PUBLIC_OBJECT_SEARCH_PATHS, PRIVATE_OBJECT_DIR

## Routing

- `/` → Landing page (unauthenticated) or Home dashboard (authenticated + onboarded)
- `/onboarding` → Profile setup wizard (redirected here if not onboarded)
- `/projects` → Browse projects
- `/projects/new` → Create project (Nova AI-guided)
- `/projects/:id` → Project dashboard with media gallery
- `/profile` → My profile
- `/profile/:id` → Public profile
- `/matches` → AI matches
- `/leaderboard` → Leaderboard
- `/discover` → Discover users

## Important Notes

- Auth: Always use `<a href="/api/login">` not wouter `<Link>` for login buttons
- AI: gpt-5.2 model for all OpenAI calls
- Query keys: Use array segments like `["/api/projects", id]` for proper cache invalidation
- Nova: Named "Nova", friendly AI partner personality with animated intro (framer-motion)
- Design: Space Grotesk font, green primary (#96 85.19% 73.53%), radius: 0rem
