import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Users, Crown, Sparkles, Shirt, Download, EyeOff, Video } from "lucide-react";
import { formatBelieverNumber, badgeLevel } from "@shared/backing";
import type { ShippingAddress } from "@shared/schema";

interface BackerRecord {
  id: string;
  believerNumber: number | null;
  name: string;
  email: string | null;
  anonymousOnWall: boolean;
  amountCents: number;
  tipCents: number;
  tierName: string | null;
  status: string;
  message: string | null;
  createdAt: string;
  entitlements: {
    earlyAccess: boolean;
    foundingBeliever: boolean;
    wallpaper: boolean;
    certificate: boolean;
    profileFrame: boolean;
    videoThankYou: boolean;
    badge: boolean;
  };
  badge: { level: string; status: string } | null;
  merch: { products: string[] | null; status: string | null; trackingUrl: string | null } | null;
  shippingAddress: ShippingAddress | null;
}

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Who backed you and what you owe them.
 *
 * This is the creator's working list, not the public wall — so it names people
 * who chose to be anonymous publicly, marked as such. Anonymity governs the
 * public listing, not whether the person you took money from is someone you
 * can post a shirt to, and conflating the two either breaks fulfillment or
 * breaks the promise.
 */
export function BackerRecords({ projectId }: { projectId: string }) {
  const { data } = useQuery<BackerRecord[]>({
    queryKey: ["/api/projects", projectId, "backing", "backers"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/backing/backers`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    enabled: !!projectId,
    retry: false,
  });

  if (!data?.length) return null;

  const owed = {
    earlyAccess: data.filter((b) => b.entitlements.earlyAccess).length,
    founding: data.filter((b) => b.entitlements.foundingBeliever).length,
    video: data.filter((b) => b.entitlements.videoThankYou).length,
    shipping: data.filter((b) => b.merch).length,
  };

  const exportCsv = () => {
    const header = [
      "believer_number", "name", "email", "anonymous_on_wall", "amount", "tip", "tier",
      "status", "early_access", "founding_believer", "wallpaper", "certificate",
      "video_thank_you", "merch", "merch_status", "address", "message",
    ];
    const rows = data.map((b) => [
      b.believerNumber ?? "", b.name, b.email ?? "", b.anonymousOnWall ? "yes" : "no",
      (b.amountCents / 100).toFixed(2), (b.tipCents / 100).toFixed(2), b.tierName ?? "",
      b.status,
      b.entitlements.earlyAccess ? "yes" : "", b.entitlements.foundingBeliever ? "yes" : "",
      b.entitlements.wallpaper ? "yes" : "", b.entitlements.certificate ? "yes" : "",
      b.entitlements.videoThankYou ? "yes" : "",
      (b.merch?.products || []).join(" + "), b.merch?.status ?? "",
      b.shippingAddress
        ? [b.shippingAddress.name, b.shippingAddress.line1, b.shippingAddress.line2,
           b.shippingAddress.city, b.shippingAddress.state, b.shippingAddress.postalCode,
           b.shippingAddress.country].filter(Boolean).join(", ")
        : "",
      b.message ?? "",
    ]);
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `backers-${projectId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" /> Your backers
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Everyone who's put money in, and what each of them is owed.
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={exportCsv} data-testid="button-export-backers">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* The obligations, counted — the numbers a creator actually plans around. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: "Backers", value: data.length, icon: Users },
            { label: "To ship", value: owed.shipping, icon: Shirt },
            { label: "Videos owed", value: owed.video, icon: Video },
            { label: "Founding", value: owed.founding, icon: Crown },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="rounded-lg border border-border/60 p-2.5">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Icon className="h-3 w-3" /> {label}
              </p>
              <p className="text-lg font-semibold">{value}</p>
            </div>
          ))}
        </div>

        <div className="space-y-1.5 max-h-[26rem] overflow-y-auto">
          {data.map((b) => {
            const level = b.badge ? badgeLevel(b.badge.level) : null;
            return (
              <div
                key={b.id}
                className="rounded-lg border border-border/60 p-2.5 space-y-1"
                data-testid={`backer-${b.id}`}
              >
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-medium flex items-center gap-1.5 flex-wrap">
                      {b.believerNumber != null && (
                        <span className="font-mono text-xs text-muted-foreground">
                          {formatBelieverNumber(b.believerNumber)}
                        </span>
                      )}
                      {b.name}
                      {b.anonymousOnWall && (
                        <Badge variant="secondary" className="text-[9px] gap-1">
                          <EyeOff className="h-2.5 w-2.5" /> anonymous publicly
                        </Badge>
                      )}
                    </p>
                    {b.message && (
                      <p className="text-xs text-muted-foreground leading-relaxed">"{b.message}"</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold">{money(b.amountCents)}</p>
                    <Badge variant="outline" className="text-[9px] capitalize">{b.status}</Badge>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1">
                  {b.tierName && <Badge variant="secondary" className="text-[10px]">{b.tierName}</Badge>}
                  {level && (
                    <Badge variant="outline" className="text-[10px]" style={{ borderColor: level.hex }}>
                      <Sparkles className="h-2.5 w-2.5 mr-1" />{level.label}
                    </Badge>
                  )}
                  {b.entitlements.foundingBeliever && (
                    <Badge className="text-[10px] gap-1"><Crown className="h-2.5 w-2.5" /> Founding</Badge>
                  )}
                  {b.entitlements.earlyAccess && <Badge variant="outline" className="text-[10px]">Early access</Badge>}
                  {b.entitlements.videoThankYou && <Badge variant="outline" className="text-[10px]">Video owed</Badge>}
                  {b.entitlements.wallpaper && <Badge variant="outline" className="text-[10px]">Wallpaper</Badge>}
                  {b.merch && (
                    <Badge className="text-[10px] gap-1">
                      <Shirt className="h-2.5 w-2.5" />
                      {(b.merch.products || []).join(" + ")} · {b.merch.status ?? "queued"}
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-[11px] text-muted-foreground">
          Addresses are collected by Stripe and included in the CSV. Backers marked anonymous are
          hidden from the public wall only — you still know who to post to.
        </p>
      </CardContent>
    </Card>
  );
}
