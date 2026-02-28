# SparkTower

SparkTower is a platform for entrepreneurs and freelancers to connect, collaborate, and build projects together. It combines LinkedIn-style networking with Kaggle-style project showcasing, powered by AI.

## Features

- **Replit Auth** - Login/signup with Google, GitHub, email via Replit OIDC
- **Onboarding Wizard** - Multi-step profile setup (skills, interests, experience, links)
- **AI Matchmaking** - OpenAI-powered user matching based on skills/interests/experience
- **Nova AI Chatbot** - AI project partner named "Nova" with animated intro, guided project creation flow
- **Media Gallery** - Upload images/videos to showcase projects (via Replit Object Storage)
- **AI Video Storyboard Slideshow** - Generate AI storyboards with 4 visual styles (Professional, Futuristic, Funny, Cartoon), displayed as animated slideshow with auto-advance, navigation, and gradient scene cards. Generated scene images are automatically saved to Object Storage and added to project media gallery.
- **Contests** - Compete in hackathons and challenges. Filter by status (active, upcoming, judging, completed). Join contests, submit entries, earn badges. Featured contests highlighted with promotional cards.
- **Badges** - Earned badges system with 4 rarity tiers (common, rare, epic, legendary). Badges displayed on user profiles. Contest winners can earn special badges.
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
    nova-intro.tsx      - Futuristic Nova AI intro/transition page
    project-create.tsx  - Nova AI-guided project creation with image upload, integrations
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
    storyboard-slideshow.tsx - AI storyboard slideshow viewer (auto-advance, navigation, gradient cards)
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
- `userProfiles` - Extended profile (displayName, username, skills, interests, experience, bio, resumeUrl, links)
- `projects` - Projects with mediaUrls (text[]), rolesNeeded (text[]), techStack (text[]), repoUrl, liveUrl, stats
- `projectMembers` - Team members per project
- `projectChatMessages` - AI chatbot conversation history per project
- `donations` - Donations to projects (in cents)
- `userMatches` - AI-generated user matches with scores and reasons
- `badges` - Badge definitions (name, description, icon, rarity, category)
- `userBadges` - Badges awarded to users
- `contests` - Contests/hackathons (title, description, category, difficulty, status, prize, dates, badgeId)
- `contestParticipants` - Contest participants with submissions

## Key API Routes

- `GET /api/auth/user` - Current authenticated user
- `GET/POST /api/profile` - User profile management
- `POST /api/profile/complete-onboarding` - Mark onboarding complete
- `GET /api/projects` - Browse projects (filter by category, status)
- `POST /api/projects` - Create project
- `GET /api/projects/:id` - Project details (auto-increments views)
- `POST /api/projects/:id/media` - Add media URL to project
- `DELETE /api/projects/:id/media/:index` - Remove media item
- `POST /api/projects/:id/generate-video` - Generate AI storyboard + scene descriptions (accepts style: professional|futuristic|funny|cartoon)
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
- `GET /api/badges` - List all badges
- `GET /api/users/:userId/badges` - Get badges earned by a user
- `GET /api/contests` - List contests (filter by ?status=active|upcoming|judging|completed)
- `GET /api/contests/:id` - Contest details
- `GET /api/contests/:id/participants` - Contest participants
- `POST /api/contests/:id/join` - Join a contest
- `POST /api/contests/:id/submit` - Submit entry to a contest
- `POST /api/seed` - Seed demo data (users, projects, badges, contests)

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
- `/projects/new` → Nova AI intro/transition page (futuristic animation)
- `/projects/new/create` → Create project (Nova AI-guided chat with image upload, integrations)
- `/projects/:id` → Project dashboard with media gallery
- `/profile` → My profile
- `/profile/:id` → Public profile
- `/matches` → AI matches
- `/leaderboard` → Leaderboard
- `/discover` → Discover users
- `/contests` → Contests & hackathons

## Important Notes

- Auth: Always use `<a href="/api/login">` not wouter `<Link>` for login buttons
- AI: gpt-5.2 model for all OpenAI calls
- Query keys: Use array segments like `["/api/projects", id]` for proper cache invalidation
- Nova: Named "Nova", friendly AI partner personality, chip/CPU icon, decryption animation intro, emoji+bold formatting
- Nova intro: /projects/new shows futuristic transition page with chip icon, decryption text animation, particle field
- Roles: Predefined selectable list (29 roles) — replaced free-text input with dropdown multi-select
- Categories: Expanded to 21 categories (Web App, Mobile App, AI/ML, SaaS, Fintech, Sustainability, IoT, Design, Data Analytics, Marketing, E-Commerce, Education, Healthcare, Social Media, Gaming, Blockchain, Content Creation, DevOps, Research, Nonprofit, Other)
- Tech stack: manual tag input on project creation + Nova can auto-populate via chat; displayed on project dashboard
- Nova prompt encourages users to add GitHub/portfolio links for traction
- Design: Space Grotesk font, green primary (#96 85.19% 73.53%), radius: 0rem
