/**
 * Your companies, and making a new one.
 *
 * Also where a team invite link lands (`/companies?invite=…`): the link is
 * accepted as soon as the page opens, and you are taken straight to the
 * company you just joined. There is nothing to confirm — someone at the
 * company chose to send you the link, and leaving is one click on its Team tab.
 */
import { useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2, Loader2, Plus, Users } from "lucide-react";
import { VerifyDomain } from "@/components/company/verify-domain";
import { Field, NovaInput, NovaTextarea, NOVA_FIELD_CLASS } from "@/components/nova";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COMPANY_SIZES, INDUSTRIES, type CompanyRole } from "@shared/companies";

interface MyCompany {
  id: string; name: string; slug: string; industry: string | null; size: string | null;
  description: string | null; role: CompanyRole; memberCount: number;
}

const NONE = "__none";

export default function CompaniesPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const invite = new URLSearchParams(search).get("invite");
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading } = useQuery<{ companies: MyCompany[] }>({ queryKey: ["/api/companies"] });

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 space-y-6">
      {invite && <AcceptInvite token={invite} />}

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Companies</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            A company account is for an existing business: run private simulation seasons to train your people, find
            people who have shown good commercial judgement, and keep an eye on startups in your industry.
          </p>
        </div>
        {!showForm && (
          <Button onClick={() => setShowForm(true)} data-testid="button-new-company">
            <Plus className="h-4 w-4 mr-1.5" /> New company
          </Button>
        )}
      </div>

      {showForm && <CreateCompany onCancel={() => setShowForm(false)} onCreated={(id) => navigate(`/companies/${id}`)} />}

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : !data?.companies.length ? (
        !showForm && (
          <Card className="nova-ring-soft">
            <CardContent className="py-10 text-center space-y-3">
              <span className="nova-chip mx-auto flex h-11 w-11 items-center justify-center rounded-xl">
                <Building2 className="h-5 w-5" />
              </span>
              <p className="text-sm text-muted-foreground">You're not part of any company yet. Create one, or ask a colleague for their team's invite link.</p>
              <Button variant="outline" onClick={() => setShowForm(true)}>Create a company</Button>
            </CardContent>
          </Card>
        )
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.companies.map((c) => (
            <button
              key={c.id}
              onClick={() => navigate(`/companies/${c.id}`)}
              /*
                * The soft ring rather than the full one: these are a grid of
                * equals, and the loud gradient is for the one thing on a
                * screen that should draw the eye. The glow on hover is what
                * says it is a door.
                */
              className="nova-ring-soft nova-hover-glow rounded-xl p-4 text-left"
              data-testid={`company-${c.id}`}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <Building2 className="h-4 w-4 text-primary shrink-0" />
                <span className="font-semibold">{c.name}</span>
                <Badge variant="secondary" className="capitalize">{c.role}</Badge>
              </div>
              {c.description && <p className="text-sm text-muted-foreground mt-1.5 line-clamp-2">{c.description}</p>}
              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                {c.industry && <span>{c.industry}</span>}
                <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {c.memberCount} {c.memberCount === 1 ? "person" : "people"}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Accepts a team link once, then goes to the company. */
function AcceptInvite({ token }: { token: string }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const accept = useMutation({
    mutationFn: () => apiRequest("POST", "/api/company-invites/accept", { token }).then((r) => r.json()),
    onSuccess: (res: { companyId: string; name: string; alreadyMember: boolean }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      // A company you just joined, fresh: a page cached from an earlier membership would show your old role and powers.
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${res.companyId}`] });
      // And somewhere you can now post as, if the company gave you that power.
      queryClient.invalidateQueries({ queryKey: ["/api/feed/my-companies"] });
      toast({ title: res.alreadyMember ? `You're already in ${res.name}` : `You've joined ${res.name}` });
      navigate(`/companies/${res.companyId}`, { replace: true });
    },
    onError: (e) => setError(errorText(e, "That invite link didn't work.")),
  });

  // Once, even under React's double-run of effects in development: accepting twice is harmless but toasts twice.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    accept.mutate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="py-4 text-sm">
          <p className="font-medium">We couldn't add you to that company.</p>
          <p className="text-muted-foreground mt-1">{error}</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="py-4 text-sm flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-primary" /> Joining the company…
      </CardContent>
    </Card>
  );
}

/**
 * Two steps, in this order: prove the website, then describe the company.
 *
 * The proof comes first because the server will not create a company without
 * one — a company that exists before anything is proved is a company that can
 * be named "Stripe" and left sitting there. Putting the details first would
 * mean filling in a form and then being told the real work hadn't started.
 */
function CreateCompany({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState(NONE);
  const [size, setSize] = useState(NONE);
  const [proved, setProved] = useState<{ id: string; domain: string } | null>(null);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);

  const create = useMutation({
    mutationFn: () => apiRequest("POST", "/api/companies", {
      name, description,
      /* The website is the proven domain; the server ignores anything else. */
      verificationId: proved?.id,
      industry: industry === NONE ? "" : industry,
      size: size === NONE ? "" : size,
    }).then((r) => r.json()),
    onSuccess: (res: { company: { id: string } }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      // The composer's "post as" list: you own this one, so you can post as it now.
      queryClient.invalidateQueries({ queryKey: ["/api/feed/my-companies"] });
      onCreated(res.company.id);
    },
    onError: (e: any) => setError({ field: e?.body?.field, message: errorText(e, "Couldn't create the company.") }),
  });

  const fieldError = (f: string) => error?.field === f ? <p className="text-xs text-destructive mt-1">{error.message}</p> : null;

  return (
    /* While it is open this is the only thing on the screen to do, so it takes the full ring. */
    <Card className="nova-ring nova-glow">
      <CardHeader><CardTitle className="text-lg">New company</CardTitle></CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => { e.preventDefault(); setError(null); create.mutate(); }}
        >
          <VerifyDomain onVerified={setProved} />

          <div className={proved ? "space-y-4" : "pointer-events-none space-y-4 opacity-40"} aria-hidden={!proved}>
            <Field
              label="Name"
              hint="How it appears to everyone: on your challenges, and to anybody you recruit."
              error={error?.field === "name" ? error.message : undefined}
            >
              {(f) => (
                <NovaInput
                  {...f} value={name} onChange={(e) => setName(e.target.value)}
                  maxLength={80} placeholder="Acme Ltd" data-testid="input-company-name"
                />
              )}
            </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Industry</Label>
              <Select value={industry} onValueChange={setIndustry}>
                <SelectTrigger className={NOVA_FIELD_CLASS} data-testid="select-industry"><SelectValue placeholder="Choose one" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not set</SelectItem>
                  {INDUSTRIES.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                </SelectContent>
              </Select>
              {fieldError("industry")}
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Size</Label>
              <Select value={size} onValueChange={setSize}>
                <SelectTrigger className={NOVA_FIELD_CLASS} data-testid="select-size"><SelectValue placeholder="How many people" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not set</SelectItem>
                  {COMPANY_SIZES.map((s) => <SelectItem key={s} value={s}>{s} people</SelectItem>)}
                </SelectContent>
              </Select>
              {fieldError("size")}
            </div>
          </div>
          {fieldError("website")}
          <Field
            label="What the company does"
            optional
            hint={error?.field === "description" ? undefined : `A line or two. ${600 - description.length} characters left.`}
            error={error?.field === "description" ? error.message : undefined}
          >
            {(f) => (
              <NovaTextarea
                {...f} value={description} onChange={(e) => setDescription(e.target.value)}
                maxLength={600} rows={3}
                placeholder="Commercial cleaning for offices across the north west."
                data-testid="input-company-description"
              />
            )}
          </Field>
          </div>
          {error && !["name", "industry", "size", "website", "description"].includes(error.field ?? "") && (
            <p className="text-sm text-destructive">{error.message}</p>
          )}
          <div className="flex gap-2">
            {/* Nothing to submit until the domain is proved: the server would only refuse it. */}
            <Button type="submit" disabled={create.isPending || !proved || name.trim().length < 2} data-testid="button-create-company">
              {create.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />} Create company
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
