import { Link } from "wouter";
import { ArrowRight, Crown, Sparkles } from "lucide-react";
import { FEATURED_CONTEST as C } from "@/lib/featured-contest";

/** The main contest, taking up the contests section. The whole card opens its page. */
export function FeaturedContestCard() {
  return (
    <Link href={`/contests/${C.slug}`} data-testid="card-featured-contest" className="group block focus:outline-none">
      <div className="relative overflow-hidden rounded-3xl p-[1.5px] bg-gradient-to-br from-green-400 via-emerald-500 to-purple-500 shadow-xl shadow-emerald-500/10 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:shadow-2xl group-hover:shadow-purple-500/20 group-focus-visible:ring-4 group-focus-visible:ring-primary/30">
        <div className="relative overflow-hidden rounded-[22px] bg-[#07060d] text-white px-6 py-10 sm:px-10 sm:py-14">
          {/* Light, grid and glow behind the number. */}
          <div aria-hidden className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-emerald-500/30 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-32 -right-20 h-80 w-80 rounded-full bg-purple-600/40 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)", backgroundSize: "44px 44px" }} />
          <div aria-hidden className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/10 to-transparent skew-x-[-20deg] animate-[featured-shine_6s_ease-in-out_infinite]" />

          <div className="relative flex flex-col items-center text-center">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/40 bg-amber-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-200">
                <Crown className="h-3.5 w-3.5" /> Grand prize
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-white/70">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> {C.status}
              </span>
            </div>

            <p className="mt-8 text-sm font-medium uppercase tracking-[0.3em] text-white/60">{C.name}</p>
            <h3 className="mt-3 font-bold tracking-tight leading-none text-[2.6rem] sm:text-6xl md:text-7xl bg-gradient-to-r from-emerald-300 via-green-200 to-purple-300 bg-clip-text text-transparent" data-testid="text-featured-amount">
              {C.amount}
            </h3>
            <p className="mt-6 max-w-xl text-xl sm:text-2xl font-semibold leading-snug">{C.headline}</p>
            <p className="mt-2 max-w-xl text-base sm:text-lg text-white/70">
              <Sparkles className="inline h-4 w-4 -mt-1 mr-1 text-amber-300" />{C.prize}
            </p>

            <span className="mt-9 inline-flex items-center gap-2 rounded-full bg-white text-[#07060d] px-6 py-3 text-sm font-semibold transition-all group-hover:gap-3 group-hover:bg-emerald-50">
              See the challenge <ArrowRight className="h-4 w-4" />
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
