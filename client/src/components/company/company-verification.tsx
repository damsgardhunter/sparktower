/**
 * Proving the website of a company that already exists.
 *
 * ## Who is looking at this
 *
 * Somebody whose company was created before verification existed, who has just
 * tried to post a challenge and been told they cannot. Every company on the
 * site is in that state today. So the banner's job is not to explain
 * verification — it is to name the thing they cannot do, and put the way out
 * directly underneath.
 *
 * It says what is blocked rather than what is missing. "This company hasn't
 * proved its website" is a fact about a database column; "you can't post
 * challenges until you prove the website" is the reason anybody would care.
 *
 * ## Once verified it stops talking
 *
 * A green "verified" banner across the top of a company forever is a banner
 * people stop seeing, which makes the amber one stop working too. Verified, it
 * shrinks to a line on the header — the domain, where the name already is.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { VerifyDomain } from "@/components/company/verify-domain";
import { AlertTriangle, Loader2, ShieldCheck, X } from "lucide-react";

/**
 * The banner, for a company with nothing proved.
 *
 * Only for somebody who can do something about it. Showing a member a wall
 * they cannot climb is worse than showing them nothing: the person who can fix
 * it is a leader, and telling everybody else makes the company look broken to
 * its own staff.
 */
export function CompanyVerificationBanner({ companyId, canManage, verifiedDomain }: {
  companyId: string;
  canManage: boolean;
  verifiedDomain: string | null;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [proved, setProved] = useState<{ id: string; domain: string } | null>(null);

  const claim = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/companies/${companyId}/verify`, { verificationId: proved!.id })).json(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}`] });
      void queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      setOpen(false);
      setProved(null);
      toast({ title: "Verified", description: "This company can post challenges now." });
    },
    onError: (e) => toast({ title: "Couldn't finish that", description: errorText(e), variant: "destructive" }),
  });

  // Verified: the header already carries the domain, so there is nothing to say.
  if (verifiedDomain) return null;
  // Nothing a member can do about it, and a wall they cannot climb helps nobody.
  if (!canManage) return null;

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3" data-testid="company-unverified">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-medium">This company can't post challenges yet.</span>{" "}
          <span className="text-muted-foreground">
            Prove you control its website and it can. It's what tells entrants the company is real before they spend a fortnight on one.
          </span>
        </p>
        <Button size="sm" className="shrink-0" onClick={() => setOpen(true)} data-testid="button-verify-company">
          <ShieldCheck className="mr-1.5 h-4 w-4" />Prove the website
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4" data-testid="company-verify-panel">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Prove this company's website</p>
          <p className="text-xs text-muted-foreground">
            A file on the site or a DNS record. Either one shows you control the domain, which a stranger cannot.
          </p>
        </div>
        <Button size="sm" variant="ghost" className="h-7 shrink-0 px-2" onClick={() => setOpen(false)} data-testid="button-verify-cancel">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* The same component the creation form uses: one flow, one set of bugs. */}
      <VerifyDomain onVerified={setProved} />

      {proved && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <p className="min-w-0 flex-1 text-sm">
            Attach <span className="font-medium">{proved.domain}</span> to this company?
            <span className="block text-xs text-muted-foreground">It can't be changed afterwards.</span>
          </p>
          <Button size="sm" disabled={claim.isPending} onClick={() => claim.mutate()} data-testid="button-confirm-verify">
            {claim.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Attach it
          </Button>
        </div>
      )}
    </div>
  );
}

/** The verified domain beside the company's name, where somebody already looks for who this is. */
export function CompanyVerifiedMark({ domain }: { domain: string | null }) {
  if (!domain) return null;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400"
      title={`${domain} — the company proved it controls this domain`}
      data-testid="company-verified-mark"
    >
      <ShieldCheck className="h-3.5 w-3.5" />
      {domain}
    </span>
  );
}
