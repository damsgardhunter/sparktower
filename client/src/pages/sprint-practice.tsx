import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";
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
  Cpu,
  GraduationCap,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SprintIdeaPicker, type SprintIdea } from "@/components/sprint-idea-picker";

type Duration = "24h" | "72h";
type ProductStyle = "past" | "modern" | "futuristic";

const DURATION_OPTIONS: { value: Duration; label: string; description: string; icon: typeof Clock }[] = [
  {
    value: "24h",
    label: "24-Hour Sprint",
    description: "Quick practice run. Covers problem definition, ICP, value proposition, and a product brief.",
    icon: Zap,
  },
  {
    value: "72h",
    label: "72-Hour Sprint",
    description: "Full practice with validation phase. Includes outreach, social posts, and interview questions.",
    icon: Clock,
  },
];

const STYLE_OPTIONS: { value: ProductStyle; label: string; description: string; icon: typeof History }[] = [
  {
    value: "past",
    label: "Reimagined Classic",
    description: "Practice with a reimagined past product concept.",
    icon: History,
  },
  {
    value: "modern",
    label: "Modern Innovation",
    description: "Practice innovating on a current product or service.",
    icon: Monitor,
  },
  {
    value: "futuristic",
    label: "Future Vision",
    description: "Practice building something that doesn't exist yet.",
    icon: Rocket,
  },
];

export default function SprintPractice() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [step, setStep] = useState(1);
  const [duration, setDuration] = useState<Duration | null>(null);
  const [productStyle, setProductStyle] = useState<ProductStyle | null>(null);

  const createPracticeMutation = useMutation({
    // `idea` is the option the builder picked; without it the server falls
    // back to generating one, which is the old behaviour.
    mutationFn: async (idea?: SprintIdea) => {
      const res = await apiRequest("POST", "/api/sprints/practice", {
        duration,
        productStyle,
        idea,
      });
      return res.json();
    },
    onSuccess: (sprint) => {
      toast({ title: "Practice sprint created!", description: `You're building "${sprint.productName}" with Nova.` });
      queryClient.invalidateQueries({ queryKey: ["/api/sprints"] });
      setLocation(`/sprints/${sprint.id}`);
    },
    onError: (error: any) => {
      const msg = error?.message || "";
      if (msg.includes("403") || msg.includes("Insufficient credits")) {
        toast({ title: "Not enough AI credits", description: "Practice sprints use 1 AI credit for Nova's product suggestion.", variant: "destructive" });
      } else {
        toast({ title: "Failed to create practice sprint", variant: "destructive" });
      }
    },
  });

  return (
    <div className="min-h-full bg-background">
      <div className="max-w-3xl mx-auto p-6">
        <div className="mb-8">
          <Button variant="ghost" onClick={() => setLocation("/sprints")} data-testid="button-back-from-practice">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </div>

        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-3">
            <GraduationCap className="h-7 w-7 text-primary" />
            <h1 className="text-2xl font-bold" data-testid="text-practice-title">Practice Sprint</h1>
          </div>
          <p className="text-muted-foreground max-w-md mx-auto">
            Practice the sprint process with Nova as your AI co-founder. Go through all phases to get comfortable before a real sprint.
          </p>
        </div>

        <Card className="mb-6">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Cpu className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">Nova AI Partner</p>
              <p className="text-xs text-muted-foreground">
                Nova pitches you ideas, talks through the product with you, answers the ideation
                questions as your partner, and gives feedback at the end.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-center gap-2 mb-10">
          {[1, 2, 3].map((s) => (
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
              {s < 3 && <div className={`w-12 h-0.5 ${s < step ? "bg-primary" : "bg-muted"}`} />}
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
          </div>
        )}

        {step === 3 && productStyle && (
          <div className="space-y-4">
            <div className="text-center mb-6">
              <h2 className="text-lg font-semibold">Pick your product</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Nova will pitch three {STYLE_OPTIONS.find(o => o.value === productStyle)?.label.toLowerCase()} ideas.
                Choose whichever sounds most fun to build.
              </p>
            </div>
            <SprintIdeaPicker
              productStyle={productStyle}
              onChoose={(idea) => createPracticeMutation.mutate(idea)}
              isSubmitting={createPracticeMutation.isPending}
            />
          </div>
        )}

        <div className="flex items-center justify-between gap-4 mt-8">
          <Button variant="outline" onClick={() => step > 1 ? setStep(step - 1) : setLocation("/sprints")} data-testid="button-step-back">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>

          {step === 1 ? (
            <Button onClick={() => setStep(2)} disabled={!duration} data-testid="button-step-next">
              Next
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          ) : step === 2 ? (
            <Button onClick={() => setStep(3)} disabled={!productStyle} data-testid="button-step-next">
              Pick an idea
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => createPracticeMutation.mutate(undefined)}
              disabled={createPracticeMutation.isPending}
              data-testid="button-create-practice"
            >
              {createPracticeMutation.isPending
                ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                : <GraduationCap className="h-4 w-4 mr-2" />}
              Surprise me instead
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
