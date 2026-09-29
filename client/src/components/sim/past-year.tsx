/**
 * Last year, looked at squarely.
 *
 * The Past tab could tell you what happened to the company and never what the
 * five of you actually did to cause it: the decisions lived on the desk for a
 * fortnight and then vanished, the bids were deleted the moment they settled,
 * and where everyone stood in the market was four sentences of prose. A team
 * could lose a third of its cash at auction and have nothing to look at
 * afterwards but one line saying so.
 *
 * Two cards. The first is the record — who decided what, what it cost, what
 * was bid and who took it. The second is the map — every company placed by
 * what it charges and what it is worth charging for, which is the argument
 * about where to go next.
 *
 * Both are deliberately blunt. A report that flatters the reader is a report
 * nobody learns from, and the numbers are the team's own.
 */
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Gavel, Map as MapIcon, TrendingDown, TrendingUp } from "lucide-react";
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Cell, LabelList,
} from "recharts";

export interface AuctionRow {
  listingId: string; name: string; kind: string; reserve: number;
  bidders: number; winner: string | null; winnerId: string | null;
  price: number | null; yourBid?: number | null;
}

export interface Standing {
  id: string; name: string; kind: string; isYou: boolean;
  price: number; quality: number; service: number; brand: number;
  customers: number; positioning: string | null;
  grade: string | null; creditScore: number | null;
}

export interface Seat {
  userId: string; name: string; role: string | null; title: string | null; isYou: boolean;
}

const money = (n: number) =>
  n >= 1_000_000 ? `£${(n / 1_000_000).toFixed(1)}m` : n >= 1_000 ? `£${Math.round(n / 1_000)}k` : `£${Math.round(n)}`;

const count = (n: number) => Math.round(n).toLocaleString();

/**
 * What one seat committed, in the fewest words that are still true.
 *
 * Every lever a seat has, read off the payload it filed — not a curated
 * subset, because the point of the card is that nothing quietly goes
 * unrecorded. Money reads as money, a share as a share, and a map (a budget
 * split, a regional focus) as the split it was.
 */
export function readDecision(payload: Record<string, any> | undefined): { label: string; value: string }[] {
  if (!payload) return [];
  const out: { label: string; value: string }[] = [];
  const say = (key: string, value: any): string => {
    if (value === null || value === undefined || value === "") return "—";
    if (Array.isArray(value)) return value.length ? value.join(", ") : "none";
    if (typeof value === "object") {
      const parts = Object.entries(value).filter(([, v]) => v !== "" && v !== null);
      return parts.length ? parts.map(([k, v]) => `${k} ${v}`).join(" · ") : "none";
    }
    if (typeof value === "number") {
      if (/Spend|Pool|Bid|borrow|repay|raiseAmount|buffer|refinance|buyback/i.test(key)) return money(value);
      if (/Pct|Discount|holdBack|costReview|automation|engineerPay/i.test(key)) return `${value}%`;
      return count(value);
    }
    return String(value);
  };
  for (const [key, value] of Object.entries(payload)) {
    if (key === "companyId") continue;
    out.push({ label: key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()), value: say(key, value) });
  }
  return out;
}

/** Card one: the record of what the five of you did, and what it bought. */
export function WhatTheTableDecided({ year, seats, filed, auctions, standing, onOpen }: {
  year: number;
  seats: Seat[];
  filed: Record<string, any> | null;
  auctions: AuctionRow[];
  standing: Standing[];
  onOpen?: () => void;
}) {
  const players = standing.filter((s) => s.kind === "player" && s.grade);
  const you = players.find((s) => s.isYou);
  const ranked = [...players].sort((a, b) => (b.creditScore ?? 0) - (a.creditScore ?? 0));
  const yourPlace = you ? ranked.findIndex((s) => s.id === you.id) + 1 : 0;

  return (
    <Card className="rounded-2xl nova-ring-soft" data-testid="card-what-we-decided">
      <CardContent className="p-5">
        <div className="flex items-center gap-2">
          <Gavel className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold">What the table decided in year {year}</h3>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Every lever, as it was filed. The year you are about to decide is judged against this one.
        </p>

        {/* Who committed what. */}
        <div className="mt-4 space-y-3">
          {seats.filter((s) => s.role).map((seat) => {
            const lines = readDecision(filed?.[seat.role as string]);
            return (
              <div key={seat.userId} className="rounded-lg border p-3" data-testid={`row-decided-${seat.role}`}>
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <p className="text-sm font-medium">
                    {seat.name}
                    {seat.isYou && <span className="text-muted-foreground font-normal"> — you</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">{seat.title}</p>
                </div>
                {lines.length === 0 ? (
                  <p className="text-xs text-destructive mt-1.5">Filed nothing. The caretaker ran the seat.</p>
                ) : (
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                    {lines.map((line) => (
                      <p key={line.label} className="text-[11px] text-muted-foreground">
                        {line.label} <span className="tabular-nums font-medium text-foreground">{line.value}</span>
                      </p>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* The auction, which used to leave no trace at all. */}
        {auctions.length > 0 && (
          <div className="mt-5">
            <p className="text-sm font-medium">At auction</p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs" data-testid="table-auctions">
                <thead>
                  <tr className="text-muted-foreground text-left">
                    <th className="font-normal py-1 pr-3">Lot</th>
                    <th className="font-normal py-1 pr-3 text-right">Reserve</th>
                    <th className="font-normal py-1 pr-3 text-right">You bid</th>
                    <th className="font-normal py-1 pr-3 text-right">Bidders</th>
                    <th className="font-normal py-1">Taken by</th>
                  </tr>
                </thead>
                <tbody>
                  {auctions.map((row) => {
                    const won = row.winnerId && auctions.length > 0 && row.yourBid != null && row.price != null && row.winner && row.yourBid === row.price;
                    return (
                      <tr key={row.listingId} className="border-t" data-testid={`row-auction-${row.listingId}`}>
                        <td className="py-1.5 pr-3">
                          {row.name}
                          <span className="text-muted-foreground"> · {row.kind.replace(/_/g, " ")}</span>
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{money(row.reserve)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">
                          {row.yourBid != null ? money(row.yourBid) : <span className="text-muted-foreground">nothing</span>}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{row.bidders}</td>
                        <td className="py-1.5">
                          {row.winner
                            ? <>{row.winner} <span className="text-muted-foreground tabular-nums">{money(row.price ?? 0)}</span></>
                            : <span className="text-muted-foreground">nobody met the reserve</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* What the lenders make of everyone. */}
        {players.length > 0 && you && (
          <div className="mt-5">
            <p className="text-sm font-medium">What the banks think</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {yourPlace === 1
                ? "The best-rated company in the market. Borrowing is cheaper for you than for anyone here."
                : `${yourPlace} of ${ranked.length} on the rating. Everyone above you borrows more cheaply than you do.`}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ranked.map((s) => (
                <Badge
                  key={s.id}
                  variant={s.isYou ? "default" : "outline"}
                  className="text-[10px]"
                  data-testid={`badge-grade-${s.id}`}
                >
                  {s.name} {s.grade}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {onOpen && (
          <button
            type="button"
            onClick={onOpen}
            className="mt-4 text-xs text-primary hover:underline"
            data-testid="button-open-full-report"
          >
            The full accounts for year {year}
          </button>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Card two: where everybody is standing.
 *
 * Price across, quality up, and the size of the dot is how many customers the
 * company holds — so a big cheap dot low down is somebody winning on price,
 * and an empty quarter of the chart is a position nobody has taken.
 */
export function WhereTheMarketSits({ standing, segments, cities, voice }: {
  standing: Standing[];
  segments: { id: string; name: string; referencePrice: number; yours: number }[];
  cities: { id: string; name: string; weight: number; open: boolean; note: string }[];
  voice: Record<string, string>;
}) {
  const points = standing.map((s) => ({
    x: s.price,
    y: s.quality,
    z: Math.max(1, s.customers),
    name: s.name,
    isYou: s.isYou,
    kind: s.kind,
  }));

  const shut = [...cities].filter((c) => !c.open).sort((a, b) => b.weight - a.weight).slice(0, 3);
  const open = cities.filter((c) => c.open);

  return (
    <Card className="rounded-2xl nova-ring-soft" data-testid="card-where-market-sits">
      <CardContent className="p-5">
        <div className="flex items-center gap-2">
          <MapIcon className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold">Where everybody is standing</h3>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          What each company charges, against {voice.quality ?? "how good it is"}. The bigger the dot, the more{" "}
          {voice.customers ?? "customers"} it holds. An empty corner is a position nobody has taken.
        </p>

        <div className="mt-3 h-64 w-full" data-testid="chart-positioning">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 10, right: 16, bottom: 24, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
              <XAxis
                type="number" dataKey="x" name="price" tick={{ fontSize: 11 }}
                label={{ value: "Price", position: "insideBottom", offset: -14, fontSize: 11 }}
              />
              <YAxis
                type="number" dataKey="y" name="quality" domain={[0, 100]} tick={{ fontSize: 11 }}
                label={{ value: "Quality", angle: -90, position: "insideLeft", fontSize: 11 }}
              />
              <ZAxis type="number" dataKey="z" range={[60, 900]} />
              <Scatter data={points}>
                {points.map((p, i) => (
                  <Cell
                    key={i}
                    fill={p.isYou ? "hsl(var(--primary))" : p.kind === "player" ? "hsl(var(--muted-foreground))" : "hsl(var(--muted-foreground) / 0.35)"}
                  />
                ))}
                <LabelList dataKey="name" position="top" style={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>

        {/* Who is worth charging what, and where there is room. */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-sm font-medium">What each kind of customer expects to pay</p>
            <div className="mt-1.5 space-y-1">
              {segments.map((seg) => (
                <p key={seg.id} className="text-[11px] text-muted-foreground" data-testid={`text-segment-price-${seg.id}`}>
                  {seg.name} <span className="tabular-nums font-medium text-foreground">£{seg.referencePrice}</span>
                  {seg.yours > 0 && <span> · you hold {count(seg.yours)}</span>}
                </p>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm font-medium">Room on the map</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              You sell in {open.length === 0 ? "nowhere yet" : open.map((c) => c.name).join(", ")}.
            </p>
            <div className="mt-1.5 space-y-1">
              {shut.map((c) => (
                <p key={c.id} className="text-[11px] text-muted-foreground" data-testid={`text-region-open-${c.id}`}>
                  <span className="font-medium text-foreground">{c.name}</span> — {Math.round(c.weight * 100)}% of{" "}
                  {voice.market ?? "the market"}. {c.note}
                </p>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Which way a number went, for the small arrows on either card. */
export const Arrow = ({ up }: { up: boolean }) =>
  up ? <TrendingUp className="h-3 w-3 text-emerald-600" /> : <TrendingDown className="h-3 w-3 text-destructive" />;
