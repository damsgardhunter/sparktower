/**
 * One simulation on the marketplace grid.
 *
 * Deliberately the same object as a project card to somebody browsing: a thing
 * with a name, a sentence about it and a person behind it, that opens when you
 * press it. So it borrows the project card's ring, hover and layout rather
 * than inventing a second visual language for the same gesture — a grid where
 * half the tiles lift and half do not reads as a page half-finished.
 *
 * What it adds is the two facts a project card has no equivalent of: what it
 * costs, and whether anybody has played it.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/user-avatar";
import { useLocation } from "wouter";
import { Users, CalendarClock, Play } from "lucide-react";

export interface ListingCard {
  id: string;
  title: string;
  summary: string | null;
  tags: string[];
  pricing: "free" | "perSeat";
  seatPriceCents: number;
  cadence: "yearly" | "quarterly" | "monthly";
  botSkill: "filler" | "survivor";
  totalYears: number;
  seatsSold: number;
  seasonsStarted: number;
  author: { id: string; name: string | null; avatarUrl: string | null };
}

/** What a seat costs, said the way a person would say it. */
export function priceLabel(listing: Pick<ListingCard, "pricing" | "seatPriceCents">): string {
  if (listing.pricing === "free") return "Free";
  return `$${(listing.seatPriceCents / 100).toFixed(2)} a seat`;
}

/** How often the table decides, which is the thing that changes how it plays. */
const CADENCE_LABEL: Record<ListingCard["cadence"], string> = {
  yearly: "Yearly",
  quarterly: "Quarterly",
  monthly: "Monthly",
};

export function SimulationListingCard({ listing }: { listing: ListingCard }) {
  const [, setLocation] = useLocation();
  const free = listing.pricing === "free";

  return (
    <Card
      className="nova-ring-soft nova-hover-glow border-0 cursor-pointer overflow-visible"
      onClick={() => setLocation(`/simulations/market/${listing.id}`)}
      data-testid={`card-simulation-${listing.id}`}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-xl font-bold line-clamp-2 min-w-0">
          <span className="truncate">{listing.title}</span>
        </CardTitle>
        {/*
          * Free is the louder badge on purpose. On a marketplace the question
          * somebody is answering fastest is "does this cost me anything", and
          * a price in muted grey beside a bright everything-else is the one
          * number they have to go looking for.
          */}
        <Badge
          variant={free ? "default" : "secondary"}
          className="shrink-0"
          data-testid={`price-${listing.id}`}
        >
          {priceLabel(listing)}
        </Badge>
      </CardHeader>

      <CardContent>
        <p className="text-secondary line-clamp-2 min-h-[3rem] mb-4">
          {listing.summary ?? "No description yet."}
        </p>

        <div className="flex flex-wrap items-center gap-1 mb-4">
          <Badge variant="outline" className="gap-1 text-xs">
            <CalendarClock className="h-3 w-3" />
            {CADENCE_LABEL[listing.cadence]} · {listing.totalYears}y
          </Badge>
          {listing.botSkill === "survivor" && (
            /* Worth saying: it is the setting that decides whether rivals try. */
            <Badge variant="outline" className="text-xs">Rivals play to win</Badge>
          )}
          {listing.tags.slice(0, 2).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs font-normal">{tag}</Badge>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <UserAvatar src={listing.author.avatarUrl ?? undefined} name={listing.author.name ?? "A builder"} className="h-6 w-6" />
            <span className="text-sm text-secondary truncate">{listing.author.name ?? "A builder"}</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-tertiary shrink-0">
            {/*
              * Seasons rather than seats: "played eleven times" is a thing a
              * person can judge, and "sold forty seats" is a thing the seller
              * cares about. Zero is left off rather than shown as a nought —
              * a new listing should not advertise that nobody has played it.
              */}
            {listing.seasonsStarted > 0 && (
              <span className="flex items-center gap-1" data-testid={`plays-${listing.id}`}>
                <Play className="h-4 w-4" />
                {listing.seasonsStarted}
              </span>
            )}
            {listing.seatsSold > 0 && (
              <span className="flex items-center gap-1">
                <Users className="h-4 w-4" />
                {listing.seatsSold}
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
