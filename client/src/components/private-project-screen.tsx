import { Button } from "@/components/ui/button";
import { Lock, ArrowLeft, Compass } from "lucide-react";
import { useLocation } from "wouter";

/**
 * Shown when someone opens a private project they don't have access to.
 *
 * The server sends only the title for these (see the `restricted` branch of
 * GET /api/projects/:id), so this screen deliberately has nothing else to
 * show — no description, team, or stats.
 */
export function PrivateProjectScreen({ title }: { title: string }) {
  const [, setLocation] = useLocation();

  return (
    <div className="h-full overflow-y-auto flex items-center justify-center p-6" data-testid="screen-private-project">
      <div className="w-full max-w-md text-center space-y-6">
        <div className="mx-auto h-14 w-14 rounded-2xl bg-muted flex items-center justify-center">
          <Lock className="h-6 w-6 text-muted-foreground" />
        </div>

        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight break-words" data-testid="text-private-project-title">
            {title}
          </h1>
          <p className="text-lg text-secondary" data-testid="text-private-project-notice">
            This is a private project.
          </p>
        </div>

        <p className="text-sm text-muted-foreground">
          Only the owner and their team can view it. If you should have access, ask them to add you.
        </p>

        <div className="flex items-center justify-center gap-2 pt-1">
          <Button variant="outline" className="gap-2" onClick={() => window.history.back()} data-testid="button-private-back">
            <ArrowLeft className="h-4 w-4" /> Go back
          </Button>
          <Button className="gap-2" onClick={() => setLocation("/discover")} data-testid="button-private-discover">
            <Compass className="h-4 w-4" /> Discover projects
          </Button>
        </div>
      </div>
    </div>
  );
}
