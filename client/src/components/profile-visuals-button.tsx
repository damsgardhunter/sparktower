import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useUpload } from "@/hooks/use-upload";
import {
  Loader2, Sparkles, ExternalLink, Trash2, RefreshCw, Upload, Eye, EyeOff, ImageIcon,
} from "lucide-react";
import type { Project } from "@shared/schema";
import { CREDIT_COSTS } from "@shared/plans";
import {
  PROJECT_VISUAL_SLOTS, projectVisualSource, isProjectVisualHidden,
  type ProjectVisualSlot, type ProjectVisualSlotDef,
} from "@shared/project-visuals";

const describeError = (err: any, fallback: string) => {
  const raw = err?.message || "";
  const start = raw.indexOf("{");
  if (start >= 0) {
    try { return JSON.parse(raw.slice(start)).message || fallback; } catch { /* keep */ }
  }
  return fallback;
};

/**
 * "Add visuals to my project's profile page", under the logo and cover.
 *
 * Appears once there's a logo to build from. The brief grounds what each
 * picture shows, so until there's a one-liner or description the button says
 * so rather than drawing five images of nothing in particular. Once drawn,
 * each image can be redrawn, swapped for the owner's own upload, or hidden.
 */
export function ProfileVisualsButton({ project }: { project: Project }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/projects", project.id] });

  const generate = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/projects/${project.id}/visuals`)).json(),
    onSuccess: (r: { failed: string[] }) => {
      refresh();
      toast({
        title: "Visuals added to your project page",
        description: r.failed?.length
          ? `${r.failed.length} of ${PROJECT_VISUAL_SLOTS.length} couldn't be drawn — redo those from their tiles.`
          : undefined,
      });
    },
    onError: (err) => toast({
      title: "Couldn't add visuals",
      description: describeError(err, "Try again in a moment."),
      variant: "destructive",
    }),
  });

  const remove = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/projects/${project.id}/visuals`)).json(),
    onSuccess: () => { refresh(); toast({ title: "Visuals removed from your page" }); },
    onError: (err) => toast({
      title: "Couldn't remove them",
      description: describeError(err, "Try again."),
      variant: "destructive",
    }),
  });

  if (!project.logoUrl) return null;

  const anyMade = PROJECT_VISUAL_SLOTS.some((s) => projectVisualSource(project.profileVisuals, s.slot));
  const hasBrief = !!(project.oneLiner?.trim() || project.description?.trim());

  return (
    <div className="sm:col-span-2 space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4" data-testid="profile-visuals">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0 space-y-0.5">
          <p className="text-sm font-medium">Make your project page less wordy</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {anyMade
              ? "Hover an image to redraw it, swap in your own, or hide it from your page."
              : `Nova draws ${PROJECT_VISUAL_SLOTS.length} images from your logo (with your cover for mood) and places them beside your one-liner, About, What Success Looks Like, and down the right side. Takes about a minute · ${CREDIT_COSTS.profileVisuals} credits.`}
          </p>
          {!hasBrief && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Add a one-liner or description to your brief first, so the images show what you're building.
            </p>
          )}
        </div>
        <Button
          className="gap-2 shrink-0"
          variant={anyMade ? "outline" : "default"}
          disabled={!hasBrief || generate.isPending}
          onClick={() => generate.mutate()}
          data-testid="button-add-profile-visuals"
        >
          {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {generate.isPending
            ? "Drawing…"
            : anyMade ? `Redo all · ${CREDIT_COSTS.profileVisuals} credits` : "Add visuals to my project's profile page"}
        </Button>
      </div>

      {anyMade && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {PROJECT_VISUAL_SLOTS.map((def) => (
              <VisualTile
                key={def.slot}
                project={project}
                def={def}
                canRedraw={hasBrief}
                allBusy={generate.isPending}
                onChanged={refresh}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setLocation(`/projects/${project.id}`)} data-testid="button-view-profile-visuals">
              <ExternalLink className="h-3.5 w-3.5" /> See them on your page
            </Button>
            <Button
              size="sm" variant="ghost" className="gap-1.5 text-muted-foreground"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
              data-testid="button-remove-profile-visuals"
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove all from page
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * One slot, with its actions on hover. On touch screens there's no hover, so
 * the toolbar stays visible there instead of being unreachable.
 */
function VisualTile({ project, def, canRedraw, allBusy, onChanged }: {
  project: Project;
  def: ProjectVisualSlotDef;
  canRedraw: boolean;
  allBusy: boolean;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const { uploadFile, isUploading } = useUpload();
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const slot: ProjectVisualSlot = def.slot;
  const src = projectVisualSource(project.profileVisuals, slot);
  const hidden = isProjectVisualHidden(project.profileVisuals, slot);

  const redraw = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/projects/${project.id}/visuals`, { slot })).json(),
    onSuccess: () => { onChanged(); toast({ title: `Redrew "${def.label}"` }); },
    onError: (err) => toast({ title: "Couldn't redraw that one", description: describeError(err, "Try again."), variant: "destructive" }),
  });

  const useOwn = useMutation({
    mutationFn: async (imageUrl: string) =>
      (await apiRequest("PUT", `/api/projects/${project.id}/visuals/${slot}`, { imageUrl })).json(),
    onSuccess: () => { onChanged(); toast({ title: "Your image is on the page" }); },
    onError: (err) => toast({ title: "Couldn't use that image", description: describeError(err, "Try again."), variant: "destructive" }),
    onSettled: () => setLocalPreview(null),
  });

  const toggleHidden = useMutation({
    mutationFn: async () =>
      (await apiRequest("PATCH", `/api/projects/${project.id}/visuals/${slot}`, { hidden: !hidden })).json(),
    onSuccess: () => onChanged(),
    onError: (err) => toast({ title: "Couldn't change that", description: describeError(err, "Try again."), variant: "destructive" }),
  });

  const pickFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Images only", description: "Pick a PNG, JPG or WebP.", variant: "destructive" });
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      toast({ title: "That file is too big", description: "Keep it under 12MB.", variant: "destructive" });
      return;
    }
    setLocalPreview(URL.createObjectURL(file));
    try {
      const result = await uploadFile(file);
      if (!result?.objectPath) throw new Error("no path");
      useOwn.mutate(result.objectPath);
    } catch {
      setLocalPreview(null);
      toast({ title: "Upload failed", description: "Try again.", variant: "destructive" });
    }
  };

  const working = redraw.isPending || isUploading || useOwn.isPending;
  const busy = allBusy || redraw.isPending || isUploading || useOwn.isPending || toggleHidden.isPending;
  const shown = localPreview || src;

  return (
    <figure className="space-y-1" data-testid={`visual-tile-${slot}`}>
      <div className="group relative aspect-square rounded-md border border-border/60 bg-muted/30 overflow-hidden">
        {shown ? (
          <img
            src={shown}
            alt=""
            className={`w-full h-full object-cover transition ${hidden ? "opacity-35 grayscale group-hover:opacity-100 group-hover:grayscale-0" : ""}`}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-muted-foreground">
            <ImageIcon className="h-5 w-5" />
            <span className="text-[10px]">Empty</span>
          </div>
        )}

        {hidden && (
          <span className="absolute top-1.5 left-1.5 rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium flex items-center gap-1">
            <EyeOff className="h-3 w-3" /> Hidden
          </span>
        )}

        {working && (
          <div className="absolute inset-0 bg-background/70 flex flex-col items-center justify-center gap-1">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-[10px] text-muted-foreground">{redraw.isPending ? "Drawing…" : "Uploading…"}</span>
          </div>
        )}

        {/*
          * A dark wash over the whole tile, light enough that the picture
          * being replaced still shows through, split into one column per
          * action so each is a big target rather than a small icon.
          */}
        <div
          hidden={working}
          className="absolute inset-0 flex divide-x divide-white/15 bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <TileAction
            label={`Redo this image · ${CREDIT_COSTS.profileVisualSingle} credit`}
            short="Redo"
            disabled={busy || !canRedraw}
            onClick={() => redraw.mutate()}
            testId={`button-redo-visual-${slot}`}
          >
            <RefreshCw className="h-5 w-5" />
          </TileAction>
          <TileAction
            label="Upload your own"
            short="Upload"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            testId={`button-upload-visual-${slot}`}
          >
            <Upload className="h-5 w-5" />
          </TileAction>
          {src && (
            <TileAction
              label={hidden ? "Show on page" : "Hide from page"}
              short={hidden ? "Show" : "Hide"}
              disabled={busy}
              onClick={() => toggleHidden.mutate()}
              testId={`button-toggle-visual-${slot}`}
            >
              {hidden ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
            </TileAction>
          )}
        </div>
      </div>
      <figcaption className="text-[10px] text-muted-foreground leading-tight">{def.label}</figcaption>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) pickFile(file);
          e.target.value = "";
        }}
      />
    </figure>
  );
}

function TileAction({ label, short, disabled, onClick, testId, children }: {
  label: string;
  /** Shown under the icon; the tooltip carries the full label. */
  short: string;
  disabled: boolean;
  onClick: () => void;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="flex-1 min-w-0 flex flex-col items-center justify-center gap-1 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] transition-colors hover:bg-white/15 focus-visible:bg-white/15 focus-visible:outline-none disabled:opacity-40 disabled:hover:bg-transparent"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          data-testid={testId}
        >
          {children}
          <span className="text-[10px] font-medium leading-none">{short}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">{label}</TooltipContent>
    </Tooltip>
  );
}
