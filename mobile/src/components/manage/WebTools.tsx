/**
 * The manager's extended tabs — Codebase, Research, Strategy, Launch,
 * Analytics and Support. They used to hand off to the website; each is now
 * native, built from the web's own components (codebase-tab.tsx and
 * pm-extended-tabs.tsx) under ./tools. The name and props stay so the
 * manager screen keeps rendering this for those six tabs.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { mkey } from "./shared";
import type { ProjectGoal } from "../../sections";
import { CodebaseTool } from "./tools/Codebase";
import { ResearchTool } from "./tools/Research";
import { StrategyTool } from "./tools/Strategy";
import { LaunchTool } from "./tools/Launch";
import { AnalyticsTool } from "./tools/Analytics";
import { SupportTool } from "./tools/Support";

export type WebOnlyTab = "codebase" | "research" | "strategy" | "launch" | "analytics" | "support";

/** `goal` is the open section: Analytics is per section, the rest are project-wide. */
export function WebTools({ projectId, tab, goal }: { projectId: string; tab: WebOnlyTab; goal: ProjectGoal }) {
  const { user } = useAuth();
  // The manager has already loaded the project under this key; this reads the cache.
  const { data: project } = useQuery({ queryKey: mkey(projectId, "project"), queryFn: () => api<any>(`/api/projects/${projectId}`) });

  switch (tab) {
    case "codebase": return <CodebaseTool projectId={projectId} repoUrl={project?.repoUrl} isOwner={!!project && project.ownerId === user?.id} />;
    case "research": return <ResearchTool projectId={projectId} />;
    case "strategy": return <StrategyTool projectId={projectId} />;
    case "launch": return <LaunchTool projectId={projectId} project={project} />;
    case "analytics": return <AnalyticsTool projectId={projectId} goal={goal} />;
    case "support": return <SupportTool projectId={projectId} />;
  }
}
