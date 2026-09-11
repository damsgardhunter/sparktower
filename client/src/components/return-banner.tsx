/**
 * Coming back to Discover.
 *
 * The loop only closes if returning is worth it, so a return says so: what's
 * new with the people and projects you'd looked at, a way straight to it, and
 * "Continue exploring" — which goes to the first card you haven't looked at
 * yet, not to the top of a list you've already read. On a first visit, and on
 * a return with nothing to report and no reason to prompt, it stays out of
 * the way.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowDown, Sparkles, X } from "lucide-react";
import { wasOpenedBefore } from "@/lib/explore";
import { updateLabel, type ExploreUpdate } from "@/hooks/use-explore-updates";

const hrefFor = (update: ExploreUpdate) => (update.kind === "builder" ? `/profile/${update.id}` : `/projects/${update.id}`);

export function ReturnBanner({ updates }: { updates: ExploreUpdate[] }) {
  // Read before this page marks the tab as having opened Discover — so it says
  // whether this visit is a return, not whether the page has loaded.
  const [returning] = useState(wasOpenedBefore);
  const [dismissed, setDismissed] = useState(false);
  const [, setLocation] = useLocation();

  if (dismissed || (!returning && !updates.length)) return null;

  const continueExploring = () => {
    setDismissed(true);
    const next = document.querySelector<HTMLElement>("[data-explore-card]:not([data-seen])");
    if (next) {
      next.scrollIntoView({ behavior: "smooth", block: "center" });
      next.focus({ preventScroll: true });
    }
  };

  return (
    <Card className="border-primary/40 bg-primary/5" data-testid="return-banner">
      <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <Sparkles className="h-5 w-5 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm">
            {updates.length ? "Welcome back — new since you last looked" : "Welcome back"}
          </p>
          <p className="text-xs text-muted-foreground" data-testid="return-banner-detail">
            {updates.length
              ? updates.map((u) => `${u.name}: ${updateLabel(u)}`).join(" · ")
              : "Pick up where you left off — there are people and projects you haven't looked at yet."}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {updates[0] && (
            <Button size="sm" variant="outline" onClick={() => setLocation(hrefFor(updates[0]))} data-testid="button-see-update">
              See {updates[0].name}
            </Button>
          )}
          <Button size="sm" onClick={continueExploring} data-testid="button-continue-exploring">
            <ArrowDown className="h-3.5 w-3.5 mr-1.5" /> Continue exploring
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setDismissed(true)} aria-label="Dismiss">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
