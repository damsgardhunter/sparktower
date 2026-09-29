/**
 * The footer every screen ends on: language, a way to say it is broken, and jobs.
 *
 * ## Why the language change asks first
 *
 * Every other picker in the product applies on click, and this one does not.
 * Changing language is the only setting here that changes *everything a person
 * can read* — including the control they would use to change it back. Somebody
 * who picks the wrong row on a phone is suddenly navigating in a script they
 * may not read, looking for a word they no longer recognise. So it asks, in
 * both languages: the question names the language being switched to, and the
 * way out names the one being left, so whichever of the two you can read tells
 * you which button to press.
 *
 * ## Why it replaces the report footer rather than sitting beside it
 *
 * `ReportProblemFooter` already put "Is there a problem? Report it" on the
 * bottom of every screen, and two footers stacked on each other is how neither
 * gets read. This is that footer with more in it, and it reuses the same
 * `ReportProblemDialog` — one report flow, one place it lands.
 */
import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ReportProblemDialog } from "@/components/report-problem";
import { LANGUAGES, languageOf, useLanguage } from "@/lib/i18n";
import { Briefcase, Check, Globe, MessageSquareWarning } from "lucide-react";

export function SiteFooter({ className = "" }: { className?: string }) {
  const { language, t, setLanguage } = useLanguage();
  const [reporting, setReporting] = useState(false);
  /** The language being asked about, or null when nothing is being asked. */
  const [asking, setAsking] = useState<string | null>(null);

  const wanted = asking ? languageOf(asking) : null;

  return (
    <footer
      className={`shrink-0 border-t border-border/60 px-4 py-2 ${className}`}
      data-testid="footer-site"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-1 gap-y-1">
        {/* ── Language ── */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              data-testid="button-language"
            >
              <Globe className="h-3.5 w-3.5" />
              {language.native}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="max-h-80 overflow-y-auto">
            {LANGUAGES.map((l) => (
              <DropdownMenuItem
                key={l.code}
                /*
                 * The one already in use is not offered: confirming a switch to
                 * the language you are reading is a dialog that can only waste
                 * somebody's time.
                 */
                onSelect={() => { if (l.code !== language.code) setAsking(l.code); }}
                className="gap-2"
                data-testid={`language-${l.code}`}
              >
                <span className="w-4">
                  {l.code === language.code ? <Check className="h-3.5 w-3.5" /> : null}
                </span>
                <span className="flex-1">{l.native}</span>
                {/*
                  * The English name beside it, because somebody who cannot yet
                  * read the native name is exactly the person looking for it.
                  */}
                {l.english !== l.native && (
                  <span className="text-xs text-muted-foreground">{l.english}</span>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <span className="text-muted-foreground/40" aria-hidden>·</span>

        {/* ── Say it is broken ── */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setReporting(true)}
          data-testid="button-report-problem"
        >
          <MessageSquareWarning className="h-3.5 w-3.5" />
          {t("footer.report")}
        </Button>

        <span className="text-muted-foreground/40" aria-hidden>·</span>

        {/* ── Jobs ── */}
        <Link href="/careers">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            data-testid="link-careers"
          >
            <Briefcase className="h-3.5 w-3.5" />
            {t("footer.careers")}
          </Button>
        </Link>
      </div>

      {/*
        * How much is actually translated, said where the choice is made.
        * Somebody who picks a language and sees English everywhere else should
        * find out here rather than conclude the switch failed.
        */}
      {language.code !== "en" && (
        <p className="mt-1 text-center text-[11px] text-muted-foreground" data-testid="text-translation-note">
          {t("footer.languageNote")}
        </p>
      )}

      <ReportProblemDialog open={reporting} onOpenChange={setReporting} />

      <AlertDialog open={!!asking} onOpenChange={(v) => { if (!v) setAsking(null); }}>
        <AlertDialogContent data-testid="dialog-confirm-language">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("footer.switchTitle", { language: wanted?.native ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("footer.switchBody", { language: wanted?.native ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {/*
              * Named in the language being left, so the way back is readable to
              * somebody who has just realised they cannot read the other one.
              */}
            <AlertDialogCancel data-testid="button-language-cancel">
              {t("footer.switchCancel", { language: language.native })}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (asking) setLanguage(asking); setAsking(null); }}
              data-testid="button-language-confirm"
            >
              {t("footer.switchConfirm", { language: wanted?.native ?? "" })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </footer>
  );
}
