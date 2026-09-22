import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import NotFound from "@/pages/not-found";
import { Loader2, Trophy, Plus } from "lucide-react";
import {
  CONTEST_DIFFICULTIES, CONTEST_STATUSES, CONTEST_TITLE_MAX, CONTEST_DESCRIPTION_MAX,
} from "@shared/contests";

interface ContestRow {
  id: string; title: string; description: string; category: string;
  difficulty: string; status: string; prize: string | null; badgeId: string | null;
  startDate: string; endDate: string; maxParticipants: number | null;
  promoted: boolean; participantCount: number;
}
interface BadgeRow { id: string; name: string }

/** A date the `<input type="datetime-local">` control will accept. */
const forInput = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const blank = () => {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const end = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
  return {
    id: null as string | null,
    title: "", description: "", category: "Build", difficulty: "intermediate", status: "upcoming",
    prize: "", badgeId: "", startDate: forInput(start.toISOString()), endDate: forInput(end.toISOString()),
    maxParticipants: "", promoted: false,
  };
};

/**
 * Making a contest.
 *
 * The Contests page has been in the main navigation with a detail page, a join
 * route and a submissions route since it shipped — and nothing anywhere could
 * create one, so it was an empty room with a permanent signpost to it. This is
 * the form that fills it. Admins only, and the server asks for a proved second
 * factor on top of the role: a contest is published to everybody.
 */
export default function AdminContests() {
  const { user, isLoading: authLoading } = useAuth();
  const isAdmin = (user as any)?.platformRole === "admin";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<{ contests: ContestRow[]; badges: BadgeRow[] }>({
    queryKey: ["/api/admin/contests"],
    enabled: isAdmin,
  });
  const [form, setForm] = useState(blank());

  const contests = useMemo(() => data?.contests ?? [], [data]);
  const set = (patch: Partial<ReturnType<typeof blank>>) => setForm((f) => ({ ...f, ...patch }));

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        title: form.title, description: form.description, category: form.category,
        difficulty: form.difficulty, status: form.status,
        prize: form.prize || null, badgeId: form.badgeId || null,
        // Sent as an ISO string so the server reads one instant, whatever
        // timezone the browser filling the form happens to be in.
        startDate: form.startDate ? new Date(form.startDate).toISOString() : "",
        endDate: form.endDate ? new Date(form.endDate).toISOString() : "",
        maxParticipants: form.maxParticipants === "" ? null : Number(form.maxParticipants),
        promoted: form.promoted,
      };
      const res = form.id
        ? await apiRequest("PUT", `/api/admin/contests/${form.id}`, body)
        : await apiRequest("POST", "/api/admin/contests", body);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: form.id ? "Contest saved" : "Contest created" });
      setForm(blank());
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/contests"] });
      // The public list reads its own endpoint; it would otherwise show the
      // old set until something else happened to refetch it.
      void queryClient.invalidateQueries({ queryKey: ["/api/contests"] });
    },
    onError: (e) => toast({ title: "Couldn't save that", description: errorText(e), variant: "destructive" }),
  });

  const edit = (c: ContestRow) => setForm({
    id: c.id, title: c.title, description: c.description, category: c.category,
    difficulty: c.difficulty, status: c.status, prize: c.prize ?? "", badgeId: c.badgeId ?? "",
    startDate: forInput(c.startDate), endDate: forInput(c.endDate),
    maxParticipants: c.maxParticipants == null ? "" : String(c.maxParticipants),
    promoted: c.promoted,
  });

  if (authLoading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (!isAdmin) return <NotFound />;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Trophy className="h-6 w-6 text-primary" />Contests</h1>
        <p className="text-sm text-muted-foreground">
          What the Contests page shows everyone. A contest can't be deleted once people have entered — close it by setting its status to completed.
        </p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">{form.id ? "Edit contest" : "New contest"}</h2>
            {form.id && <Button size="sm" variant="ghost" onClick={() => setForm(blank())} data-testid="contest-admin-cancel">Cancel</Button>}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="contest-title">Name</Label>
              <Input id="contest-title" maxLength={CONTEST_TITLE_MAX} value={form.title} onChange={(e) => set({ title: e.target.value })} data-testid="contest-admin-title" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="contest-description">What entrants are asked to do</Label>
              <Textarea id="contest-description" rows={4} maxLength={CONTEST_DESCRIPTION_MAX} value={form.description} onChange={(e) => set({ description: e.target.value })} data-testid="contest-admin-description" />
            </div>
            <div>
              <Label htmlFor="contest-category">Category</Label>
              <Input id="contest-category" value={form.category} onChange={(e) => set({ category: e.target.value })} data-testid="contest-admin-category" />
            </div>
            <div>
              <Label htmlFor="contest-prize">Prize</Label>
              <Input id="contest-prize" value={form.prize} onChange={(e) => set({ prize: e.target.value })} placeholder="Optional" data-testid="contest-admin-prize" />
            </div>
            <div>
              <Label htmlFor="contest-difficulty">Difficulty</Label>
              <select id="contest-difficulty" className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={form.difficulty} onChange={(e) => set({ difficulty: e.target.value })} data-testid="contest-admin-difficulty">
                {CONTEST_DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="contest-status">Status</Label>
              <select id="contest-status" className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={form.status} onChange={(e) => set({ status: e.target.value })} data-testid="contest-admin-status">
                {CONTEST_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="contest-start">Opens</Label>
              <Input id="contest-start" type="datetime-local" value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} data-testid="contest-admin-start" />
            </div>
            <div>
              <Label htmlFor="contest-end">Closes</Label>
              <Input id="contest-end" type="datetime-local" value={form.endDate} onChange={(e) => set({ endDate: e.target.value })} data-testid="contest-admin-end" />
            </div>
            <div>
              <Label htmlFor="contest-max">Entrant cap</Label>
              <Input id="contest-max" type="number" min={1} value={form.maxParticipants} onChange={(e) => set({ maxParticipants: e.target.value })} placeholder="No cap" data-testid="contest-admin-max" />
            </div>
            <div>
              <Label htmlFor="contest-badge">Badge for entrants</Label>
              <select id="contest-badge" className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={form.badgeId} onChange={(e) => set({ badgeId: e.target.value })} data-testid="contest-admin-badge">
                <option value="">None</option>
                {(data?.badges ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Switch id="contest-promoted" checked={form.promoted} onCheckedChange={(v) => set({ promoted: v })} data-testid="contest-admin-promoted" />
              <Label htmlFor="contest-promoted" className="text-sm font-normal">Pin to the top of the Contests page</Label>
            </div>
          </div>

          <Button onClick={() => save.mutate()} disabled={save.isPending} className="gap-1" data-testid="contest-admin-save">
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {form.id ? "Save changes" : "Create contest"}
          </Button>
        </CardContent>
      </Card>

      {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : contests.length === 0 ? (
        <p className="text-sm text-muted-foreground">No contests yet. The one above will be the first.</p>
      ) : (
        <div className="space-y-2" data-testid="contest-admin-list">
          {contests.map((c) => (
            <Card key={c.id}>
              <CardContent className="p-3 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-[14rem]">
                  <div className="font-medium text-sm flex items-center gap-2">
                    {c.title}
                    {c.promoted && <Badge variant="secondary" className="text-[10px]">pinned</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {c.status} · {c.participantCount} entered{c.maxParticipants ? ` of ${c.maxParticipants}` : ""} · closes {new Date(c.endDate).toLocaleDateString()}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => edit(c)} data-testid={`contest-admin-edit-${c.id}`}>Edit</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
