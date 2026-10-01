import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useUpload } from "@/hooks/use-upload";
import { ImageCropDialog } from "@/components/image-crop-dialog";
import { CROP_PRESETS, type CropPresetName } from "@/lib/image-crop";
import { Loader2, Upload, X, ImageIcon, Crop } from "lucide-react";

/**
 * Pick an image from your computer, and choose which part of it is kept.
 *
 * Replaces the "paste a URL" inputs that were scattered around the app. Asking
 * someone to host their own logo somewhere and paste a link is a step most
 * people can't complete, and the ones who can tend to paste a link to a page
 * rather than to an image — which fails much later, at print time.
 *
 * Uploads through the presigned-URL flow and hands back the stored object
 * path, so the caller only deals in a string either way.
 *
 * ## Why a crop step
 *
 * Because without one this field was quietly lying. It previewed with
 * `object-contain`, which shows the whole picture letterboxed, and every place
 * the picture was then shown used `object-cover` / `bg-cover bg-center`, which
 * fills the shape and throws the rest away. So the preview showed you a photo
 * and the page showed you the middle of it. Pass a `crop` preset and the preview
 * becomes the real shape and the person picks what survives; leave it off and
 * the file is uploaded as it was, which is still right for a logo or a document
 * where no shape is being forced.
 */
export function ImageUploadField({
  label, value, onChange, hint, aspect = "square", accept = "image/*", maxMB = 12, testId, crop,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (objectPath: string | null) => void;
  hint?: string;
  /** Shape of the preview box, so a cover doesn't preview as a square. */
  aspect?: "square" | "wide";
  accept?: string;
  maxMB?: number;
  testId?: string;
  /**
   * Offer the crop step, framed as the shape this picture is shown in.
   *
   * Also the fix for a second problem: the crop re-encodes to a JPEG of known
   * size, so a 12-megapixel phone photo stops arriving at the uploader as
   * several megabytes of something that was going to be drawn 400px wide.
   */
  crop?: CropPresetName;
}) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [pending, setPending] = useState<File | null>(null);
  const { uploadFile, isUploading } = useUpload();

  /*
   * The size check happens before the crop, on the file as picked. It is a
   * guard against reading a 90MB file into memory to decode it, not against
   * uploading one — what gets uploaded after a crop is always small.
   */
  const accepted = (file: File): boolean => {
    if (!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name)) {
      toast({ title: "Images only", description: "Pick a PNG, JPG or WebP.", variant: "destructive" });
      return false;
    }
    const limit = crop ? Math.max(maxMB, 40) : maxMB;
    if (file.size > limit * 1024 * 1024) {
      toast({ title: "That file is too big", description: `Keep it under ${limit}MB.`, variant: "destructive" });
      return false;
    }
    return true;
  };

  const upload = async (file: File) => {
    // Shown immediately so the box doesn't sit empty during the round trip.
    setLocalPreview(URL.createObjectURL(file));
    try {
      const result = await uploadFile(file);
      if (!result?.objectPath) throw new Error("no path");
      onChange(result.objectPath);
      setPending(null);
    } catch {
      setLocalPreview(null);
      setPending(null);
      toast({ title: "Upload failed", description: "Try again.", variant: "destructive" });
    }
  };

  const handle = (file: File) => {
    if (!accepted(file)) return;
    if (crop) { setPending(file); return; }
    void upload(file);
  };

  const shown = localPreview || value || null;

  return (
    <div className="space-y-2">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-start gap-3">
        <div
          className={`relative shrink-0 rounded-md border border-border/60 bg-muted/30 overflow-hidden ${
            aspect === "wide" ? "w-40 h-20" : "w-20 h-20"
          }`}
        >
          {shown ? (
            /*
             * `object-cover` once there is a crop step, because that is what the
             * page does with it. `object-contain` here and cover everywhere else
             * is how the preview came to disagree with the product.
             */
            <img src={shown} alt="" className={`w-full h-full ${crop ? "object-cover" : "object-contain"}`} />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
              <ImageIcon className="h-5 w-5" />
            </div>
          )}
          {isUploading && (
            <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-1.5">
          <div className="flex gap-2">
            <Button
              type="button" variant="outline" size="sm" className="gap-1.5"
              disabled={isUploading}
              onClick={() => inputRef.current?.click()}
              data-testid={testId ? `${testId}-choose` : undefined}
            >
              <Upload className="h-3.5 w-3.5" />
              {shown ? "Replace" : "Choose file"}
            </Button>
            {shown && (
              <Button
                type="button" variant="ghost" size="sm" className="gap-1.5 text-destructive"
                disabled={isUploading}
                onClick={() => { setLocalPreview(null); onChange(null); }}
                data-testid={testId ? `${testId}-clear` : undefined}
              >
                <X className="h-3.5 w-3.5" /> Remove
              </Button>
            )}
          </div>
          {hint && <p className="text-[11px] text-muted-foreground leading-relaxed">{hint}</p>}
          {crop && (
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Crop className="h-3 w-3" /> You choose the framing after picking a file.
            </p>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handle(file);
          // Cleared so picking the same file twice still fires a change.
          e.target.value = "";
        }}
        data-testid={testId}
      />

      {crop && (
        <ImageCropDialog
          file={pending}
          preset={crop}
          open={pending !== null}
          busy={isUploading}
          onCancel={() => setPending(null)}
          onCropped={(cropped) => void upload(cropped)}
        />
      )}
    </div>
  );
}

/** Re-exported so callers can name a shape without reaching into the lib. */
export { CROP_PRESETS };
