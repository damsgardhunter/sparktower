/**
 * Cards on file: adding one, choosing the default, and forgetting one.
 *
 * The card is typed into Stripe's own PaymentElement, which talks to Stripe
 * directly — so the number never reaches this app's server, and the platform
 * stays in PCI SAQ A rather than SAQ D. What comes back is a `pm_…` id, and
 * that is all this product ever holds. See the note at the top of
 * server/payment-methods.ts.
 *
 * It is this product's own form, inside this product's own dialog. The only
 * thing Stripe renders is the field the number goes in, which is exactly the
 * part that must not be ours.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { apiRequest } from "@/lib/queryClient";
import { stripePromise } from "@/lib/stripe";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { errorText } from "@/lib/api-error";
import { CreditCard, Loader2, Star, Trash2 } from "lucide-react";

export interface SavedCard {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
  expired: boolean;
}

export const CARDS_KEY = ["/api/payment-methods"];

export function useSavedCards() {
  return useQuery<{ cards: SavedCard[]; stripeConfigured: boolean }>({
    queryKey: CARDS_KEY,
    queryFn: async () => {
      const res = await fetch("/api/payment-methods", { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    staleTime: 60_000,
  });
}

/** "Visa" rather than "visa" — Stripe sends the brand lower-case. */
const brandName = (b: string) =>
  ({ visa: "Visa", mastercard: "Mastercard", amex: "American Express", discover: "Discover" }[b]
    ?? b.replace(/\b\w/g, (c) => c.toUpperCase()));

export const cardLabel = (c: SavedCard) => `${brandName(c.brand)} ···· ${c.last4}`;

/**
 * The cards, with the two things somebody does to them.
 *
 * An expired card is shown rather than hidden, with a word saying so: it is
 * still the card they think they are paying with, and a list that quietly
 * dropped it would make the "no card saved" message a lie.
 */
export function SavedCardList({ onAdd }: { onAdd?: () => void }) {
  const { data, isLoading } = useSavedCards();
  const qc = useQueryClient();
  const { toast } = useToast();

  const refresh = () => qc.invalidateQueries({ queryKey: CARDS_KEY });

  const makeDefault = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/payment-methods/${id}/default`, {}),
    onSuccess: () => { refresh(); toast({ title: "Default card changed" }); },
    onError: (e) => toast({ title: "Couldn't change that", description: errorText(e), variant: "destructive" }),
  });

  const forget = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/payment-methods/${id}`),
    onSuccess: () => { refresh(); toast({ title: "Card removed" }); },
    onError: (e) => toast({ title: "Couldn't remove that card", description: errorText(e), variant: "destructive" }),
  });

  const busy = makeDefault.isPending || forget.isPending;

  if (isLoading) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  if (data && !data.stripeConfigured) {
    return <p className="text-sm text-muted-foreground">Card payments aren't set up on this server yet.</p>;
  }

  const cards = data?.cards ?? [];

  return (
    <div className="space-y-2" data-testid="saved-cards">
      {!cards.length && (
        <p className="text-sm text-muted-foreground">No card saved. Adding one makes the next top-up a single tap.</p>
      )}
      {cards.map((c) => (
        <div key={c.id} className="flex items-center gap-3 rounded-md border p-2.5" data-testid={`saved-card-${c.id}`}>
          <CreditCard className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{cardLabel(c)}</p>
            <p className="text-xs text-muted-foreground">
              {String(c.expMonth).padStart(2, "0")}/{String(c.expYear).slice(-2)}
              {c.expired && " — expired"}
            </p>
          </div>
          {c.isDefault
            ? <Badge variant="secondary" className="shrink-0 gap-1"><Star className="h-3 w-3" /> Default</Badge>
            : (
              <Button
                variant="ghost" size="sm" disabled={busy}
                onClick={() => makeDefault.mutate(c.id)}
                data-testid={`make-default-${c.id}`}
              >
                Make default
              </Button>
            )}
          <Button
            variant="ghost" size="icon" disabled={busy}
            aria-label={`Remove ${cardLabel(c)}`}
            onClick={() => forget.mutate(c.id)}
            data-testid={`forget-card-${c.id}`}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ))}
      {onAdd && (
        <Button variant="outline" size="sm" onClick={onAdd} data-testid="button-add-card">Add a card</Button>
      )}
    </div>
  );
}

/**
 * The form that saves a card.
 *
 * Wrapped in `Elements` with the SetupIntent's client secret, which is what
 * lets PaymentElement collect and confirm in one step. The secret is fetched
 * when the form opens rather than held: a SetupIntent is cheap, and one created
 * on page load and used an hour later is one more thing that can have expired.
 */
export function AddCardForm({ onSaved, onCancel }: { onSaved?: () => void; onCancel?: () => void }) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiRequest("POST", "/api/payment-methods/setup-intent", {});
        const { clientSecret: secret } = await res.json();
        if (alive) setClientSecret(secret ?? null);
      } catch (e) {
        if (alive) setError(errorText(e));
      }
    })();
    return () => { alive = false; };
  }, []);

  if (error) return <p className="text-sm text-destructive" data-testid="add-card-error">{error}</p>;
  if (!clientSecret) {
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" data-testid="add-card-loading" />;
  }

  return (
    <Elements stripe={stripePromise()} options={{ clientSecret, appearance: { theme: "stripe" } }}>
      <CardFields onSaved={onSaved} onCancel={onCancel} />
    </Elements>
  );
}

function CardFields({ onSaved, onCancel }: { onSaved?: () => void; onCancel?: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSaving(true);
    /*
     * `redirect: "if_required"` keeps a card in this page. Some methods have to
     * leave and come back; a card does not, and sending somebody away to save
     * one is the redirect this whole change exists to remove.
     */
    const { error } = await stripe.confirmSetup({ elements, redirect: "if_required" });
    setSaving(false);
    if (error) {
      /* Stripe's own sentence names the field and says what is wrong with it. */
      toast({ title: "Couldn't save that card", description: error.message, variant: "destructive" });
      return;
    }
    await qc.invalidateQueries({ queryKey: CARDS_KEY });
    toast({ title: "Card saved" });
    onSaved?.();
  };

  return (
    <form onSubmit={submit} className="space-y-3" data-testid="add-card-form">
      <PaymentElement />
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={saving} data-testid="add-card-cancel">
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={!stripe || saving} data-testid="add-card-save">
          {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…</> : "Save card"}
        </Button>
      </div>
    </form>
  );
}
