/**
 * Where a company's training-season link lands: whose season it is, which
 * market, and a button to take a seat.
 *
 * Joining puts you in a room of that season and hands over to /simulation,
 * which already knows how to show a room you are in. Only the company's own
 * people can join; anyone else is told so plainly rather than shown a button
 * that fails.
 */
import { useParams, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2, Clock, Loader2, Users } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface SeasonInvite {
  seasonId: string;
  name: string;
  status: "forming" | "running" | "finished" | "abandoned";
  totalYears: number;
  yearMinutes: number | null;
  niche: { id: string; name: string; premise: string | null };
  company: { id: string; name: string } | null;
  isMember: boolean;
  ventureId: string | null;
}

const yearLength = (minutes: number | null) =>
  minutes == null ? "a day" : minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? "" : "s"}` : `${minutes} minutes`;

export default function JoinSeasonPage() {
  const { code } = useParams<{ code: string }>();
  const [, navigate] = useLocation();

  const { data, isLoading, error } = useQuery<SeasonInvite>({
    queryKey: [`/api/sim/join-code/${encodeURIComponent(code ?? "")}`],
    retry: false,
  });

  const join = useMutation({
    mutationFn: () => apiRequest("POST", "/api/sim/join-code", { code }).then((r) => r.json()),
    onSuccess: (res: { ventureId?: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sim/ventures"] });
      // So Back shows "Go to your table" rather than offering to join again, here and on the company's Training tab.
      queryClient.invalidateQueries({ queryKey: [`/api/sim/join-code/${encodeURIComponent(code ?? "")}`] });
      queryClient.invalidateQueries({ predicate: (q) => /^\/api\/companies\/[^/]+\/seasons$/.test(String(q.queryKey[0])) });
      navigate(res?.ventureId ? `/simulation?room=${res.ventureId}` : "/simulation");
    },
  });

  if (isLoading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  if (error || !data) {
    return (
      <Shell>
        <p className="font-medium">This join link doesn't work.</p>
        <p className="text-sm text-muted-foreground mt-1">Check you have the whole link, or ask whoever sent it for a new one.</p>
      </Shell>
    );
  }

  const open = data.status === "forming";

  return (
    <Shell>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Building2 className="h-4 w-4" /> {data.company?.name ?? "A company"} · private training season
      </div>
      <h1 className="text-2xl font-bold tracking-tight mt-1" data-testid="text-season-name">{data.name}</h1>
      <p className="text-sm mt-3"><span className="font-medium">Market:</span> {data.niche.name}</p>
      {data.niche.premise && <p className="text-sm text-muted-foreground mt-1">{data.niche.premise}</p>}
      <div className="flex gap-4 flex-wrap text-sm text-muted-foreground mt-3">
        <span className="flex items-center gap-1"><Clock className="h-4 w-4" /> {data.totalYears} years, each lasting {yearLength(data.yearMinutes)}</span>
        <span className="flex items-center gap-1"><Users className="h-4 w-4" /> Five people run each company</span>
      </div>

      <div className="mt-6">
        {data.ventureId ? (
          <Button onClick={() => navigate(`/simulation?room=${data.ventureId}`)} data-testid="button-open-room">Go to your table</Button>
        ) : !data.isMember ? (
          <p className="text-sm text-muted-foreground">
            This season is only for people at {data.company?.name ?? "the company"}. Ask them for their team invite link first, then come back to this page.
          </p>
        ) : !open ? (
          <p className="text-sm text-muted-foreground">
            {data.status === "running" ? "This season has already started, so its tables are full." : "This season is over."}
          </p>
        ) : (
          <>
            <Button onClick={() => join.mutate()} disabled={join.isPending} data-testid="button-join-season">
              {join.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />} Join the season
            </Button>
            {join.error && <p className="text-sm text-destructive mt-2">{errorText(join.error)}</p>}
          </>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <Card><CardContent className="py-6">{children}</CardContent></Card>
    </div>
  );
}
