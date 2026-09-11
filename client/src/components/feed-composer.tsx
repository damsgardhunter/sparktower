import { errorText } from "@/lib/api-error";
import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { UserAvatar } from "@/components/user-avatar";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useUpload } from "@/hooks/use-upload";
import { MentionTextarea } from "@/components/mention-textarea";
import {
  Loader2, ImagePlus, X, Send, Lock, FolderKanban, PenLine, AtSign,
} from "lucide-react";
import * as Icons from "lucide-react";
import { POST_TYPES, POST_TYPES_BY_KEY, MAX_POST_LENGTH, MAX_POST_MEDIA } from "@shared/feed";
import type { FeedMention, FeedPostType } from "@shared/schema";

/** Resolves the icon name stored in the post-type config. */
function TypeIcon({ name, className }: { name: string; className?: string }) {
  const Icon = (Icons as any)[name] || Icons.Circle;
  return <Icon className={className} />;
}

/**
 * The founder feed composer.
 *
 * Opens as a single prompt row and expands once you pick a post type. Post
 * types come first deliberately — a founder staring at an empty box rarely
 * knows what to write, but "Looking for Help" with an example placeholder is
 * an easy thing to fill in.
 */
export function FeedComposer({ defaultProjectId }: { defaultProjectId?: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [postType, setPostType] = useState<FeedPostType>("project_update");
  const [content, setContent] = useState("");
  const [mentions, setMentions] = useState<FeedMention[]>([]);
  const [projectId, setProjectId] = useState<string>(defaultProjectId || "none");
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);

  const { data: myProjects } = useQuery<{ id: string; title: string; isPrivate: boolean }[]>({
    queryKey: ["/api/feed/my-projects"],
    enabled: open && !!user,
  });

  const { uploadFile, isUploading } = useUpload({
    onSuccess: (response) => setMediaUrls((prev) => [...prev, response.objectPath].slice(0, MAX_POST_MEDIA)),
    onError: (error) => toast({ title: "Upload failed", description: errorText(error), variant: "destructive" }),
  });

  const def = POST_TYPES_BY_KEY[postType];
  const selectedProject = myProjects?.find((p) => p.id === projectId);

  const reset = () => {
    setContent("");
    setMentions([]);
    setMediaUrls([]);
    setOpen(false);
  };

  const publish = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/feed", {
        postType,
        content,
        projectId: projectId === "none" ? undefined : projectId,
        mediaUrls,
        mentions,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Posted", description: "Your update is on the feed." });
      reset();
      queryClient.invalidateQueries({ queryKey: ["/api/feed"] });
    },
    onError: (err: any) => {
      const raw = err?.message || "";
      const start = raw.indexOf("{");
      let description = "Please try again.";
      if (start >= 0) {
        try { description = JSON.parse(raw.slice(start)).message || description; } catch { /* keep */ }
      }
      toast({ title: "Couldn't post", description, variant: "destructive" });
    },
  });

  if (!user) return null;

  const displayName = user.firstName ? `${user.firstName} ${user.lastName || ""}`.trim() : user.email || "You";

  if (!open) {
    return (
      <Card className="rounded-lg shadow-none bg-background dark:bg-card" data-testid="card-composer-collapsed">
        <CardContent className="p-3">
          <div className="flex items-center gap-3">
            <UserAvatar src={user.profileImageUrl} name={displayName} className="h-10 w-10 shrink-0" />
            <button
              onClick={() => setOpen(true)}
              className="flex-1 text-left px-4 py-2.5 rounded-full border border-border text-sm text-muted-foreground hover:bg-accent transition-colors"
              data-testid="button-open-composer"
            >
              Share what you're building…
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-border/50">
            {POST_TYPES.slice(0, 5).map((t) => (
              <Button
                key={t.type}
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs h-7"
                onClick={() => { setPostType(t.type); setOpen(true); }}
                data-testid={`button-quick-${t.type}`}
              >
                <TypeIcon name={t.icon} className="h-3.5 w-3.5" />
                {t.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/30 rounded-lg shadow-none bg-background dark:bg-card" data-testid="card-composer">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start gap-3">
          <UserAvatar src={user.profileImageUrl} name={displayName} className="h-10 w-10 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-sm">{displayName}</p>
            <p className="text-xs text-muted-foreground">
              Posting {selectedProject ? `for ${selectedProject.title}` : "as yourself"}
            </p>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={reset} data-testid="button-close-composer">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Post type picker — the thing that makes the box easy to fill. */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">What kind of post is this?</p>
          <div className="flex flex-wrap gap-1.5">
            {POST_TYPES.map((t) => (
              <button
                key={t.type}
                onClick={() => setPostType(t.type)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-xs transition-colors ${
                  postType === t.type
                    ? "border-primary bg-primary/10 text-foreground font-medium"
                    : "border-border text-muted-foreground hover:border-primary/40"
                }`}
                data-testid={`chip-type-${t.type}`}
              >
                <TypeIcon name={t.icon} className="h-3.5 w-3.5" />
                {t.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{def.hint}</p>
        </div>

        <MentionTextarea
          value={content}
          onChange={setContent}
          mentions={mentions}
          onMentionsChange={setMentions}
          placeholder={def.placeholder}
          className="min-h-[120px]"
          maxLength={MAX_POST_LENGTH}
          testId="textarea-post-content"
        />

        {/* Starters only while the box is empty, so they never nag. */}
        {content.length === 0 && (
          <div className="flex flex-wrap gap-1.5">
            {def.starters.map((starter) => (
              <button
                key={starter}
                onClick={() => setContent(starter + " ")}
                className="text-xs px-2 py-1 rounded-md bg-muted hover:bg-accent text-muted-foreground transition-colors"
                data-testid={`starter-${starter.slice(0, 12)}`}
              >
                {starter}
              </button>
            ))}
          </div>
        )}

        {mediaUrls.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {mediaUrls.map((url, i) => (
              <div key={url} className="relative aspect-video rounded-md overflow-hidden bg-muted">
                <img src={url} alt="" className="h-full w-full object-cover" />
                <button
                  onClick={() => setMediaUrls((prev) => prev.filter((u) => u !== url))}
                  className="absolute top-1 right-1 rounded-full bg-background/90 p-1 hover:bg-background"
                  data-testid={`button-remove-media-${i}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/50">
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="w-auto min-w-[11rem] h-8 text-xs" data-testid="select-post-project">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">
                <span className="flex items-center gap-1.5"><PenLine className="h-3.5 w-3.5" /> Just me</span>
              </SelectItem>
              {(myProjects || []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  <span className="flex items-center gap-1.5">
                    {p.isPrivate ? <Lock className="h-3.5 w-3.5" /> : <FolderKanban className="h-3.5 w-3.5" />}
                    {p.title}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={isUploading || mediaUrls.length >= MAX_POST_MEDIA}
            onClick={() => fileRef.current?.click()}
            data-testid="button-add-media"
          >
            {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
            Photo
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadFile(file);
              e.target.value = "";
            }}
          />

          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <AtSign className="h-3 w-3" /> to tag someone
          </span>

          <div className="flex items-center gap-2 ml-auto">
            {content.length > MAX_POST_LENGTH * 0.8 && (
              <span className="text-xs text-muted-foreground">
                {content.length}/{MAX_POST_LENGTH}
              </span>
            )}
            {mentions.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">{mentions.length} tagged</Badge>
            )}
            <Button
              size="sm"
              className="gap-1.5"
              disabled={!content.trim() || publish.isPending}
              onClick={() => publish.mutate()}
              data-testid="button-publish-post"
            >
              {publish.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Post
            </Button>
          </div>
        </div>

        {selectedProject?.isPrivate && (
          <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
            <Lock className="h-3 w-3" />
            {selectedProject.title} is private — only its team will see this post.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
