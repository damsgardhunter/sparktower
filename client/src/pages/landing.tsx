import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Zap, MessageSquare, Target, Eye, EyeOff, Loader2 } from "lucide-react";
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
      <header className="fixed top-0 w-full z-50" style={{ opacity: 0, animation: 'hero-fade-in-slow 1.5s ease-out 3.8s forwards' }}>
        <div className="flex items-center justify-between p-4 bg-white/80 backdrop-blur-md border-b border-black/5">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center font-bold text-primary-foreground">
              ST
            </div>
            <span className="font-bold text-xl tracking-tight text-black">SparkTower</span>
          </div>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <Button
              data-testid="button-login"
              onClick={() => { setActiveTab("login"); setShowAuthModal(true); }}
            >
              Log In
            </Button>
            <Button
              variant="outline"
              data-testid="button-signup-nav"
              onClick={() => { setActiveTab("signup"); setShowAuthModal(true); }}
            >
              Sign Up
            </Button>
          </div>
        </div>
      </header>

      <section className="relative h-screen flex items-start justify-center px-4 pt-24 bg-white overflow-hidden">
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

        <div className="relative z-10 w-full max-w-5xl flex flex-col items-center gap-12" style={{ animation: 'hero-fade-in 1.2s ease-out 2s both' }}>
          <div className="text-center space-y-6">
            <h1 className="text-3xl md:text-5xl font-bold text-black tracking-tight italic leading-tight" style={{ opacity: 0, animation: 'hero-fade-in 1.2s ease-out 2s forwards' }} data-testid="text-hero-headline">
              "The present is theirs; the future, for which I really worked, <span className="text-primary">is mine.</span>"
            </h1>
            <div className="flex justify-center" style={{ opacity: 0, animation: 'hero-fade-in 1.2s ease-out 2.4s forwards' }}>
              <span className="inline-block px-4 py-1.5 bg-black text-white text-sm font-semibold tracking-wide">
                — Nikola Tesla
              </span>
            </div>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto font-light leading-relaxed" style={{ opacity: 0, animation: 'hero-fade-in 1.2s ease-out 2.8s forwards' }}>
              SparkTower is built for the builders who think ahead. Like Tesla, we believe the future belongs to those who create it — connect with visionary entrepreneurs, collaborate with AI, and launch the projects that shape tomorrow.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center" style={{ opacity: 0, animation: 'hero-fade-in 1.2s ease-out 3.2s forwards' }}>
              <Button
                size="lg"
                className="h-12 px-8 text-lg"
                data-testid="button-get-started"
                onClick={() => { setActiveTab("signup"); setShowAuthModal(true); }}
              >
                Get Started
              </Button>
              <Button size="lg" variant="outline" className="h-12 px-8 text-lg border-black/10 bg-white/80 backdrop-blur-md hover:bg-white/90" asChild>
                <a href="#features">Learn More</a>
              </Button>
            </div>
          </div>

          {showAuthModal && (
            <div className="w-full max-w-md" style={{ opacity: 0, animation: 'hero-fade-in 1.2s ease-out 3.2s forwards' }}>
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

      <footer className="py-12 border-t border-border bg-card">
        <div className="max-w-6xl mx-auto px-4 text-center text-tertiary">
          <p>&copy; {new Date().getFullYear()} SparkTower. Built for the future of collaboration.</p>
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
        <div className="grid grid-cols-2 gap-3">
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
