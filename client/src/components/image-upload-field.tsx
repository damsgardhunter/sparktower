import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useUpload } from "@/hooks/use-upload";
import { Loader2, Upload, X, ImageIcon } from "lucide-react";

/**
 * Pick an image from your computer.
 *
 * Replaces the "paste a URL" inputs that were scattered around the app. Asking
 * someone to host their own logo somewhere and paste a link is a step most
 * people can't complete, and the ones who can tend to paste a link to a page
 * rather than to an image — which fails much later, at print time.
 *
 * Uploads through the presigned-URL flow and hands back the stored object
 * path, so the caller only deals in a string either way.
 */
export function ImageUploadField({
  label, value, onChange, hint, aspect = "square", accept = "image/*", maxMB = 12, testId,
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
}) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const { uploadFile, isUploading } = useUpload();

  const handle = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Images only", description: "Pick a PNG, JPG or WebP.", variant: "destructive" });
      return;
    }
    if (file.size > maxMB * 1024 * 1024) {
      toast({ title: "That file is too big", description: `Keep it under ${maxMB}MB.`, variant: "destructive" });
      return;
    }
    // Shown immediately so the box doesn't sit empty during the round trip.
    setLocalPreview(URL.createObjectURL(file));
    try {
      const result = await uploadFile(file);
      if (!result?.objectPath) throw new Error("no path");
      onChange(result.objectPath);
    } catch {
      setLocalPreview(null);
      toast({ title: "Upload failed", description: "Try again.", variant: "destructive" });
    }
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
            <img src={shown} alt="" className="w-full h-full object-contain" />
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
    </div>
  );
}
