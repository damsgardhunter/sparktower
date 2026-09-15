import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Check, Copy, Loader2, Mail, UserPlus, X } from "lucide-react";
import { DEFAULT_INVITE_EXPIRY_DAYS, INVITE_EXPIRY_DAYS, INVITE_ROLES } from "@shared/invites";

interface CreatedInvite {
  invite: { id: string; email: string | null; role: string; expiresAt: string; emailStatus: "sent" | "logged" | "failed" | null };
  url: string;
  email: { status: "sent" | "logged" | "failed"; error?: string } | null;
}
interface InviteRow { id: string; email: string | null; role: string; expiresAt: string; createdAt: string; emailStatus: string | null; status: "pending" | "accepted" | "revoked" | "expired" }

const SELECT = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

/**
 * "Invite collaborator": an optional email, a role, how long it lasts. Always
 * ends in a link to copy — whether or not an email went out — because email
 * is the part that can be slow or not set up, and the link is what works.
 */
export function InviteCollaboratorDialog({ projectId, projectTitle }: { projectId: string; projectTitle: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>(INVITE_ROLES[0]);
  const [days, setDays] = useState<number>(DEFAULT_INVITE_EXPIRY_DAYS);
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const [copied, setCopied] = useState(false);

  const create = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/projects/${projectId}/invites`, { email: email.trim() || undefined, role, expiresInDays: days })).json() as Promise<CreatedInvite>,
    onSuccess: (r) => { setCreated(r); queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "invites"] }); },
    onError: (e) => toast({ title: "Couldn't create the invite", description: errorText(e), variant: "destructive" }),
  });

  const reset = () => { setEmail(""); setRole(INVITE_ROLES[0]); setDays(DEFAULT_INVITE_EXPIRY_DAYS); setCreated(null); setCopied(false); };
  const copy = async () => {
    if (!created) return;
    try { await navigator.clipboard.writeText(created.url); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { toast({ title: "Couldn't copy — select the link and copy it", variant: "destructive" }); }
  };

  const emailLine = !created?.email ? null
    : created.email.status === "sent" ? { tone: "text-emerald-700 dark:text-emerald-400", text: `Emailed to ${created.invite.email}.` }
    : created.email.status === "logged" ? { tone: "text-muted-foreground", text: `Email isn't set up here, so nothing was sent to ${created.invite.email} — send them the link. (In development the email is in the server log.)` }
    : { tone: "text-amber-700 dark:text-amber-400", text: `The email to ${created.invite.email} didn't go through — send them the link instead.` };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)} data-testid="button-invite-collaborator">
        <UserPlus className="h-4 w-4" /> Invite collaborator
      </Button>
      <DialogContent className="max-w-md" data-testid="invite-dialog">
        <DialogHeader>
          <DialogTitle>{created ? "Invite ready" : `Invite someone to ${projectTitle}`}</DialogTitle>
          <DialogDescription>
            {created
              ? `Anyone with this link can join as ${created.invite.role}${created.invite.email ? ` — only ${created.invite.email} can accept it` : ""}. It works once and expires ${new Date(created.invite.expiresAt).toLocaleDateString()}.`
              : "You'll get a link to share. Add their email and we'll send it too — only that account will be able to accept."}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input readOnly value={created.url} onFocus={(e) => e.target.select()} className="text-xs font-mono" data-testid="invite-link" />
              <Button variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={copy} data-testid="button-copy-invite">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? "Copied" : "Copy"}
              </Button>
            </div>
            {emailLine && <p className={`text-xs flex items-start gap-1.5 ${emailLine.tone}`} data-testid="invite-email-status"><Mail className="h-3.5 w-3.5 shrink-0 mt-0.5" />{emailLine.text}</p>}
            <p className="text-[11px] text-muted-foreground">This is the only time the full link is shown. Lost it? Revoke this invite and create another.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block text-xs font-medium space-y-1">
              <span>Email <span className="font-normal text-muted-foreground">(optional)</span></span>
              <Input type="email" placeholder="teammate@example.com" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-invite-email" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs font-medium space-y-1">
                <span>Role</span>
                <select className={SELECT} value={role} onChange={(e) => setRole(e.target.value)} data-testid="select-invite-role">
                  {INVITE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <label className="block text-xs font-medium space-y-1">
                <span>Expires after</span>
                <select className={SELECT} value={days} onChange={(e) => setDays(Number(e.target.value))} data-testid="select-invite-expiry">
                  {INVITE_EXPIRY_DAYS.map((d) => <option key={d} value={d}>{d === 1 ? "1 day" : `${d} days`}</option>)}
                </select>
              </label>
            </div>
          </div>
        )}

        <DialogFooter>
          {created ? (
            <>
              <Button variant="outline" onClick={reset} data-testid="button-invite-another">Invite another</Button>
              <Button onClick={() => { setOpen(false); reset(); }}>Done</Button>
            </>
          ) : (
            <Button disabled={create.isPending} onClick={() => create.mutate()} data-testid="button-create-invite">
              {create.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}Create invite link
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Invites the owner has sent: who, as what, where each stands, and a way to cancel a pending one. */
export function PendingInvites({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const { data } = useQuery<{ invites: InviteRow[] }>({ queryKey: ["/api/projects", projectId, "invites"] });
  const revoke = useMutation({
    mutationFn: async (inviteId: string) => (await apiRequest("DELETE", `/api/projects/${projectId}/invites/${inviteId}`)).json(),
    onSuccess: () => { toast({ title: "Invite revoked", description: "Its link no longer works." }); queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "invites"] }); },
    onError: (e) => toast({ title: "Couldn't revoke that", description: errorText(e), variant: "destructive" }),
  });
  const invites = data?.invites ?? [];
  if (!invites.length) return null;
  return (
    <div className="rounded-md border border-border p-3 space-y-2" data-testid="pending-invites">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Invites</p>
      <ul className="divide-y divide-border/60">
        {invites.map((i) => (
          <li key={i.id} className="flex items-center gap-2 py-1.5 text-sm" data-testid={`invite-row-${i.id}`}>
            <span className="flex-1 min-w-0 truncate">{i.email ?? "Link invite"} <span className="text-muted-foreground">· {i.role}</span></span>
            <Badge variant={i.status === "pending" ? "secondary" : "outline"} className="text-[10px] capitalize">{i.status}</Badge>
            {i.status === "pending" && (
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Revoke" disabled={revoke.isPending} onClick={() => revoke.mutate(i.id)} data-testid={`button-revoke-invite-${i.id}`}>
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
