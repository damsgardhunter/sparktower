import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { plural } from "@/components/section/path-types";
import type { ProjectGoal } from "@shared/goals";
import { FileDown, FileText } from "lucide-react";

/**
 * The path, as a file somebody can send.
 *
 * Everything on a path is written onto a task, which is the right place to do
 * the work and the wrong place to keep it: the bank, the landlord and the
 * co-founder all want a document, and what a builder had at the end of a build
 * was a board. Both buttons are plain links rather than fetches, so the browser
 * does the download and nothing here has to hold a blob in memory or invent a
 * progress state for a file that arrives in a second.
 *
 * It says how much is in it before offering it, and says nothing at all when
 * the answer is nothing — an empty document is worse than no button.
 */
export function TakeItAway({ projectId, goal }: { projectId: string; goal: ProjectGoal }) {
  const { data } = useQuery<{ steps: number; phases: number; goalLabel: string | null }>({
    queryKey: ["/api/projects", projectId, "path", "export", "summary", goal],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/path/export/summary?goal=${goal}`, { credentials: "include" });
      if (!res.ok) throw new Error("summary");
      return res.json();
    },
  });

  if (!data?.steps) return null;
  const href = (format: string) => `/api/projects/${projectId}/path/export?goal=${goal}&format=${format}`;

  return (
    <div className="space-y-2" data-testid="take-it-away">
      <p className="text-sm text-muted-foreground">
        {plural(data.steps, "step")} written across {plural(data.phases, "phase")}, as one document — the answers themselves, in path order.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline" data-testid="button-export-pdf">
          <a href={href("pdf")} download>
            <FileDown className="h-3.5 w-3.5 mr-1.5" />PDF
          </a>
        </Button>
        <Button asChild size="sm" variant="outline" data-testid="button-export-md">
          <a href={href("md")} download>
            <FileText className="h-3.5 w-3.5 mr-1.5" />Markdown
          </a>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Free — it's your writing, and you already have it.</p>
    </div>
  );
}
