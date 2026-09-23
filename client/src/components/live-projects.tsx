/**
 * What is being built right now, on the landing page, to a visitor with no
 * account.
 *
 * The strongest thing a builder's platform can show a stranger is somebody
 * else building. So the newest project sits in front, with the person's name on
 * it, and the ones before it fan out behind — and it refreshes on a timer, so a
 * page left open watches the list move.
 *
 * When nothing has been started lately the panel does not go blank or pretend:
 * it turns into ideas instead, and says which it is showing.
 *
 * Everything here comes from `GET /api/projects`, which is already public and
 * already excludes private projects for a signed-out caller
 * (`includePrivateOwnedBy`, server/routes.ts). Nothing new is exposed by this
 * component — it shows what the explore page already showed.
 */
import { useEffect, useState } from "react";
import { LiveDot } from "@/components/nova";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, Clock, ArrowUpRight } from "lucide-react";
import { NOVA_GRADIENT, NOVA_GRADIENT_CSS } from "@shared/backing";
import { PROJECT_GOALS } from "@shared/goals";
import { STARTER_IDEAS } from "@shared/starter-ideas";

/** How often the list is asked for again. Slow enough to be free, quick enough to feel alive. */
const REFRESH_MS = 20_000;

/**
 * How recent "right now" is.
 *
 * A day rather than an hour: a builder's platform that says "nothing is being
 * built" because the last project was at breakfast is telling a lie about
 * itself. Past this, the panel shows ideas instead — which is the honest thing
 * to show a stranger on a quiet day, and a better prompt than an empty shelf.
 */
const RECENT_MS = 24 * 60 * 60 * 1000;

interface PublicProject {
  id: string;
  title: string;
  oneLiner?: string | null;
  description?: string | null;
  goal?: string | null;
  createdAt?: string | null;
  owner?: { firstName?: string | null; lastName?: string | null; profileImageUrl?: string | null } | null;
}

const goalLabel = (goal?: string | null) => PROJECT_GOALS.find((g) => g.id === goal)?.short ?? "Building";

/** "just now", "12m", "3h" — short, because it sits in a chip. */
function ago(iso?: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

const firstName = (p: PublicProject) => p.owner?.firstName?.trim() || "A builder";
const initials = (p: PublicProject) =>
  `${p.owner?.firstName?.[0] ?? ""}${p.owner?.lastName?.[0] ?? ""}`.toUpperCase() || "·";

export function LiveProjects() {
  const { data } = useQuery<PublicProject[]>({
    queryKey: ["/api/projects"],
    refetchInterval: REFRESH_MS,
    staleTime: REFRESH_MS,
  });

  const newest = [...(data ?? [])]
    .filter((p) => p.createdAt)
    .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());

  const live = newest.filter((p) => Date.now() - new Date(p.createdAt!).getTime() < RECENT_MS);
  const [lead, ...behind] = live;

  return (
    <section className="relative scroll-mt-40 py-20 px-4 bg-white border-t border-gray-100 overflow-hidden" data-testid="section-live-projects">
      <div aria-hidden className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-0 w-[60rem] h-64 opacity-[0.10] blur-3xl" style={{ backgroundImage: NOVA_GRADIENT_CSS }} />

      <div className="relative z-10 max-w-5xl mx-auto">
        <div className="flex items-center justify-center gap-2 mb-2">
          <LiveDot size="md" aria-hidden />
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-gray-500">
            {lead ? "Being built right now" : "Ideas worth stealing"}
          </span>
        </div>

        <h2 className="text-center text-2xl sm:text-3xl font-bold tracking-tight text-black mb-10">
          {lead ? "The newest project on SparkTower" : "Nobody has started one today — so start one"}
        </h2>

        {lead ? <LeadProject lead={lead} behind={behind.slice(0, 3)} /> : <IdeaCarousel />}
      </div>
    </section>
  );
}

/** The newest project, in front; the ones before it fanned out behind. */
function LeadProject({ lead, behind }: { lead: PublicProject; behind: PublicProject[] }) {
  return (
    <div className="relative max-w-2xl mx-auto" data-testid="live-project-lead">
      {/*
        * The stack behind: each one further back, smaller and paler, so the
        * newest reads as being in front rather than merely first in a list.
        * Inert on purpose — they are depth, not a menu.
        */}
      {behind.map((p, i) => (
        <div
          key={p.id}
          aria-hidden
          className="absolute inset-x-0 mx-auto rounded-2xl bg-white ring-1 ring-gray-100 shadow-lg"
          style={{
            top: `${(i + 1) * 14}px`,
            width: `${100 - (i + 1) * 5}%`,
            height: "100%",
            opacity: 0.55 - i * 0.15,
            zIndex: -1 - i,
          }}
        />
      ))}

      <div className="relative rounded-2xl p-[2px] shadow-[0_24px_50px_-18px_rgba(0,0,0,0.35)]" style={{ backgroundImage: NOVA_GRADIENT_CSS }}>
        <div className="rounded-[0.95rem] bg-white p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <div className="h-11 w-11 shrink-0 rounded-full grid place-items-center text-white text-sm font-bold" style={{ backgroundImage: NOVA_GRADIENT_CSS }}>
              {lead.owner?.profileImageUrl
                ? <img src={lead.owner.profileImageUrl} alt="" className="h-11 w-11 rounded-full object-cover" />
                : initials(lead)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="font-semibold text-black" data-testid="text-live-owner">{firstName(lead)}</span>
                <span className="text-gray-500">started a project</span>
                <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
                  <Clock className="h-3 w-3" /> {ago(lead.createdAt)}
                </span>
              </div>
              <h3 className="mt-1 text-lg sm:text-xl font-bold text-black truncate" data-testid="text-live-title">{lead.title}</h3>
              {(lead.oneLiner || lead.description) && (
                <p className="mt-1 text-sm text-gray-600 line-clamp-2">{lead.oneLiner || lead.description}</p>
              )}
              <span className="mt-3 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundImage: NOVA_GRADIENT_CSS }}>
                {goalLabel(lead.goal)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {behind.length > 0 && (
        <p className="mt-6 text-center text-xs text-gray-400" data-testid="text-live-count">
          and {behind.length} more started in the last day
        </p>
      )}
    </div>
  );
}

/**
 * The quiet-day panel: one idea at a time, on a rotation.
 *
 * These are a written list shipped with the page (shared/starter-ideas.ts), not
 * generated for each visitor — a model call on a public page with no account
 * behind it is somebody else's bill and an open door. They rotate so the panel
 * is never the same twice in a row, and the button next to them does the only
 * thing that matters, which is start.
 */
function IdeaCarousel() {
  const [i, setI] = useState(() => Math.floor(Math.random() * STARTER_IDEAS.length));

  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % STARTER_IDEAS.length), 4000);
    return () => clearInterval(t);
  }, []);

  const idea = STARTER_IDEAS[i];

  return (
    <div className="max-w-2xl mx-auto" data-testid="live-idea-carousel">
      <div className="rounded-2xl p-[2px] shadow-[0_24px_50px_-18px_rgba(0,0,0,0.3)]" style={{ backgroundImage: NOVA_GRADIENT_CSS }}>
        <div className="rounded-[0.95rem] bg-white p-6 min-h-[9.5rem] flex flex-col justify-center">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-gray-400">
            <Sparkles className="h-3.5 w-3.5" style={{ color: NOVA_GRADIENT[2] }} />
            {idea.path}
          </div>
          {/* Keyed so React replaces the node and the fade runs again on every rotation. */}
          <div key={i} style={{ animation: "hero-fade-in 0.5s ease-out both" }}>
            <h3 className="mt-2 text-lg sm:text-xl font-bold text-black" data-testid="text-idea-title">{idea.title}</h3>
            <p className="mt-1 text-sm text-gray-600">{idea.line}</p>
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-center gap-3">
        <div className="flex gap-1.5" aria-hidden>
          {STARTER_IDEAS.map((_, n) => (
            <span
              key={n}
              className="h-1.5 rounded-full transition-all"
              style={{ width: n === i ? 18 : 6, backgroundImage: n === i ? NOVA_GRADIENT_CSS : undefined, backgroundColor: n === i ? undefined : "#e5e7eb" }}
            />
          ))}
        </div>
      </div>

      <p className="mt-5 text-center text-sm text-gray-500">
        Take one, or bring your own.{" "}
        <a href="#top" className="font-semibold text-black inline-flex items-center gap-1 hover:gap-1.5 transition-all" data-testid="link-idea-start">
          Start it <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
      </p>
    </div>
  );
}
