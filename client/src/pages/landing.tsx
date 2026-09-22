import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Zap, Eye, EyeOff, Loader2, Globe, Handshake, ArrowRight, Trophy, Heart, Scale } from "lucide-react";
const logoImage = "/favicon.png";
import { SiGoogle } from "react-icons/si";
import { ThemeToggle } from "@/components/theme-toggle";
import { AnimatedTowerLogo } from "@/components/animated-tower-logo";
import { NOVA_GRADIENT, NOVA_GRADIENT_CSS } from "@shared/backing";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { PENDING_PATH_KEY, type PendingPath } from "@shared/path-artifacts";
import { PENDING_INVITE_KEY } from "@shared/invites";
import { MfaCodeForm } from "@/components/mfa";
import { PASSWORD_MIN } from "@shared/passwords";
import { PROJECT_GOALS } from "@shared/goals";
import { LiveProjects } from "@/components/live-projects";
import { Link } from "wouter";

/** The artifact a visitor chose "start" or "explore" on before signing up, so the signup is credited to it. */
function pendingArtifactId(): string | undefined {
  try { return (JSON.parse(localStorage.getItem(PENDING_PATH_KEY) ?? "null") as PendingPath | null)?.fromArtifact; } catch { return undefined; }
}

/** After signing in or up: back to an invite this browser was holding, else home. */
function afterAuthPath(): string {
  try {
    const token = localStorage.getItem(PENDING_INVITE_KEY);
    if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) return `/invite/${token}`;
  } catch { /* no pending invite */ }
  return "/";
}

/**
 * The sentence each path gets on the landing page, on top of the one-liner in
 * shared/goals.ts. The shared one says what the path *is*, everywhere in the
 * product; this says what you actually do on it, which is what a stranger
 * deciding whether to sign up is asking.
 */
const PATH_DETAIL: Record<string, string> = {
  ship_mvp: "Scope down to something you can finish, build it, and put it in front of real people before you are ready.",
  systemize_business: "Know how fundable you are and the route to the money, write down what you already do, and hand the rest to a process or a person.",
  run_company: "Check in on the numbers every week, give the team's recurring work an owner, and get a monthly report on what improved.",
};

export default function LandingPage() {
  /*
   * `?signup=1` (a public page's "start your own path") is the default now, so
   * it needs no branch — the tab it used to select is the one that opens.
   * `?login=1` (an invite link's "I have an account") still does.
   */
  const search = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const arrivedToLogIn = search?.get("login") === "1";
  /*
   * Sign up unless the visitor asked for log in. The form is on the page from
   * the first paint now, so there is no "show the form" state any more — the
   * header's buttons pick a tab and bring the panel into view.
   */
  const [activeTab, setActiveTab] = useState(arrivedToLogIn ? "login" : "signup");
  const focusAuth = (tab: "login" | "signup") => {
    setActiveTab(tab);
    document.querySelector("[data-testid=panel-auth]")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="landing-type flex flex-col min-h-screen bg-white text-foreground">
      {/*
        * The same header a signed-in person gets (App.tsx) — Nova's gradient
        * with the logo hanging under it in a semicircle — scaled up, because
        * this is the first thing a visitor sees rather than a bar they work
        * beneath. Matching it means arriving and signing in don't feel like
        * two different products.
        *
        * Two deliberate differences from the app's:
        *
        *   - The wordmark rides inside the semicircle with the tower. Signed
        *     in you already know whose site this is; arriving, you don't.
        *   - No slogan. The app bar carries it either side of the logo; here
        *     the hero says what the page is, and the same words twice on one
        *     screen just crowds the tower.
        *
        * `hero-header-reveal` holds the whole thing hidden while the opening
        * video plays, then brings it up slowly (index.css).
        */}
      {/*
        * Visible immediately. This used to carry `hero-header-reveal`, which
        * held it invisible for 3.8 seconds while the opening video played —
        * and with the video gone that was 3.8 seconds of a page with no way
        * to sign in on it.
        */}
      <header className="fixed top-0 w-full z-50" data-testid="landing-header">
        <div
          className="relative flex items-center justify-between h-14 sm:h-16 md:h-20 px-2 sm:px-6 text-white shadow-[0_4px_20px_-6px_rgba(0,0,0,0.35)]"
          style={{ backgroundImage: NOVA_GRADIENT_CSS }}
        >
          <div className="relative z-10 flex items-center gap-2 [&_button]:text-white [&_button:hover]:bg-white/15">
            <ThemeToggle />
          </div>

          {/*
            * The hanging semicircle, in the gradient's middle colour — which is
            * exactly what the bar is at its centre, so the two meet with no seam.
            * It clips the lightning, so the bolts leave through its curved edge.
            */}
          <button
            type="button"
            aria-label="SparkTower"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="absolute left-1/2 -translate-x-1/2 top-0 w-[6.25rem] sm:w-48 md:w-56 h-[4.5rem] sm:h-[7rem] md:h-[8.25rem] rounded-b-full overflow-hidden flex flex-col items-center justify-center gap-0 pb-2 sm:pb-4 shadow-[0_8px_18px_-6px_rgba(0,0,0,0.35)]"
            style={{ backgroundColor: NOVA_GRADIENT[1] }}
            data-testid="header-logo-hang"
          >
            <AnimatedTowerLogo height={48} className="drop-shadow-lg sm:hidden" />
            <AnimatedTowerLogo height={84} className="drop-shadow-lg hidden sm:block md:hidden" />
            <AnimatedTowerLogo height={96} className="drop-shadow-lg hidden md:block" />
            <span className="text-white font-bold text-[9px] sm:text-[11px] md:text-xs tracking-[0.14em] sm:tracking-[0.2em] uppercase leading-none drop-shadow">
              SparkTower
            </span>
          </button>

          <div className="relative z-10 flex items-center gap-1 sm:gap-3">
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-1.5 text-xs border-0 sm:h-9 sm:px-4 sm:text-sm sm:border bg-white/10 text-white border-white/40 hover:bg-white/20 hover:text-white backdrop-blur-sm"
              data-testid="button-login"
              onClick={() => focusAuth("login")}
            >
              Log In
            </Button>
            <Button
              size="sm"
              className="h-8 px-2.5 text-xs sm:h-9 sm:px-4 sm:text-sm bg-white text-black hover:bg-white/90 font-semibold"
              data-testid="button-signup-nav"
              onClick={() => focusAuth("signup")}
            >
              Sign Up
            </Button>
          </div>
        </div>
      </header>

      {/*
        * The whole point of the page, above the fold: a person can make an
        * account without scrolling or clicking anything first.
        *
        * It replaced a full-screen hero video with a Tesla quote under it. That
        * page looked handsome and asked for nothing — the only way to sign up
        * was to notice a button, which opened a form somewhere further down.
        * Every social product converges on the same shape for a reason: what
        * you get on the left, the box that gets you in on the right, nothing in
        * between. The video also cost every first-time visitor a 2.5MB download
        * before the page settled.
        */}
      <section
        className="relative flex items-start justify-center px-4 pt-24 sm:pt-32 md:pt-36 pb-16 md:pb-24 bg-white overflow-hidden"
        data-testid="section-hero"
      >
        {/* The gradient, far back and soft, so the white card in front of it has something to sit on. */}
        <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 w-[80rem] h-[50rem] opacity-[0.16] blur-3xl" style={{ backgroundImage: NOVA_GRADIENT_CSS }} />

        <div className="relative z-10 w-full max-w-6xl" style={{ animation: "hero-fade-in 0.6s ease-out both" }}>
          {/* The gradient border: a 2px gradient sheet with the card laid on top of it. */}
          <div className="rounded-[1.75rem] p-[2px] shadow-[0_24px_60px_-20px_rgba(0,0,0,0.35)]" style={{ backgroundImage: NOVA_GRADIENT_CSS }}>
            <div className="rounded-[1.65rem] bg-white overflow-hidden grid md:grid-cols-[1.15fr_1fr]">

              <ChallengePanel />

              {/* The box that gets you in. Sign up first: a landing page is for people who don't have an account yet. */}
              <div className="p-6 sm:p-10 flex flex-col justify-center border-t md:border-t-0 md:border-l border-gray-100" data-testid="panel-auth">
                <AuthCard activeTab={activeTab} onTabChange={setActiveTab} />
                <p className="mt-6 text-center text-xs text-gray-400 leading-relaxed">
                  Free to start. No card, no credits spent until you ask Nova for something.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <TaglineBanner />

      <LiveProjects />

      <section id="how-it-works" className="scroll-mt-40 py-24 px-4 bg-white border-t border-gray-100" data-testid="section-how-it-works">
        <div className="max-w-5xl mx-auto">

          <div className="max-w-3xl mx-auto text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500" data-testid="badge-contest-status">
              <Trophy className="h-3.5 w-3.5" style={{ color: NOVA_GRADIENT[2] }} />
              The contest hasn't started yet
            </span>
            <h2 className="mt-5 text-3xl md:text-4xl font-bold tracking-tight text-black">
              The $50B challenge, and where it actually stands
            </h2>
            <p className="mt-4 text-[15px] sm:text-base text-gray-600 leading-relaxed">
              The offer is real and it is not open yet. Handing over a majority of a company is a
              promotion with a prize, and that means written rules, eligibility, judging and a
              promotion agreement drafted by lawyers who do this for a living. We are finding
              those lawyers and writing those rules now.
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              {
                icon: Scale,
                title: "Rules, so nobody can cheat",
                body: "What counts as a company built here, what counts as $50 billion, who verifies it, and what stops someone bolting SparkTower onto a business they already had. Ambiguity is how a prize like this gets fought over instead of won.",
              },
              {
                icon: Globe,
                title: "Open wherever you are",
                body: "Anyone, anywhere. That is the hardest part to write, not the easiest: prize promotions are governed country by country, and \"open to everyone\" has to survive the places with the strictest rules rather than ignore them.",
              },
              {
                icon: Handshake,
                title: "A promotion agreement, in writing",
                body: "An offer this size is worth nothing as a sentence on a landing page. It needs a document that binds the company, survives a change of ownership, and says exactly what a winner receives.",
              },
            ].map((item) => (
              <div key={item.title} className="rounded-2xl border border-gray-200 p-5" data-testid={`card-contest-${item.title.split(" ")[0].toLowerCase()}`}>
                <item.icon className="h-5 w-5" style={{ color: NOVA_GRADIENT[1] }} />
                <h3 className="mt-3 font-bold text-black">{item.title}</h3>
                <p className="mt-1.5 text-sm text-gray-600 leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>

          <p className="mt-6 text-center text-sm text-gray-500 max-w-2xl mx-auto">
            This takes a while, and we would rather say so than open something we would have to
            change halfway through. Nothing you build before the rules land is wasted: the contest
            will be judged on companies, and a company takes longer to build than a rulebook takes
            to write.
          </p>

          {/* --- Meanwhile: the part you can do today ------------------------------- */}

          <div className="mt-20 max-w-3xl mx-auto text-center">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-black">
              So start building now
            </h2>
            <p className="mt-4 text-[15px] sm:text-base text-gray-600 leading-relaxed">
              Make an account, tell Nova what you're thinking about, and it turns the idea into a
              project with a path under it. Every project picks one of three — and a project works
              all three side by side as it grows, so the one you pick first is a starting point
              rather than a category you're stuck in.
            </p>
          </div>

          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {PROJECT_GOALS.map((goal, i) => (
              <div key={goal.id} className="relative rounded-2xl p-[2px]" style={{ backgroundImage: NOVA_GRADIENT_CSS }} data-testid={`card-path-${goal.id}`}>
                <div className="h-full rounded-[0.95rem] bg-white p-5">
                  <div className="flex items-center gap-2">
                    <span className="grid h-7 w-7 place-items-center rounded-lg text-[11px] font-bold text-white" style={{ backgroundImage: NOVA_GRADIENT_CSS }}>
                      {i + 1}
                    </span>
                    <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-gray-400">{goal.short}</span>
                  </div>
                  <h3 className="mt-3 text-lg font-bold text-black">{goal.label}</h3>
                  <p className="mt-1.5 text-sm text-gray-600 leading-relaxed">{goal.description}</p>
                  <p className="mt-3 text-sm text-gray-500 leading-relaxed">{PATH_DETAIL[goal.id]}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-12 rounded-2xl bg-gray-50 border border-gray-200 p-6 sm:p-8">
            <h3 className="font-bold text-black">What the first hour looks like</h3>
            <ol className="mt-4 grid gap-4 sm:grid-cols-2 text-sm text-gray-600">
              {[
                ["Describe the idea in a sentence", "Nova asks what you're building and who it's for, then writes the project for you — you're editing rather than starting at a blank page."],
                ["Pick a path", "Ship, Systemize or Run. It decides what Nova puts in front of you first, and it can change."],
                ["Do the next step", "One card at a time, never a backlog. Each finished step saves what you wrote as part of the project."],
                ["Publish one and get feedback", "A finished step becomes a page you can share with anyone, no account needed to read it. That is how people find you here."],
              ].map(([title, body], n) => (
                <li key={title} className="flex gap-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white" style={{ backgroundImage: NOVA_GRADIENT_CSS }}>{n + 1}</span>
                  <span><span className="font-semibold text-black">{title}.</span> {body}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="py-24 px-4 bg-black text-white" data-testid="section-vision">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <div className="h-16 w-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto">
            <Zap className="h-8 w-8 text-primary" />
          </div>
          <blockquote className="text-2xl md:text-4xl font-bold italic leading-tight tracking-tight">
            "If you want to find the secrets of the universe, think in terms of <span className="text-primary">energy, frequency, and vibration.</span>"
          </blockquote>
          <div className="inline-block px-4 py-1.5 bg-white/10 text-white/80 text-sm font-semibold tracking-wide">
            — Nikola Tesla
          </div>
          <p className="text-lg text-white/70 max-w-2xl mx-auto font-light leading-relaxed">
            Tesla saw connections where others saw chaos. SparkTower is built on that same frequency — matching the right energy between builders, amplifying the vibration of collaboration, and channeling it into projects that reshape industries. This isn't just a platform. It's a movement for the ones who build the future.
          </p>
        </div>
      </section>

      <section className="py-24 px-4 bg-background" data-testid="section-final-cta">
        <div className="max-w-3xl mx-auto text-center space-y-8">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-foreground">
            The future won't build itself.
          </h2>
          <p className="text-xl text-muted-foreground font-light max-w-xl mx-auto leading-relaxed">
            Every great invention started with one person who refused to wait for permission. Your project, your team, your legacy — it starts right here.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
            <Button
              size="lg"
              data-testid="button-join-sparktower"
              onClick={() => focusAuth("signup")}
            >
              Join SparkTower
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </div>
          <p className="text-sm text-muted-foreground/60">Free to start. No credit card required.</p>
        </div>
      </section>

      <footer className="py-16 border-t border-border bg-card" data-testid="section-footer">
        <div className="max-w-6xl mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-10 mb-12">
            <div className="space-y-4 md:col-span-2">
              <div className="flex items-center gap-3">
                <img src={logoImage} alt="SparkTower" className="h-10 w-auto" />
                <span className="font-bold text-lg tracking-tight text-foreground">SparkTower</span>
              </div>
              <p className="text-muted-foreground leading-relaxed max-w-sm">
                Where visionary builders connect, collaborate, and create the future. Inspired by Tesla's belief that the greatest achievements come from bold collaboration.
              </p>
            </div>
            <div className="space-y-3">
              <h4 className="font-bold text-sm tracking-widest uppercase text-muted-foreground/50">Platform</h4>
              <ul className="space-y-2 text-muted-foreground text-sm">
                <li>AI Matching</li>
                <li>Co-Founder Sprints</li>
                <li>Project Dashboard</li>
                <li>Leaderboard</li>
              </ul>
            </div>
            <div className="space-y-3">
              <h4 className="font-bold text-sm tracking-widest uppercase text-muted-foreground/50">Community</h4>
              <ul className="space-y-2 text-muted-foreground text-sm">
                <li>Nova AI Assistant</li>
                <li>Builder Reputation</li>
                <li>Hackathons & Contests</li>
                <li>Startup Toolkit</li>
              </ul>
            </div>
          </div>
          <div className="border-t border-border pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-muted-foreground/60 text-sm">
              &copy; {new Date().getFullYear()} SparkTower. Built for the future of collaboration.
              {/* Where people look for them, and where a store reviewer looks first. */}
              <span className="ml-2">
                <Link href="/privacy" className="underline hover:text-foreground" data-testid="link-footer-privacy">Privacy</Link>
                <span className="mx-1.5">·</span>
                <Link href="/terms" className="underline hover:text-foreground" data-testid="link-footer-terms">Terms</Link>
              </span>
            </p>
            <p className="text-muted-foreground/40 text-xs italic">"The present is theirs; the future is mine." — Nikola Tesla</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

/**
 * The line between the sign-up panel and the live tracker.
 *
 * Black letters with the gradient showing only at their edges, and the same
 * gradient blurred behind them for the glow. Three stacked copies of the same
 * text do it: a blurred one for the light, a gradient one whose gradient is
 * clipped to the glyphs *and their stroke* (`background-clip: text` with a
 * transparent `-webkit-text-stroke`, which is what makes the outline gradient
 * rather than one flat colour), and the black one on top covering the middle.
 *
 * The copies are `aria-hidden` and the readable one is last, so a screen
 * reader hears the sentence once.
 */
/*
 * Change this one string to change the line.
 *
 * "Fastest growing" is a comparative claim rather than the kind of superlative
 * nobody reads literally, and growth measured as a rate from a small base is a
 * real way to mean it — 0 to 100 accounts in a day is a bigger percentage than
 * anyone established can post. Worth knowing, in case a competitor or an
 * advertising regulator ever asks: keep a note of the basis you would answer
 * with (accounts week over week, say), because the answer to that question is
 * either a number you already have or an afternoon you did not plan on. The
 * specific counts that used to sit further down this page were a different
 * thing entirely, and they are gone.
 */
const TAGLINE = "The fastest growing startup community.";

function TaglineBanner() {
  /* The gradient, clipped to the glyphs plus a fat transparent stroke. */
  const gradientText = {
    backgroundImage: NOVA_GRADIENT_CSS,
    WebkitBackgroundClip: "text" as const,
    backgroundClip: "text" as const,
    color: "transparent",
  };

  /*
   * The letters are not flat black. They run through near-black tints of the
   * same three gradient stops — green-black, black, purple-black — so the fill
   * has somewhere to go between the bright edges instead of sitting there as a
   * slab. Dark enough to still read as black type at a glance.
   */
  const letterFill = {
    backgroundImage: "linear-gradient(135deg, #07271b 0%, #0b0b0c 48%, #241043 100%)",
    WebkitBackgroundClip: "text" as const,
    backgroundClip: "text" as const,
    color: "transparent",
  };

  return (
    <section className="relative bg-white px-4 pt-6 pb-14 sm:pb-20" data-testid="section-tagline">
      <h2 className="landing-tagline relative mx-auto max-w-4xl text-center font-black tracking-tight leading-[1.05] text-[2rem] sm:text-5xl md:text-[3.5rem]">
        {/* The glow: the same words, fattened and blurred, sitting underneath. */}
        <span aria-hidden className="absolute inset-0 select-none" style={{ ...gradientText, WebkitTextStroke: "6px transparent", filter: "blur(18px)", opacity: 0.45 }}>
          {TAGLINE}
        </span>
        {/* The outline: gradient everywhere, about to be covered in the middle. */}
        <span aria-hidden className="absolute inset-0 select-none" style={{ ...gradientText, WebkitTextStroke: "4px transparent" }}>
          {TAGLINE}
        </span>
        {/* The letters themselves. */}
        <span className="relative" style={letterFill} data-testid="text-tagline">{TAGLINE}</span>
      </h2>
    </section>
  );
}

/**
 * The left half: what you get, and the offer that makes people stop scrolling.
 *
 * Built out of the product's own shapes rather than a stock photograph — a
 * project card, a believer badge, a path step, Nova's tower — because a
 * landing page that shows the thing is worth more than one that describes it,
 * and because these stay true when the product changes. They overlap and tilt
 * so the panel reads as depth rather than a list.
 *
 * The challenge is the headline and deliberately not a link: there is no
 * contest row behind it yet (`contests` is empty), and sending somebody to an
 * empty page is worse than telling them it's coming.
 */
function ChallengePanel() {
  return (
    <div className="relative p-6 sm:p-10 overflow-hidden bg-gradient-to-br from-gray-50 to-white" data-testid="panel-challenge">
      {/* A wash of the gradient behind the cards, so they have something to lift off. */}
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 w-[28rem] h-[28rem] rounded-full opacity-20 blur-3xl" style={{ backgroundImage: NOVA_GRADIENT_CSS }} />

      <div className="relative z-10">
        <span
          className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-white shadow-lg"
          style={{ backgroundImage: NOVA_GRADIENT_CSS }}
          data-testid="badge-challenge"
        >
          <Trophy className="h-3.5 w-3.5" />
          The Contest
        </span>

        <h1 className="mt-5 text-3xl sm:text-4xl md:text-[2.75rem] font-bold tracking-tight leading-[1.08] text-black" data-testid="text-hero-headline">
          Build a $50B company.
          <br />
          <span
            className="bg-clip-text text-transparent"
            style={{ backgroundImage: NOVA_GRADIENT_CSS }}
          >
            Take most of mine.
          </span>
        </h1>

        <p className="mt-4 text-[15px] sm:text-base text-gray-600 leading-relaxed max-w-md">
          The first builder who takes a project from SparkTower to a $50 billion company
          takes home a majority stake in SparkTower itself. One contest, one winner,
          no entry fee — start a project and you are in it.
        </p>

        <a href="#how-it-works" className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-gray-900 hover:gap-2.5 transition-all" data-testid="link-challenge-details">
          How it works <ArrowRight className="h-4 w-4" />
        </a>
      </div>

      {/*
        * The product in miniature, as one overlapping stack rather than four
        * things spread to the corners. The first version placed each card
        * against a different edge and left a hole through the middle of the
        * panel; depth comes from pieces covering each other, which is what the
        * collages these pages all use are actually doing.
        *
        * Hidden below `sm`, where the form is the only thing that matters.
        */}
      <div className="relative z-10 mt-8 h-64 hidden sm:block" aria-hidden>
        {/* Back of the stack: a project mid-build. */}
        <div className="absolute left-0 top-8 w-64 rounded-2xl bg-white p-4 shadow-[0_18px_40px_-16px_rgba(0,0,0,0.3)] ring-1 ring-gray-100 -rotate-[4deg]">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-lg shrink-0" style={{ backgroundImage: NOVA_GRADIENT_CSS }} />
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-black leading-tight truncate">Harbor Coffee Co</div>
              <div className="text-[11px] text-gray-500">Ship an MVP · step 4 of 9</div>
            </div>
          </div>
          <div className="mt-3 h-1.5 w-full rounded-full bg-gray-100">
            <div className="h-1.5 rounded-full w-5/12" style={{ backgroundImage: NOVA_GRADIENT_CSS }} />
          </div>
          <div className="mt-3 flex items-center gap-1.5">
            <div className="h-5 w-5 rounded-full bg-gray-200" />
            <div className="h-5 w-5 rounded-full bg-gray-300 -ml-2.5" />
            <div className="h-5 w-5 rounded-full -ml-2.5" style={{ backgroundColor: NOVA_GRADIENT[0] }} />
            <span className="ml-1 text-[11px] text-gray-400">3 believers</span>
          </div>
        </div>

        {/* Over its shoulder: the next step, which is what the product is for. */}
        <div className="absolute left-[14.5rem] top-0 w-60 rounded-2xl bg-black p-4 text-white shadow-[0_22px_45px_-14px_rgba(0,0,0,0.55)] rotate-[3deg]">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-white/60">
            <Zap className="h-3 w-3" /> Next step
          </div>
          <div className="mt-2 text-[13px] leading-snug">
            Write the one-line version of what you're building.
          </div>
          <div className="mt-3 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-black" style={{ backgroundImage: NOVA_GRADIENT_CSS }}>
            Do it with Nova <ArrowRight className="h-3 w-3" />
          </div>
        </div>

        {/* Front of the stack, overlapping both: the moment worth showing. */}
        <div className="absolute left-20 bottom-2 flex items-center gap-2 rounded-full bg-white px-3.5 py-2 shadow-[0_16px_32px_-10px_rgba(0,0,0,0.45)] ring-1 ring-gray-100 -rotate-2">
          <Heart className="h-4 w-4 fill-current" style={{ color: NOVA_GRADIENT[2] }} />
          <span className="text-[12px] font-semibold text-black">Believer #1</span>
        </div>

        {/* The tower, leaning in from the edge the way the reaction chips do. */}
        <div className="absolute right-0 bottom-6 rounded-2xl p-3.5 shadow-[0_18px_38px_-12px_rgba(0,0,0,0.5)] rotate-[6deg]" style={{ backgroundColor: NOVA_GRADIENT[1] }}>
          <AnimatedTowerLogo height={64} className="drop-shadow" />
        </div>
      </div>
    </div>
  );
}

/**
 * The form, with no card around it any more: on the landing page it *is* the
 * right half of the panel, and a card inside a card is a border inside a
 * border. It still renders standalone elsewhere, so the spacing lives here
 * rather than on the panel.
 *
 * Sign up leads. The tab order matters more than it looks — the first tab is
 * what a hurried visitor lands on, and a landing page is read by people who
 * don't have an account.
 */
function AuthCard({ activeTab, onTabChange }: { activeTab: string; onTabChange: (tab: string) => void }) {
  return (
    <Tabs value={activeTab} onValueChange={onTabChange}>
      <div className="mb-6">
        <h2 className="text-2xl font-bold tracking-tight text-black" data-testid="text-auth-heading">
          {activeTab === "signup" ? "Start building." : "Welcome back."}
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          {activeTab === "signup" ? "Your first project takes about a minute." : "Pick up where you left off."}
        </p>
      </div>

      {/* The gradient rides under the selected tab, so the two halves of the panel share a palette. */}
      <TabsList className="grid w-full grid-cols-2 bg-gray-100 p-1 h-11">
        <TabsTrigger
          value="signup"
          data-testid="tab-signup"
          className="h-9 data-[state=active]:text-white data-[state=active]:shadow-md"
          style={activeTab === "signup" ? { backgroundImage: NOVA_GRADIENT_CSS } : undefined}
        >
          Sign Up
        </TabsTrigger>
        <TabsTrigger
          value="login"
          data-testid="tab-login"
          className="h-9 data-[state=active]:text-white data-[state=active]:shadow-md"
          style={activeTab === "login" ? { backgroundImage: NOVA_GRADIENT_CSS } : undefined}
        >
          Log In
        </TabsTrigger>
      </TabsList>

      <div className="mt-6">
        <TabsContent value="login" className="mt-0">
          <LoginForm />
        </TabsContent>
        <TabsContent value="signup" className="mt-0">
          <SignupForm onSuccess={() => onTabChange("login")} />
        </TabsContent>
      </div>
    </Tabs>
  );
}

function LoginForm() {
  const [mfaStep, setMfaStep] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Login failed");
        return;
      }
      // 2FA on: the password was right, but there's no session until a code (server/mfa.ts).
      if (data.mfaRequired) {
        setMfaStep(true);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      window.location.href = afterAuthPath();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (mfaStep) {
    return (
      <MfaCodeForm
        onVerified={async () => {
          await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
          window.location.href = afterAuthPath();
        }}
        onRestart={() => { setMfaStep(false); setPassword(""); }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <CardDescription className="text-center text-sm text-muted-foreground mb-4">
        Welcome back! Log in to your account.
      </CardDescription>
      <GoogleButton />
      <div className="relative my-4">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">or</span>
        </div>
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && (
          <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3" data-testid="text-login-error">
            {error}
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="login-email">Email</Label>
          <Input
            id="login-email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            data-testid="input-login-email"
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="login-password">Password</Label>
            {/*
              * Next to the field it fails at — where someone looks the moment
              * the password doesn't work. The redesign that moved this form to
              * the right-hand panel dropped it, and with it the only way anyone
              * could reach /forgot-password: nothing else on the site links there.
              */}
            <Link href="/forgot-password" className="text-xs text-muted-foreground underline hover:text-foreground" data-testid="link-forgot-password">
              Forgot your password?
            </Link>
          </div>
          <div className="relative">
            <Input
              id="login-password"
              type={showPassword ? "text" : "password"}
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              data-testid="input-login-password"
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowPassword(!showPassword)}
              data-testid="button-toggle-password"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <Button type="submit" className="w-full text-white font-semibold border-0 hover:opacity-90 transition-opacity" style={{ backgroundImage: NOVA_GRADIENT_CSS }} disabled={loading} data-testid="button-submit-login">
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Log In
        </Button>
      </form>
    </div>
  );
}

function SignupForm({ onSuccess }: { onSuccess: () => void }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    // The server decides; this is the same rule said sooner (shared/passwords.ts).
    if (password.length < PASSWORD_MIN) {
      setError(`Use at least ${PASSWORD_MIN} characters — length is what makes a password hard to guess.`);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password, firstName, lastName, fromArtifact: pendingArtifactId() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Registration failed");
        return;
      }
      toast({ title: "Account created!", description: "You're now logged in." });
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      window.location.href = afterAuthPath();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <CardDescription className="text-center text-sm text-muted-foreground mb-4">
        Create your SparkTower account.
      </CardDescription>
      <GoogleButton />
      <div className="relative my-4">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">or</span>
        </div>
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && (
          <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3" data-testid="text-signup-error">
            {error}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="signup-first">First Name</Label>
            <Input
              id="signup-first"
              placeholder="Jane"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              data-testid="input-signup-firstname"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="signup-last">Last Name</Label>
            <Input
              id="signup-last"
              placeholder="Doe"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              data-testid="input-signup-lastname"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="signup-email">Email</Label>
          <Input
            id="signup-email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            data-testid="input-signup-email"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="signup-password">Password</Label>
          <div className="relative">
            <Input
              id="signup-password"
              type={showPassword ? "text" : "password"}
              placeholder={`At least ${PASSWORD_MIN} characters`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              data-testid="input-signup-password"
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="signup-confirm">Confirm Password</Label>
          <Input
            id="signup-confirm"
            type={showPassword ? "text" : "password"}
            placeholder="Confirm your password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            data-testid="input-signup-confirm"
          />
        </div>
        {/* The gradient, on the one button the page exists for. */}
        <Button type="submit" className="w-full text-white font-semibold border-0 hover:opacity-90 transition-opacity" style={{ backgroundImage: NOVA_GRADIENT_CSS }} disabled={loading} data-testid="button-submit-signup">
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Create Account
        </Button>
      </form>
    </div>
  );
}

function GoogleButton() {
  return (
    <Button
      variant="outline"
      className="w-full gap-2"
      onClick={() => { window.location.href = "/api/auth/google"; }}
      data-testid="button-google-auth"
    >
      <SiGoogle className="h-4 w-4" />
      Continue with Google
    </Button>
  );
}
