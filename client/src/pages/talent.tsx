/**
 * The person's side of recruiting: whether companies may see my record, what
 * exactly they would see, and the invitations to talk I have received.
 *
 * The preview is not a mock-up. It is the same record, rendered by the same
 * component, that a company opens — so "this is what companies will see" is
 * a statement the page can keep.
 */
import { useEffect, useState, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Briefcase, Check, Loader2, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TrackRecordView } from "@/components/company/talent-tab";
import { TALENT_ROLES, type TrackRecord } from "@shared/track-record";

interface Profile {
  open: boolean;
  headline: string | null;
  roles: string[];
  location: string | null;
  remote: boolean;
  updatedAt: string | null;
}

interface Invite {
  id: string;
  role: string | null;
  message: string;
  status: "sent" | "accepted" | "declined";
  createdAt: string;
  answeredAt: string | null;
  sentBy: string | null;
  company: { id: string; name: string; industry: string | null; website: string | null; size: string | null };
}

export default function TalentPage() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ profile: Profile; record: TrackRecord }>({ queryKey: ["/api/talent/me"] });
  const { data: inbox } = useQuery<{ invites: Invite[] }>({ queryKey: ["/api/talent/invites"] });

  const [headline, setHeadline] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [location, setLocation] = useState("");
  const [remote, setRemote] = useState(true);

  /*
   * The form starts from what is saved, once, when it first loads. It used to
   * re-seed on every change to `updatedAt` — and flipping the visibility
   * switch saves, which moves `updatedAt`, which put the saved headline and
   * roles back over whatever had been typed and not yet saved.
   */
  const seeded = useRef(false);
  useEffect(() => {
    if (!data || seeded.current) return;
    seeded.current = true;
    setHeadline(data.profile.headline ?? "");
    setRoles(data.profile.roles);
    setLocation(data.profile.location ?? "");
    setRemote(data.profile.remote);
  }, [data]);

  const save = useMutation({
    mutationFn: async (patch: Partial<Profile>) => (await apiRequest("PUT", "/api/talent/me", patch)).json(),
    onSuccess: (_r, patch) => {
      queryClient.invalidateQueries({ queryKey: ["/api/talent/me"] });
      if (patch.open !== undefined) {
        toast({ title: patch.open ? "Companies can now find you" : "You're hidden from companies", description: patch.open ? "They see the record below, and can invite you to talk." : "Nobody new can see your record or invite you." });
      } else {
        toast({ title: "Saved" });
      }
    },
    onError: (e) => toast({ title: "Couldn't save", description: errorText(e), variant: "destructive" }),
  });

  const answer = useMutation({
    mutationFn: async ({ id, accept }: { id: string; accept: boolean }) => (await apiRequest("POST", `/api/talent/invites/${id}/answer`, { accept })).json(),
    onSuccess: (r: { conversationWith: string | null }, v) => {
      queryClient.invalidateQueries({ queryKey: ["/api/talent/invites"] });
      toast({
        title: v.accept ? "You said yes" : "You said no",
        description: v.accept
          ? r.conversationWith ? "Their message is waiting in Messages, where you can reply." : "They've been told."
          : "They won't be told directly, and can't ask again.",
      });
    },
    onError: (e) => toast({ title: "Couldn't answer", description: errorText(e), variant: "destructive" }),
  });

  if (isLoading || !data) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  const { profile, record } = data;
  const toggleRole = (r: string) => setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));
  const waiting = inbox?.invites.filter((i) => i.status === "sent") ?? [];
  const answered = inbox?.invites.filter((i) => i.status !== "sent") ?? [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Briefcase className="h-6 w-6 text-primary" />Open to companies</h1>
        <p className="text-sm text-muted-foreground mt-1.5">
          Companies on SparkTower look for people who have shown good commercial judgement. You can let them see how you've played and ask you to talk.
        </p>
      </div>

      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="talent-open" className="text-base font-semibold">Let companies see my record</Label>
              <p className="text-sm text-muted-foreground mt-1">
                {profile.open ? "On. Companies can find you and invite you to talk." : "Off. No company can see your record or find you."}
              </p>
            </div>
            <Switch id="talent-open" checked={profile.open} disabled={save.isPending} onCheckedChange={(open) => save.mutate({ open })} data-testid="switch-talent-open" />
          </div>
          <div className="text-sm rounded-md bg-muted px-3 py-2.5 space-y-1.5">
            <p className="font-medium">What companies see when it's on</p>
            <ul className="list-disc pl-5 space-y-0.5 text-muted-foreground">
              <li>Your name, and the headline, roles, location and remote preference you set below.</li>
              <li>Your record from public simulation seasons: seats held, years you filed, yearly objectives, where your company finished.</li>
              <li>Your scores from the startup game.</li>
            </ul>
            <p className="font-medium pt-1">What they never see</p>
            <ul className="list-disc pl-5 space-y-0.5 text-muted-foreground">
              <li>Private training seasons run by a company, including your employer's.</li>
              <li>What you decided in any year, your messages, your projects' private details, or your email address.</li>
            </ul>
            <p className="text-muted-foreground pt-1">Each company can invite you once. You can turn this off at any time, and you'll disappear from their searches straight away.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Your record, as companies see it</CardTitle></CardHeader>
        <CardContent><TrackRecordView record={record} full /></CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">About you</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="talent-headline">Headline</Label>
            <Input id="talent-headline" value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={140} placeholder="e.g. Operations lead who likes a messy problem" data-testid="input-talent-headline" />
          </div>
          <div className="space-y-1.5">
            <Label>Roles you'd consider</Label>
            <div className="flex flex-wrap gap-1.5">
              {TALENT_ROLES.map((r) => (
                <button key={r} type="button" onClick={() => toggleRole(r)} data-testid={`toggle-role-${r}`}>
                  <Badge variant={roles.includes(r) ? "default" : "outline"} className="capitalize cursor-pointer">{r}</Badge>
                </button>
              ))}
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4 items-end">
            <div className="space-y-1">
              <Label htmlFor="talent-location">Location</Label>
              <Input id="talent-location" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={80} placeholder="City or region" data-testid="input-talent-location" />
            </div>
            <div className="flex items-center gap-2 pb-2">
              <Switch id="talent-remote" checked={remote} onCheckedChange={setRemote} data-testid="switch-talent-remote" />
              <Label htmlFor="talent-remote">Open to remote work</Label>
            </div>
          </div>
          <Button onClick={() => save.mutate({ headline, roles, location, remote })} disabled={save.isPending} data-testid="button-save-talent">
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Save
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Invitations</h2>
        {!inbox?.invites.length ? (
          <p className="text-sm text-muted-foreground">
            {profile.open ? "No invitations yet. When a company asks to talk, it will appear here and in your notifications." : "Turn on the switch above to let companies invite you."}
          </p>
        ) : (
          <>
            {waiting.map((i) => (
              <Card key={i.id} data-testid={`card-invite-${i.id}`}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{i.company.name}</span>
                    {i.company.industry && <Badge variant="outline">{i.company.industry}</Badge>}
                    {i.role && <Badge variant="secondary">{i.role}</Badge>}
                    <span className="text-xs text-muted-foreground ml-auto">{new Date(i.createdAt).toLocaleDateString()}</span>
                  </div>
                  {i.company.website && /^https?:\/\//i.test(i.company.website) && <a href={i.company.website} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">{i.company.website}</a>}
                  <p className="text-sm whitespace-pre-line">{i.message}</p>
                  <p className="text-xs text-muted-foreground">Saying yes opens a conversation with the person who asked. Saying no isn't sent to them; they just see it wasn't taken up.</p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => answer.mutate({ id: i.id, accept: true })} disabled={answer.isPending} data-testid={`button-accept-${i.id}`}>
                      <Check className="h-4 w-4 mr-1" />Accept
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => answer.mutate({ id: i.id, accept: false })} disabled={answer.isPending} data-testid={`button-decline-${i.id}`}>
                      <X className="h-4 w-4 mr-1" />Decline
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            {answered.length > 0 && (
              <div className="border rounded-md divide-y">
                {answered.map((i) => (
                  <div key={i.id} className="px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span><span className="font-medium">{i.company.name}</span>{i.role && <span className="text-muted-foreground"> · {i.role}</span>}</span>
                    <span className="flex items-center gap-2">
                      <Badge variant={i.status === "accepted" ? "default" : "outline"}>{i.status === "accepted" ? "You said yes" : "You said no"}</Badge>
                      {/* No sender once their account is gone: the conversation is with whoever the company put forward, not "null". */}
                      {i.status === "accepted" && i.sentBy && <Link href={`/messages?with=${i.sentBy}`} className="text-xs text-primary hover:underline">Open conversation</Link>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
