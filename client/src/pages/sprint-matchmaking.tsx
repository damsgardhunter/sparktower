import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Clock,
  Zap,
  History,
  Monitor,
  Rocket,
  Sparkles,
  PenLine,
  ArrowLeft,
  ArrowRight,
  Check,
  Users,
  Shuffle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Duration = "24h" | "72h";
type ProductStyle = "past" | "modern" | "futuristic";
type ProductSource = "nova" | "custom";

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
  const [productSource, setProductSource] = useState<ProductSource | null>(null);
  const [productName, setProductName] = useState("");
  const [productDescription, setProductDescription] = useState("");

  const novaSuggestMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sprints/nova-suggest", {
        productStyle,
        partnerId,
      });
      return res.json();
    },
    onSuccess: (data: { name: string; description: string }) => {
      setProductName(data.name);
      setProductDescription(data.description);
    },
    onError: (error: any) => {
      const msg = error.message || "";
      if (msg.includes("403") || msg.includes("Insufficient credits")) {
        toast({ title: "Out of AI credits", description: "Upgrade your plan for more credits.", variant: "destructive" });
      } else {
        toast({ title: "Failed to generate suggestion", variant: "destructive" });
      }
    },
  });

  const createSprintMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sprints", {
        partnerId,
        duration,
        productStyle,
        productName: productName || undefined,
        productDescription: productDescription || undefined,
      });
      return res.json();
    },
    onSuccess: (sprint) => {
      toast({ title: "Sprint created!", description: "Your co-founder sprint has been started." });
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
        toast({ title: "Joined queue", description: "You'll be notified when a partner is found." });
        setLocation("/sprints");
      }
    },
    onError: () => {
      toast({ title: "Failed to join queue", variant: "destructive" });
    },
  });

  const handleNext = () => {
    if (step === 1 && !duration) return;
    if (step === 2 && !productStyle) return;
    if (step === 3 && !productSource) return;

    if (step === 3 && productSource === "nova") {
      novaSuggestMutation.mutate();
    }

    if (step < 4) setStep(step + 1);
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
          {[1, 2, 3, 4].map((s) => (
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
              {s < 4 && <div className={`w-12 h-0.5 ${s < step ? "bg-primary" : "bg-muted"}`} />}
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

        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-center mb-6">How would you like to pick a product idea?</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Card
                className={`cursor-pointer transition-colors ${
                  productSource === "nova" ? "border-primary bg-primary/5" : "hover-elevate"
                }`}
                onClick={() => setProductSource("nova")}
                data-testid="card-source-nova"
              >
                <CardContent className="p-6 text-center">
                  <div className={`mx-auto p-3 rounded-md w-fit mb-3 ${productSource === "nova" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                    <Sparkles className="h-6 w-6" />
                  </div>
                  <h3 className="font-semibold">Let Nova Choose</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Nova will suggest a product idea based on your profiles and chosen style. Uses 1 AI credit.
                  </p>
                  {productSource === "nova" && (
                    <Badge variant="default" className="mt-3">Selected</Badge>
                  )}
                </CardContent>
              </Card>
              <Card
                className={`cursor-pointer transition-colors ${
                  productSource === "custom" ? "border-primary bg-primary/5" : "hover-elevate"
                }`}
                onClick={() => setProductSource("custom")}
                data-testid="card-source-custom"
              >
                <CardContent className="p-6 text-center">
                  <div className={`mx-auto p-3 rounded-md w-fit mb-3 ${productSource === "custom" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                    <PenLine className="h-6 w-6" />
                  </div>
                  <h3 className="font-semibold">I'll Describe My Own</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Enter your own product name and description to start the sprint with.
                  </p>
                  {productSource === "custom" && (
                    <Badge variant="default" className="mt-3">Selected</Badge>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-center mb-6">Product Details</h2>

            {novaSuggestMutation.isPending && (
              <Card>
                <CardContent className="p-8 flex flex-col items-center gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Nova is crafting a product idea...</p>
                </CardContent>
              </Card>
            )}

            {!novaSuggestMutation.isPending && (
              <Card>
                <CardContent className="p-6 space-y-4">
                  {productSource === "nova" && productName && (
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      <span className="text-xs text-muted-foreground">Suggested by Nova — feel free to edit</span>
                    </div>
                  )}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Product Name</label>
                    <Input
                      value={productName}
                      onChange={(e) => setProductName(e.target.value)}
                      placeholder="Enter a product name"
                      className="mt-1"
                      data-testid="input-product-name"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Product Description</label>
                    <Textarea
                      value={productDescription}
                      onChange={(e) => setProductDescription(e.target.value)}
                      placeholder="Describe your product idea in 2-3 sentences"
                      className="mt-1 min-h-[100px]"
                      data-testid="textarea-product-description"
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent className="p-5">
                <h3 className="text-sm font-semibold mb-3">Sprint Summary</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Duration</span>
                    <Badge variant="outline" data-testid="badge-summary-duration">{duration}</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Product Style</span>
                    <Badge variant="outline" data-testid="badge-summary-style">
                      {STYLE_OPTIONS.find((o) => o.value === productStyle)?.label || productStyle}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Idea Source</span>
                    <Badge variant="outline" data-testid="badge-summary-source">
                      {productSource === "nova" ? "Nova AI" : "Custom"}
                    </Badge>
                  </div>
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
              </CardContent>
            </Card>
          </div>
        )}

        <div className="flex items-center justify-between gap-4 mt-8">
          <Button variant="outline" onClick={handleBack} disabled={step === 1} data-testid="button-step-back">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>

          {step < 4 ? (
            <Button
              onClick={handleNext}
              disabled={
                (step === 1 && !duration) ||
                (step === 2 && !productStyle) ||
                (step === 3 && !productSource)
              }
              data-testid="button-step-next"
            >
              Next
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          ) : (
            <Button
              onClick={handleCreate}
              disabled={isCreating || novaSuggestMutation.isPending}
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
