import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Clock,
  Zap,
  History,
  Monitor,
  Rocket,
  ArrowLeft,
  ArrowRight,
  Check,
  Users,
  Shuffle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Duration = "24h" | "72h";
type ProductStyle = "past" | "modern" | "futuristic";

const DURATION_OPTIONS: { value: Duration; label: string; description: string; icon: typeof Clock }[] = [
  {
    value: "24h",
    label: "24-Hour Sprint",
    description: "Quick validation sprint. Focus on problem definition, ICP, value proposition, and a product brief.",
    icon: Zap,
  },
  {
    value: "72h",
    label: "72-Hour Sprint",
    description: "Extended sprint with validation. Includes outreach emails, social posts, interview questions, and evidence collection.",
    icon: Clock,
  },
];

const STYLE_OPTIONS: { value: ProductStyle; label: string; description: string; icon: typeof History }[] = [
  {
    value: "past",
    label: "Reimagined Classic",
    description: "Reimagine a past product or concept with modern technology and fresh thinking.",
    icon: History,
  },
  {
    value: "modern",
    label: "Modern Innovation",
    description: "Improve or innovate on a current product or service that exists today.",
    icon: Monitor,
  },
  {
    value: "futuristic",
    label: "Future Vision",
    description: "Build something that doesn't exist yet but could shape the future.",
    icon: Rocket,
  },
];

export default function SprintMatchmaking() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const partnerId = params.get("partnerId");
  const { toast } = useToast();

  const [step, setStep] = useState(1);
  const [duration, setDuration] = useState<Duration | null>(null);
  const [productStyle, setProductStyle] = useState<ProductStyle | null>(null);

  const createSprintMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sprints", {
        partnerId,
        duration,
        productStyle,
      });
      return res.json();
    },
    onSuccess: (sprint) => {
      toast({ title: "Sprint created!", description: "Head to the sprint dashboard to meet your partner and propose a product name." });
      queryClient.invalidateQueries({ queryKey: ["/api/sprints"] });
      setLocation(`/sprints/${sprint.id}`);
    },
    onError: () => {
      toast({ title: "Failed to create sprint", variant: "destructive" });
    },
  });

  const queueMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sprints/queue", {
        duration,
        productStyle,
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.matched) {
        toast({ title: "Match found!", description: "You've been paired with a partner." });
        queryClient.invalidateQueries({ queryKey: ["/api/sprints"] });
        setLocation(`/sprints/${data.sprint.id}`);
      } else {
        toast({ title: "Joined queue", description: "We'll match you as soon as a partner joins. Check back on the Sprints page." });
        queryClient.invalidateQueries({ queryKey: ["/api/sprints/queue/status"] });
        setLocation("/sprints");
      }
    },
    onError: () => {
      toast({ title: "Failed to join queue", variant: "destructive" });
    },
  });

  const handleNext = () => {
    if (step === 1 && !duration) return;
    if (step < 2) setStep(step + 1);
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleCreate = () => {
    if (partnerId) {
      createSprintMutation.mutate();
    } else {
      queueMutation.mutate();
    }
  };

  const isCreating = createSprintMutation.isPending || queueMutation.isPending;

  return (
    <div className="min-h-full bg-background">
      <div className="max-w-3xl mx-auto p-6">
        <div className="mb-8">
          <Button variant="ghost" onClick={() => setLocation(partnerId ? "/matches" : "/sprints")} data-testid="button-back-from-sprint">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </div>

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold" data-testid="text-sprint-matchmaking-title">Co-Founder Sprint</h1>
          <p className="text-muted-foreground mt-1">
            {partnerId ? "Set up a trial collaboration with your match" : "Find a partner and start building together"}
          </p>
        </div>

        <div className="flex items-center justify-center gap-2 mb-10">
          {[1, 2].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                  s < step
                    ? "bg-primary text-primary-foreground"
                    : s === step
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
                data-testid={`step-indicator-${s}`}
              >
                {s < step ? <Check className="h-4 w-4" /> : s}
              </div>
              {s < 2 && <div className={`w-12 h-0.5 ${s < step ? "bg-primary" : "bg-muted"}`} />}
            </div>
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-center mb-6">Choose Sprint Duration</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {DURATION_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const isSelected = duration === opt.value;
                return (
                  <Card
                    key={opt.value}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? "border-primary bg-primary/5" : "hover-elevate"
                    }`}
                    onClick={() => setDuration(opt.value)}
                    data-testid={`card-duration-${opt.value}`}
                  >
                    <CardContent className="p-6">
                      <div className="flex items-start gap-4">
                        <div className={`p-2 rounded-md ${isSelected ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold">{opt.label}</h3>
                          <p className="text-sm text-muted-foreground mt-1">{opt.description}</p>
                        </div>
                        {isSelected && (
                          <div className="bg-primary text-primary-foreground rounded-full p-0.5">
                            <Check className="h-3 w-3" />
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-center mb-6">Choose Product Style</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {STYLE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const isSelected = productStyle === opt.value;
                return (
                  <Card
                    key={opt.value}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? "border-primary bg-primary/5" : "hover-elevate"
                    }`}
                    onClick={() => setProductStyle(opt.value)}
                    data-testid={`card-style-${opt.value}`}
                  >
                    <CardContent className="p-5 text-center">
                      <div className={`mx-auto p-3 rounded-md w-fit mb-3 ${isSelected ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                        <Icon className="h-6 w-6" />
                      </div>
                      <h3 className="font-semibold text-sm">{opt.label}</h3>
                      <p className="text-xs text-muted-foreground mt-1">{opt.description}</p>
                      {isSelected && (
                        <Badge variant="default" className="mt-3">Selected</Badge>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <Card className="mt-6">
              <CardContent className="p-5">
                <h3 className="text-sm font-semibold mb-3">Sprint Summary</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Duration</span>
                    <Badge variant="outline" data-testid="badge-summary-duration">{duration}</Badge>
                  </div>
                  {productStyle && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">Product Style</span>
                      <Badge variant="outline" data-testid="badge-summary-style">
                        {STYLE_OPTIONS.find((o) => o.value === productStyle)?.label || productStyle}
                      </Badge>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Partner</span>
                    <Badge variant="outline" data-testid="badge-summary-partner">
                      {partnerId ? (
                        <span className="flex items-center gap-1"><Users className="h-3 w-3" /> Matched Partner</span>
                      ) : (
                        <span className="flex items-center gap-1"><Shuffle className="h-3 w-3" /> Random Match</span>
                      )}
                    </Badge>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-4">
                  You'll propose a product name after being matched with your partner.
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        <div className="flex items-center justify-between gap-4 mt-8">
          <Button variant="outline" onClick={handleBack} disabled={step === 1} data-testid="button-step-back">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>

          {step < 2 ? (
            <Button
              onClick={handleNext}
              disabled={step === 1 && !duration}
              data-testid="button-step-next"
            >
              Next
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          ) : (
            <Button
              onClick={handleCreate}
              disabled={isCreating || !productStyle}
              data-testid="button-create-sprint"
            >
              {isCreating ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : partnerId ? (
                <Rocket className="h-4 w-4 mr-2" />
              ) : (
                <Shuffle className="h-4 w-4 mr-2" />
              )}
              {partnerId ? "Create Sprint" : "Find Match & Create"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
