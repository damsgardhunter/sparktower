import { useMemo } from "react";
import { CREATOR_TAGLINE, type MerchConfig } from "@shared/backing";

/**
 * The merch, as the server will actually print it.
 *
 * These are `<img>` tags pointing at `/api/projects/:id/merch/preview.png`,
 * which is rendered by the same function that produces the print file. An
 * earlier version drew its own SVG approximation in the browser, which is the
 * classic way to ship a preview that quietly disagrees with the garment —
 * different font, different metrics, different everything.
 *
 * `version` busts the cache when the creator edits their design; the endpoint
 * caches for a minute so a backer reloading a project page doesn't re-render a
 * 4500px canvas.
 */

/** A plain tee silhouette to frame the artwork. */
const SHIRT_PATH =
  "M62,22 L88,10 Q100,26 112,10 L138,22 L176,48 L158,76 L144,64 L144,212 " +
  "L56,212 L56,64 L42,76 L24,48 Z";

const GARMENT: Record<MerchConfig["colorway"], { fill: string; seam: string }> = {
  black: { fill: "#17171b", seam: "#2b2b31" },
  white: { fill: "#f7f7f6", seam: "#dedede" },
  heather: { fill: "#a1a1aa", seam: "#8b8b93" },
};

function Garment({
  projectId, face, colorway, version, label,
}: {
  projectId: string;
  face: "front" | "back" | "creator";
  colorway: MerchConfig["colorway"];
  version: string;
  label: string;
}) {
  const colors = GARMENT[colorway] ?? GARMENT.black;
  const src = `/api/projects/${projectId}/merch/preview.png?face=${face}&width=700&v=${version}`;

  return (
    <div className="space-y-1">
      <div className="relative rounded-lg border border-border/60 bg-muted/30 p-2">
        <svg viewBox="0 0 200 224" className="w-full h-auto" role="presentation">
          <path d={SHIRT_PATH} fill={colors.fill} stroke={colors.seam} strokeWidth="1.5" />
          <path d="M88,10 Q100,26 112,10" fill="none" stroke={colors.seam} strokeWidth="3" />
          {/*
            * The rendered artwork, clipped to the printable chest area.
            * preserveAspectRatio keeps it in proportion rather than stretching
            * it to the box, so the preview matches the garment's real ratio.
            */}
          <image
            href={src}
            x="62" y="60" width="76" height="110"
            preserveAspectRatio="xMidYMid meet"
          />
        </svg>
      </div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground text-center">
        {label}
      </p>
    </div>
  );
}

export function MerchPreview({
  projectId, config,
}: {
  projectId: string;
  config: MerchConfig;
}) {
  /*
   * Everything that changes the artwork, hashed into the URL. Without this the
   * browser keeps showing the old design after every edit, which reads as the
   * save having failed.
   */
  const version = useMemo(() => {
    const key = JSON.stringify([
      config.showLogo, config.showName, config.showDatestamp,
      config.displayName, config.logoUrl, config.colorway,
    ]);
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
    return String(h >>> 0);
  }, [config.showLogo, config.showName, config.showDatestamp, config.displayName, config.logoUrl, config.colorway]);

  const blankBack = !config.showLogo && !config.showName && !config.showDatestamp;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3" data-testid="merch-preview">
        <Garment projectId={projectId} face="front" colorway={config.colorway} version={version} label="front" />
        <Garment projectId={projectId} face="back" colorway={config.colorway} version={version} label="back" />
      </div>

      {blankBack && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          With the logo, name and date all off, the back is blank. Turn one on.
        </p>
      )}

      {config.creatorShirt && (
        <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/20 p-3">
          <div className="w-16 shrink-0">
            <Garment
              projectId={projectId} face="creator" colorway={config.colorway}
              version={version} label=""
            />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium">Your shirt: "{CREATOR_TAGLINE}"</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              The counterpart to what your backers wear. One photo of the pair sells the whole thing.
            </p>
          </div>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        This is the real artwork, rendered by the same code that generates the print file.
      </p>
    </div>
  );
}
