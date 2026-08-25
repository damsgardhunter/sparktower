import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Zap, MessageSquare, Target, Eye, EyeOff, Loader2, Users, Rocket, Globe, Brain, UserPlus, Search, Handshake, Lightbulb, Wrench, User, ArrowRight } from "lucide-react";
import logoImage from "@assets/logo_1772583119620.png";
import { SiGoogle } from "react-icons/si";
import { ThemeToggle } from "@/components/theme-toggle";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import heroVideo from "@assets/Brooklyn_Tower_Tesla_Coil_Animation_1772567582595.mp4";

export default function LandingPage() {
  const [activeTab, setActiveTab] = useState("login");
  const [showAuthModal, setShowAuthModal] = useState(false);

  return (
    <div className="flex flex-col min-h-screen bg-white text-foreground">
      <header className="fixed top-0 w-full z-50" style={{ opacity: 0, animation: 'hero-fade-in-slow 0.8s ease-out forwards' }}>
        <div className="relative flex items-center justify-center p-3 bg-white/80 backdrop-blur-md border-b border-black/5">
          <div className="absolute left-4 flex items-center gap-4">
            <ThemeToggle />
          </div>
          <div className="flex flex-col items-center">
            <img src={logoImage} alt="SparkTower" className="h-10 w-auto" data-testid="img-logo" />
            <span className="font-bold text-xs tracking-widest uppercase text-black -mt-0.5">SparkTower</span>
          </div>
          <div className="absolute right-4 flex items-center gap-3">
            <Button
              size="sm"
              data-testid="button-login"
              onClick={() => { setActiveTab("login"); setShowAuthModal(true); }}
            >
              Log In
            </Button>
            <Button
              size="sm"
              variant="outline"
              data-testid="button-signup-nav"
              onClick={() => { setActiveTab("signup"); setShowAuthModal(true); }}
            >
              Sign Up
            </Button>
          </div>
        </div>
      </header>

      <section className="relative min-h-screen flex items-start justify-center px-4 pt-24 pb-16 md:pb-24 bg-white overflow-visible">
        <div className="absolute left-0 right-0 z-0 overflow-hidden" style={{ top: '0px', bottom: 0 }}>
          <video
            src={heroVideo}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover object-top"
            data-testid="video-hero"
          />
        </div>

        <div className="relative z-10 w-full max-w-5xl flex flex-col items-center gap-12" style={{ animation: 'hero-fade-in 0.8s ease-out both' }}>
          <div className="text-center space-y-6">
            <h1 className="text-3xl md:text-5xl font-bold text-black tracking-tight italic leading-tight" style={{ opacity: 0, animation: 'hero-fade-in 0.8s ease-out forwards' }} data-testid="text-hero-headline">
              "The present is theirs; the future, for which I really worked, <span className="text-primary">is mine.</span>"
            </h1>
            <div className="flex justify-center" style={{ opacity: 0, animation: 'hero-fade-in 0.8s ease-out 0.1s forwards' }}>
              <span className="inline-block px-4 py-1.5 bg-black text-white text-sm font-semibold tracking-wide">
                — Nikola Tesla
              </span>
            </div>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto font-light leading-relaxed" style={{ opacity: 0, animation: 'hero-fade-in 0.8s ease-out 0.2s forwards' }}>
              SparkTower is built for the builders who think ahead. Like Tesla, we believe the future belongs to those who create it — connect with visionary entrepreneurs, collaborate with AI, and launch the projects that shape tomorrow.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center" style={{ opacity: 0, animation: 'hero-fade-in 0.8s ease-out 0.3s forwards' }}>
              <Button
                size="lg"
                data-testid="button-get-started"
                onClick={() => { setActiveTab("signup"); setShowAuthModal(true); }}
              >
                Get Started
              </Button>
              <Button size="lg" variant="outline" className="bg-white/80 backdrop-blur-md" asChild>
                <a href="#features" data-testid="link-learn-more">Learn More</a>
              </Button>
            </div>
          </div>

          {showAuthModal && (
            <div className="w-full max-w-md" style={{ opacity: 0, animation: 'hero-fade-in 0.8s ease-out forwards' }}>
              <AuthCard activeTab={activeTab} onTabChange={setActiveTab} />
            </div>
          )}
        </div>
      </section>

      <section id="features" className="py-24 px-4 bg-card/30 border-y border-border">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16 space-y-4">
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight">Why SparkTower?</h2>
            <p className="text-xl text-secondary max-w-2xl mx-auto">
              We provide the tools and network to turn your vision into reality.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="p-8 rounded-2xl bg-card border border-card-border space-y-4 hover-elevate">
              <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                <Target className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold">AI Matching</h3>
              <p className="text-secondary leading-relaxed">
                Our smart algorithm matches you with users based on skills, interests, and experience level.
              </p>
            </div>
            <div className="p-8 rounded-2xl bg-card border border-card-border space-y-4 hover-elevate">
              <div className="h-12 w-12 rounded-xl bg-accent/10 flex items-center justify-center text-accent-foreground">
                <MessageSquare className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold">AI Project Chat</h3>
              <p className="text-secondary leading-relaxed">
                Guided project creation with an AI assistant that helps you plan roadmaps, teams, and roles.
              </p>
            </div>
            <div className="p-8 rounded-2xl bg-card border border-card-border space-y-4 hover-elevate">
              <div className="h-12 w-12 rounded-xl bg-chart-4/10 flex items-center justify-center text-chart-4">
                <Zap className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold">Showcase & Scale</h3>
              <p className="text-secondary leading-relaxed">
                Display your code, receive donations, and climb the leaderboard as your project gains traction.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 px-4 bg-background border-b border-border" data-testid="section-stats">
        <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            { value: "10,000+", label: "Builders & Creators", icon: Users },
            { value: "2,500+", label: "Projects Launched", icon: Rocket },
            { value: "50,000+", label: "AI Matches Made", icon: Brain },
            { value: "120+", label: "Countries Represented", icon: Globe },
          ].map((stat) => (
            <div key={stat.label} className="space-y-2" data-testid={`stat-${stat.label.toLowerCase().replace(/\s+/g, '-')}`}>
              <stat.icon className="h-6 w-6 text-primary mx-auto mb-2" />
              <div className="text-3xl md:text-4xl font-bold text-foreground tracking-tight">{stat.value}</div>
              <div className="text-sm text-muted-foreground font-medium">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="py-24 px-4 bg-card/30 border-b border-border" data-testid="section-personas">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16 space-y-4">
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight">Built for Builders Like You</h2>
            <p className="text-xl text-secondary max-w-2xl mx-auto">
              Whether you're going solo or looking for your dream team, SparkTower meets you where you are.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="p-8 rounded-2xl bg-card border border-card-border space-y-4 hover-elevate" data-testid="card-persona-founder">
              <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                <Lightbulb className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold">Solo Founders</h3>
              <p className="text-secondary leading-relaxed italic">"I have the vision, but I need the right people to make it real."</p>
              <p className="text-secondary leading-relaxed">
                Stop pitching into the void. SparkTower's AI matches you with co-founders who share your drive and complement your skills — so you can move from idea to launch, faster.
              </p>
            </div>
            <div className="p-8 rounded-2xl bg-card border border-card-border space-y-4 hover-elevate" data-testid="card-persona-freelancer">
              <div className="h-12 w-12 rounded-xl bg-accent/10 flex items-center justify-center text-accent-foreground">
                <Wrench className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold">Freelancers & Specialists</h3>
              <p className="text-secondary leading-relaxed italic">"I'm tired of one-off gigs. I want to build something that matters."</p>
              <p className="text-secondary leading-relaxed">
                Your skills deserve more than a marketplace listing. Join projects you believe in, earn reputation through real collaboration, and build a portfolio that proves your impact.
              </p>
            </div>
            <div className="p-8 rounded-2xl bg-card border border-card-border space-y-4 hover-elevate" data-testid="card-persona-sideproject">
              <div className="h-12 w-12 rounded-xl bg-chart-4/10 flex items-center justify-center text-chart-4">
                <Zap className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold">Side-Project Builders</h3>
              <p className="text-secondary leading-relaxed italic">"I build on nights and weekends, but I feel like I'm doing it alone."</p>
              <p className="text-secondary leading-relaxed">
                You're not alone anymore. Connect with others who share your hustle. Practice sprints with our AI, compete in hackathons, and turn your side project into your main thing.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="py-24 px-4 bg-background border-b border-border" data-testid="section-how-it-works">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16 space-y-4">
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight">How It Works</h2>
            <p className="text-xl text-secondary max-w-2xl mx-auto">
              Four steps from sign-up to launch. No gatekeeping, no waiting — just building.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[
              { step: "01", title: "Sign Up", desc: "Create your free account in under a minute. No credit card required.", icon: UserPlus },
              { step: "02", title: "Build Your Profile", desc: "Tell us your skills, interests, and what you're looking to build. Our AI learns what makes you unique.", icon: User },
              { step: "03", title: "Get Matched", desc: "Our AI finds builders who complement your strengths. Try a 24-hour sprint to test the fit before committing.", icon: Search },
              { step: "04", title: "Launch Together", desc: "Collaborate with built-in project tools, AI assistance, and a community cheering you on.", icon: Handshake },
            ].map((item, i) => (
              <div key={item.step} className="relative text-center space-y-4 p-6" data-testid={`step-${item.step}`}>
                {i < 3 && (
                  <div className="hidden md:block absolute top-12 -right-3 z-10">
                    <ArrowRight className="h-5 w-5 text-primary/40" />
                  </div>
                )}
                <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center text-primary mx-auto">
                  <item.icon className="h-6 w-6" />
                </div>
                <div className="text-xs font-bold text-primary tracking-widest uppercase">Step {item.step}</div>
                <h3 className="text-lg font-bold">{item.title}</h3>
                <p className="text-secondary text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
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
              onClick={() => { setActiveTab("signup"); setShowAuthModal(true); }}
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
                <li>Games Arena</li>
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
            <p className="text-muted-foreground/60 text-sm">&copy; {new Date().getFullYear()} SparkTower. Built for the future of collaboration.</p>
            <p className="text-muted-foreground/40 text-xs italic">"The present is theirs; the future is mine." — Nikola Tesla</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function AuthCard({ activeTab, onTabChange }: { activeTab: string; onTabChange: (tab: string) => void }) {
  return (
    <Card className="bg-card/95 backdrop-blur-md border-card-border shadow-2xl">
      <Tabs value={activeTab} onValueChange={onTabChange}>
        <CardHeader className="pb-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login" data-testid="tab-login">Log In</TabsTrigger>
            <TabsTrigger value="signup" data-testid="tab-signup">Sign Up</TabsTrigger>
          </TabsList>
        </CardHeader>
        <CardContent>
          <TabsContent value="login" className="mt-0">
            <LoginForm />
          </TabsContent>
          <TabsContent value="signup" className="mt-0">
            <SignupForm onSuccess={() => onTabChange("login")} />
          </TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  );
}

function LoginForm() {
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
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      window.location.href = "/";
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

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
          <Label htmlFor="login-password">Password</Label>
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
        <Button type="submit" className="w-full" disabled={loading} data-testid="button-submit-login">
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
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password, firstName, lastName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Registration failed");
        return;
      }
      toast({ title: "Account created!", description: "You're now logged in." });
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      window.location.href = "/";
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
              placeholder="At least 6 characters"
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
        <Button type="submit" className="w-full" disabled={loading} data-testid="button-submit-signup">
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
