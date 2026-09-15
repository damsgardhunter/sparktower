/**
 * The project-wide tabs — Setup, Codebase, Team, Chat — on the right, the
 * same whichever section is open. On narrow screens it's a row of four.
 */
import { useQuery } from "@tanstack/react-query";
import { RAIL_TABS, NOVA_GRADIENT, type TabId } from "./tabs";

/** Icons alternate through the Nova colours. */
const ICON_TONE: Record<string, string> = {
  setup: "text-emerald-600",
  codebase: "text-purple-600",
  team: "text-emerald-600",
  chat: "text-purple-600",
};

function ago(iso: string | null | undefined) {
  if (!iso) return null;
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function ManagerRail({ projectId, active, onSelect }: {
  projectId: string;
  active: TabId;
  onSelect: (tab: TabId) => void;
}) {
  const latest = useLatestAudit(projectId);
  const lastAudit = latest ? ago(latest.appliedAt ?? latest.createdAt) : null;

  return (
    <div className={`rounded-2xl p-[1.5px] ${NOVA_GRADIENT}`}>
      <nav
        className="rounded-[14px] bg-background p-1.5 grid grid-cols-4 gap-1 lg:grid-cols-1 lg:p-2"
        aria-label="Project"
        data-testid="manager-rail"
      >
        <p className="hidden lg:block px-2 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Project</p>
        {RAIL_TABS.map((t) => {
          const on = active === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t.id)}
              aria-current={on ? "page" : undefined}
              className={`relative flex flex-col lg:flex-row items-center gap-1 lg:gap-3 rounded-xl px-1 py-2 lg:px-3 lg:py-2.5 text-xs lg:text-[15px] font-medium transition-colors ${
                on ? "bg-gradient-to-r from-green-400/10 via-emerald-500/10 to-purple-500/15 text-foreground" : "text-foreground/75 hover:bg-muted"
              }`}
              data-testid={`rail-${t.id}`}
            >
              <span className={`h-8 w-8 lg:h-9 lg:w-9 shrink-0 rounded-lg flex items-center justify-center ${on ? `${NOVA_GRADIENT} text-white shadow-sm` : `bg-gradient-to-br from-green-400/15 to-purple-500/15 ${ICON_TONE[t.id]}`}`}>
                <t.icon className="h-[18px] w-[18px] lg:h-5 lg:w-5" />
              </span>
              <span className="lg:flex-1 lg:text-left">{t.label}</span>
              {t.id === "codebase" && lastAudit && (
                <span className="hidden lg:inline-flex items-center gap-1 text-[10px] text-muted-foreground" title="Last code audit" data-testid="rail-codebase-live">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  {lastAudit}
                </span>
              )}
              {t.id === "codebase" && lastAudit && (
                <span className="lg:hidden absolute top-1.5 right-2 h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

/**
 * The project's newest code audit, kept live. Shares the Codebase tab's cache
 * entry, so it costs nothing extra there.
 */
export function useLatestAudit(projectId: string | undefined) {
  const { data } = useQuery<{ id: string; createdAt: string; appliedAt: string | null }[]>({
    queryKey: ["/api/projects", projectId, "code-audits"],
    enabled: !!projectId,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
  return data?.[0] ?? null;
}
