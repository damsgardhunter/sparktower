import { useEffect, useState } from "react";
import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/user-avatar";
import { useToast } from "@/hooks/use-toast";
import NotFound from "@/pages/not-found";
import {
  Loader2, ArrowRight, AlertTriangle, Copy, Check, Globe, Link2, MessageSquare, CheckCircle2,
} from "lucide-react";
import { weekLabel, shareText, checkInPath } from "@shared/check-in";
import { CheckInComments } from "@/components/check-in-comments";
import { trackLoopEvent, LOOP_EVENTS } from "@/lib/loop-events";
import { ReportButton } from "@/components/report-button";

interface PublicCheckIn {
  id: string;
  projectId: string;
  projectTitle: string;
  projectLogo: string | null;
  author: { name: string; avatarUrl: string | null };
  weekStart: string;
  goal: string;
  proof: string;
  blocker: string | null;
  nextStep: string;
  visibility: "unlisted" | "public";
  needsFeedback: boolean;
  createdAt: string;
  commentCount: number;
  viewerCanModerate: boolean;
}

/** Turns bare links in the proof into real ones, without a markdown parser. */
function Linkify({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/\S+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i} href={part} target="_blank" rel="noopener noreferrer"
            className="text-primary underline break-words"
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/**
 * The public check-in page — the artifact the loop produces.
 *
 * Deliberately readable with no account: this is the address someone sends to
 * a friend, posts in a group chat, or gets asked for feedback through. It
 * loads from the unauthenticated `GET /api/check-ins/:id`, so a logged-out
 * visitor sees exactly what the sharer intended them to see.
 */
export default function CheckInDetail() {
  const [, params] = useRoute("/c/:id");
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const id = params?.id;

  const { data, isLoading, isError } = useQuery<PublicCheckIn>({
    queryKey: ["/api/check-ins", id],
    queryFn: async () => {
      const res = await fetch(`/api/check-ins/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
    enabled: !!id,
    retry: false,
  });

  // The page is a shareable artifact, so it should name itself in the tab.
  useEffect(() => {
    if (!data) return;
    const previous = document.title;
    document.title = `${data.projectTitle} — ${weekLabel(data.weekStart)}`;
    return () => { document.title = previous; };
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (isError || !data) return <NotFound />;

  const url = `${window.location.origin}${checkInPath(data.id)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        shareText({ projectTitle: data.projectTitle, goal: data.goal, nextStep: data.nextStep, url }),
      );
      trackLoopEvent(LOOP_EVENTS.shareInitiated, { projectId: data.projectId, checkInId: data.id });
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Copied", description: "Link and share text are on your clipboard." });
    } catch {
      toast({ title: "Copy failed", description: url, variant: "destructive" });
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-5">
      {/* Project + week, which is the heading the spec asks for. */}
      <div className="flex items-start gap-3">
        {data.projectLogo && (
          <img
            src={data.projectLogo} alt=""
            className="h-12 w-12 rounded-lg object-contain border border-border/60 bg-background p-1 shrink-0"
          />
        )}
        <div className="min-w-0">
          <Link
            href={`/projects/${data.projectId}`}
            className="text-xl font-bold tracking-tight hover:underline break-words"
            data-testid="link-project"
          >
            {data.projectTitle}
          </Link>
          <p className="text-sm text-muted-foreground">{weekLabel(data.weekStart)}</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-6 space-y-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <UserAvatar src={data.author.avatarUrl} name={data.author.name} className="h-8 w-8" />
              <span className="text-sm font-medium">{data.author.name}</span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge variant="outline" className="text-[10px] gap-1">
                {data.visibility === "public"
                  ? <><Globe className="h-2.5 w-2.5" /> Public</>
                  : <><Link2 className="h-2.5 w-2.5" /> Unlisted</>}
              </Badge>
              {/*
                * Step 5 of the loop is "received feedback when >=1 comment",
                * so once someone has replied the ask is answered and the badge
                * changes rather than sitting there still asking.
                */}
              {data.commentCount > 0 ? (
                <Badge className="text-[10px] gap-1 bg-emerald-600 hover:bg-emerald-600">
                  <CheckCircle2 className="h-2.5 w-2.5" /> Got feedback
                </Badge>
              ) : data.needsFeedback ? (
                <Badge className="text-[10px] gap-1">
                  <MessageSquare className="h-2.5 w-2.5" /> Wants feedback
                </Badge>
              ) : null}
            </div>
          </div>

          <section className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              The goal
            </p>
            <p className="text-lg font-semibold leading-snug" data-testid="text-goal">{data.goal}</p>
          </section>

          <section className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              What shipped
            </p>
            <p className="text-sm leading-relaxed whitespace-pre-wrap" data-testid="text-proof">
              <Linkify text={data.proof} />
            </p>
          </section>

          {data.blocker && (
            <section className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                In the way
              </p>
              <p className="text-sm leading-relaxed flex items-start gap-2 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span className="whitespace-pre-wrap">{data.blocker}</span>
              </p>
            </section>
          )}

          <section className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Next
            </p>
            <p className="text-sm leading-relaxed flex items-start gap-2" data-testid="text-next-step">
              <ArrowRight className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
              <span>{data.nextStep}</span>
            </p>
          </section>

          <div className="flex items-center gap-2 pt-2 border-t border-border/50">
            <ReportButton targetType="check_in" targetId={data.id} className="ml-auto order-last" />
            <Button variant="outline" size="sm" className="gap-1.5" onClick={copy} data-testid="button-copy-link">
              {copied
                ? <><Check className="h-3.5 w-3.5 text-emerald-500" /> Copied</>
                : <><Copy className="h-3.5 w-3.5" /> Copy link</>}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <CheckInComments
            projectId={data.projectId}
            checkInId={data.id}
            authorName={data.author.name}
            canModerate={data.viewerCanModerate}
          />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center">
        A weekly check-in on <Link href="/" className="text-primary hover:underline">SparkTower</Link>.
        Goal, proof, blocker, next step.
      </p>
    </div>
  );
}
