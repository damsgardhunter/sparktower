import { Switch, Route, Redirect } from "wouter";
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
import Profile from "@/pages/profile";
import Contests from "@/pages/contests";
import Pricing from "@/pages/pricing";
import Messages from "@/pages/messages";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import type { UserProfile } from "@shared/schema";
import { Loader2 } from "lucide-react";

function Router() {
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
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

  // Redirect to onboarding if not onboarded
  if (profile && !profile.isOnboarded && window.location.pathname !== "/onboarding") {
    return <Redirect to="/onboarding" />;
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
            <Route path="/projects/:id" component={ProjectDashboard} />
            <Route path="/profile" component={Profile} />
            <Route path="/profile/:id" component={Profile} />
            <Route path="/matches" component={Matches} />
            <Route path="/leaderboard" component={Leaderboard} />
            <Route path="/discover" component={Discover} />
            <Route path="/contests" component={Contests} />
            <Route path="/messages" component={Messages} />
            <Route path="/pricing" component={Pricing} />
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
