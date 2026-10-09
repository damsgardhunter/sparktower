/**
 * The page at the end of a link you send somebody.
 *
 * ## What it is for
 *
 * Somebody who is thinking about starting a business, or has just started one,
 * gets a link. They are not a user of this product, they have not asked to
 * join anything, and their patience is measured in seconds. What they should
 * meet is the simulation of their own business, running, at year one.
 *
 * So the whole journey is on this one screen: what the market is, who is
 * already in it, and a button. Signing in happens here, inline, rather than by
 * sending them to an auth page and hoping they find their way back — that
 * round trip was the friction, not the password field. Everything the server
 * needs is behind `POST /api/sim-market/listings/:id/try`, which seats them in
 * a table of one with the lobby already resolved and the first year started,
 * and hands back the path to the desk.
 *
 * ## What it deliberately does not do
 *
 * No onboarding. `shared/onboarding.ts` already exempts playing a simulation —
 * its own comment says playing "carries no claim about who you are" — and no
 * email confirmation either, because `requireVerifiedEmail` only covers the
 * routes that reach other people. So nothing here asks for a display name,
 * skills, hours a week or a confirmed address. They came to play a market.
 *
 * ## Two ways in, one page
 *
 * `/try/:id` is a listing on the marketplace: public, and anybody may play it.
 * `/s/:token` is a link the author minted and sent to somebody — the listing
 * behind it is usually not public at all, because a market written around one
 * real business should not be on sale to that business's competitors.
 *
 * They differ in two lines: where the facts are read from, and where the press
 * goes. Everything else — what the page says, the inline sign-up, the single
 * button — is the same thing for the same person, so it is the same page rather
 * than a copy of it that drifts.
 */
import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Play, CalendarClock, Users, ShieldCheck } from "lucide-react";

interface TryListing {
  listing: {
    id: string;
    title: string;
    summary: string | null;
    description: string | null;
    pricing: "free" | "perSeat";
    seatPriceCents: number;
    cadence: "yearly" | "quarterly" | "monthly";
    totalYears: number;
    botSkill: "filler" | "survivor";
    author: { id: string; name: string | null };
  };
  youOwn: { seats: number };
  isAuthor: boolean;
  /** Only on a shared link: how much of it is left, and why not if none. */
  share?: { usesLeft: number; expiresAt: string | null; state: "open" | "revoked" | "expired" | "spent" };
}

/** What to say to somebody holding a link that has stopped working. */
const SHARE_GONE: Record<string, { title: string; detail: string }> = {
  revoked: {
    title: "This link has been taken back",
    detail: "Whoever sent it has withdrawn it. Ask them for another and it'll work straight away.",
  },
  expired: {
    title: "This link has expired",
    detail: "Links can be set to run out. Ask whoever sent it for a fresh one.",
  },
  spent: {
    title: "This link has already been used",
    detail: "Each link works a set number of times. Ask whoever sent it for another.",
  },
};

const PERIOD_WORD: Record<string, string> = { yearly: "a year", quarterly: "a quarter", monthly: "a month" };

export default function TrySimulationPage() {
  /*
   * One of the two is set, never both: `/try/:id` has an id and `/s/:token` a
   * token. `token` decides every branch below, so it is read once here.
   */
  const { id, token } = useParams<{ id?: string; token?: string }>();
  const [, navigate] = useLocation();
  const { user, isLoading: authLoading } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  /* Signing in rather than signing up, for somebody who already has an account. */
  const [returning, setReturning] = useState(false);

  /*
   * The public read while signed out, the full one once signed in.
   *
   * `GET /api/sim-market/listings/:id` requires a session — correct, it tells
   * you what you own — and a stranger following a link has none. The preview
   * carries the same public facts and nothing about anybody's purchases, so
   * the page can be rendered before there is an account to ask about.
   */
  const { data, isLoading } = useQuery<TryListing>({
    queryKey: [token
      ? `/api/sim-market/shares/${token}`
      : user ? `/api/sim-market/listings/${id}` : `/api/sim-market/listings/${id}/preview`],
    /*
     * A share link that is spent, revoked or expired answers 410 *with the
     * listing still in it*, which is the whole reason it is a 410 and not a
     * 404: the page can say "this was yours and is finished" rather than "no
     * such thing". The default query function throws on any non-2xx, which
     * would throw that away, so the share read is done here.
     */
    queryFn: token
      ? async () => {
        const res = await fetch(`/api/sim-market/shares/${token}`, { credentials: "include" });
        if (!res.ok && res.status !== 410) throw new Error(String(res.status));
        return res.json();
      }
      : undefined,
  });

  /*
   * Start it, then go. One mutation for both the signed-in and just-signed-up
   * cases, because by the time it runs the difference has stopped mattering.
   */
  const start = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        token ? `/api/sim-market/shares/${token}/try` : `/api/sim-market/listings/${id}/try`,
        {},
      );
      return res.json();
    },
    onSuccess: (body: { deskPath?: string; ventureId?: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sim-market/me"] });
      navigate(body.deskPath ?? (body.ventureId ? `/simulation/${body.ventureId}` : "/simulations/market"));
    },
    onError: (e: any) => setAuthError(errorText(e)),
  });

  /*
   * Account and season in one press.
   *
   * Registering and then immediately starting, rather than returning them to a
   * "you're signed up!" screen with a second button on it. If the account
   * already exists we sign in instead of failing — a link forwarded twice is
   * the ordinary case, not an error.
   */
  const enter = useMutation({
    mutationFn: async () => {
      setAuthError(null);
      const path = returning ? "/api/auth/login" : "/api/auth/register";
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        /*
         * An address that already exists is not a dead end: offer the sign-in
         * they actually need, with the email they already typed kept.
         */
        if (!returning && (body?.code === "email_taken" || res.status === 409)) {
          setReturning(true);
          throw new Error("You already have an account with that address — enter your password to sign in.");
        }
        throw new Error(body?.message ?? "Couldn't get you in. Check the address and try again.");
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      return start.mutateAsync();
    },
    onError: (e: any) => setAuthError(e?.message ?? "Couldn't get you in."),
  });

  if (isLoading || authLoading) {
    return <div className="mx-auto max-w-2xl px-4 py-12"><Skeleton className="h-72 rounded-2xl" /></div>;
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <p className="font-medium">That simulation isn't here any more</p>
        <p className="mt-2 text-sm text-secondary">The link may have expired, or whoever sent it has taken it down.</p>
      </div>
    );
  }

  const { listing, youOwn, isAuthor, share } = data;

  /*
   * A link that has stopped working, said plainly and with what to do about it.
   * It still names the simulation, because "the thing Dana sent me" is how the
   * person thinks about it and the title is what lets them ask for another.
   */
  if (share && share.state !== "open") {
    const said = SHARE_GONE[share.state] ?? SHARE_GONE.spent;
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:py-24">
        <Card className="nova-ring">
          <CardContent className="p-6 text-center sm:p-10">
            <h1 className="text-xl font-semibold tracking-tight" data-testid="text-share-gone">{said.title}</h1>
            <p className="mt-3 text-sm text-secondary">{said.detail}</p>
            <p className="mt-6 text-sm text-tertiary">
              It was for <span className="font-medium text-secondary">{listing.title}</span>
              {listing.author.name ? <>, a market written by {listing.author.name}</> : null}.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const free = listing.pricing === "free";
  /*
   * Whether pressing the button will work, which decides what the button says.
   *
   * A share link needs no seat and costs nothing however the listing is priced:
   * minting one is the author giving this away, and the server charges nothing
   * for it. So a per-seat listing reached through a link is playable, which is
   * the point of having sent it.
   */
  const canPlay = !!share || isAuthor || free || youOwn.seats > 0;
  const busy = start.isPending || enter.isPending;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:py-16">
      <Card className="nova-ring overflow-hidden">
        <CardContent className="p-6 sm:p-8">
          <div className="flex flex-wrap items-center gap-2">
            {/*
              * On a shared link the seat price is not what this person pays —
              * they pay nothing — so quoting it would be a worse than useless
              * number. What matters is that it was sent to them.
              */}
            <Badge variant="default">
              {share ? "Sent to you" : free ? "Free to play" : `$${(listing.seatPriceCents / 100).toFixed(2)} a seat`}
            </Badge>
            {listing.botSkill === "survivor" && <Badge variant="outline">Rivals play to win</Badge>}
          </div>

          <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">{listing.title}</h1>
          {listing.author.name && (
            <p className="mt-1 text-sm text-tertiary">
              {share
                ? `${listing.author.name} built this market for you`
                : `A market written by ${listing.author.name}`}
            </p>
          )}
          {listing.summary && <p className="mt-4 text-secondary">{listing.summary}</p>}

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="flex items-start gap-2">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-medium">{listing.totalYears} years, {PERIOD_WORD[listing.cadence]} at a time</p>
                <p className="text-xs text-tertiary">You decide, the market answers, and the next one opens.</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Users className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-medium">You run it on your own</p>
                <p className="text-xs text-tertiary">Every desk is yours, against four rival companies.</p>
              </div>
            </div>
          </div>

          {listing.description && (
            <p className="mt-6 whitespace-pre-line text-sm text-secondary">{listing.description}</p>
          )}

          <div className="mt-8">
            {user ? (
              <>
                <Button
                  size="lg"
                  className="w-full"
                  disabled={busy || !canPlay}
                  onClick={() => start.mutate()}
                  data-testid="button-try-start"
                >
                  {start.isPending
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening year one</>
                    : <><Play className="mr-2 h-4 w-4" /> Start year one</>}
                </Button>
                {!canPlay && (
                  <p className="mt-3 text-center text-sm text-secondary" data-testid="text-try-needs-seat">
                    This one is sold by the seat and you don't have one yet.{" "}
                    <button className="underline" onClick={() => navigate(`/simulations/market/${listing.id}`)}>
                      Get a seat
                    </button>
                  </p>
                )}
              </>
            ) : (
              /*
               * Two fields and one button. No display name, no confirmation
               * step, nothing about hours a week — none of it is needed to
               * play, and every one of them is somewhere to give up.
               */
              <form
                className="space-y-3"
                onSubmit={(e) => { e.preventDefault(); enter.mutate(); }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="try-email">Your email</Label>
                  <Input
                    id="try-email" type="email" autoComplete="email" required
                    value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    data-testid="input-try-email"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="try-password">{returning ? "Your password" : "Pick a password"}</Label>
                  <Input
                    id="try-password" type="password" required minLength={8}
                    autoComplete={returning ? "current-password" : "new-password"}
                    value={password} onChange={(e) => setPassword(e.target.value)}
                    data-testid="input-try-password"
                  />
                </div>
                {authError && (
                  <p className="text-sm text-destructive" data-testid="text-try-error">{authError}</p>
                )}
                <Button size="lg" type="submit" className="w-full" disabled={busy} data-testid="button-try-enter">
                  {busy
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening year one</>
                    : <><Play className="mr-2 h-4 w-4" /> {returning ? "Sign in and play" : "Start year one"}</>}
                </Button>
                <p className="text-center text-xs text-tertiary">
                  {returning ? (
                    <>New here?{" "}
                      <button type="button" className="underline" onClick={() => { setReturning(false); setAuthError(null); }}>
                        Make an account instead
                      </button>
                    </>
                  ) : (
                    <>Already have an account?{" "}
                      <button type="button" className="underline" onClick={() => { setReturning(true); setAuthError(null); }}>
                        Sign in
                      </button>
                    </>
                  )}
                </p>
              </form>
            )}
          </div>

          <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-tertiary">
            <ShieldCheck className="h-3.5 w-3.5" />
            Nothing is published and nobody is told you played. It's yours.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
