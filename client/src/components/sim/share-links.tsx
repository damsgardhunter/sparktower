/**
 * Sending a simulation to somebody, from the author's side.
 *
 * The marketplace had one way to put a listing in front of a person, and it
 * was to publish it to everybody. That is the wrong instrument for the thing
 * this marketplace mostly carries: a market written around one real business
 * names its segments, its regions and the competitors already holding share,
 * so publishing it in order to reach its owner hands a study of their company
 * to their rivals.
 *
 * So this mints a link instead. It works on a draft, it costs the recipient
 * nothing, and it can be taken back — which is most of why it is a link and
 * not simply a public page nobody has found yet.
 *
 * ## What is shown, and what is not
 *
 * The note is the author's own, back to them: "who was this for" is the only
 * question they will have in a fortnight, and whoever opens the link never
 * sees it. `opened` answers the other question — did they actually play it —
 * which before this had no answer anywhere in the product.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, Copy, Link2, Loader2, Send, Undo2 } from "lucide-react";

interface Share {
  id: string;
  token: string;
  url: string;
  note: string | null;
  uses: number;
  usesSpent: number;
  usesLeft: number;
  expiresAt: string | null;
  revokedAt: string | null;
  state: "open" | "revoked" | "expired" | "spent";
  createdAt: string;
  opened: { name: string | null; at: string }[];
}

interface Shares {
  shares: Share[];
  rules: { usesMax: number; daysMax: number };
}

/** The browser knows where it is; nothing else reliably does. */
const absolute = (path: string) =>
  typeof window === "undefined" ? path : `${window.location.origin}${path}`;

const STATE_LABEL: Record<Share["state"], string> = {
  open: "Live",
  revoked: "Taken back",
  expired: "Expired",
  spent: "All used",
};

const when = (v: string | null) => (v ? new Date(v).toLocaleDateString() : null);

export function ShareLinks({ listingId }: { listingId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [uses, setUses] = useState(1);
  const [copied, setCopied] = useState<string | null>(null);

  const key = [`/api/sim-market/listings/${listingId}/shares`];
  const { data, isLoading } = useQuery<Shares>({ queryKey: key });

  const mint = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/sim-market/listings/${listingId}/shares`, {
        note: note.trim() || undefined,
        uses,
      });
      return res.json();
    },
    onSuccess: async (body: { share: Share }) => {
      setNote("");
      setUses(1);
      await queryClient.invalidateQueries({ queryKey: key });
      /*
       * Copied for them. The next thing they are going to do is paste it
       * somewhere, and a link you have to go and find is a link that gets sent
       * as a screenshot.
       */
      await copy(body.share.url, body.share.id);
      toast({ title: "Link ready", description: "Copied — paste it wherever you're sending it." });
    },
    onError: (e: any) => toast({ title: "Couldn't make a link", description: errorText(e), variant: "destructive" }),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/sim-market/shares/${id}/revoke`, {}),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
      toast({ title: "Taken back", description: "That link won't open for anybody now." });
    },
    onError: (e: any) => toast({ title: "Couldn't take it back", description: errorText(e), variant: "destructive" }),
  });

  async function copy(path: string, id: string) {
    try {
      await navigator.clipboard.writeText(absolute(path));
      setCopied(id);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      toast({ title: "Couldn't copy", description: "Select the link and copy it by hand.", variant: "destructive" });
    }
  }

  const shares = data?.shares ?? [];
  const usesMax = data?.rules.usesMax ?? 20;

  return (
    <Card className="nova-ring-soft border-0">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center gap-2">
          <Send className="h-4 w-4 shrink-0 text-primary" />
          <h2 className="font-semibold">Send it to someone</h2>
        </div>
        <p className="text-xs text-tertiary">
          A link that opens this simulation for whoever you send it to — free for them, and it
          works even while this listing is a draft. You can take it back at any time.
        </p>

        <form
          className="space-y-3"
          onSubmit={(e) => { e.preventDefault(); mint.mutate(); }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="share-note">Who's it for?</Label>
            <Input
              id="share-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Fareway Fools"
              maxLength={120}
              data-testid="input-share-note"
            />
            <p className="text-xs text-tertiary">Just for you — whoever opens the link never sees this.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="share-uses">How many times can it be used?</Label>
            <Input
              id="share-uses"
              type="number"
              min={1}
              max={usesMax}
              value={uses}
              onChange={(e) => setUses(Math.max(1, Math.min(usesMax, Number(e.target.value) || 1)))}
              data-testid="input-share-uses"
            />
            <p className="text-xs text-tertiary">
              One each is usually right. Each use starts one season.
            </p>
          </div>
          <Button type="submit" className="w-full" disabled={mint.isPending} data-testid="button-mint-share">
            {mint.isPending
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Making a link</>
              : <><Link2 className="mr-2 h-4 w-4" /> Make a link</>}
          </Button>
        </form>

        {isLoading ? (
          <Skeleton className="h-16 rounded-lg" />
        ) : shares.length === 0 ? null : (
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-xs font-medium text-secondary">
              {shares.length === 1 ? "One link" : `${shares.length} links`}
            </p>
            {shares.map((share) => (
              <div
                key={share.id}
                className="space-y-2 rounded-lg border border-border p-3"
                data-testid={`share-${share.id}`}
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {share.note || "No note"}
                  </span>
                  <Badge variant={share.state === "open" ? "default" : "secondary"}>
                    {STATE_LABEL[share.state]}
                  </Badge>
                </div>

                <p className="text-xs text-tertiary">
                  {share.usesLeft} of {share.uses} left
                  {share.expiresAt ? ` · expires ${when(share.expiresAt)}` : ""}
                </p>

                {share.opened.length > 0 && (
                  <p className="text-xs text-secondary" data-testid={`share-opened-${share.id}`}>
                    Played by {share.opened.map((o) => o.name?.trim() || "someone").join(", ")}
                  </p>
                )}

                {share.state === "open" && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => copy(share.url, share.id)}
                      data-testid={`button-copy-share-${share.id}`}
                    >
                      {copied === share.id
                        ? <><Check className="mr-1.5 h-3.5 w-3.5" /> Copied</>
                        : <><Copy className="mr-1.5 h-3.5 w-3.5" /> Copy link</>}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => revoke.mutate(share.id)}
                      disabled={revoke.isPending}
                      data-testid={`button-revoke-share-${share.id}`}
                    >
                      <Undo2 className="mr-1.5 h-3.5 w-3.5" /> Take back
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
