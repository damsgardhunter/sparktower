/**
 * A company's own page: everything an existing business comes here for, one
 * tab each.
 *
 * The tabs are separate components on purpose — each belongs to one feature
 * (training seasons, recruiting, challenges, scouting, running the business)
 * and can change without touching the others. This file only decides which
 * one is showing and what the company is.
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useParams, useLocation, useSearch } from "wouter";
import { Loader2, ArrowLeft, Building2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { canCompany, type CompanyPermission, type CompanyRole } from "@shared/companies";
import { TeamTab } from "@/components/company/team-tab";
import { TrainingTab } from "@/components/company/training-tab";
import { TalentTab } from "@/components/company/talent-tab";
import { ScoutingTab } from "@/components/company/scouting-tab";
import { ChallengesTab } from "@/components/company/challenges-tab";
import { RunTab } from "@/components/company/run-tab";
import { AdminTab } from "@/components/company/admin-tab";
import { PostsTab } from "@/components/company/posts-tab";

export interface CompanyView {
  company: {
    id: string; name: string; slug: string; website: string | null; industry: string | null;
    size: string | null; description: string | null; projectId: string | null;
  };
  role: CompanyRole;
  members: { userId: string; name: string; role: CompanyRole; avatarUrl: string | null; permissions: CompanyPermission[] }[];
  /** The viewer: `permissions` is what was given to them, `powers` everything they can actually do (all of them for a leader). */
  me: { userId: string; role: CompanyRole; permissions: CompanyPermission[]; powers: CompanyPermission[] };
}

/*
 * Running the business first, because that is what a company is here to do,
 * and Simulations directly under Team, because a season is something you run
 * *for* your people: you pick who plays from the same place you manage them.
 * It opened on training seasons, which put the game in front of the work.
 */
const TABS = [
  { id: "run", label: "Run the business" },
  { id: "team", label: "Team" },
  { id: "training", label: "Simulations" },
  { id: "talent", label: "Talent" },
  { id: "challenges", label: "Challenges" },
  { id: "scouting", label: "Scouting" },
  { id: "posts", label: "Posts" },
  { id: "admin", label: "Admin" },
] as const;

/** Links written before the tabs were renamed, so a bookmark or an email still lands. */
const TAB_ALIASES: Record<string, string> = { simulations: "training", seasons: "training", business: "run" };

export default function CompanyPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const search = useSearch();
  const initial = new URLSearchParams(search).get("tab");
  const asked = initial ? TAB_ALIASES[initial] ?? initial : null;
  const tab = TABS.some((t) => t.id === asked) ? asked! : "run";

  /*
   * Coming back from paying for seats.
   *
   * The checkout has always appended `?seats=bought`, and nothing read it —
   * so somebody paid, got redirected, and landed on a page that behaved as
   * though nothing had happened. The seats were credited by the webhook; the
   * only thing missing was saying so.
   *
   * Said once and then taken out of the address, so a reload or a shared
   * link does not congratulate somebody on a purchase they did not make.
   */
  const seats = new URLSearchParams(search).get("seats");
  useEffect(() => {
    if (seats !== "bought" && seats !== "cancelled") return;
    if (seats === "bought") {
      toast({
        title: "Seats added",
        description: "They stay with the company — every season after this one is already paid for.",
      });
      // The balance on screen is a purchase out of date.
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${id}/simulation-seats`] });
    } else {
      toast({ title: "Nothing was charged", description: "You can pick up where you left off whenever you like." });
    }
    const rest = new URLSearchParams(search);
    rest.delete("seats");
    navigate(`/companies/${id}${rest.toString() ? `?${rest}` : ""}`, { replace: true });
  }, [seats, search, id, navigate, toast]);

  const { data, isLoading, isError } = useQuery<CompanyView>({ queryKey: [`/api/companies/${id}`] });

  if (isLoading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }
  if (isError || !data) {
    return <div className="mx-auto max-w-4xl px-4 py-8 text-sm text-muted-foreground">This company couldn't be found.</div>;
  }

  // "Is a leader": what most tabs read. The Run tab is given its own power instead, since a member can be trusted with it alone.
  const canManage = canCompany(data.role, "manage");
  const props = { companyId: data.company.id, canManage };
  const powers = data.me?.powers ?? [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 space-y-6">
      <div>
        <button onClick={() => navigate("/companies")} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-2" data-testid="button-back">
          <ArrowLeft className="h-3 w-3" /> Companies
        </button>
        <div className="flex items-center gap-3 flex-wrap">
          <Building2 className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-company-name">{data.company.name}</h1>
          <Badge variant="secondary" className="capitalize">{data.role}</Badge>
          {data.company.industry && <Badge variant="outline">{data.company.industry}</Badge>}
        </div>
        {data.company.description && <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">{data.company.description}</p>}
      </div>

      <Tabs value={tab} onValueChange={(t) => navigate(`/companies/${id}?tab=${t}`, { replace: true })}>
        <TabsList className="flex-wrap h-auto">
          {TABS.map((t) => <TabsTrigger key={t.id} value={t.id} data-testid={`tab-${t.id}`}>{t.label}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="training"><TrainingTab {...props} /></TabsContent>
        <TabsContent value="talent"><TalentTab {...props} /></TabsContent>
        <TabsContent value="challenges"><ChallengesTab {...props} /></TabsContent>
        <TabsContent value="scouting"><ScoutingTab {...props} /></TabsContent>
        <TabsContent value="run"><RunTab companyId={data.company.id} canManage={powers.includes("run_business")} /></TabsContent>
        <TabsContent value="posts"><PostsTab {...props} /></TabsContent>
        <TabsContent value="team"><TeamTab {...props} powers={powers} /></TabsContent>
        <TabsContent value="admin"><AdminTab {...props} powers={powers} /></TabsContent>
      </Tabs>
    </div>
  );
}
