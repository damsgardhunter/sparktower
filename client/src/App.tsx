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
import { SiteFooter } from "@/components/site-footer";
import { LanguageProvider } from "@/lib/i18n";
import Careers from "@/pages/careers";
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
import Earnings from "@/pages/earnings";
import BackingReview from "@/pages/backing-review";
import PublicArtifactPage from "@/pages/public-artifact";
import InviteAcceptPage from "@/pages/invite-accept";
import AdminPromotions from "@/pages/admin-promotions";
import AdminContests from "@/pages/admin-contests";
import MfaVerifyPage from "@/pages/mfa-verify";
import SecuritySettings from "@/pages/security-settings";
import ForgotPasswordPage from "@/pages/forgot-password";
import { PrivacyPolicy, TermsOfService, SecurityPolicy } from "@/pages/legal";
import ProjectSimPage from "@/pages/project-sim";
import SimulationPage from "@/pages/simulation";
import SimulationDeskPage from "@/pages/simulation-desk";
import SimulationMarketPage from "@/pages/simulation-market";
import SimulationStandingsPage from "@/pages/simulation-standings";
import SimulationOffersPage from "@/pages/simulation-offers";
import SimulationReportPage from "@/pages/simulation-report";
import CompaniesPage from "@/pages/companies";
import CompanyPage from "@/pages/company";
import JoinSeasonPage from "@/pages/join-season";
import TalentPage from "@/pages/talent";
import ChallengesPage from "@/pages/challenges";
import ChallengePage from "@/pages/challenge";
import ResetPasswordPage from "@/pages/reset-password";
import { MfaNotice } from "@/components/mfa";
import { NOVA_GRADIENT, NOVA_GRADIENT_CSS } from "@shared/backing";
import { AnimatedTowerLogo } from "@/components/animated-tower-logo";
import { UpgradeToKeepGenerating, CheckoutReturn, BillingIssueNotice } from "@/components/upgrade-to-keep-generating";
import { PaymentDialog, TopUpReturn, PurchaseConfirmProvider } from "@/components/payment-dialog";
import { useSurfaces } from "@/hooks/use-surfaces";
import { isPathDisabled } from "@shared/surfaces";
import PostDetail from "@/pages/post-detail";
import AdminSurfaces from "@/pages/admin-surfaces";
import AdminReports from "@/pages/admin-reports";
import AdminProblems from "@/pages/admin-problems";
import AdminSafety from "@/pages/admin-safety";
import AdminSecurity from "@/pages/admin-security";
import AdminConsole from "@/pages/admin-console";
import { ErrorBoundary } from "@/components/error-boundary";
import AdminAnalytics from "@/pages/admin-analytics";
import AdminAiSpend from "@/pages/admin-ai-spend";
import AdminRevenue from "@/pages/admin-revenue";
import { installAnalytics, trackPageView } from "@/lib/analytics";
import Messages from "@/pages/messages";
import ProjectManager from "@/pages/project-manager";
import Sprints from "@/pages/sprints";
import StartupGamePage from "@/pages/startup-game";
import GameBoardsPage from "@/pages/game-boards";
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
      <div className="flex min-h-screen flex-col">
        <div className="flex-1 min-h-0">
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
        {/* Somebody looking for a job is not a customer and has no account. */}
        <Route path="/careers" component={Careers} />
        {/* Named by /.well-known/security.txt, so it must answer for a stranger. */}
        <Route path="/security" component={SecurityPolicy} />
        <Route>
          <Redirect to="/" />
        </Route>
        </Switch>
        </div>
        {/*
          * Signed out and still able to report, which is the case that matters
          * most: somebody who cannot sign in is by definition not signed in,
          * and "I cannot sign in" is the report you least want to lose.
          */}
        <SiteFooter />
      </div>
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
          <SiteFooter />
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
        {/* Every 402 in the product, in one place. See payment-dialog. */}
        <PaymentDialog />
        <TopUpReturn />
        {/* Room for the logo hanging below the bar, so it never covers the top of a page — inside each page's own background. */}
        <main className="flex-1 overflow-y-auto [&>*]:pt-6">
          {/*
            * Around the routed page, so a screen that throws loses that screen
            * and not the product: the sidebar, the header and the navigation
            * stay, and one click gets somewhere that works.
            */}
          <ErrorBoundary where="page">
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
            {/*
              * Keyed by the project id. With component= wouter reuses the same
              * instance when only :id changes (a link from one project to
              * another, a notification, Back), so every useState inside kept the
              * previous project's tab, selections and drafts — and could act on
              * them against the new project. A key makes a new project a fresh
              * mount, the same as arriving from anywhere else.
              */}
            <Route path="/projects/:id/manage">{(params) => <ProjectManager key={params.id} />}</Route>
            <Route path="/projects/:id">{(params) => <ProjectDashboard key={params.id} />}</Route>
            {/* What you've earned and how to get it to a bank account. */}
            <Route path="/earnings" component={Earnings} />
            <Route path="/profile" component={Profile} />
            <Route path="/settings/security" component={SecuritySettings} />
            <Route path="/profile/:id" component={Profile} />
            <Route path="/matches"><Redirect to="/discover" replace /></Route>
            <Route path="/leaderboard"><Redirect to="/discover" replace /></Route>
            <Route path="/discover" component={Discover} />
            <Route path="/contests" component={Contests} />
            <Route path="/contests/:slug" component={ContestDetail} />
            <Route path="/sprints" component={Sprints} />
            {/* The market simulation lives under /sprints, the page now called "Simulations". */}
            {/* A project's own simulations, one to a page. See `project-sim.tsx`. */}
            <Route path="/projects/:id/simulate/:game" component={ProjectSimPage} />
            <Route path="/simulation" component={SimulationPage} />
            {/* One company's desk: the year this seat is deciding. */}
            <Route path="/simulation/:id/market" component={SimulationMarketPage} />
            <Route path="/simulation/:id/standings" component={SimulationStandingsPage} />
            <Route path="/simulation/:id/offers" component={SimulationOffersPage} />
            <Route path="/simulation/:id/report/:year?" component={SimulationReportPage} />
            {/* Company accounts: training seasons, recruiting, challenges, scouting, running the business. */}
            <Route path="/companies" component={CompaniesPage} />
            <Route path="/companies/:id" component={CompanyPage} />
            <Route path="/join-season/:code" component={JoinSeasonPage} />
            <Route path="/talent" component={TalentPage} />
            <Route path="/challenges" component={ChallengesPage} />
            <Route path="/challenges/:id" component={ChallengePage} />
            <Route path="/simulation/:id" component={SimulationDeskPage} />
            {/* Ten Years From Now. Declared before /sprints/:id, which would
                otherwise match "boards" and "game" as sprint ids. */}
            <Route path="/sprints/boards" component={GameBoardsPage} />
            <Route path="/sprints/game/:id" component={StartupGamePage} />
            {/*
                The questionnaire sprint is retired. Old links — a bookmark, a
                notification from before, a shared URL — land on the game
                rather than a blank 404, because the person following one was
                trying to get to this part of the product and still can.
              */}
            <Route path="/sprints/new"><Redirect to="/sprints" replace /></Route>
            <Route path="/sprints/practice"><Redirect to="/sprints" replace /></Route>
            <Route path="/sprints/:id"><Redirect to="/sprints" replace /></Route>
            <Route path="/messages" component={Messages} />
            <Route path="/pricing" component={Pricing} />
            {/* Reviewer-only. The page itself renders NotFound for anyone
                else, matching what the API tells them. */}
            <Route path="/admin/backing" component={BackingReview} />
            <Route path="/posts/:id" component={PostDetail} />
            <Route path="/admin/surfaces" component={AdminSurfaces} />
            <Route path="/admin/reports" component={AdminReports} />
            {/* What people said is broken, as opposed to who reported whom. */}
            <Route path="/admin/problems" component={AdminProblems} />
            <Route path="/admin/safety" component={AdminSafety} />
            <Route path="/admin/security" component={AdminSecurity} />
            {/* The customer console. Its own API answers 404 to anyone who shouldn't know it exists, and the page draws that as a 404 too. */}
            <Route path="/admin/console" component={AdminConsole} />
            <Route path="/admin/analytics" component={AdminAnalytics} />
            {/* What the models cost us. Owner only. */}
            <Route path="/admin/ai-spend" component={AdminAiSpend} />
            {/* What the platform has collected and what of it is actually ours. Owner only. */}
            <Route path="/admin/revenue" component={AdminRevenue} />
            <Route path="/admin/promotions" component={AdminPromotions} />
            <Route path="/admin/contests" component={AdminContests} />
            {/* Public on purpose: somebody looking for a job has no account here. */}
            <Route path="/careers" component={Careers} />
            <Route component={NotFound} />
          </Switch>
          </ErrorBoundary>
        </main>
        {/* Every screen ends with a way to say it is broken. */}
        <SiteFooter />
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
      {/* Above the app, because the footer that switches it is inside it. */}
      <LanguageProvider>
      <ThemeProvider defaultTheme="light" storageKey="sparktower-theme">
        <TooltipProvider>
          <SidebarProvider style={style as React.CSSProperties}>
            {/* Anything priced asks before it spends. See payment-dialog. */}
            <PurchaseConfirmProvider>
              <div className="w-full min-h-screen bg-background text-foreground">
                {/*
                  * The backstop. React unmounts the whole tree when a render
                  * throws, so without this one bad value anywhere replaced the
                  * entire product with a blank white page — no message, no
                  * navigation, and no report. The inner boundary around the
                  * routed page catches almost everything and keeps the sidebar
                  * and the header alive; this one is for a throw in the shell
                  * itself, where there is nothing left to navigate with.
                  */}
                <ErrorBoundary where="app">
                  <Router />
                </ErrorBoundary>
                <Toaster />
              </div>
            </PurchaseConfirmProvider>
          </SidebarProvider>
        </TooltipProvider>
      </ThemeProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}

export default App;
