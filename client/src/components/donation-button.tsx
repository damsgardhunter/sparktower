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
import { Heart } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface DonationButtonProps {
  projectId: string;
  projectTitle: string;
}

export function DonationButton({ projectId, projectTitle }: DonationButtonProps) {
  const [amount, setAmount] = useState("10");
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/projects/${projectId}/donate`, {
        amount: parseInt(amount) * 100, // to cents
        message,
      });
    },
    onSuccess: () => {
      toast({
        title: "Thank you!",
        description: `Your donation for ${projectTitle} was successful.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      setOpen(false);
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
            Support this project with a small donation. Your contribution helps the creators stay motivated.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="amount">Amount ($)</Label>
            <Input
              id="amount"
              type="number"
              min="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              data-testid="input-donation-amount"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="message">Message (Optional)</Label>
            <Input
              id="message"
              placeholder="Good luck with the project!"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              data-testid="input-donation-message"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            className="w-full"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            data-testid="button-submit-donation"
          >
            {mutation.isPending ? "Processing..." : `Donate $${amount}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
