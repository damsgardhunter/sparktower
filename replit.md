# SparkTower

SparkTower is a platform for entrepreneurs and freelancers to connect, collaborate, and build projects together. It combines LinkedIn-style networking with Kaggle-style project showcasing, powered by AI.

## Features

- **Replit Auth** - Login/signup with Google, GitHub, email via Replit OIDC
- **Onboarding Wizard** - Multi-step profile setup (skills, interests, experience, links)
- **AI Matchmaking** - OpenAI-powered user matching based on skills/interests/experience
- **AI Project Creation Chatbot** - Guided project planning with AI assistant (timeline, team size, tech stack)
- **Project Dashboard** - Code display, donation widget, stats (views, donations)
- **Leaderboard** - Ranked by most visited or most donations (gold/silver/bronze podium)
- **Discover** - Search and find other users by skills/interests
- **Dark/Light Mode** - Full theme support

## Stack

- **Frontend**: React + TypeScript + Vite + Wouter + TanStack Query + Shadcn UI + Tailwind CSS + Framer Motion
- **Backend**: Express.js + TypeScript + Drizzle ORM + PostgreSQL
- **AI**: OpenAI via Replit AI Integrations (gpt-5.2 for chat/matching, no API key needed)
- **Auth**: Replit Auth (OIDC)

## Project Structure

```
client/src/
  pages/
    landing.tsx         - Public landing page (unauthenticated)
    home.tsx            - Dashboard home (authenticated)
    onboarding.tsx      - Multi-step profile setup wizard
    profile.tsx         - User profile page (own + public)
    projects.tsx        - Browse all projects
    project-create.tsx  - AI-guided project creation
    project-dashboard.tsx - Individual project page
    matches.tsx         - AI-matched users
    leaderboard.tsx     - Project rankings
    discover.tsx        - Search users
  components/
    app-sidebar.tsx     - Navigation sidebar
    project-card.tsx    - Project card component
    user-card.tsx       - User/match card component
    skill-badge.tsx     - Skill tag badge
    donation-button.tsx - Donation modal + button
    code-display.tsx    - Code syntax display
    theme-toggle.tsx    - Dark/light mode toggle
    ThemeProvider.tsx   - Theme context
  hooks/
    use-auth.ts         - Auth state hook

server/
  index.ts              - Express server entry
  routes.ts             - All API routes
  storage.ts            - Database storage interface + implementation
  db.ts                 - Drizzle DB connection

shared/
  schema.ts             - All database schemas + TypeScript types
  models/auth.ts        - Replit Auth user/session models
```

## Database Schema

- `sessions` - Replit Auth sessions
- `users` - Replit Auth users
- `userProfiles` - Extended profile (skills, interests, experience, bio, links)
- `projects` - Projects with code, tech stack, stats
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
- `POST /api/chat` - AI chatbot for project planning (pre-creation)
- `GET/POST /api/projects/:id/chat` - AI chatbot for existing project
- `POST /api/projects/:id/donate` - Donate to a project
- `GET /api/matches` - Get user matches
- `POST /api/matches/generate` - Generate AI matches
- `GET /api/leaderboard?sortBy=views|donations` - Leaderboard
- `GET /api/users/search?q=` - Search users
- `GET /api/users/:id` - Public user profile + projects
- `POST /api/seed` - Seed demo data

## Routing

- `/` → Landing page (unauthenticated) or Home dashboard (authenticated + onboarded)
- `/onboarding` → Profile setup wizard (redirected here if not onboarded)
- `/projects` → Browse projects
- `/projects/new` → Create project (AI-guided)
- `/projects/:id` → Project dashboard
- `/profile` → My profile
- `/profile/:id` → Public profile
- `/matches` → AI matches
- `/leaderboard` → Leaderboard
- `/discover` → Discover users
