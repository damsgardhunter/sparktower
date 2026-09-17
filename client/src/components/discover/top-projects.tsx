/**
 * The top three, and only the top three.
 *
 * The old leaderboard ranked builders as well as projects, which quietly told
 * people their standing on SparkTower was a number attached to them. Both
 * axes here are project-level and both are things a project earned from the
 * outside — money in, people through the door. There is deliberately no
 * ranking of builders; don't add one back.
 *
 * It borrows the contest page's language on purpose: the same dark panel and
 * gradient say "this is the wall the whole site looks at".
 */
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PrivateBadge } from "@/components/private-badge";
import { ArrowRight, DollarSign, Eye, Trophy } from "lucide-react";
import type { Project } from "@shared/schema";
import type { User } from "@shared/models/auth";

type RankedProject = Project & { owner: User; soloMode?: boolean };
type Metric = "donations" | "views";

const RANK_STYLES: Record<number, string> = {
  1: "border-amber-300/40 bg-amber-300/10 text-amber-200",
  2: "border-white/25 bg-white/10 text-white/80",
  3: "border-orange-400/30 bg-orange-400/10 text-orange-200",
};

export function TopProjects({ metric, onMetric }: { metric: Metric; onMetric: (m: Metric) => void }) {
  const { data, isLoading, isError } = useQuery<RankedProject[]>({
    queryKey: ["/api/leaderboard", metric],
    queryFn: async () => {
      const res = await fetch(`/api/leaderboard?sortBy=${metric}&limit=3&filter=all`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load the leaderboard");
      return res.json();
    },
  });

  const top = (data ?? []).slice(0, 3);

  return (
    <section className="relative overflow-hidden rounded-3xl bg-[#07060d] text-white" data-testid="discover-leaderboard">
      <div aria-hidden className="pointer-events-none absolute -top-32 left-1/4 h-80 w-80 rounded-full bg-emerald-500/25 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 right-0 h-[24rem] w-[24rem] rounded-full bg-purple-600/35 blur-3xl" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      <div className="relative px-5 sm:px-8 py-8 sm:py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/40 bg-amber-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-200">
              <Trophy className="h-3.5 w-3.5" /> Top of the tower
            </span>
            <h2 className="mt-4 text-3xl sm:text-4xl font-bold tracking-tight bg-gradient-to-r from-emerald-300 via-green-200 to-purple-300 bg-clip-text text-transparent">
              {metric === "donations" ? "Most funded" : "Most visited"}
            </h2>
            <p className="mt-2 max-w-xl text-sm text-white/60">
              Two axes, both about the work rather than the person: dollars backers put in,
              and visits the project pulled. Ranked per project — a builder with three
              projects is three entries, never one score.
            </p>
          </div>

          <div className="inline-flex shrink-0 rounded-xl border border-white/15 bg-white/5 p-1" role="tablist" aria-label="Rank by">
            <button
              role="tab"
              aria-selected={metric === "donations"}
              onClick={() => onMetric("donations")}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                metric === "donations" ? "bg-white text-[#07060d]" : "text-white/70 hover:text-white"
              }`}
              data-testid="leaderboard-toggle-funded"
            >
              Most funded
            </button>
            <button
              role="tab"
              aria-selected={metric === "views"}
              onClick={() => onMetric("views")}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                metric === "views" ? "bg-white text-[#07060d]" : "text-white/70 hover:text-white"
              }`}
              data-testid="leaderboard-toggle-visited"
            >
              Most visited
            </button>
          </div>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {isLoading
            ? [1, 2, 3].map((i) => (
                <div key={i} className="rounded-2xl border border-white/10 bg-white/5 p-5" data-testid={`leaderboard-skeleton-${i}`}>
                  <Skeleton className="h-6 w-10 bg-white/10" />
                  <Skeleton className="mt-4 h-5 w-3/4 bg-white/10" />
                  <Skeleton className="mt-2 h-4 w-1/2 bg-white/10" />
                  <Skeleton className="mt-6 h-9 w-full bg-white/10" />
                </div>
              ))
            : isError
              ? <p className="sm:col-span-3 rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-white/70" data-testid="leaderboard-error">
                  The rankings didn't load. They'll be back on the next refresh.
                </p>
              : top.length === 0
                ? <p className="sm:col-span-3 rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-white/70" data-testid="leaderboard-empty">
                    Nothing is ranked yet. The first projects to take a donation or draw visitors land here.
                  </p>
                : top.map((project, i) => <RankCard key={project.id} project={project} rank={i + 1} metric={metric} />)}
        </div>

        {/*
          A ranking where every entry is zero is not a ranking — it's three
          projects in whatever order the database returned. Saying so is better
          than letting a builder read "#1 most funded" as a standing they've
          earned, or as one they're behind.
        */}
        {!isLoading && !isError && top.length > 0 && !top.some((p) => (metric === "donations" ? p.totalDonations : p.views) ?? 0) && (
          <p className="mt-4 text-sm text-white/60" data-testid="leaderboard-all-zero">
            {metric === "donations"
              ? "No project has been backed yet, so this is just the order they're waiting in — the first dollar puts someone first."
              : "No project has been visited yet, so this is just the order they're waiting in."}
          </p>
        )}
      </div>
    </section>
  );
}

function RankCard({ project, rank, metric }: { project: RankedProject; rank: number; metric: Metric }) {
  const value =
    metric === "donations"
      ? `$${((project.totalDonations ?? 0) / 100).toLocaleString()} raised`
      : `${(project.views ?? 0).toLocaleString()} visits`;

  return (
    <div
      className={`relative rounded-2xl border bg-white/[0.04] p-5 transition-colors hover:bg-white/[0.08] ${
        rank === 1 ? "border-amber-300/30" : "border-white/10"
      }`}
      data-testid={`leaderboard-rank-${rank}`}
    >
      <div className="flex items-center justify-between">
        <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full border text-sm font-bold ${RANK_STYLES[rank]}`}>
          {rank}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-xs font-mono text-white/80">
          {metric === "donations" ? <DollarSign className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {value}
        </span>
      </div>

      <div className="mt-4 flex items-center gap-1.5">
        {project.isPrivate && <PrivateBadge variant="icon" className="shrink-0" />}
        <h3 className="font-semibold text-lg leading-tight line-clamp-2">{project.title}</h3>
      </div>
      <p className="mt-1 text-sm text-white/55 truncate">
        by {project.owner?.firstName || project.owner?.email || "a builder"}
      </p>
      {project.soloMode && (
        <Badge variant="outline" className="mt-3 border-emerald-300/30 text-emerald-200 text-[10px]">Solo build</Badge>
      )}

      <Button asChild variant="outline" size="sm" className="mt-5 w-full border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white">
        <Link href={`/projects/${project.id}`} data-testid={`leaderboard-open-${rank}`}>
          View project <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
        </Link>
      </Button>
    </div>
  );
}
