import { useState } from "react";
import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/user-avatar";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import NotFound from "@/pages/not-found";
import { ReportButton } from "@/components/report-button";
import { ArrowRight, Check, Compass, Copy, FileCode2, Loader2, MessageSquare } from "lucide-react";
import { PENDING_PATH_KEY, afterOnboardingPath, artifactPath, type PendingPath } from "@shared/path-artifacts";

interface PublicArtifact {
  id: string;
  title: string;
  summary: string;
  body: string;
  files: { path: string; purpose?: string }[];
  tags: string[];
  publishedAt: string | null;
  views: number;
  postId: string | null;
  project: { id: string; title: string; oneLiner: string | null; logoUrl: string | null };
  path: { goal: string; goalLabel: string; subcategory: string | null; progress: { done: number; total: number } | null; next: string | null };
  author: { id: string; name: string; avatarUrl: string | null };
}

/**
 * A published path artifact — the growth loop's front door.
 *
 * Readable with no account: it's the link a builder shares, and the page a
 * search result lands on. It shows what one step on a real project produced,
 * where that project is on its path, and one clear way in: start your own
 * path on the same goal. That choice waits through sign up and onboarding
 * (PENDING_PATH_KEY) and project create opens on it; the signup is credited
 * to this artifact server-side (first landing page, or the artifact carried
 * through sign up). "Explore this project and its path" does the same, but
 * lands the new account on the project first.
 */
export default function PublicArtifactPage() {
  const [, params] = useRoute("/a/:id");
  const id = params?.id;
  const { user } = useAuth();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const { data, isLoading, isError } = useQuery<PublicArtifact>({
    queryKey: ["/api/public/artifacts", id],
    queryFn: async () => {
      const res = await fetch(`/api/public/artifacts/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
    enabled: !!id,
    retry: false,
    staleTime: Infinity,
  });

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }
  if (isError || !data) return <NotFound />;

  const go = (intent: "start" | "explore") => {
    const pending: PendingPath = { goal: data.path.goal, fromArtifact: data.id, intent, projectId: data.project.id };
    try { localStorage.setItem(PENDING_PATH_KEY, JSON.stringify(pending)); } catch { /* the choice just isn't remembered */ }
    // A full load: the app decides between sign up, onboarding and create from a fresh start.
    window.location.href = user ? afterOnboardingPath(pending) : `/?signup=1&artifact=${encodeURIComponent(data.id)}`;
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${artifactPath(data.id)}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: "Couldn't copy the link", variant: "destructive" });
    }
  };
  const progress = data.path.progress;

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <header className="flex items-center justify-between gap-2">
          <a href="/" className="font-bold text-xs tracking-widest uppercase">SparkTower</a>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={copy} data-testid="button-copy-artifact-link">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? "Copied" : "Copy link"}
            </Button>
            {/*
              * A way to report the page, with or without an account. This is
              * the one page built for people who have never signed in, and it
              * had no control at all: the only answer to something abusive on
              * it was to close the tab. What it reports is the artifact's
              * published post, which is what the moderation queue already
              * knows how to take down — and taking the post down takes this
              * page with it.
              */}
            {data.postId && (
              <ReportButton
                targetType="feed_post"
                targetId={data.postId}
                anonymousArtifactId={data.id}
                variant="action"
              />
            )}
          </div>
        </header>

        <article className="space-y-3" data-testid="public-artifact">
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Compass className="h-3.5 w-3.5 text-primary" />A step on the path to <span className="font-medium">{data.path.goalLabel}</span>
          </p>
          <h1 className="text-2xl font-bold leading-tight" data-testid="text-artifact-title">{data.title}</h1>
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            <UserAvatar src={data.author.avatarUrl} name={data.author.name} className="h-5 w-5" />
            <span>{data.author.name}</span>
            {data.publishedAt && <><span>·</span><span>{new Date(data.publishedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span></>}
          </div>
          {data.tags.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">{data.tags.map((t) => <Badge key={t} variant="secondary" className="text-[11px]">#{t}</Badge>)}</div>
          )}
          <div className="whitespace-pre-wrap text-sm leading-relaxed" data-testid="text-artifact-body">{data.body}</div>
          {data.files.length > 0 && (
            <div className="rounded-md border border-border p-3 space-y-1">
              <p className="text-xs font-medium">What was built</p>
              <ul className="space-y-0.5 text-xs">
                {data.files.map((f) => (
                  <li key={f.path} className="flex gap-1.5"><FileCode2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><code>{f.path}</code>{f.purpose && <span className="text-muted-foreground">— {f.purpose}</span>}</li>
                ))}
              </ul>
            </div>
          )}
        </article>

        {/* The backlink: the project and where it is on its path. */}
        <Card data-testid="artifact-project">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-3">
              {data.project.logoUrl
                ? <img src={data.project.logoUrl} alt="" className="h-10 w-10 rounded-md object-contain" />
                : <div className="h-10 w-10 rounded-md bg-primary/10" />}
              <div className="min-w-0">
                <p className="font-semibold truncate">{data.project.title}</p>
                {data.project.oneLiner && <p className="text-xs text-muted-foreground line-clamp-2">{data.project.oneLiner}</p>}
              </div>
            </div>
            {progress && (
              <div className="space-y-1">
                <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} /></div>
                <p className="text-xs text-muted-foreground">{progress.done} of {progress.total} milestones{data.path.next ? ` · next: ${data.path.next}` : ""}</p>
              </div>
            )}
            <div className="flex gap-3 text-xs pt-1 flex-wrap items-center">
              <button className="text-primary hover:underline" onClick={() => go("explore")} data-testid="button-explore-project-path">Explore this project and its path</button>
              {user && data.postId && <Link href={`/posts/${data.postId}`} className="text-primary hover:underline inline-flex items-center gap-1" data-testid="link-artifact-discussion"><MessageSquare className="h-3 w-3" />See the discussion</Link>}
            </div>
          </CardContent>
        </Card>

        {/* The way in. */}
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="p-4 space-y-2">
            <p className="font-semibold">Start your own path to {data.path.goalLabel.toLowerCase()}</p>
            <p className="text-sm text-muted-foreground">
              SparkTower breaks the goal into steps, Nova helps with each one, and what you finish becomes something you can publish — like this.
            </p>
            <Button className="gap-1.5" onClick={() => go("start")} data-testid="button-start-own-path">
              {user ? "Start a project on this path" : "Sign up and start your path"}<ArrowRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
