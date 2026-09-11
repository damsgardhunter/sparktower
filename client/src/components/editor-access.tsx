/**
 * Editor access: the tokens that connect VS Code, Claude Code or Cursor to Nova.
 *
 * Two surfaces onto the same thing, because they answer different questions.
 * The dashboard asks "can I work on this in my editor?" and wants one button
 * and the right default — a token pinned to the project you're looking at. The
 * profile asks "what has access to my account?" and wants the list, the last
 * time each was used, and a way to revoke.
 *
 * Both share the dialog, because the moment that matters is the same either
 * way: the token is shown once and never again, and that has to be said
 * *before* it disappears rather than after.
 */
import { errorText } from "@/lib/api-error";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy, Loader2, Plus, Terminal, Trash2, Check } from "lucide-react";
import type { Project } from "@shared/schema";

interface TokenRow {
  id: string;
  label: string;
  prefix: string;
  projectId: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

const NO_PIN = "__all__";
const when = (v: string | null) => (v ? new Date(v).toLocaleDateString() : null);

/**
 * The address this page is served from.
 *
 * The one thing nobody can guess and everybody has to get right. The extension
 * ships with a default that is a guess about a deployment, so a token from a
 * self-hosted or local instance fails with "couldn't reach Nova at" a domain
 * the person has never heard of — and nothing on the screen that produced the
 * token says otherwise. It does now: the browser knows where it is.
 */
const origin = () => (typeof window === "undefined" ? "" : window.location.origin);

const mcpConfig = (token: string) => JSON.stringify({
  mcpServers: {
    nova: {
      command: "npx",
      args: ["-y", "@sparktower/nova-mcp"],
      env: { NOVA_TOKEN: token, NOVA_BASE_URL: origin() },
    },
  },
}, null, 2);

/**
 * `vscode://…` — one click instead of three steps and a URL to copy.
 *
 * VS Code asks the person before handing this to the extension, and the
 * extension asks again before replacing a session, so the token in the link
 * can't connect anything silently.
 */
const vscodeLink = (token: string, projectId?: string | null) => {
  const params = new URLSearchParams({ url: origin(), token });
  if (projectId) params.set("project", projectId);
  return `vscode://sparktower.nova-sparktower/connect?${params.toString()}`;
};

function useCopy() {
  const { toast } = useToast();
  const [copied, setCopied] = useState<string | null>(null);
  return {
    copied,
    copy: async (text: string, key: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(key);
        setTimeout(() => setCopied(null), 1600);
      } catch {
        toast({ title: "Couldn't copy", description: "Select the text and copy it by hand.", variant: "destructive" });
      }
    },
  };
}

function CopyButton({ text, id, label }: { text: string; id: string; label?: string }) {
  const { copied, copy } = useCopy();
  return (
    <Button size="sm" variant="outline" onClick={() => copy(text, id)} data-testid={`button-copy-${id}`}>
      {copied === id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
      {label && <span className="ml-2">{copied === id ? "Copied" : label}</span>}
    </Button>
  );
}

/**
 * Creating one token.
 *
 * `defaultProjectId` is what makes this worth having on a dashboard: a token
 * created from a project is pinned to that project unless someone widens it,
 * so the token sitting in a repository's config reaches that repository's
 * project and nothing else in the account.
 */
function TokenDialog({
  open, onOpenChange, defaultProjectId,
}: { open: boolean; onOpenChange: (open: boolean) => void; defaultProjectId?: string | null }) {
  const { toast } = useToast();
  const [label, setLabel] = useState("");
  const [pinned, setPinned] = useState<string>(defaultProjectId ?? NO_PIN);
  /** Held until the dialog closes. Never refetchable — the server keeps only a hash. */
  const [minted, setMinted] = useState<string | null>(null);

  const { data: projects } = useQuery<Project[]>({ queryKey: ["/api/user/projects"], enabled: open });

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/mcp-tokens", { label, projectId: pinned === NO_PIN ? null : pinned });
      return res.json();
    },
    onSuccess: (body: { token: string }) => {
      setMinted(body.token);
      queryClient.invalidateQueries({ queryKey: ["/api/mcp-tokens"] });
    },
    onError: (err: any) => toast({ title: "Couldn't create that token", description: errorText(err), variant: "destructive" }),
  });

  const close = (value: boolean) => {
    onOpenChange(value);
    if (!value) { setMinted(null); setLabel(""); setPinned(defaultProjectId ?? NO_PIN); }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{minted ? "Copy your token now" : "Connect your editor"}</DialogTitle>
          <DialogDescription>
            {minted
              ? "This is the only time it's shown. If you lose it, revoke it and make another."
              : "Nova holds the plan — the path, the next milestone, what counts as done. Your editor does the reading and the writing."}
          </DialogDescription>
        </DialogHeader>

        {minted ? (
          <div className="space-y-5">
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-muted rounded p-2 break-all" data-testid="text-new-token">{minted}</code>
              <CopyButton text={minted} id="token" />
            </div>

            <Tabs defaultValue="vscode">
              <TabsList>
                <TabsTrigger value="vscode" data-testid="tab-connect-vscode">VS Code extension</TabsTrigger>
                <TabsTrigger value="agent" data-testid="tab-connect-agent">Claude Code / Cursor</TabsTrigger>
              </TabsList>

              <TabsContent value="vscode" className="space-y-3 pt-3">
                <p className="text-sm text-muted-foreground">
                  Install <strong>Nova for SparkTower</strong> from the Extensions view, then open it
                  with the token, the server and the project already filled in:
                </p>
                <Button asChild size="sm" data-testid="button-open-vscode">
                  <a href={vscodeLink(minted, pinned === NO_PIN ? null : pinned)}>Open in VS Code</a>
                </Button>

                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground">Or do it by hand</summary>
                  <ol className="space-y-1.5 list-decimal pl-5 pt-2">
                    <li>Open the command palette — <kbd className="text-xs bg-muted px-1 rounded">⌘⇧P</kbd> / <kbd className="text-xs bg-muted px-1 rounded">Ctrl+Shift+P</kbd></li>
                    <li>Run <strong>Nova: Set the server URL</strong> and enter <code className="text-xs bg-muted px-1 rounded" data-testid="text-server-url">{origin()}</code></li>
                    <li>Run <strong>Nova: Sign in</strong> and paste the token above</li>
                    <li>Run <strong>Nova: Choose project</strong></li>
                  </ol>
                </details>

                <p className="text-xs text-muted-foreground">
                  The path appears under the Nova icon in the activity bar. The token is kept in VS Code's
                  secret storage, not in your settings.
                </p>
              </TabsContent>

              <TabsContent value="agent" className="space-y-3 pt-3">
                <p className="text-sm text-muted-foreground">
                  Add this to your MCP client config — Claude Code, Cursor, or VS Code's agent mode.
                  It already points at <code className="text-xs bg-muted px-1 rounded">{origin()}</code>.
                </p>
                <pre className="text-xs bg-muted rounded p-3 overflow-x-auto">{mcpConfig(minted)}</pre>
                <CopyButton text={mcpConfig(minted)} id="config" label="Copy config" />
              </TabsContent>
            </Tabs>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="token-label">Name this token</Label>
              <Input
                id="token-label" value={label} onChange={(e) => setLabel(e.target.value)}
                placeholder="MacBook · VS Code" data-testid="input-token-label"
                onKeyDown={(e) => { if (e.key === "Enter" && label.trim()) create.mutate(); }}
              />
              <p className="text-xs text-muted-foreground">So you'll know which one to revoke later.</p>
            </div>
            <div className="space-y-2">
              <Label>Which project can it reach?</Label>
              <Select value={pinned} onValueChange={setPinned}>
                <SelectTrigger data-testid="select-token-project"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PIN}>All my projects</SelectItem>
                  {(projects ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                A token that lives in one repository should only reach that repository's project.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          {minted ? (
            <Button onClick={() => close(false)} data-testid="button-done-token">Done</Button>
          ) : (
            <Button onClick={() => create.mutate()} disabled={!label.trim() || create.isPending} data-testid="button-confirm-token">
              {create.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Create token
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The dashboard's version: one line and one button.
 *
 * Loud while there's nothing connected, quiet once there is. An affordance
 * that keeps shouting after you've used it is one people learn to look past,
 * and this one has to still be findable in six months when they get a new
 * laptop.
 */
export function ConnectEditorBar({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery<{ tokens: TokenRow[] }>({ queryKey: ["/api/mcp-tokens"] });

  const tokens = data?.tokens ?? [];
  const connected = tokens.some((t) => !t.projectId || t.projectId === projectId);
  const count = tokens.filter((t) => !t.projectId || t.projectId === projectId).length;

  /*
   * The dialog is rendered in one fixed position, outside the branch.
   *
   * It used to live inside each arm of the conditional, which cost someone
   * their token: creating one invalidates the token list, the list comes back
   * non-empty, this flips from the invitation to the connected line — and the
   * dialog in the old arm unmounts, taking with it the only copy of a secret
   * the server keeps no plaintext of. React sees two different positions as
   * two different components; the fix is to have only one position.
   */
  return (
    <>
      {isLoading ? null : connected ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="editor-connected">
          <Terminal className="w-3.5 h-3.5" />
          <span>Editor connected — {count} token{count === 1 ? "" : "s"}.</span>
          <button className="underline hover:text-foreground" onClick={() => setOpen(true)} data-testid="button-new-token-inline">
            New token
          </button>
          <a className="underline hover:text-foreground" href="/profile#editor">Manage</a>
        </div>
      ) : (
        <Card className="border-primary/30 bg-primary/5" data-testid="card-connect-editor">
          <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <Terminal className="w-5 h-5 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">Work on this project in your editor</p>
              <p className="text-xs text-muted-foreground">
                Nova's next step, the build packet and the verification — in VS Code, Claude Code or Cursor.
              </p>
            </div>
            <Button size="sm" onClick={() => setOpen(true)} data-testid="button-connect-editor">
              <Plus className="w-4 h-4 mr-1.5" /> Connect
            </Button>
          </CardContent>
        </Card>
      )}

      <TokenDialog open={open} onOpenChange={setOpen} defaultProjectId={projectId} />
    </>
  );
}

/** The profile's version: what has access to this account, and how to take it away. */
export function EditorAccess() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery<{ tokens: TokenRow[] }>({ queryKey: ["/api/mcp-tokens"] });
  const { data: projects } = useQuery<Project[]>({ queryKey: ["/api/user/projects"] });

  const revoke = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `/api/mcp-tokens/${id}`, undefined)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mcp-tokens"] });
      toast({ title: "Token revoked", description: "Any editor using it stops working on its next request." });
    },
    onError: (err: any) => toast({ title: "Couldn't revoke that", description: errorText(err), variant: "destructive" }),
  });

  const tokens = data?.tokens ?? [];
  const projectName = (id: string | null) => projects?.find((p) => p.id === id)?.title ?? "one project";

  return (
    <Card data-testid="card-editor-access">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Terminal className="w-5 h-5" /> Editor access
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground max-w-2xl">
          Nova can work alongside your editor. Nova holds the plan — the path, the next milestone,
          what counts as done — and your editor does the reading and the writing. A token connects them.
        </p>

        <Button onClick={() => setOpen(true)} data-testid="button-create-token">
          <Plus className="w-4 h-4 mr-2" /> New token
        </Button>

        {isLoading ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : tokens.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tokens yet.</p>
        ) : (
          <div className="space-y-2" data-testid="list-tokens">
            {tokens.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-4 border rounded-lg p-3" data-testid={`token-${t.id}`}>
                <div className="min-w-0">
                  <div className="font-medium truncate">{t.label}</div>
                  <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-2 mt-1">
                    <code>{t.prefix}…</code>
                    {t.projectId && <Badge variant="secondary">{projectName(t.projectId)} only</Badge>}
                    {/* Answers "is anything still using this?" before someone revokes it. */}
                    <span>{when(t.lastUsedAt) ? `last used ${when(t.lastUsedAt)}` : "never used"}</span>
                    {when(t.expiresAt) && <span>expires {when(t.expiresAt)}</span>}
                  </div>
                </div>
                <Button
                  variant="ghost" size="sm"
                  onClick={() => revoke.mutate(t.id)} disabled={revoke.isPending}
                  data-testid={`button-revoke-${t.id}`}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      <TokenDialog open={open} onOpenChange={setOpen} />
    </Card>
  );
}
