import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Loader2, Minus, Plus, RotateCcw } from "lucide-react";
import {
  CROP_PRESETS, ImageDecodeError, MAX_ZOOM, type CropPresetName, type CropTransform,
  decodeImageFile, initialTransform, panBy, previewStyle, renderCrop, zoomTo,
} from "@/lib/image-crop";

/**
 * Pick which part of a photo is kept.
 *
 * The frame is the shape the picture will actually appear in — round for an
 * avatar, 4:1 for a cover — so what is inside the frame here is what lands on
 * the page. That is the point of it: the old uploader previewed with
 * `object-contain`, showed the whole photo, and let the page centre-crop it
 * afterwards, so the preview was a promise the product did not keep.
 *
 * Drag to move, the slider or the wheel to zoom. Nothing is uploaded until
 * "Use this photo", so a wrong file costs nothing.
 */
export function ImageCropDialog({
  file, preset, open, onCancel, onCropped, busy,
}: {
  /** The picked file. Decoded when it arrives; null closes the dialog. */
  file: File | null;
  preset: CropPresetName;
  open: boolean;
  onCancel: () => void;
  /** The cropped JPEG, ready to upload. */
  onCropped: (cropped: File) => void;
  /** The caller's upload is in flight — keeps the dialog up and the buttons quiet. */
  busy?: boolean;
}) {
  const { aspect, outWidth, outHeight, label } = CROP_PRESETS[preset];
  const round = preset === "avatar";

  const [decoded, setDecoded] = useState<{ source: CanvasImageSource; width: number; height: number; url: string } | null>(null);
  const [transform, setTransform] = useState<CropTransform | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);

  const frameRef = useRef<HTMLDivElement>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  const dragging = useRef<{ x: number; y: number } | null>(null);

  /* Decode on arrival. The object URL is revoked when the file changes or we close. */
  useEffect(() => {
    if (!file || !open) return;
    let cancelled = false;
    let url: string | null = null;
    setError(null);
    setDecoded(null);
    setTransform(null);

    decodeImageFile(file).then(
      (result) => {
        if (cancelled) { URL.revokeObjectURL(result.url); return; }
        url = result.url;
        setDecoded(result);
        setTransform(initialTransform(result.width, result.height, aspect));
      },
      (err) => {
        if (cancelled) return;
        setError(err instanceof ImageDecodeError ? err.message : "That image couldn't be read.");
      },
    );
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [file, open, aspect]);

  /* The frame's width is the scale factor for every drag, so it has to be measured. */
  useEffect(() => {
    const el = frameRef.current;
    if (!el || !open) return;
    const measure = () => setFrameWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [open, decoded]);

  const style = useMemo(() => {
    if (!decoded || !transform || frameWidth <= 0) return null;
    return previewStyle(decoded.width, decoded.height, aspect, transform, frameWidth);
  }, [decoded, transform, aspect, frameWidth]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!decoded || busy) return;
    dragging.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const from = dragging.current;
    if (!from || !decoded || !transform) return;
    const dx = e.clientX - from.x;
    const dy = e.clientY - from.y;
    dragging.current = { x: e.clientX, y: e.clientY };
    setTransform(panBy(decoded.width, decoded.height, aspect, transform, dx, dy, frameWidth));
  };
  const endDrag = () => { dragging.current = null; };

  const setZoom = useCallback((zoom: number) => {
    if (!decoded || !transform) return;
    setTransform(zoomTo(decoded.width, decoded.height, aspect, transform, zoom));
  }, [decoded, transform, aspect]);

  const onWheel = (e: React.WheelEvent) => {
    if (!decoded || !transform) return;
    e.preventDefault();
    setZoom(transform.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08));
  };

  const confirm = async () => {
    if (!decoded || !transform || !file) return;
    setRendering(true);
    try {
      onCropped(await renderCrop(decoded, aspect, transform, outWidth, outHeight, file.name));
    } catch (err) {
      setError(err instanceof ImageDecodeError ? err.message : "That image couldn't be prepared.");
    } finally {
      setRendering(false);
    }
  };

  const working = rendering || busy;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !working) onCancel(); }}>
      <DialogContent className="max-w-lg" data-testid="crop-dialog">
        <DialogHeader>
          <DialogTitle>Position your {label.toLowerCase()}</DialogTitle>
        </DialogHeader>

        {error ? (
          <div className="py-6 space-y-4">
            <p className="text-sm text-muted-foreground" data-testid="crop-error">{error}</p>
            <Button type="button" variant="outline" onClick={onCancel}>Pick a different file</Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/*
              * The frame. `overflow-hidden` plus an absolutely positioned image
              * is what makes this what-you-see-is-what-you-get: the box is the
              * shape the picture lands in, and anything outside it is gone.
              */}
            <div
              ref={frameRef}
              className={`relative w-full overflow-hidden bg-muted/40 select-none touch-none ${
                round ? "rounded-full mx-auto max-w-[18rem]" : "rounded-md"
              } ${decoded ? "cursor-grab active:cursor-grabbing" : ""}`}
              style={{ aspectRatio: String(aspect) }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onWheel={onWheel}
              data-testid="crop-frame"
            >
              {decoded && style ? (
                <img
                  src={decoded.url}
                  alt=""
                  draggable={false}
                  className="absolute max-w-none pointer-events-none"
                  style={{ width: style.width, height: style.height, left: style.left, top: style.top }}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              <Minus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <Slider
                value={[transform?.zoom ?? 1]}
                min={1}
                max={MAX_ZOOM}
                step={0.01}
                disabled={!decoded || working}
                onValueChange={([v]) => setZoom(v)}
                aria-label="Zoom"
                data-testid="crop-zoom"
              />
              <Plus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <Button
                type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                title="Start again" aria-label="Start again"
                disabled={!decoded || working}
                onClick={() => decoded && setTransform(initialTransform(decoded.width, decoded.height, aspect))}
                data-testid="crop-reset"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            </div>

            <p className="text-[11px] text-muted-foreground">
              Drag the photo to move it, and the slider to zoom. What you see here is exactly what
              other people will see.
            </p>
          </div>
        )}

        {!error && (
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCancel} disabled={working}>Cancel</Button>
            <Button type="button" onClick={confirm} disabled={!decoded || working} data-testid="crop-confirm">
              {working ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Saving…</> : "Use this photo"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
