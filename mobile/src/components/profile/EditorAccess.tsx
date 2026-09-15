/**
 * Editor access: the tokens that connect VS Code, Claude Code or Cursor to
 * Nova — the profile's version of client/src/components/editor-access.tsx.
 *
 * Nobody writes code on a phone, but this is where you look to see what has
 * access to your account and take it away, and a token made here can be sent
 * to your laptop with the share sheet. The token is shown once, as on the web:
 * the server keeps only a hash.
 */
import { useState } from "react";
import { Platform, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, API_URL } from "../../api/client";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Btn, Chip, Icon, Meta, Row } from "../ui";
import { Sheet, type Notice } from "../Sheet";
import { OutlineButton, PCard, Pill, StrongTitle } from "./kit";

interface TokenRow {
  id: string;
  label: string;
  prefix: string;
  projectId: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

const when = (v: string | null) => (v ? new Date(v).toLocaleDateString() : null);

const mcpConfig = (token: string) => JSON.stringify({
  mcpServers: { nova: { command: "npx", args: ["-y", "@sparktower/nova-mcp"], env: { NOVA_TOKEN: token, NOVA_BASE_URL: API_URL } } },
}, null, 2);

/** Copies on the web preview; on a phone, hands the text to the share sheet (which offers Copy). */
async function copyOrShare(text: string): Promise<"copied" | "shared"> {
  const nav: any = Platform.OS === "web" ? (globalThis as any).navigator : null;
  if (nav?.clipboard?.writeText) {
    await nav.clipboard.writeText(text);
    return "copied";
  }
  await Share.share({ message: text });
  return "shared";
}

export function EditorAccess({ notify }: { notify: (n: Notice) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["mcp-tokens"], queryFn: () => api<{ tokens: TokenRow[] }>("/api/mcp-tokens") });
  const { data: projects } = useQuery({ queryKey: ["user-projects"], queryFn: () => api<any[]>("/api/user/projects") });

  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/mcp-tokens/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["mcp-tokens"] });
      notify({ text: "Token revoked. Any editor using it stops working on its next request.", tone: "success" });
    },
    onError: (e: any) => notify({ text: e?.message || "Couldn't revoke that", tone: "error" }),
  });

  const tokens = data?.tokens ?? [];
  const projectName = (id: string | null) => projects?.find((p) => p.id === id)?.title ?? "one project";

  return (
    <PCard style={{ gap: spacing.lg }}>
      <StrongTitle icon="terminal-outline">Editor access</StrongTitle>
      <Text style={{ fontSize: font.sm, lineHeight: 20, fontFamily: fontFamily.regular, color: colors.textTertiary }}>
        Nova can work alongside your editor. Nova holds the plan — the path, the next milestone, what counts as done — and
        your editor does the reading and the writing. A token connects them.
      </Text>
      <Btn label="New token" icon="add" small style={{ alignSelf: "flex-start" }} onPress={() => setOpen(true)} />

      {isLoading ? (
        <Meta style={{ fontSize: font.sm }}>Loading…</Meta>
      ) : tokens.length === 0 ? (
        <Meta style={{ fontSize: font.sm }}>No tokens yet.</Meta>
      ) : (
        <View style={{ gap: spacing.sm }}>
          {tokens.map((t) => (
            <View key={t.id} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.md }}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text }} numberOfLines={1}>{t.label}</Text>
                <Row wrap gap={6} center>
                  <Text style={{ fontSize: font.xs, fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }), color: colors.textTertiary }}>{t.prefix}…</Text>
                  {t.projectId ? <Pill label={`${projectName(t.projectId)} only`} variant="secondary" /> : null}
                  <Meta>{when(t.lastUsedAt) ? `last used ${when(t.lastUsedAt)}` : "never used"}</Meta>
                  {when(t.expiresAt) ? <Meta>expires {when(t.expiresAt)}</Meta> : null}
                </Row>
              </View>
              <Pressable onPress={() => revoke.mutate(t.id)} disabled={revoke.isPending} hitSlop={8} accessibilityLabel={`Revoke ${t.label}`}>
                <Icon name="trash-outline" size={18} color={colors.textSecondary} />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {open && <TokenSheet projects={projects ?? []} onClose={() => setOpen(false)} notify={notify} />}
    </PCard>
  );
}

function TokenSheet({ projects, onClose, notify }: { projects: any[]; onClose: () => void; notify: (n: Notice) => void }) {
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [pinned, setPinned] = useState<string | null>(null);
  /** Held until the sheet closes. Never refetchable. */
  const [minted, setMinted] = useState<string | null>(null);
  const [tab, setTab] = useState<"vscode" | "agent">("vscode");

  const create = useMutation({
    mutationFn: () => api<{ token: string }>("/api/mcp-tokens", { method: "POST", body: { label, projectId: pinned } }),
    onSuccess: (body) => { setMinted(body.token); void qc.invalidateQueries({ queryKey: ["mcp-tokens"] }); },
    onError: (e: any) => notify({ text: e?.message || "Couldn't create that token", tone: "error" }),
  });

  const copy = (text: string) => copyOrShare(text)
    .then((how) => { if (how === "copied") notify({ text: "Copied", tone: "success" }); })
    .catch(() => notify({ text: "Couldn't copy. Select the text and copy it by hand.", tone: "error" }));

  const mono = { fontSize: font.xs, fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }), color: colors.text } as const;

  return (
    <Sheet
      visible
      onClose={onClose}
      title={minted ? "Copy your token now" : "Connect your editor"}
      subtitle={minted
        ? "This is the only time it's shown. If you lose it, revoke it and make another."
        : "Nova holds the plan — the path, the next milestone, what counts as done. Your editor does the reading and the writing."}
    >
      {minted ? (
        <ScrollView style={{ maxHeight: 440 }} contentContainerStyle={{ gap: spacing.md }}>
          <Row gap={spacing.sm} center>
            <Text selectable style={[mono, { flex: 1, backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, padding: spacing.sm }]}>{minted}</Text>
            <OutlineButton label="Copy" icon="copy-outline" onPress={() => copy(minted)} />
          </Row>
          <Row gap={spacing.sm}>
            <Chip label="VS Code extension" active={tab === "vscode"} onPress={() => setTab("vscode")} />
            <Chip label="Claude Code / Cursor" active={tab === "agent"} onPress={() => setTab("agent")} />
          </Row>
          {tab === "vscode" ? (
            <View style={{ gap: spacing.sm }}>
              <Text style={hint}>Install Nova for SparkTower from the Extensions view, then:</Text>
              <Text style={hint}>1. Open the command palette — ⌘⇧P / Ctrl+Shift+P</Text>
              <Text style={hint}>2. Run Nova: Set the server URL and enter <Text style={mono}>{API_URL}</Text></Text>
              <Text style={hint}>3. Run Nova: Sign in and paste the token above</Text>
              <Text style={hint}>4. Run Nova: Choose project</Text>
              <Meta style={{ lineHeight: 16 }}>The path appears under the Nova icon in the activity bar. The token is kept in VS Code's secret storage, not in your settings.</Meta>
            </View>
          ) : (
            <View style={{ gap: spacing.sm }}>
              <Text style={hint}>Add this to your MCP client config — Claude Code, Cursor, or VS Code's agent mode. It already points at <Text style={mono}>{API_URL}</Text>.</Text>
              <Text selectable style={[mono, { backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, padding: spacing.md }]}>{mcpConfig(minted)}</Text>
              <OutlineButton label="Copy config" icon="copy-outline" style={{ alignSelf: "flex-start" }} onPress={() => copy(mcpConfig(minted))} />
            </View>
          )}
          <Btn label="Done" onPress={onClose} />
        </ScrollView>
      ) : (
        <View style={{ gap: spacing.md }}>
          <View style={{ gap: 6 }}>
            <Text style={labelStyle}>Name this token</Text>
            <TextInput value={label} onChangeText={setLabel} placeholder="MacBook · VS Code" placeholderTextColor={colors.textTertiary} maxLength={80}
              onSubmitEditing={() => { if (label.trim()) create.mutate(); }}
              style={{ backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, height: 42, fontFamily: fontFamily.regular, fontSize: font.base, color: colors.text }} />
            <Meta>So you'll know which one to revoke later.</Meta>
          </View>
          <View style={{ gap: 6 }}>
            <Text style={labelStyle}>Which project can it reach?</Text>
            <Row wrap gap={6}>
              <Chip label="All my projects" active={pinned === null} onPress={() => setPinned(null)} />
              {projects.map((p) => <Chip key={p.id} label={p.title} active={pinned === p.id} onPress={() => setPinned(p.id)} />)}
            </Row>
            <Meta>A token that lives in one repository should only reach that repository's project.</Meta>
          </View>
          <Btn label="Create token" loading={create.isPending} disabled={!label.trim()} onPress={() => create.mutate()} />
        </View>
      )}
    </Sheet>
  );
}

const hint = { fontSize: font.sm, lineHeight: 20, fontFamily: fontFamily.regular, color: colors.textSecondary } as const;
const labelStyle = { fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text } as const;
