/**
 * The company page's "Run the business" tab.
 *
 * A company runs itself here through one project on the Run a company path;
 * the weekly check-in, the recurring jobs and the monthly report all live on
 * that project, because that is where the path, the board and Nova already
 * are. This tab is the doorway: a glance at whether this week's check-in is
 * in (and which day it's due), what's overdue, how the quarter's goals are
 * going, and this month's report in a line — and a link through. Before the project exists, an
 * admin can start it in one step — the company's people are put on it, so
 * nobody has to be invited twice.
 */
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, CalendarCheck, ArrowRight, AlertTriangle, Check, Repeat, FileBarChart, Target } from "lucide-react";
import { useRhythm, useGoals, shortDate, quarterName, GoalProgressView } from "@/components/company-rhythm";
import { CHECKIN_DAYS, daysOverdue, type MonthlyReport } from "@shared/company-rhythm";

interface CompanyPayload { company: { id: string; name: string; projectId: string | null } }

export function RunTab({ companyId, canManage }: { companyId: string; canManage: boolean }) {
  const { toast } = useToast();
  const companyKey = [`/api/companies/${companyId}`];
  const { data, isLoading } = useQuery<CompanyPayload>({ queryKey: companyKey });
  const projectId = data?.company.projectId ?? null;

  const start = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${companyId}/run-project`, {}).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: companyKey });
      // Everyone in the company is on the new project, you included: it belongs in your projects list now.
      queryClient.invalidateQueries({ queryKey: ["/api/user/projects"] });
    },
    onError: (e) => {
      toast({ title: "Couldn't set up the Run project", description: errorText(e), variant: "destructive" });
      /*
       * Most often another admin set it up first (409). Refetch so the button
       * gives way to the project they made, rather than failing on every press.
       */
      queryClient.invalidateQueries({ queryKey: companyKey });
    },
  });

  if (isLoading || !data) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;

  if (!projectId) {
    return (
      <Card data-testid="run-tab-start">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-2"><CalendarCheck className="h-5 w-5 text-primary" /><p className="text-lg font-semibold">Run {data.company.name} week to week</p></div>
          <ul className="text-sm text-muted-foreground space-y-2">
            <li className="flex gap-2"><Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />A five-minute check-in every week: your numbers, what went right and wrong, and a reply saying what changed and the one thing to do about it.</li>
            <li className="flex gap-2"><Repeat className="h-4 w-4 text-primary shrink-0 mt-0.5" />The jobs that come round every week or month — payroll, invoicing, stock — each with an owner and a backup, and a nudge when one is overdue.</li>
            <li className="flex gap-2"><FileBarChart className="h-4 w-4 text-primary shrink-0 mt-0.5" />A monthly report on what improved, what slipped, and what to fix next.</li>
          </ul>
          {canManage ? (
            <Button onClick={() => start.mutate()} disabled={start.isPending} data-testid="button-start-run-project">
              {start.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Start running it here
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground" data-testid="text-run-needs-admin">An admin of the company can set this up.</p>
          )}
          <p className="text-xs text-muted-foreground">This makes a project on the Run a company path, kept private where your plan allows, with everyone in the company on it.</p>
        </CardContent>
      </Card>
    );
  }

  return <RunSummary projectId={projectId} />;
}

function RunSummary({ projectId }: { projectId: string }) {
  const { data, isLoading, isError } = useRhythm(projectId);
  const href = `/projects/${projectId}/manage?section=run_company`;
  const { data: goals } = useGoals(data ? projectId : null, data?.quarter);
  const month = data?.today.slice(0, 7);
  // `glance=1`: a headline on the company page isn't reading the report, so it doesn't tick the path's "read your first report".
  const { data: report } = useQuery<MonthlyReport>({
    queryKey: ["/api/projects", projectId, "rhythm", "report", `${month}?glance=1`],
    enabled: !!data && !!month,
  });
  const activeGoals = goals?.goals.filter((g) => g.status !== "dropped") ?? [];

  return (
    <Card data-testid="run-tab-summary">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <CalendarCheck className="h-5 w-5 text-primary" />
          <p className="text-lg font-semibold">The weekly rhythm</p>
          <Link href={href} className="ml-auto">
            <Button size="sm" className="gap-1" data-testid="link-run-project">Open <ArrowRight className="h-3.5 w-3.5" /></Button>
          </Link>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-primary" /></div>
        ) : isError || !data ? (
          <p className="text-sm text-muted-foreground" data-testid="text-run-not-member">You're not on the company's Run project yet. Ask an admin to add you.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm" data-testid="run-checkin-status">
              <span>Week of {shortDate(data.weekOf)}:</span>
              {data.current
                ? <Badge variant="secondary" className="gap-1"><Check className="h-3 w-3" />Checked in</Badge>
                : <Badge variant="outline">Check-in due</Badge>}
              <span className="text-xs text-muted-foreground ml-auto" data-testid="run-checkin-day">Check-in day: {CHECKIN_DAYS[data.settings?.checkinDay ?? 0]}</span>
            </div>
            {data.current?.reply && (
              <p className="text-sm text-muted-foreground line-clamp-3 whitespace-pre-line">{data.current.reply}</p>
            )}
            {data.overdue.length > 0 ? (
              <div className="space-y-1" data-testid="run-overdue">
                <p className="text-sm flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-destructive" />{data.overdue.length} overdue job{data.overdue.length === 1 ? "" : "s"}</p>
                <ul className="text-sm text-muted-foreground pl-6 list-disc">
                  {data.overdue.slice(0, 5).map((j) => <li key={j.id}>{j.title} — due {shortDate(j.nextDue)}, {daysOverdue(j.nextDue, data.today)}d late</li>)}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="run-no-overdue">{data.jobs.length ? "Every recurring job is up to date." : "No recurring jobs on the board yet."}</p>
            )}

            <div className="space-y-2 pt-1" data-testid="run-goals">
              <p className="text-sm flex items-center gap-1.5"><Target className="h-4 w-4 text-primary" />Goals for {quarterName(data.quarter)}</p>
              {!goals ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : activeGoals.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="run-no-goals">No goals set for this quarter yet.</p>
              ) : (
                <ul className="space-y-3">
                  {activeGoals.map((g) => (
                    <li key={g.id} className="space-y-1" data-testid={`run-goal-${g.id}`}>
                      <p className="text-sm">{g.title}</p>
                      <GoalProgressView goal={g} metrics={goals.metrics} />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {report && (
              <div className="space-y-1 pt-1" data-testid="run-report-headline">
                <p className="text-sm flex items-center gap-1.5"><FileBarChart className="h-4 w-4 text-primary" />This month so far</p>
                <p className="text-sm text-muted-foreground">
                  {report.filed} of {report.weeksSoFar || report.weeks.length} check-ins filed · {report.jobs.onTime} job{report.jobs.onTime === 1 ? "" : "s"} on time · {report.jobs.late + report.jobs.missed} late or missed
                </p>
                {report.fixNext && <p className="text-sm line-clamp-2" data-testid="run-report-fix-next">{report.fixNext.text}</p>}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
