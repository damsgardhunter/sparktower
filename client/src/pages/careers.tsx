/**
 * Careers, when there are none.
 *
 * A jobs page with no jobs is the normal state of a jobs page, and it is worth
 * building properly rather than leaving the link dead: somebody who looked is
 * somebody who would have applied, and "no jobs available" answers them in one
 * line where a 404 tells them the company is broken.
 *
 * There is no application form, because there is nothing to apply to. Offering
 * one would collect names against a role that does not exist — and the honest
 * version of "apply anyway" is the one thing here that does reach a person, so
 * it hands over to the problem report rather than inventing a second inbox
 * nobody reads.
 */
import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ReportProblemDialog } from "@/components/report-problem";
import { useLanguage } from "@/lib/i18n";
import { ArrowLeft, Briefcase } from "lucide-react";

export default function CareersPage() {
  const { t } = useLanguage();
  const [applying, setApplying] = useState(false);

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <Link href="/">
        <Button variant="ghost" size="sm" className="mb-6 gap-1.5 text-muted-foreground" data-testid="link-back">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
      </Link>

      <Card data-testid="card-careers">
        <CardContent className="space-y-4 p-8 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl nova-chip">
            <Briefcase className="h-5 w-5" />
          </span>

          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-careers-title">
            {t("careers.title")}
          </h1>

          <p className="text-lg" data-testid="text-no-jobs">{t("careers.none")}</p>
          <p className="text-sm text-muted-foreground">{t("careers.checkBack")}</p>

          <div className="pt-2">
            <Button variant="outline" onClick={() => setApplying(true)} data-testid="button-apply">
              {t("careers.apply")}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">{t("careers.applyNote")}</p>
          </div>
        </CardContent>
      </Card>

      <ReportProblemDialog open={applying} onOpenChange={setApplying} />
    </div>
  );
}
