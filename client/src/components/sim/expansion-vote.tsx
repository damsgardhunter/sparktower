/**
 * The table on the announced region.
 *
 * Opening a region is the decision that commits the company for years — the
 * entry cost now, the rent for ever, and a first year reaching almost nobody —
 * so it stopped being the operations seat's to take alone. Operations puts it
 * up, everybody votes, and a majority of the votes cast carries it.
 *
 * Which makes this card the only place in the game where you can see what
 * your four colleagues actually think before the year runs. So it shows
 * faces, not a tally: a row of people with their answer under them, the ones
 * who have not answered greyed out. The argument this starts is the point.
 *
 * The count comes from the server, which counts it the same way the engine
 * does. This screen does not recount it.
 */
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Check, X, MapPin } from "lucide-react";

export interface ExpansionVoteData {
  region: { id: string; name: string; note: string };
  cost: number;
  /** Whether operations has actually put it up. Nobody's vote counts until it has. */
  proposed: boolean;
  votes: Record<string, "yes" | "no">;
  carried: boolean;
  yes: number;
  no: number;
}

export interface VotingSeat {
  userId: string;
  name: string;
  role: string | null;
  title: string | null;
  isYou: boolean;
  avatarUrl?: string | null;
}

const initials = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

export function ExpansionVote({ data, seats }: { data: ExpansionVoteData; seats: VotingSeat[] }) {
  const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  /*
   * Operations first, because operations is the one who put it up and its
   * proposal is its vote. After that, the order the table is in.
   */
  const ordered = [...seats.filter((s) => s.role)].sort((a, b) =>
    (a.role === "coo" ? 0 : 1) - (b.role === "coo" ? 0 : 1));

  return (
    <Card className="rounded-2xl" data-testid="card-expansion-vote">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
              <h2 className="font-semibold truncate">{data.region.name}</h2>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{data.region.note}</p>
          </div>
          <Badge
            variant={data.carried ? "default" : "secondary"}
            className="shrink-0"
            data-testid="badge-expansion-outcome"
          >
            {!data.proposed ? "Not put up" : data.carried ? "Carried" : "Not carried"}
          </Badge>
        </div>

        <p className="text-sm text-muted-foreground mt-3">
          {data.proposed ? (
            <>
              Operations has put it to the table at {money(data.cost)} now, opening next year.{" "}
              {data.yes} for and {data.no} against so far —{" "}
              {data.carried
                ? "as it stands, it opens."
                : "as it stands, it stays shut. A tie or silence leaves the region closed."}
            </>
          ) : (
            <>
              Announced for next year at {money(data.cost)}. Operations has not put it up, so nothing is
              being decided and no vote counts yet.
            </>
          )}
        </p>

        <div className="flex flex-wrap gap-4 mt-4">
          {ordered.map((s) => {
            const vote = data.proposed ? data.votes[s.role!] : undefined;
            return (
              <div
                key={s.userId}
                className="flex flex-col items-center gap-1 w-16"
                data-testid={`expansion-voter-${s.role}`}
              >
                <div className="relative">
                  <Avatar className={`h-10 w-10 ${vote ? "" : "opacity-40"}`}>
                    {s.avatarUrl ? <AvatarImage src={s.avatarUrl} alt="" /> : null}
                    <AvatarFallback className="text-xs">{initials(s.name)}</AvatarFallback>
                  </Avatar>
                  {vote && (
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 rounded-full p-0.5 ring-2 ring-background ${
                        vote === "yes" ? "bg-emerald-600 text-white" : "bg-destructive text-white"
                      }`}
                      data-testid={`expansion-vote-${s.role}-${vote}`}
                    >
                      {vote === "yes" ? <Check className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />}
                    </span>
                  )}
                </div>
                <p className="text-[11px] font-medium text-center leading-tight truncate w-full">
                  {s.isYou ? "You" : s.name.split(/\s+/)[0]}
                </p>
                <p className="text-[10px] text-muted-foreground text-center leading-tight">
                  {!data.proposed ? "—" : vote === "yes" ? "For" : vote === "no" ? "Against" : "Not voted"}
                </p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
