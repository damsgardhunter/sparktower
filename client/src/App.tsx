import { Switch, Route, Redirect, useLocation, Link } from "wouter";
import VerifyEmailPage, { VerifyEmailNotice } from "@/components/verify-email";
import PathHome from "@/pages/path-home";
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
import { NotificationBell } from "@/components/notification-bell";
import LandingPage from "@/pages/landing";
import Home from "@/pages/home";
import NovaIntro from "@/pages/nova-intro";
import ProjectCreate from "@/pages/project-create";
import ProjectDashboard from "@/pages/project-dashboard";
import Discover from "@/pages/discover";
import Onboarding from "@/pages/onboarding";
import DocumentBuilder from "@/pages/document-builder";
import Profile from "@/pages/profile";
import Contests from "@/pages/contests";
import ContestDetail from "@/pages/contest-detail";
import Pricing from "@/pages/pricing";
import BackingReview from "@/pages/backing-review";
import PublicArtifactPage from "@/pages/public-artifact";
import InviteAcceptPage from "@/pages/invite-accept";
import AdminPromotions from "@/pages/admin-promotions";
import MfaVerifyPage from "@/pages/mfa-verify";
import SecuritySettings from "@/pages/security-settings";
import ForgotPasswordPage from "@/pages/forgot-password";
import { PrivacyPolicy, TermsOfService, SecurityPolicy } from "@/pages/legal";
import ResetPasswordPage from "@/pages/reset-password";
import { MfaNotice } from "@/components/mfa";
import { NOVA_GRADIENT, NOVA_GRADIENT_CSS } from "@shared/backing";
import { AnimatedTowerLogo } from "@/components/animated-tower-logo";
import { UpgradeToKeepGenerating, CheckoutReturn, BillingIssueNotice } from "@/components/upgrade-to-keep-generating";
import { useSurfaces } from "@/hooks/use-surfaces";
import { isPathDisabled } from "@shared/surfaces";
import PostDetail from "@/pages/post-detail";
import AdminSurfaces from "@/pages/admin-surfaces";
import AdminReports from "@/pages/admin-reports";
import AdminSafety from "@/pages/admin-safety";
import AdminAnalytics from "@/pages/admin-analytics";
import { installAnalytics, trackPageView } from "@/lib/analytics";
import Messages from "@/pages/messages";
import ProjectManager from "@/pages/project-manager";
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
   * A published path artifact gets sent to people who have never heard of
   * SparkTower, and bouncing them to a landing page would make the share step
   * pointless. Checked before both the auth gate and the onboarding redirect
   * so neither can swallow it.
   */
  const isPublicRoute = /^\/(a|invite)\/[^/]+$/.test(window.location.pathname);
  if (isPublicRoute) {
    return (
      <Switch>
        {/* A published path artifact: the growth loop's front door. */}
        <Route path="/a/:id" component={PublicArtifactPage} />
        {/* An invite link: who's inviting you to what, signed in or not. */}
        <Route path="/invite/:token" component={InviteAcceptPage} />
      </Switch>
    );
  }

  if (!isAuthenticated) {
    return (
      <Switch>
        <Route path="/" component={LandingPage} />
        {/* Google sign-in, for an account with 2FA on, lands here for the code (server/mfa.ts). */}
        <Route path="/mfa" component={MfaVerifyPage} />
        {/* The emailed link works signed out — the link is the credential. */}
        <Route path="/verify-email" component={VerifyEmailPage} />
        {/*
          * Both halves of a password reset, for the same reason and then some:
          * everyone who needs them is locked out by definition, so bouncing
          * them to the sign-in page they can't use would make the feature
          * pointless.
          */}
        <Route path="/forgot-password" component={ForgotPasswordPage} />
        <Route path="/reset-password" component={ResetPasswordPage} />
        {/*
          * Signed out on purpose. Both app stores refuse a first submission
          * without a privacy policy a reviewer can open with no account
          * (Apple 5.1.1(i), Google's Data safety form), and anyone deciding
          * whether to sign up should be able to read the terms before they do.
          */}
        <Route path="/privacy" component={PrivacyPolicy} />
        <Route path="/terms" component={TermsOfService} />
        {/* Named by /.well-known/security.txt, so it must answer for a stranger. */}
        <Route path="/security" component={SecurityPolicy} />
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
  /*
   * Three paths are exempt, all for the same reason: they are the ones a
   * person follows out of a hole, and onboarding is not the way out of any of
   * them. Someone who signed up, never finished, and now can't remember their
   * password would otherwise click the link in their inbox and be shown a
   * "tell us about yourself" form instead of the reset — with no way to reach
   * it at all, since every other address redirects here too.
   */
  const RECOVERY_PATHS = ["/onboarding", "/verify-email", "/forgot-password", "/reset-password", "/privacy", "/terms", "/security"];
  if (!profile?.isOnboarded && !RECOVERY_PATHS.includes(window.location.pathname)) {
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
        {/*
          * Nova's gradient, with the logo in a semicircle hanging off its bottom
          * edge so it can be big without making the bar tall. The lines either
          * side are centred on the page, not between the buttons, so they sit
          * symmetrically around the logo. White on the gradient in both themes.
          */}
        <header
          className="relative z-30 flex items-center justify-between h-14 px-4 text-white [&_button]:text-white [&_button:hover]:bg-white/15"
          style={{ backgroundImage: NOVA_GRADIENT_CSS }}
          data-testid="app-header"
        >
          <SidebarTrigger className="relative z-10" data-testid="button-sidebar-toggle" />

          <div className="pointer-events-none absolute inset-y-0 inset-x-14 sm:inset-x-28 grid grid-cols-[1fr_9rem_1fr] items-center">
            <span className="slogan-arrive slogan-arrive-left hidden md:block text-center text-base lg:text-lg font-semibold tracking-[0.18em] lg:tracking-[0.3em] whitespace-nowrap drop-shadow" data-testid="text-header-left">I believe'd in them.</span>
            <span />
            <span className="slogan-arrive slogan-arrive-right hidden md:block text-center text-base lg:text-lg font-semibold tracking-[0.18em] lg:tracking-[0.3em] whitespace-nowrap drop-shadow" data-testid="text-header-right">They believe'd in me.</span>
          </div>

          {/* The hanging semicircle: the gradient's middle colour, which is exactly what the bar is at its centre, so there's no seam. */}
          <Link
            href="/"
            aria-label="SparkTower home"
            className="absolute left-1/2 -translate-x-1/2 top-0 w-32 h-[4.75rem] rounded-b-full overflow-hidden flex items-end justify-center pb-1 shadow-[0_6px_12px_-4px_rgba(0,0,0,0.25)]"
            style={{ backgroundColor: NOVA_GRADIENT[1] }}
            data-testid="header-logo-hang"
          >
            {/* The semicircle clips the bolts, so they disappear through its edge. */}
            <AnimatedTowerLogo height={68} className="drop-shadow-md" />
          </Link>

          <div className="relative z-10 flex items-center gap-2">
            <NotificationBell />
            <ThemeToggle />
          </div>
        </header>
        {/* The revenue loop: out of credits anywhere → plans → checkout → back here. */}
        {/* Reviewers, admins and the owner: their tools are locked until this session passes 2FA. */}
        <MfaNotice />
        {/* Until the address is confirmed, nothing this account writes reaches another person. */}
        <VerifyEmailNotice />
        <BillingIssueNotice />
        <UpgradeToKeepGenerating />
        <CheckoutReturn />
        {/* Room for the logo hanging below the bar, so it never covers the top of a page — inside each page's own background. */}
        <main className="flex-1 overflow-y-auto [&>*]:pt-6">
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/onboarding" component={Onboarding} />
            <Route path="/verify-email" component={VerifyEmailPage} />
            {/* Signed in and still resetting — an old email, or a shared computer. */}
            <Route path="/forgot-password" component={ForgotPasswordPage} />
            <Route path="/reset-password" component={ResetPasswordPage} />
            <Route path="/privacy" component={PrivacyPolicy} />
            <Route path="/terms" component={TermsOfService} />
            <Route path="/security" component={SecurityPolicy} />
            {/* Every project's next step in one place — the address the retention loop returns to. */}
            <Route path="/path" component={PathHome} />
            {/*
              * The three destinations Discover absorbed. They stay as routes for good:
              * old emails, notifications and shared links point at them, and a 404 for
              * those is worse than a hop. Replacing history rather than pushing, so Back
              * goes where the person came from instead of bouncing off the redirect.
              *
              * /projects was your OWN list, which now lives on your profile — the browse
              * half of it is what moved to Discover, so sending it there would answer a
              * different question than the one the link asked.
              *
              * Exact paths in wouter, so this matches the bare index only: every
              * /projects/* route below is untouched. They follow it for readability,
              * not because the order matters here.
              */}
            <Route path="/projects"><Redirect to="/profile#projects" replace /></Route>
            <Route path="/projects/new" component={NovaIntro} />
            <Route path="/projects/new/create" component={ProjectCreate} />
            {/* Before /projects/:id so the builder path isn't swallowed by it. */}
            <Route path="/projects/:projectId/documents/:docId" component={DocumentBuilder} />
            <Route path="/projects/:id/manage" component={ProjectManager} />
            <Route path="/projects/:id" component={ProjectDashboard} />
            <Route path="/profile" component={Profile} />
            <Route path="/settings/security" component={SecuritySettings} />
            <Route path="/profile/:id" component={Profile} />
            <Route path="/matches"><Redirect to="/discover" replace /></Route>
            <Route path="/leaderboard"><Redirect to="/discover" replace /></Route>
            <Route path="/discover" component={Discover} />
            <Route path="/contests" component={Contests} />
            <Route path="/contests/:slug" component={ContestDetail} />
            <Route path="/sprints" component={Sprints} />
            <Route path="/sprints/new" component={SprintMatchmaking} />
            <Route path="/sprints/practice" component={SprintPractice} />
            <Route path="/sprints/:id" component={SprintDashboard} />
            <Route path="/messages" component={Messages} />
            <Route path="/pricing" component={Pricing} />
            {/* Reviewer-only. The page itself renders NotFound for anyone
                else, matching what the API tells them. */}
            <Route path="/admin/backing" component={BackingReview} />
            <Route path="/posts/:id" component={PostDetail} />
            <Route path="/admin/surfaces" component={AdminSurfaces} />
            <Route path="/admin/reports" component={AdminReports} />
            <Route path="/admin/safety" component={AdminSafety} />
            <Route path="/admin/analytics" component={AdminAnalytics} />
            <Route path="/admin/promotions" component={AdminPromotions} />
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
