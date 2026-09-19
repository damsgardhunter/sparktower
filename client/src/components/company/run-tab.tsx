/**
 * The company page's "Run the business" tab.
 *
 * A company runs itself here through one project on the Run a company path;
 * the weekly check-in, the recurring jobs and the monthly report all live on
 * that project, because that is where the path, the board and Nova already
 * are. This tab is the doorway: a glance at whether this week's check-in is
 * in and what's overdue, and a link through. Before the project exists, an
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
import { Loader2, CalendarCheck, ArrowRight, AlertTriangle, Check, Repeat, FileBarChart } from "lucide-react";
import { useRhythm, shortDate } from "@/components/company-rhythm";

interface CompanyPayload { company: { id: string; name: string; projectId: string | null } }

export function RunTab({ companyId, canManage }: { companyId: string; canManage: boolean }) {
  const { toast } = useToast();
  const companyKey = [`/api/companies/${companyId}`];
  const { data, isLoading } = useQuery<CompanyPayload>({ queryKey: companyKey });
  const projectId = data?.company.projectId ?? null;

  const start = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${companyId}/run-project`, {}).then((r) => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: companyKey }),
    onError: (e) => toast({ title: "Couldn't set up the Run project", description: errorText(e), variant: "destructive" }),
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
            </div>
            {data.current?.reply && (
              <p className="text-sm text-muted-foreground line-clamp-3 whitespace-pre-line">{data.current.reply}</p>
            )}
            {data.overdue.length > 0 ? (
              <div className="space-y-1" data-testid="run-overdue">
                <p className="text-sm flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-destructive" />{data.overdue.length} overdue job{data.overdue.length === 1 ? "" : "s"}</p>
                <ul className="text-sm text-muted-foreground pl-6 list-disc">
                  {data.overdue.slice(0, 5).map((j) => <li key={j.id}>{j.title} — due {shortDate(j.nextDue)}</li>)}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="run-no-overdue">{data.jobs.length ? "Every recurring job is up to date." : "No recurring jobs on the board yet."}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
