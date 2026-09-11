import { errorText } from "@/lib/api-error";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useUpload } from "@/hooks/use-upload";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import {
  Upload,
  X,
  Image as ImageIcon,
  Film,
  Loader2,
  Plus,
} from "lucide-react";

interface MediaGalleryProps {
  projectId: string;
  mediaUrls: string[];
  isOwner: boolean;
}

function isVideo(url: string) {
  return /\.(mp4|webm|ogg|mov)$/i.test(url) || url.includes("video");
}

export function MediaGallery({ projectId, mediaUrls, isOwner }: MediaGalleryProps) {
  const { toast } = useToast();
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const { uploadFile, isUploading, progress } = useUpload({
    onSuccess: (response) => {
      addMediaMutation.mutate(response.objectPath);
    },
    onError: (error) => {
      toast({ title: "Upload failed", description: errorText(error), variant: "destructive" });
    },
  });

  const addMediaMutation = useMutation({
    mutationFn: async (objectPath: string) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/media`, { objectPath });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Media uploaded" });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
    },
  });

  const deleteMediaMutation = useMutation({
    mutationFn: async (index: number) => {
      await apiRequest("DELETE", `/api/projects/${projectId}/media/${index}`);
    },
    onSuccess: () => {
      toast({ title: "Media removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
    },
  });

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    const file = files[0];
    if (!file) return;
    const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp", "video/mp4", "video/webm"];
    if (!allowed.includes(file.type)) {
      toast({ title: "Invalid file type", description: "Upload JPG, PNG, GIF, WebP, MP4, or WebM files.", variant: "destructive" });
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum file size is 50MB.", variant: "destructive" });
      return;
    }
    uploadFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <div className="space-y-4">
      {mediaUrls.length === 0 && !isOwner && (
        <div className="flex flex-col items-center justify-center py-12 text-center border border-dashed border-border rounded-lg">
          <ImageIcon className="h-12 w-12 text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No media uploaded yet.</p>
          <p className="text-sm text-muted-foreground">Showcase your project with images and videos!</p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {mediaUrls.map((url, index) => (
          <div
            key={index}
            className="relative group aspect-video rounded-lg overflow-hidden border border-border bg-muted cursor-pointer"
            onClick={() => setLightboxUrl(url)}
            data-testid={`media-item-${index}`}
          >
            {isVideo(url) ? (
              <div className="relative w-full h-full flex items-center justify-center bg-black">
                <video src={url} className="w-full h-full object-cover" muted preload="metadata" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Film className="h-8 w-8 text-white/80" />
                </div>
              </div>
            ) : (
              <img src={url} alt={`Project media ${index + 1}`} className="w-full h-full object-cover" />
            )}
            {isOwner && (
              <button
                className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteMediaMutation.mutate(index);
                }}
                data-testid={`button-delete-media-${index}`}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}

        {isOwner && (
          <div
            className={`aspect-video rounded-lg border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-colors ${
              dragOver ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => document.getElementById("media-upload-input")?.click()}
            data-testid="dropzone-media-upload"
          >
            {isUploading ? (
              <>
                <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
                <span className="text-sm text-muted-foreground">{progress}%</span>
              </>
            ) : (
              <>
                <Plus className="h-8 w-8 text-muted-foreground mb-2" />
                <span className="text-sm text-muted-foreground">Add Media</span>
              </>
            )}
            <input
              id="media-upload-input"
              type="file"
              className="hidden"
              accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm"
              onChange={(e) => handleFiles(e.target.files)}
              data-testid="input-media-upload"
            />
          </div>
        )}
      </div>

      <Dialog open={!!lightboxUrl} onOpenChange={() => setLightboxUrl(null)}>
        <DialogContent className="max-w-4xl p-0 overflow-hidden bg-black border-none">
          {lightboxUrl && (
            isVideo(lightboxUrl) ? (
              <video
                src={lightboxUrl}
                controls
                autoPlay
                className="w-full max-h-[80vh] object-contain"
                data-testid="video-lightbox"
              />
            ) : (
              <img
                src={lightboxUrl}
                alt="Media preview"
                className="w-full max-h-[80vh] object-contain"
                data-testid="img-lightbox"
              />
            )
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
