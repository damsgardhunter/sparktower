import { Link, useRoute } from "wouter";
import { ArrowLeft, Clock, Crown, Lock, Sparkles } from "lucide-react";
import { FEATURED_CONTEST as C } from "@/lib/featured-contest";
import { Button } from "@/components/ui/button";

/**
 * A contest's own page. Only the $50 Billion Challenge exists, and it's an
 * announcement: what it is, how it works, the basic rules — and no way to
 * enter. Entry opens once the official terms are written.
 */
export default function ContestDetail() {
  const [, params] = useRoute("/contests/:slug");
  if (params?.slug !== C.slug) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-muted-foreground">That contest doesn't exist.</p>
        <Button asChild variant="outline"><Link href="/contests">Back to contests</Link></Button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* Hero */}
      <section className="relative overflow-hidden bg-[#07060d] text-white">
        <div aria-hidden className="pointer-events-none absolute -top-32 left-1/4 h-96 w-96 rounded-full bg-emerald-500/25 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-40 right-0 h-[28rem] w-[28rem] rounded-full bg-purple-600/35 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.06]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)", backgroundSize: "48px 48px" }} />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 pt-6 pb-16 sm:pb-24">
          <Link href="/contests" className="inline-flex items-center gap-1.5 text-sm text-white/60 hover:text-white" data-testid="link-back-contests">
            <ArrowLeft className="h-4 w-4" /> Contests and Communities
          </Link>
          <div className="mt-12 sm:mt-16 flex flex-col items-center text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/40 bg-amber-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-200">
              <Crown className="h-3.5 w-3.5" /> The SparkTower grand prize
            </span>
            <h1 className="mt-6 text-sm font-medium uppercase tracking-[0.3em] text-white/60" data-testid="text-contest-name">{C.name}</h1>
            <p className="mt-3 font-bold tracking-tight leading-none text-[2.5rem] sm:text-7xl md:text-8xl bg-gradient-to-r from-emerald-300 via-green-200 to-purple-300 bg-clip-text text-transparent">{C.amount}</p>
            <p className="mt-8 max-w-2xl text-2xl sm:text-3xl font-semibold leading-tight">{C.headline}</p>
            <p className="mt-3 max-w-2xl text-lg sm:text-xl text-white/75"><Sparkles className="inline h-5 w-5 -mt-1 mr-1 text-amber-300" />{C.prize}</p>
            <div className="mt-10 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm text-white/80" data-testid="contest-status">
              <Clock className="h-4 w-4 text-emerald-300" /> {C.status} — official terms are on the way
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 space-y-12">
        {/* About */}
        <section data-testid="contest-about">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">The challenge</h2>
          <div className="mt-4 space-y-4 text-lg leading-relaxed">
            {C.about.map((p, i) => <p key={i}>{p}</p>)}
          </div>
        </section>

        {/* How it works */}
        <section className="border-t border-border pt-10">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">How it works</h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-3">
            {C.steps.map((s, i) => (
              <li key={s.title} className="rounded-2xl border border-border bg-card p-5">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-green-400 via-emerald-500 to-purple-500 text-sm font-bold text-white">{i + 1}</span>
                <h3 className="mt-4 font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Rules */}
        <section className="border-t border-border pt-10" data-testid="contest-rules">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Basic rules</h2>
          <ol className="mt-6 divide-y divide-border rounded-2xl border border-border bg-card">
            {C.rules.map((r, i) => (
              <li key={r.title} className="flex gap-4 p-5">
                <span className="mt-0.5 shrink-0 text-sm font-semibold tabular-nums text-primary">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3 className="font-semibold">{r.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{r.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Not open — no way to enter, on purpose. */}
        <section className="rounded-2xl border border-border bg-muted/40 p-6 flex flex-col sm:flex-row sm:items-center gap-4" data-testid="contest-not-open">
          <div className="h-11 w-11 shrink-0 rounded-full bg-background border border-border flex items-center justify-center">
            <Lock className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <h2 className="font-semibold">Entries aren't open yet</h2>
            <p className="text-sm text-muted-foreground mt-0.5">The full terms and rules are being drafted. Keep building — this is where the challenge will open.</p>
          </div>
        </section>

        <p className="text-xs text-muted-foreground leading-relaxed" data-testid="contest-fineprint">{C.fineprint}</p>
      </div>
    </div>
  );
}
