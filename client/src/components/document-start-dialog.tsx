import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useEntitlements } from "@/hooks/use-entitlements";
import { Loader2, FileText, Sparkles, Lock } from "lucide-react";
import { CREDIT_COSTS } from "@shared/plans";
import type { ProjectDocument } from "@shared/schema";

/**
 * Whether a task's deliverable is plainly a document.
 *
 * This gates a button on every task card, so it has to be tight: matching on
 * bare verbs like "write" or "plan" tagged most of the board and turned the
 * offer into noise. It requires a document *noun* — the thing that would exist
 * when the task is done. Nova's own suggestion (from the task planner) is the
 * smarter path and catches whatever this misses.
 */
const DOCUMENT_NOUNS = [
  "spec", "one-pager", "one pager", "1-pager", "onepager",
  "doc", "document", "brief", "memo", "report", "proposal", "whitepaper",
  "business plan", "marketing plan", "launch plan", "test plan", "pitch deck",
  "deck", "outline", "policy", "charter", "playbook", "runbook", "readme",
  "case study", "press release", "faq", "terms of service", "privacy policy",
  "job description", "postmortem", "retro", "agenda", "meeting notes",
];

/** Only counts when paired with a noun; "write the API" is not a document. */
const DOCUMENT_VERBS = ["write", "draft", "author", "document"];

export function looksLikeDocumentTask(title?: string | null, description?: string | null): boolean {
  const haystack = `${title || ""} ${description || ""}`.toLowerCase();
  if (!haystack.trim()) return false;

  // Word-boundary matching, so "deck" doesn't fire on "decked" and — more to
  // the point — "doc" doesn't fire on "docker".
  const hasWord = (phrase: string) =>
    new RegExp(`(^|[^a-z0-9])${phrase.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}(s|es)?([^a-z0-9]|$)`).test(haystack);

  const noun = DOCUMENT_NOUNS.some(hasWord);
  if (noun) return true;

  // "Write up the loop steps" — a verb plus something written-sounding.
  return DOCUMENT_VERBS.some(hasWord) && /\b(page|section|chapter|copy|content|summary|plan)\b/.test(haystack);
}

/**
 * Kicks off a document: collects the ask, has Nova plan the structure, then
 * hands off to the builder.
 */
export function DocumentStartDialog({
  projectId, open, onOpenChange, initialTitle = "", initialDescription = "", sourceTaskId,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTitle?: string;
  initialDescription?: string;
  sourceTaskId?: string;
}) {
  const { toast } = useToast();
  const { can } = useEntitlements();
  const [, setLocation] = useLocation();
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [pageHint, setPageHint] = useState("");

  // Re-seed when reopened from a different task.
  const [seededFor, setSeededFor] = useState(initialTitle);
  if (open && seededFor !== initialTitle) {
    setSeededFor(initialTitle);
    setTitle(initialTitle);
    setDescription(initialDescription);
  }

  const isBuilder = can("aiMilestones");

  const planMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/documents/plan`, {
        title, description,
        sourceTaskId,
        pageHint: pageHint ? Number(pageHint) : undefined,
      });
      return res.json() as Promise<{ document: ProjectDocument; approach: string }>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
      onOpenChange(false);
      setLocation(`/projects/${projectId}/documents/${result.document.id}`);
    },
    onError: (err: any) => {
      const raw = err?.message || "";
      const jsonStart = raw.indexOf("{");
      let message = "Nova couldn't plan that document.";
      let upgrade = false;
      if (jsonStart >= 0) {
        try {
          const body = JSON.parse(raw.slice(jsonStart));
          message = body.message || message;
          upgrade = body.code === "upgrade_required";
        } catch { /* keep */ }
      }
      toast({
        title: upgrade ? "Builder plan needed" : "Couldn't start the document",
        description: message,
        variant: upgrade ? "default" : "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" /> Build this document with Nova
          </DialogTitle>
          <DialogDescription>
            Nova works out how many pages it needs, lays out a grid, and writes a headline for
            every block. You approve the shape before anything gets written.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {!isBuilder && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
              <Lock className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
              <div className="text-sm">
                <p className="font-medium">The document builder is on the Builder plan</p>
                <p className="text-muted-foreground text-xs">Have a look around — starting one will tell you what to upgrade to.</p>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">What's the document? *</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Write the 1-page weekly check-in loop spec"
              data-testid="input-doc-start-title"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">What has to be in it?</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="The more specific the better — exact sections, what's explicitly out of scope, what you'll measure against."
              className="min-h-[110px]"
              data-testid="textarea-doc-start-description"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Roughly how many pages? (optional)</Label>
            <Input
              type="number" min={1} max={40}
              value={pageHint}
              onChange={(e) => setPageHint(e.target.value)}
              placeholder="Leave blank and Nova decides"
              className="w-48"
              data-testid="input-doc-start-pages"
            />
            <p className="text-[10px] text-muted-foreground">
              Nova won't pad a one-pager, and it'll build out a chaptered plan with a title page
              when the work actually calls for one.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            className="gap-2"
            disabled={!title.trim() || planMutation.isPending}
            onClick={() => planMutation.mutate()}
            data-testid="button-plan-document"
          >
            {planMutation.isPending
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Nova is planning…</>
              : <><Sparkles className="h-4 w-4" /> Plan it ({CREDIT_COSTS.documentPlan})</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
