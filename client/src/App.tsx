import { Switch, Route, Redirect, useLocation } from "wouter";
import { useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemeToggle } from "@/components/theme-toggle";
import LandingPage from "@/pages/landing";
import Home from "@/pages/home";
import Projects from "@/pages/projects";
import NovaIntro from "@/pages/nova-intro";
import ProjectCreate from "@/pages/project-create";
import ProjectDashboard from "@/pages/project-dashboard";
import Matches from "@/pages/matches";
import Leaderboard from "@/pages/leaderboard";
import Discover from "@/pages/discover";
import Onboarding from "@/pages/onboarding";
import DocumentBuilder from "@/pages/document-builder";
import Profile from "@/pages/profile";
import Contests from "@/pages/contests";
import Pricing from "@/pages/pricing";
import BackingReview from "@/pages/backing-review";
import CheckInDetail from "@/pages/check-in-detail";
import { useSurfaces } from "@/hooks/use-surfaces";
import { isPathDisabled } from "@shared/surfaces";
import FeedbackQueue from "@/pages/feedback-queue";
import LoopMetrics from "@/pages/loop-metrics";
import AdminSurfaces from "@/pages/admin-surfaces";
import AdminReports from "@/pages/admin-reports";
import AdminAnalytics from "@/pages/admin-analytics";
import { installAnalytics, trackPageView } from "@/lib/analytics";
import Messages from "@/pages/messages";
import ProjectManager from "@/pages/project-manager";
import TypingArena from "@/pages/games/typing-arena";
import SignalNoise from "@/pages/games/signal-noise";
import Sprints from "@/pages/sprints";
import SprintMatchmaking from "@/pages/sprint-matchmaking";
import SprintDashboard from "@/pages/sprint-dashboard";
import SprintPractice from "@/pages/sprint-practice";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import type { UserProfile } from "@shared/schema";
import { Loader2 } from "lucide-react";

/**
 * Reports every page change to the behaviour stream.
 *
 * Sits above the auth gate deliberately: a visitor who reads the landing page
 * and leaves without signing up is exactly the behaviour worth seeing, and
 * putting this inside the signed-in tree would make them invisible.
 */
function usePageTracking() {
  const [location] = useLocation();
  useEffect(() => { installAnalytics(); }, []);
  useEffect(() => { trackPageView(location); }, [location]);
}

function Router() {
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const { enabled: surfaces } = useSurfaces();
  usePageTracking();
  const { data: profile, isLoading: profileLoading } = useQuery<UserProfile | null>({
    queryKey: ["/api/profile"],
    queryFn: async () => {
      const res = await fetch("/api/profile", { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: isAuthenticated,
    retry: false,
  });

  if (authLoading || (isAuthenticated && profileLoading)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  /*
   * Routes that work with no account at all.
   *
   * A check-in permalink is the artifact the weekly loop produces — it gets
   * sent to people who have never heard of SparkTower, and bouncing them to a
   * landing page would make the whole share step pointless. Checked before
   * both the auth gate and the onboarding redirect so neither can swallow it.
   */
  const isPublicRoute = /^\/c\/[^/]+$/.test(window.location.pathname);
  if (isPublicRoute) {
    return (
      <Switch>
        <Route path="/c/:id" component={CheckInDetail} />
      </Switch>
    );
  }

  if (!isAuthenticated) {
    return (
      <Switch>
        <Route path="/" component={LandingPage} />
        <Route>
          <Redirect to="/" />
        </Route>
      </Switch>
    );
  }

  /*
   * Anyone who hasn't finished onboarding goes to onboarding — including
   * anyone with no profile row at all.
   *
   * This used to read `profile && !profile.isOnboarded`, which a *missing*
   * profile fails: the accounts most in need of onboarding were the ones waved
   * through it, landing in the app with no name and no way back. Profiles are
   * now created at sign-up (server/user-provisioning.ts), so a null here means
   * something went wrong — and onboarding is the right place to end up either
   * way. Safe because the loading branch above has already settled the query.
   */
  if (!profile?.isOnboarded && window.location.pathname !== "/onboarding") {
    return <Redirect to="/onboarding" />;
  }

  /*
   * A route whose surface is off resolves to NotFound rather than rendering.
   * The server already refuses the data, so without this the page would load
   * and then sit empty — which reads as broken rather than absent.
   */
  if (isPathDisabled(window.location.pathname, surfaces)) {
    return (
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <main className="flex-1 overflow-hidden"><NotFound /></main>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full">
      <AppSidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <header className="flex items-center justify-between p-4 border-b border-border bg-background/50 backdrop-blur-sm z-10">
          <SidebarTrigger data-testid="button-sidebar-toggle" />
          <div className="flex items-center gap-4">
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/onboarding" component={Onboarding} />
            <Route path="/projects" component={Projects} />
            <Route path="/projects/new" component={NovaIntro} />
            <Route path="/projects/new/create" component={ProjectCreate} />
            {/* Before /projects/:id so the builder path isn't swallowed by it. */}
            <Route path="/projects/:projectId/documents/:docId" component={DocumentBuilder} />
            <Route path="/projects/:id/manage" component={ProjectManager} />
            <Route path="/projects/:id" component={ProjectDashboard} />
            <Route path="/profile" component={Profile} />
            <Route path="/profile/:id" component={Profile} />
            <Route path="/matches" component={Matches} />
            <Route path="/leaderboard" component={Leaderboard} />
            <Route path="/discover" component={Discover} />
            {/* Hidden from nav, still reachable by direct link. */}
            <Route path="/contests" component={Contests} />
            <Route path="/games/typing/:id" component={TypingArena} />
            <Route path="/games/typing" component={TypingArena} />
            <Route path="/games/signal-noise" component={SignalNoise} />
            <Route path="/sprints" component={Sprints} />
            <Route path="/sprints/new" component={SprintMatchmaking} />
            <Route path="/sprints/practice" component={SprintPractice} />
            <Route path="/sprints/:id" component={SprintDashboard} />
            <Route path="/messages" component={Messages} />
            <Route path="/pricing" component={Pricing} />
            {/* Reviewer-only. The page itself renders NotFound for anyone
                else, matching what the API tells them. */}
            <Route path="/admin/backing" component={BackingReview} />
            <Route path="/c/:id" component={CheckInDetail} />
            <Route path="/feedback" component={FeedbackQueue} />
            <Route path="/admin/loop-metrics" component={LoopMetrics} />
            <Route path="/admin/surfaces" component={AdminSurfaces} />
            <Route path="/admin/reports" component={AdminReports} />
            <Route path="/admin/analytics" component={AdminAnalytics} />
            <Route component={NotFound} />
          </Switch>
        </main>
      </div>
    </div>
  );
}

function App() {
  const style = {
    "--sidebar-width": "18rem",
    "--sidebar-width-icon": "4rem",
  };

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light" storageKey="sparktower-theme">
        <TooltipProvider>
          <SidebarProvider style={style as React.CSSProperties}>
            <div className="w-full min-h-screen bg-background text-foreground">
              <Router />
              <Toaster />
            </div>
          </SidebarProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
