/**
 * The pages this project has put on the open internet.
 *
 * Publishing a finished step creates a page a stranger can read, and until now
 * there was nowhere to see those pages — the only way back to one was to reopen
 * the dialog that published it, on the step that produced it. So a team could
 * not answer "what of ours is public?", which is a question worth being able to
 * answer without hunting, and taking a page down meant finding the right step
 * first.
 *
 * What it shows is what a builder actually wants to know: is it live, has
 * anyone read it, and did anyone join because of it.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { errorText } from "@/lib/api-error";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { artifactPath } from "@shared/path-artifacts";
import { Globe, Eye, UserPlus, ExternalLink } from "lucide-react";

interface Artifact {
  id: string;
  title: string;
  visibility: "private" | "public";
  publishedAt: string | null;
  views: number;
  signups: number;
}

export function PublishedPages({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const [takingDown, setTakingDown] = useState<Artifact | null>(null);

  const { data } = useQuery<Artifact[]>({
    queryKey: ["/api/projects", projectId, "artifacts"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/artifacts`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: !!projectId,
  });

  const live = (data ?? []).filter((a) => a.visibility === "public");

  const takeDown = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/artifacts/${id}/unpublish`)).json(),
    onSuccess: () => {
      toast({ title: "The page is down", description: "The link leads nowhere now. Your post about it is still on the feed until you delete it." });
      setTakingDown(null);
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "artifacts"] });
    },
    onError: (e) => toast({ title: "Couldn't take it down", description: errorText(e), variant: "destructive" }),
  });

  // Nothing published yet isn't worth a card: the path already offers publishing where a step is finished.
  if (!live.length) return null;

  return (
    <div className="rounded-lg border border-border p-3 space-y-2" data-testid="published-pages">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <Globe className="h-3.5 w-3.5" /> Published pages
      </p>
      <ul className="divide-y divide-border/60">
        {live.map((a) => (
          <li key={a.id} className="flex items-center gap-2 py-1.5 text-sm" data-testid={`published-page-${a.id}`}>
            <a href={artifactPath(a.id)} target="_blank" rel="noreferrer" className="flex-1 min-w-0 truncate hover:underline">
              {a.title} <ExternalLink className="inline h-3 w-3 text-muted-foreground" />
            </a>
            <span className="text-xs text-muted-foreground tabular-nums flex items-center gap-2 shrink-0" title={`${a.views} reads, ${a.signups} joined from it`}>
              <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{a.views}</span>
              <span className="flex items-center gap-1"><UserPlus className="h-3 w-3" />{a.signups}</span>
            </span>
            <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => setTakingDown(a)} data-testid={`button-take-down-${a.id}`}>
              Take down
            </Button>
          </li>
        ))}
      </ul>

      <AlertDialog open={!!takingDown} onOpenChange={(o) => !o && setTakingDown(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Take this page down?</AlertDialogTitle>
            <AlertDialogDescription>
              The page stops being reachable. Anyone who opens the link — including people who already have it — gets nothing.
              Your post about it stays on the feed until you delete it, and you can publish the page again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Leave it up</AlertDialogCancel>
            <AlertDialogAction disabled={takeDown.isPending} onClick={() => takingDown && takeDown.mutate(takingDown.id)} data-testid="button-confirm-take-down">
              Take it down
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
