import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Heart, Loader2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface DonationButtonProps {
  projectId: string;
  projectTitle: string;
}

const PRESET_AMOUNTS = [5, 10, 25, 50];

export function DonationButton({ projectId, projectTitle }: DonationButtonProps) {
  const [selectedPreset, setSelectedPreset] = useState<number | null>(10);
  const [customAmount, setCustomAmount] = useState("");
  const [isCustom, setIsCustom] = useState(false);
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const donationAmountCents = isCustom
    ? Math.round(parseFloat(customAmount || "0") * 100)
    : (selectedPreset || 0) * 100;

  const displayAmount = isCustom
    ? customAmount
    : String(selectedPreset || 0);

  const isValidAmount = donationAmountCents >= 100;

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/donate-checkout`, {
        amount: donationAmountCents,
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No checkout URL returned");
      }
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2" data-testid="button-donate">
          <Heart className="h-4 w-4 fill-current" />
          Donate
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Donate to {projectTitle}</DialogTitle>
          <DialogDescription>
            Support this project with a donation. Your contribution helps the creators stay motivated.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>Select Amount</Label>
            <div className="flex flex-wrap gap-2">
              {PRESET_AMOUNTS.map((amt) => (
                <Button
                  key={amt}
                  variant={!isCustom && selectedPreset === amt ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setSelectedPreset(amt);
                    setIsCustom(false);
                  }}
                  className="toggle-elevate"
                  data-testid={`button-preset-${amt}`}
                >
                  ${amt}
                </Button>
              ))}
              <Button
                variant={isCustom ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setIsCustom(true);
                  setSelectedPreset(null);
                }}
                className="toggle-elevate"
                data-testid="button-preset-custom"
              >
                Custom
              </Button>
            </div>
          </div>
          {isCustom && (
            <div className="grid gap-2">
              <Label htmlFor="custom-amount">Custom Amount ($)</Label>
              <Input
                id="custom-amount"
                type="number"
                min="1"
                step="0.01"
                placeholder="Enter amount"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                data-testid="input-donation-custom-amount"
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            className="w-full gap-2"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !isValidAmount}
            data-testid="button-submit-donation"
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Redirecting to Stripe...
              </>
            ) : (
              <>
                <Heart className="h-4 w-4" />
                Donate ${displayAmount}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
