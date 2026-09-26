/**
 * What a company has paid for, and what it still owes.
 *
 * Two seats, priced apart because they are two different things. A play seat
 * is a person at a table in one of the markets we wrote. A Nova seat is a
 * person at a table in a season Nova built by reading this company's own
 * project — worth more, so it costs more. The balances do not substitute:
 * buying ten of one leaves you none of the other, and saying so plainly here
 * is cheaper than saying it in a refund.
 *
 * Nothing is charged for creating a season. The gate is at the start line,
 * against the people who actually sat down, so a company of forty never pays
 * for a season five of them play.
 */
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { Loader2 } from "lucide-react";
import { useState } from "react";

export type SeatKind = "play" | "nova";

export interface SeatTier {
  kind: SeatKind;
  paid: number;
  pricePerSeat: number;
  /** What seating everyone in the company would still cost. The most a season could ever need. */
  shortBy: number;
}

export interface Seats {
  people: number;
  currency: string;
  seats: SeatTier[];
}

export function useSeats(companyId: string) {
  // An empty id means "not this person's business" — asked for by a caller
  // that knows the viewer cannot manage the company, so there is nothing to
  // fetch and nothing to show.
  return useQuery<Seats>({
    queryKey: [`/api/companies/${companyId}/simulation-seats`],
    enabled: !!companyId,
  });
}

export const tierOf = (seats: Seats | undefined, kind: SeatKind): SeatTier | undefined =>
  seats?.seats.find((t) => t.kind === kind);

const NAME: Record<SeatKind, string> = { play: "play", nova: "Nova" };

/**
 * One line on where this company stands for one kind of seat, and a button to
 * buy what it is short of. Deliberately not a dialog: the number is small and
 * the decision is small, and a modal would make it feel otherwise.
 */
export function SeatsNotice({ companyId, kind, seats, onError }: {
  companyId: string;
  kind: SeatKind;
  seats: Seats | undefined;
  onError?: (message: string) => void;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const tier = tierOf(seats, kind);

  const buy = useMutation({
    /*
     * Enough for everyone in the company, because the alternative is buying
     * again the first time somebody else joins the table. One is the floor so
     * the button always does something.
     */
    mutationFn: () => apiRequest("POST", `/api/companies/${companyId}/simulation-seats/checkout`, {
      seats: Math.max(1, tier?.shortBy || seats?.people || 5),
      kind,
    }),
    onSuccess: async (res: any) => {
      const body = await res.json();
      if (body.url) window.location.href = body.url;
    },
    onError: (err: unknown) => {
      const message = errorText(err, "Couldn't start that purchase.");
      setFailed(message);
      onError?.(message);
    },
  });

  if (!tier) return null;
  const short = tier.shortBy;

  return (
    <div className="space-y-1.5" data-testid={`seats-${kind}`}>
      <p className="text-xs text-muted-foreground" data-testid={`text-seats-${kind}`}>
        {tier.paid > 0
          ? `${tier.paid} ${NAME[kind]} seat${tier.paid === 1 ? "" : "s"} paid for, ${seats!.people} ${seats!.people === 1 ? "person" : "people"} in the company.`
          : `$${tier.pricePerSeat} a seat, once. A seat is a person at a table for the life of a season, and it stays with the company.`}
        {short > 0 && tier.paid > 0 && ` ${short} more would seat everyone.`}
      </p>
      {short > 0 && (
        <Button
          size="sm"
          variant={tier.paid > 0 ? "outline" : "default"}
          onClick={() => buy.mutate()}
          disabled={buy.isPending}
          data-testid={`button-buy-seats-${kind}`}
        >
          {buy.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
          Buy {short} {NAME[kind]} seat{short === 1 ? "" : "s"} — ${short * tier.pricePerSeat}
        </Button>
      )}
      {failed && <p className="text-xs text-destructive">{failed}</p>}
    </div>
  );
}
