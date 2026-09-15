import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import NotFound from "@/pages/not-found";
import { PromotionCard } from "@/components/promotion-card";
import { Loader2, Megaphone, Video, Link2, RefreshCw } from "lucide-react";
import {
  PROMOTION_CATEGORIES, PROMO_HEADLINE_MAX, PROMO_PERK_MAX, parsePromoVideo, type FeedPromotion,
} from "@shared/promotions";

interface Synced { logo: boolean; logoSourceUrl: string | null; channelId: string | null; videoId: string | null; videoTitle: string | null; videoPublishedAt: string | null; fetchedAt: string | null; error: string | null }
interface Row { promotion: FeedPromotion; active: boolean; perk: string | null; youtubeChannelUrl: string | null; updatedAt: string | null; synced: Synced | null }

/**
 * The featured tools in the feed: for each company, the short video, a
 * referral link and its perk, a "what's new" headline, a logo, and whether
 * it's shown — with a preview of the card as the feed will show it. Admins only.
 */
export default function AdminPromotions() {
  const { user, isLoading: authLoading } = useAuth();
  const isAdmin = (user as any)?.platformRole === "admin";
  const { data, isLoading } = useQuery<{ promotions: Row[] }>({ queryKey: ["/api/admin/promotions"], enabled: isAdmin });
  const { toast } = useToast();
  const refreshAll = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/promotions/refresh")).json(),
    onSuccess: (r: { companies: number }) => toast({ title: "Refreshing from their sites", description: `${r.companies} companies — logos and videos update over the next few minutes.` }),
    onError: (e) => toast({ title: "Couldn't start that", description: errorText(e), variant: "destructive" }),
  });
  const [category, setCategory] = useState<string>("all");
  const [selected, setSelected] = useState<string | null>(null);

  const rows = useMemo(() => (data?.promotions ?? []).filter((r) => category === "all" || r.promotion.category === category), [data, category]);
  const current = (data?.promotions ?? []).find((r) => r.promotion.id === selected) ?? rows[0] ?? null;

  if (authLoading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (!isAdmin) return <NotFound />;

  const all = data?.promotions ?? [];
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-4">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[16rem]">
          <h1 className="text-2xl font-bold flex items-center gap-2"><Megaphone className="h-6 w-6 text-primary" />Featured tools</h1>
          <p className="text-sm text-muted-foreground">Shown between posts on the home feed, a different set each visit. Logos and videos are read from each company's own site and YouTube channel every day; anything you set here takes precedence.</p>
        </div>
        <div className="flex gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary">{all.filter((r) => r.active).length} shown</Badge>
          <Badge variant="secondary"><Video className="h-3 w-3 mr-1" />{all.filter((r) => r.promotion.videoUrl).length} with video</Badge>
          <Badge variant="secondary"><Link2 className="h-3 w-3 mr-1" />{all.filter((r) => r.promotion.referralUrl).length} with referral</Badge>
          <Button size="sm" variant="outline" className="h-6 text-xs gap-1" disabled={refreshAll.isPending} onClick={() => refreshAll.mutate()} data-testid="promo-admin-refresh-all">
            <RefreshCw className="h-3 w-3" />Refresh all from their sites
          </Button>
        </div>
      </div>

      <div className="flex gap-1.5 flex-wrap" data-testid="promo-admin-categories">
        {[{ id: "all", label: "All" }, ...PROMOTION_CATEGORIES].map((c) => (
          <Button key={c.id} size="sm" variant={category === c.id ? "default" : "outline"} className="h-7 text-xs" onClick={() => setCategory(c.id)}>{c.label}</Button>
        ))}
      </div>

      {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <Card className="shadow-none"><CardContent className="p-0 max-h-[70vh] overflow-y-auto">
            <ul className="divide-y divide-border/60">
              {rows.map((r) => (
                <li key={r.promotion.id}>
                  <button
                    className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-muted ${current?.promotion.id === r.promotion.id ? "bg-muted font-medium" : ""}`}
                    onClick={() => setSelected(r.promotion.id)}
                    data-testid={`promo-admin-row-${r.promotion.id}`}
                  >
                    <span className="flex-1 truncate">{r.promotion.name}</span>
                    {r.promotion.videoUrl && <Video className="h-3.5 w-3.5 text-primary" />}
                    {r.promotion.referralUrl && <Link2 className="h-3.5 w-3.5 text-primary" />}
                    {!r.active && <Badge variant="outline" className="text-[10px]">Hidden</Badge>}
                  </button>
                </li>
              ))}
            </ul>
          </CardContent></Card>
          {current && <Editor key={current.promotion.id} row={current} />}
        </div>
      )}
    </div>
  );
}

/** The admin's own values — empty where the synced logo, video and headline are in use. */
function editable(row: Row) {
  const own = (merged: string | null, synced: string | null) => (merged && merged !== synced ? merged : "");
  const syncedVideo = row.synced?.videoId ? `https://www.youtube.com/watch?v=${row.synced.videoId}` : null;
  const syncedLogo = row.promotion.logoUrl?.startsWith(`/api/promotions/${row.promotion.id}/logo`) ? row.promotion.logoUrl : null;
  const videoOwn = own(row.promotion.videoUrl, syncedVideo);
  return {
    headline: own(row.promotion.headline, videoOwn ? null : row.synced?.videoTitle ?? null),
    videoUrl: videoOwn,
    referralUrl: row.promotion.referralUrl ?? "",
    logoUrl: own(row.promotion.logoUrl, syncedLogo),
    perk: row.perk ?? "",
    youtubeChannelUrl: row.youtubeChannelUrl ?? "",
    active: row.active,
  };
}

function SyncedFrom({ synced, refreshing, onRefresh }: { synced: Synced | null; refreshing: boolean; onRefresh: () => void }) {
  return (
    <div className="rounded-md border border-border p-2.5 text-xs space-y-1" data-testid="promo-admin-synced">
      <div className="flex items-center gap-2">
        <span className="font-medium flex-1">From their site</span>
        <Button size="sm" variant="outline" className="h-6 text-xs gap-1" disabled={refreshing} onClick={onRefresh} data-testid="promo-admin-refresh">
          {refreshing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}Refresh
        </Button>
      </div>
      {!synced ? <p className="text-muted-foreground">Not read yet — refresh to fetch the logo and a video.</p> : (
        <>
          <p>Logo: {synced.logo ? <span className="text-emerald-700 dark:text-emerald-400">found</span> : "none"}{synced.logoSourceUrl && <span className="text-muted-foreground"> · {synced.logoSourceUrl}</span>}</p>
          <p>Video: {synced.videoId ? <a className="text-primary hover:underline" href={`https://www.youtube.com/watch?v=${synced.videoId}`} target="_blank" rel="noopener noreferrer">{synced.videoTitle}</a> : "none"}</p>
          <p className="text-muted-foreground">Checked {synced.fetchedAt ? new Date(synced.fetchedAt).toLocaleString() : "never"}{synced.error ? ` · ${synced.error}` : ""}</p>
        </>
      )}
    </div>
  );
}

function Editor({ row }: { row: Row }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const p = row.promotion;
  const [form, setForm] = useState({
    ...editable(row),
  });
  useEffect(() => { setForm(editable(row)); }, [row]);
  const refresh = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/admin/promotions/${p.id}/refresh`)).json(),
    onSuccess: (r: { result: { logo: boolean; videoId: string | null; error: string | null } }) => {
      toast({ title: `${p.name} refreshed`, description: [r.result.logo ? "logo found" : "no logo", r.result.videoId ? "video found" : "no video", r.result.error].filter(Boolean).join(" · ") });
      qc.invalidateQueries({ queryKey: ["/api/admin/promotions"] });
      qc.invalidateQueries({ queryKey: ["/api/promotions"] });
    },
    onError: (e) => toast({ title: "Couldn't refresh that", description: errorText(e), variant: "destructive" }),
  });

  const save = useMutation({
    mutationFn: async () => (await apiRequest("PUT", `/api/admin/promotions/${p.id}`, form)).json(),
    onSuccess: () => {
      toast({ title: `${p.name} saved` });
      qc.invalidateQueries({ queryKey: ["/api/admin/promotions"] });
      qc.invalidateQueries({ queryKey: ["/api/promotions"] });
    },
    onError: (e) => toast({ title: "Couldn't save that", description: errorText(e), variant: "destructive" }),
  });

  const videoOk = !form.videoUrl.trim() || !!parsePromoVideo(form.videoUrl);
  // What the feed will show: your values, else what was read from their site.
  const syncedVideo = row.synced?.videoId ? `https://www.youtube.com/watch?v=${row.synced.videoId}` : null;
  const syncedLogo = row.synced?.logo && row.synced.fetchedAt ? `/api/promotions/${p.id}/logo?v=${new Date(row.synced.fetchedAt).getTime()}` : null;
  const preview: FeedPromotion = {
    ...p,
    headline: form.headline.trim() || (form.videoUrl.trim() ? null : row.synced?.videoTitle ?? null),
    videoUrl: videoOk ? form.videoUrl.trim() || syncedVideo : syncedVideo,
    referralUrl: form.referralUrl.trim() || null,
    logoUrl: form.logoUrl.trim() || syncedLogo,
    offer: form.referralUrl.trim() && form.perk.trim() ? form.perk.trim() : null,
  };
  const field = (key: keyof typeof form, label: string, hint: string, props: Record<string, unknown> = {}) => (
    <label className="block text-xs font-medium space-y-1">
      <span>{label}</span>
      <Input value={form[key] as string} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} className="text-sm" data-testid={`promo-admin-${key}`} {...props} />
      <span className="block font-normal text-muted-foreground">{hint}</span>
    </label>
  );

  return (
    <div className="grid gap-4 xl:grid-cols-2 items-start">
      <Card className="shadow-none"><CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <p className="font-semibold flex-1">{p.name}</p>
          <span className="text-xs text-muted-foreground">Shown</span>
          <Switch checked={form.active} onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))} data-testid="promo-admin-active" />
        </div>
        <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">{p.url}</a>
        {field("headline", "What's new", `Replaces the one-line description (${p.tagline}). Up to ${PROMO_HEADLINE_MAX} characters.`, { maxLength: PROMO_HEADLINE_MAX, placeholder: p.tagline })}
        {field("videoUrl", "Video", videoOk ? "A YouTube or Vimeo link, or an https link to an .mp4 or .webm file." : "That isn't a YouTube, Vimeo, .mp4 or .webm link.", { placeholder: "https://www.youtube.com/watch?v=…" })}
        {field("referralUrl", "Referral link", "Where the card links instead of the company's site. Marked as a referral link in the feed.", { placeholder: "https://…" })}
        {field("perk", "Perk", `Shown on the button as "Get …", only with a referral link. Up to ${PROMO_PERK_MAX} characters.`, { maxLength: PROMO_PERK_MAX, placeholder: "$10 in credits" })}
        {field("logoUrl", "Logo", "An https link to the logo image. Leave empty to use the one read from their site.", { placeholder: "https://…/logo.png" })}
        {field("youtubeChannelUrl", "YouTube channel", "Only if their site doesn't link the right one. The newest embeddable video about something new is used.", { placeholder: "https://www.youtube.com/@company" })}
        <SyncedFrom synced={row.synced} refreshing={refresh.isPending} onRefresh={() => refresh.mutate()} />
        <Button disabled={save.isPending || !videoOk} onClick={() => save.mutate()} data-testid="promo-admin-save">
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}Save
        </Button>
      </CardContent></Card>
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Preview</p>
        <PromotionCard promotion={preview} slot={0} />
      </div>
    </div>
  );
}
