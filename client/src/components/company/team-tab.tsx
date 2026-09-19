/**
 * The people who act for a company, and what the company says about itself.
 *
 * Everyone sees the team. Admins also get the invite link, each person's role,
 * and the company's details to edit. Anyone may leave; the server refuses the
 * last owner, and the message it gives is shown as-is because it says what to
 * do instead.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Copy, Link2, Loader2, LogOut, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COMPANY_ROLES, COMPANY_SIZES, INDUSTRIES, type CompanyRole } from "@shared/companies";
import type { CompanyView } from "@/pages/company";

const NONE = "__none";
const ROLE_HELP: Record<CompanyRole, string> = {
  owner: "Can do anything, including deleting the company",
  admin: "Runs seasons, invites people and edits the company",
  member: "Can see everything and join seasons",
};

export function TeamTab({ companyId, canManage }: { companyId: string; canManage: boolean }) {
  const key = [`/api/companies/${companyId}`];
  const { data } = useQuery<CompanyView>({ queryKey: key });
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const fail = (title: string) => (e: unknown) => toast({ title, description: errorText(e), variant: "destructive" });

  const changeRole = useMutation({
    mutationFn: (v: { userId: string; role: CompanyRole }) =>
      apiRequest("PATCH", `/api/companies/${companyId}/members/${v.userId}`, { role: v.role }),
    onSuccess: refresh,
    onError: fail("Couldn't change that role"),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => apiRequest("DELETE", `/api/companies/${companyId}/members/${userId}`),
    onSuccess: (_r, userId) => {
      if (userId === user?.id) {
        queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
        navigate("/companies");
      } else refresh();
    },
    onError: fail("Couldn't do that"),
  });

  if (!data) return null;
  const isOwner = data.role === "owner";

  return (
    <div className="space-y-4">
      {canManage && <InviteLink companyId={companyId} />}

      <Card>
        <CardHeader><CardTitle className="text-base">People ({data.members.length})</CardTitle></CardHeader>
        <CardContent className="divide-y">
          {data.members.map((m) => {
            const you = m.userId === user?.id;
            // Ownership is for owners to hand out; the server says the same.
            const canEditThis = canManage && (isOwner || m.role !== "owner");
            return (
              <div key={m.userId} className="flex items-center gap-3 py-2.5" data-testid={`member-${m.userId}`}>
                <Avatar className="h-8 w-8">
                  {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt="" />}
                  <AvatarFallback>{m.name.slice(0, 1).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{m.name}{you && <span className="text-muted-foreground font-normal"> (you)</span>}</p>
                  <p className="text-xs text-muted-foreground">{ROLE_HELP[m.role]}</p>
                </div>
                {canEditThis ? (
                  <Select value={m.role} onValueChange={(role) => changeRole.mutate({ userId: m.userId, role: role as CompanyRole })}>
                    <SelectTrigger className="w-28 h-8" data-testid={`select-role-${m.userId}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {COMPANY_ROLES.filter((r) => isOwner || r !== "owner").map((r) => (
                        <SelectItem key={r} value={r} className="capitalize">{r[0].toUpperCase() + r.slice(1)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant="secondary" className="capitalize">{m.role}</Badge>
                )}
                {you ? (
                  <Button
                    variant="ghost" size="sm" title="Leave this company"
                    onClick={() => { if (confirm(`Leave ${data.company.name}?`)) remove.mutate(m.userId); }}
                    data-testid="button-leave-company"
                  >
                    <LogOut className="h-4 w-4" />
                  </Button>
                ) : canEditThis ? (
                  <Button
                    variant="ghost" size="sm" title={`Remove ${m.name}`}
                    onClick={() => { if (confirm(`Remove ${m.name} from ${data.company.name}?`)) remove.mutate(m.userId); }}
                    data-testid={`button-remove-${m.userId}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : <span className="w-9" />}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {canManage && <EditCompany view={data} onSaved={refresh} />}
      {isOwner && <DeleteCompany companyId={companyId} name={data.company.name} />}
    </div>
  );
}

function InviteLink({ companyId }: { companyId: string }) {
  const [role, setRole] = useState<"member" | "admin">("member");
  const [link, setLink] = useState<{ url: string; expiresAt: string; role: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const make = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${companyId}/invite-link`, { role }).then((r) => r.json()),
    onSuccess: async (res: { url: string; expiresAt: string; role: string }) => {
      setLink(res);
      try {
        await navigator.clipboard.writeText(res.url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        // The link is on screen to copy by hand.
      }
    },
    onError: (e) => toast({ title: "Couldn't make a link", description: errorText(e), variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Invite colleagues</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Anyone with the link can join for the next 7 days, so share it only with your own people.
        </p>
        <div className="flex gap-2 flex-wrap items-center">
          <Select value={role} onValueChange={(v) => { setRole(v as "member" | "admin"); setLink(null); }}>
            <SelectTrigger className="w-40" data-testid="select-invite-role"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="member">Join as a member</SelectItem>
              <SelectItem value="admin">Join as an admin</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => make.mutate()} disabled={make.isPending} data-testid="button-invite-link">
            {make.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : copied ? <Check className="h-4 w-4 mr-1.5" /> : <Link2 className="h-4 w-4 mr-1.5" />}
            {copied ? "Copied" : "Copy invite link"}
          </Button>
        </div>
        {link && (
          <div className="flex gap-2 items-center">
            <Input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" data-testid="input-invite-url" />
            <Button variant="outline" size="icon" title="Copy" onClick={() => navigator.clipboard.writeText(link.url).catch(() => {})}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        )}
        {link && <p className="text-xs text-muted-foreground">Works until {new Date(link.expiresAt).toLocaleDateString()}.</p>}
      </CardContent>
    </Card>
  );
}

function EditCompany({ view, onSaved }: { view: CompanyView; onSaved: () => void }) {
  const c = view.company;
  const [name, setName] = useState(c.name);
  const [industry, setIndustry] = useState(c.industry ?? NONE);
  const [size, setSize] = useState(c.size ?? NONE);
  const [website, setWebsite] = useState(c.website ?? "");
  const [description, setDescription] = useState(c.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const save = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/companies/${c.id}`, {
      name, website, description, industry: industry === NONE ? "" : industry, size: size === NONE ? "" : size,
    }),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      onSaved();
      toast({ title: "Saved" });
    },
    onError: (e) => setError(errorText(e, "Couldn't save those changes.")),
  });

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Company details</CardTitle></CardHeader>
      <CardContent>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <div>
            <Label htmlFor="edit-name">Name</Label>
            <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Industry</Label>
              <Select value={industry} onValueChange={setIndustry}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not set</SelectItem>
                  {INDUSTRIES.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Size</Label>
              <Select value={size} onValueChange={setSize}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not set</SelectItem>
                  {COMPANY_SIZES.map((s) => <SelectItem key={s} value={s}>{s} people</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="edit-website">Website</Label>
            <Input id="edit-website" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="edit-description">What the company does</Label>
            <Textarea id="edit-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={600} rows={3} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={save.isPending} data-testid="button-save-company">
            {save.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />} Save
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function DeleteCompany({ companyId, name }: { companyId: string; name: string }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const del = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/companies/${companyId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      navigate("/companies");
    },
    onError: (e) => toast({ title: "Couldn't delete the company", description: errorText(e), variant: "destructive" }),
  });
  return (
    <Card className="border-destructive/30">
      <CardContent className="py-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-medium">Delete this company</p>
          <p className="text-xs text-muted-foreground">Removes the company and everyone's access to it. This can't be undone.</p>
        </div>
        <Button
          variant="destructive" size="sm" disabled={del.isPending}
          onClick={() => { if (confirm(`Delete ${name}? This can't be undone.`)) del.mutate(); }}
          data-testid="button-delete-company"
        >
          Delete company
        </Button>
      </CardContent>
    </Card>
  );
}
