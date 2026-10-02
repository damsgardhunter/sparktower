/**
 * Who backed this project, and what the team still owes them.
 *
 * Most of what a tier promises is the platform's job and is true the moment the
 * pledge lands — the name on the wall, the believer number, the badge, the
 * certificate. Two are not: early access and a personal video thank-you are marked
 * `fulfilledBy: "creator"` in shared/backing.ts, which means a person has to go and
 * do something.
 *
 * Nothing used to record whether they had. The owner's list in Settings showed what
 * each backer was *owed* and never what was *done*, so running a campaign properly
 * meant keeping a spreadsheet beside it — and the backer who paid for a video had
 * no way to know whether it was coming.
 *
 * ## Why the outstanding work is first
 *
 * The question this page answers is "what do I have to do today", not "who are my
 * backers". A list sorted by who paid most, or most recently, buries the one person
 * still waiting three weeks later behind thirty people who are owed nothing — so
 * the people with something outstanding come first, and the rest are a roll call
 * underneath.
 *
 * ## What is deliberately not here
 *
 * Email addresses and postal addresses. This page is open to the whole team, and
 * nobody needs to read an address by hand because Printful is handed it directly.
 * The owner's own list in Settings still has them, behind an owner-only route. What
 * this page says about shipping is whether an address is on file at all, which is
 * the one thing somebody might have to chase.
 */
import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useUpload } from "@/hooks/use-upload";
import {
  Users, Video, DoorOpen, Package, Check, Undo2, Loader2, Truck, AlertTriangle, MapPinOff, ExternalLink,
} from "lucide-react";

interface Task {
  rewardKey: string;
  label: string;
  done: boolean;
  deliveredAt: string | null;
  deliveredByName: string | null;
  note: string | null;
  hasVideo: boolean;
}

interface MerchOrder {
  id: string;
  status: "queued" | "submitted" | "shipped" | "failed" | "canceled";
  items: string[];
  trackingUrl: string | null;
  submittedAt: string | null;
  lastError: string | null;
}

interface Backer {
  backingId: string;
  believerNumber: number | null;
  name: string;
  anonymousOnWall: boolean;
  avatarUrl: string | null;
  amountCents: number;
  tierName: string | null;
  backedAt: string;
  message: string | null;
  tasks: Task[];
  merchPromised: string[];
  merchOrders: MerchOrder[];
  hasShippingAddress: boolean;
}

interface Fulfilment {
  rewards: { key: string; label: string; description: string }[];
  backers: Backer[];
  owed: number;
  done: number;
  merchInFlight: number;
}

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

const REWARD_ICON: Record<string, typeof Video> = { video_thankyou: Video, early_access: DoorOpen };

/** How a merch order reads, and whether it is somebody's problem. */
const MERCH: Record<MerchOrder["status"], { label: string; tone: "neutral" | "wait" | "good" | "bad" }> = {
  queued: { label: "Waiting to go out", tone: "wait" },
  submitted: { label: "With the printer", tone: "wait" },
  shipped: { label: "Shipped", tone: "good" },
  failed: { label: "Failed", tone: "bad" },
  canceled: { label: "Canceled", tone: "neutral" },
};

export function BackersTab({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<Fulfilment>({
    queryKey: [`/api/projects/${projectId}/backing/fulfilment`],
  });

  /* The video being attached, if any: one dialog for whichever backer was picked. */
  const [recording, setRecording] = useState<{ backer: Backer; task: Task } | null>(null);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/backing/fulfilment`] });

  const mark = useMutation({
    mutationFn: async (body: { backingId: string; rewardKey: string; assetPath?: string; note?: string }) =>
      (await apiRequest("POST", `/api/projects/${projectId}/backing/fulfilment`, body)).json(),
    onSuccess: () => {
      refresh();
      setRecording(null);
      /* Said plainly, because the backer is told too and the person doing it should know that. */
      toast({ title: "Marked done", description: "The backer has been told." });
    },
    onError: (err: any) => toast({
      title: "Couldn't record that",
      description: serverMessage(err),
      variant: "destructive",
    }),
  });

  const undo = useMutation({
    mutationFn: async (body: { backingId: string; rewardKey: string }) =>
      (await apiRequest("DELETE", `/api/projects/${projectId}/backing/fulfilment/${body.backingId}/${body.rewardKey}`)).json(),
    onSuccess: () => { refresh(); toast({ title: "Put back on the list" }); },
    onError: (err: any) => toast({ title: "Couldn't undo that", description: serverMessage(err), variant: "destructive" }),
  });

  if (isLoading) {
    return <div className="py-16 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  if (!data?.backers.length) {
    return (
      <Card data-testid="backers-empty">
        <CardContent className="py-12 text-center space-y-2">
          <Users className="h-8 w-8 mx-auto text-muted-foreground/40" />
          <p className="font-medium">Nobody has backed this project yet</p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            When they do, this is where you'll see what each tier promised them and tick it off as you
            do it. Set the tiers up in Settings.
          </p>
        </CardContent>
      </Card>
    );
  }

  /*
   * Outstanding first. The question is "what do I have to do", so the person still
   * waiting comes before thirty people who are owed nothing.
   */
  const outstanding = data.backers.filter((b) => b.tasks.some((t) => !t.done) || b.merchOrders.some((o) => o.status === "failed"));
  const settled = data.backers.filter((b) => !outstanding.includes(b));

  return (
    <div className="space-y-4" data-testid="backers-tab">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Backers" value={data.backers.length} />
        <Stat label="Still to do" value={data.owed} tone={data.owed ? "wait" : "good"} testId="stat-owed" />
        <Stat label="Done" value={data.done} tone="good" />
        <Stat label="Merch on its way" value={data.merchInFlight} tone={data.merchInFlight ? "wait" : "neutral"} />
      </div>

      {data.owed === 0 && data.backers.length > 0 && (
        <p className="text-sm text-muted-foreground" data-testid="text-all-done">
          Nothing outstanding. Everything your tiers promise that a person has to do has been done.
        </p>
      )}

      {outstanding.length > 0 && (
        <section className="space-y-3" aria-labelledby="outstanding-heading">
          <h3 id="outstanding-heading" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Still to do
          </h3>
          {outstanding.map((b) => (
            <BackerCard
              key={b.backingId}
              backer={b}
              onMark={(task) => (task.rewardKey === "video_thankyou"
                ? setRecording({ backer: b, task })
                : mark.mutate({ backingId: b.backingId, rewardKey: task.rewardKey }))}
              onUndo={(task) => undo.mutate({ backingId: b.backingId, rewardKey: task.rewardKey })}
              busy={mark.isPending || undo.isPending}
              projectId={projectId}
            />
          ))}
        </section>
      )}

      {settled.length > 0 && (
        <section className="space-y-3" aria-labelledby="settled-heading">
          <h3 id="settled-heading" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Everyone else
          </h3>
          {settled.map((b) => (
            <BackerCard
              key={b.backingId}
              backer={b}
              onMark={(task) => (task.rewardKey === "video_thankyou"
                ? setRecording({ backer: b, task })
                : mark.mutate({ backingId: b.backingId, rewardKey: task.rewardKey }))}
              onUndo={(task) => undo.mutate({ backingId: b.backingId, rewardKey: task.rewardKey })}
              busy={mark.isPending || undo.isPending}
              projectId={projectId}
            />
          ))}
        </section>
      )}

      <VideoDialog
        open={recording}
        onClose={() => setRecording(null)}
        busy={mark.isPending}
        onSend={(assetPath, note) => recording && mark.mutate({
          backingId: recording.backer.backingId,
          rewardKey: recording.task.rewardKey,
          assetPath, note,
        })}
      />
    </div>
  );
}

function Stat({ label, value, tone = "neutral", testId }: {
  label: string; value: number; tone?: "neutral" | "wait" | "good"; testId?: string;
}) {
  const colour = tone === "wait" ? "text-amber-600 dark:text-amber-400" : tone === "good" ? "text-emerald-600 dark:text-emerald-400" : "";
  return (
    <div className="rounded-lg border p-3" data-testid={testId}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${colour}`}>{value}</p>
    </div>
  );
}

function BackerCard({ backer, onMark, onUndo, busy, projectId }: {
  backer: Backer;
  onMark: (task: Task) => void;
  onUndo: (task: Task) => void;
  busy: boolean;
  projectId: string;
}) {
  return (
    <Card data-testid={`backer-${backer.backingId}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-sm flex items-center gap-2">
              {backer.name}
              {backer.believerNumber != null && (
                <span className="text-xs font-normal text-muted-foreground tabular-nums">#{backer.believerNumber}</span>
              )}
              {/*
                * Said, not hidden. They are anonymous on the public wall, and the
                * person recording them a video still has to know who it is for.
                */}
              {backer.anonymousOnWall && (
                <Badge variant="outline" className="text-[10px]">anonymous publicly</Badge>
              )}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {money(backer.amountCents)}{backer.tierName ? ` · ${backer.tierName}` : ""} · backed {when(backer.backedAt)}
            </p>
          </div>
        </div>
        {backer.message && (
          <p className="text-xs text-muted-foreground italic border-l-2 pl-2 mt-1">“{backer.message}”</p>
        )}
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {backer.tasks.length === 0 && backer.merchPromised.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Their tier promises nothing you have to do by hand.
          </p>
        )}

        {backer.tasks.map((task) => {
          const Icon = REWARD_ICON[task.rewardKey] ?? Check;
          return (
            <div key={task.rewardKey} className="flex items-start justify-between gap-3" data-testid={`task-${backer.backingId}-${task.rewardKey}`}>
              <div className="flex items-start gap-2 min-w-0">
                <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${task.done ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`} />
                <div className="min-w-0">
                  <p className="text-sm">{task.label}</p>
                  {task.done ? (
                    <p className="text-xs text-muted-foreground">
                      Done {when(task.deliveredAt)}{task.deliveredByName ? ` by ${task.deliveredByName}` : ""}
                      {task.note ? ` · “${task.note}”` : ""}
                    </p>
                  ) : (
                    <p className="text-xs text-amber-600 dark:text-amber-400">Still owed</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {task.done && task.hasVideo && (
                  <Button asChild size="sm" variant="ghost" className="text-xs">
                    <a
                      href={`/api/projects/${projectId}/backing/fulfilment/${backer.backingId}/${task.rewardKey}/video`}
                      target="_blank"
                      rel="noreferrer"
                      data-testid={`watch-${backer.backingId}`}
                    >
                      Watch
                    </a>
                  </Button>
                )}
                {task.done ? (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => onUndo(task)} data-testid={`undo-${backer.backingId}-${task.rewardKey}`}>
                    <Undo2 className="h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => onMark(task)} data-testid={`do-${backer.backingId}-${task.rewardKey}`}>
                    {task.rewardKey === "video_thankyou" ? "Send a video" : "Mark done"}
                  </Button>
                )}
              </div>
            </div>
          );
        })}

        {(backer.merchPromised.length > 0 || backer.merchOrders.length > 0) && (
          <div className="rounded-md bg-muted/40 p-2.5 space-y-1.5" data-testid={`merch-${backer.backingId}`}>
            <p className="text-xs font-medium flex items-center gap-1.5">
              <Package className="h-3.5 w-3.5" />
              {backer.merchPromised.join(", ") || "Merch"}
            </p>
            {backer.merchOrders.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {/*
                  * An order is made after the project clears review once. Said here
                  * because "nothing yet" otherwise reads as something being broken.
                  */}
                No order yet — one is created once the project has been approved.
              </p>
            ) : backer.merchOrders.map((order) => (
              <div key={order.id} className="text-xs flex flex-wrap items-center gap-x-2 gap-y-1">
                <Badge
                  variant={MERCH[order.status].tone === "bad" ? "destructive" : "secondary"}
                  className="text-[10px]"
                >
                  {MERCH[order.status].tone === "good" ? <Truck className="h-3 w-3 mr-1" /> : null}
                  {MERCH[order.status].label}
                </Badge>
                {order.items.length > 0 && <span className="text-muted-foreground">{order.items.join(", ")}</span>}
                {order.submittedAt && <span className="text-muted-foreground">sent {when(order.submittedAt)}</span>}
                {order.trackingUrl && (
                  <a href={order.trackingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline" data-testid={`tracking-${order.id}`}>
                    Track it <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {order.lastError && (
                  <span className="inline-flex items-center gap-1 text-destructive">
                    <AlertTriangle className="h-3 w-3" />{order.lastError}
                  </span>
                )}
              </div>
            ))}
            {/*
              * The one shipping problem a person has to chase. The address itself is
              * not on this page — the printer is handed it directly, and this list is
              * open to the whole team.
              */}
            {!backer.hasShippingAddress && (
              <p className="text-xs text-destructive inline-flex items-center gap-1" data-testid={`no-address-${backer.backingId}`}>
                <MapPinOff className="h-3 w-3" /> No address on file — ask them for one.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Attaching the video.
 *
 * An upload rather than a recorder: the camera API in a browser is a different
 * feature with its own permissions and failure modes, and somebody recording a
 * thank-you will do it on their phone and have a file. The note goes with it
 * because "here is a video" alone is a strange thing to receive.
 */
function VideoDialog({ open, onClose, onSend, busy }: {
  open: { backer: Backer; task: Task } | null;
  onClose: () => void;
  onSend: (assetPath: string | undefined, note: string | undefined) => void;
  busy: boolean;
}) {
  const { uploadFile, isUploading } = useUpload();
  const inputRef = useRef<HTMLInputElement>(null);
  const [assetPath, setAssetPath] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const { toast } = useToast();

  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      const uploaded = await uploadFile(file);
      /*
       * `objectPath`, not the presigned `uploadURL`. The URL is a one-time ticket
       * to write the bytes and is useless afterwards; the path is what the server
       * stores and serves from.
       */
      if (!uploaded?.objectPath) throw new Error("no path");
      setAssetPath(uploaded.objectPath);
      setFileName(file.name);
    } catch {
      toast({ title: "Upload failed", description: "Try again.", variant: "destructive" });
    }
  };

  return (
    <Dialog open={!!open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send {open?.backer.name} their video</DialogTitle>
          <DialogDescription>
            They'll be told as soon as you do, and can watch it from the project's page.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>The video</Label>
            <input
              ref={inputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => void pick(e.target.files?.[0])}
              data-testid="input-video-file"
            />
            <Button variant="outline" className="w-full" disabled={isUploading} onClick={() => inputRef.current?.click()} data-testid="button-pick-video">
              {isUploading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Video className="h-4 w-4 mr-2" />}
              {fileName ?? "Choose a video"}
            </Button>
            <p className="text-xs text-muted-foreground">
              {/*
                * Marking it done without a file is allowed on purpose: plenty of
                * people will send the video another way and want the list to be true.
                */}
              Record it on your phone and upload it here. You can also mark this done
              without a file if you sent it some other way.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="video-note">A line to go with it (optional)</Label>
            <Textarea
              id="video-note"
              rows={3}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Thanks for being one of the first."
              data-testid="input-video-note"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={busy || isUploading}
            onClick={() => onSend(assetPath ?? undefined, note.trim() || undefined)}
            data-testid="button-send-video"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : assetPath ? "Send it" : "Mark done"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The server's own sentence out of a thrown `apiRequest` error. */
function serverMessage(err: unknown, fallback = "Try again in a moment."): string {
  const raw = String((err as any)?.message ?? "");
  const start = raw.indexOf("{");
  if (start < 0) return fallback;
  try { return JSON.parse(raw.slice(start)).message || fallback; } catch { return fallback; }
}
