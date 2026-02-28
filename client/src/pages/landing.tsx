import { Button } from "@/components/ui/button";
import { Zap, MessageSquare, Target } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

export default function LandingPage() {
  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground">
      {/* Navbar */}
      <header className="fixed top-0 w-full z-50 flex items-center justify-between p-4 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center font-bold text-primary-foreground">
            ST
          </div>
          <span className="font-bold text-xl tracking-tight">SparkTower</span>
        </div>
        <div className="flex items-center gap-4">
          <ThemeToggle />
          <Button asChild data-testid="button-login">
            <a href="/api/login">Login with Replit</a>
          </Button>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center justify-center pt-20 px-4">
        {/* Background Image Wash */}
        <div className="absolute inset-0 z-0">
          <img
            src="https://images.unsplash.com/photo-1517048676732-d65bc937f952?q=80&w=2070&auto=format&fit=crop"
            alt="Collaboration Hero"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/60 to-black/80" />
        </div>

        <div className="relative z-10 max-w-4xl text-center space-y-8">
          <h1 className="text-4xl md:text-7xl font-bold text-white tracking-tight">
            Ignite your next <span className="text-primary">Collaborative Project</span>
          </h1>
          <p className="text-xl md:text-2xl text-slate-300 max-w-2xl mx-auto font-light">
            Connect with entrepreneurs and freelancers. Use AI to find your perfect team and build something amazing together.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" className="h-12 px-8 text-lg" asChild data-testid="button-get-started">
              <a href="/api/login">Get Started</a>
            </Button>
            <Button size="lg" variant="outline" className="h-12 px-8 text-lg text-white border-white/20 bg-white/5 backdrop-blur-sm" asChild>
              <a href="#features">Learn More</a>
            </Button>
          </div>
        </div>
      </section>

      {/* Features Section */}
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
                Guided project creation with an AI assistant that helps you plan roadmaps, teams, and tech stacks.
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
          <p>© {new Date().getFullYear()} SparkTower. Built for the future of collaboration.</p>
        </div>
      </footer>
    </div>
  );
}
