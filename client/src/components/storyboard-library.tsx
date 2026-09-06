import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { StoryboardSlideshow } from "@/components/storyboard-slideshow";
import { Loader2, Play, Trash2, Lock, Film, Sparkles } from "lucide-react";

interface StoryboardSummary {
  id: string;
  style: string;
  prompt: string | null;
  sceneCount: number;
  imageModel: string | null;
  createdAt: string;
  thumbnail: string | null;
}

interface StoryboardDetail {
  id: string;
  style: string;
  storyboard: string;
  scenes: { caption: string; prompt?: string; imageUrl: string }[];
}

/**
 * The user's own storyboards for a project.
 *
 * Storyboards are private working output — they never appear in the project's
 * media gallery and no one but the account that generated them can load them.
 * Keeping them here lets someone generate several per project and come back to
 * any of them later.
 */
export function StoryboardLibrary({
  projectId, projectTitle, open, onOpenChange, onGenerateNew,
}: {
  projectId: string;
  projectTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerateNew: () => void;
}) {
  const { toast } = useToast();
  const [viewingId, setViewingId] = useState<string | null>(null);

  const { data: storyboards, isLoading } = useQuery<StoryboardSummary[]>({
    queryKey: ["/api/projects", projectId, "storyboards"],
    enabled: open && !!projectId,
  });

  const { data: viewing, isFetching: loadingDetail } = useQuery<StoryboardDetail>({
    queryKey: ["/api/storyboards", viewingId],
    enabled: !!viewingId,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/storyboards/${id}`); },
    onSuccess: () => {
      toast({ title: "Storyboard deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "storyboards"] });
    },
    onError: () => toast({ title: "Couldn't delete that storyboard", variant: "destructive" }),
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Film className="h-5 w-5 text-primary" /> Your storyboards
            </DialogTitle>
            <DialogDescription className="flex items-center gap-1.5">
              <Lock className="h-3 w-3" /> Private to you — never shown on the project page or in the media gallery.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto -mx-6 px-6 py-2">
            {isLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : !storyboards?.length ? (
              <div className="text-center py-12 space-y-3">
                <Film className="h-10 w-10 mx-auto text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">
                  No storyboards yet. Generate one to see your project as a showcase reel.
                </p>
                <Button size="sm" className="gap-2" onClick={() => { onOpenChange(false); onGenerateNew(); }} data-testid="button-generate-first-storyboard">
                  <Sparkles className="h-4 w-4" /> Generate a storyboard
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {storyboards.map((sb) => (
                  <div
                    key={sb.id}
                    className="flex items-center gap-3 rounded-lg border border-border/60 p-2.5 hover:border-primary/40 transition-colors"
                    data-testid={`storyboard-row-${sb.id}`}
                  >
                    <div className="h-14 w-24 rounded-md bg-muted overflow-hidden shrink-0 flex items-center justify-center">
                      {sb.thumbnail ? (
                        <img src={sb.thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <Film className="h-5 w-5 text-muted-foreground/40" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-[10px] capitalize">{sb.style}</Badge>
                        <span className="text-xs text-muted-foreground">{sb.sceneCount} scenes</span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {sb.prompt || new Date(sb.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 h-8"
                        onClick={() => setViewingId(sb.id)}
                        data-testid={`button-play-storyboard-${sb.id}`}
                      >
                        {loadingDetail && viewingId === sb.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Play className="h-3.5 w-3.5" />}
                        Play
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        disabled={deleteMutation.isPending}
                        onClick={() => deleteMutation.mutate(sb.id)}
                        data-testid={`button-delete-storyboard-${sb.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
                <Button
                  variant="outline"
                  className="w-full gap-2 mt-2"
                  onClick={() => { onOpenChange(false); onGenerateNew(); }}
                  data-testid="button-generate-another-storyboard"
                >
                  <Sparkles className="h-4 w-4" /> Generate another
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {viewingId && viewing && (
        <StoryboardSlideshow
          scenes={viewing.scenes}
          title={projectTitle}
          style={viewing.style}
          storyboard={viewing.storyboard}
          onClose={() => setViewingId(null)}
        />
      )}
    </>
  );
}
