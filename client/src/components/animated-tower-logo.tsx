import type { CSSProperties } from "react";
import { LOGO_LAYOUT } from "@/components/animated-logo-layout";

/**
 * The SparkTower logo, charged: the tower, with its lightning bolts shooting
 * out from the dome on a loop — out, fading as they leave, a moment of bare
 * tower, then back in to go again (keyframes `tower-bolt-shoot` in index.css).
 *
 * Built from separate art (script/build-logo-assets.mjs aligns each bolt on the
 * dome and writes their places and directions). The bolts travel past the
 * artboard on purpose: whatever contains the logo clips them — in the header,
 * the hanging semicircle — so they leave through its edge. With reduced motion
 * asked for, the bolts stay put.
 */
export function AnimatedTowerLogo({ height, className = "" }: { height: number; className?: string }) {
  const width = height * LOGO_LAYOUT.aspect;
  // Far enough that every bolt is past the edge of anything around the logo by the time it's faded.
  const travel = height * 1.1;
  const box = (p: { left: number; top: number; width: number; height: number }): CSSProperties => ({
    position: "absolute", left: `${p.left}%`, top: `${p.top}%`, width: `${p.width}%`, height: `${p.height}%`,
  });
  return (
    <span className={`relative block ${className}`} style={{ width, height }} role="img" aria-label="SparkTower" data-testid="animated-tower-logo">
      {/* Behind the tower, so each bolt leaves from under the dome's edge. */}
      {LOGO_LAYOUT.bolts.map((b) => (
        <img
          key={b.id}
          src={b.src}
          alt=""
          draggable={false}
          className="tower-bolt select-none"
          style={{ ...box(b), "--bolt-dx": `${b.dirX * travel}px`, "--bolt-dy": `${b.dirY * travel}px` } as CSSProperties}
          data-testid={`tower-bolt-${b.id}`}
        />
      ))}
      <img src={LOGO_LAYOUT.tower.src} alt="" draggable={false} className="select-none" style={box(LOGO_LAYOUT.tower)} />
    </span>
  );
}
