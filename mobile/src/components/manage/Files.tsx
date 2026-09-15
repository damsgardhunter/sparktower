/**
 * Files & Assets — the native counterpart of FilesTab in
 * client/src/pages/project-manager.tsx: Nova documents first, then uploads,
 * a folder filter, and upload / open / delete. New Nova documents are built
 * page by page on the website.
 */
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as DocumentPicker from "expo-document-picker";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_URL, api, uploadFile } from "../../api/client";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Btn, Card, Icon, IconButton, Loading, Meta, Row, Segments, assetUri } from "../ui";
import { Overline, Tag, openWeb, useNotify } from "./bits";
import { mkey } from "./shared";

const FILE_FOLDERS = ["general", "design", "docs", "data"];

export function Files({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { notify, fail } = useNotify();
  const [filter, setFilter] = useState("all");
  const [folder, setFolder] = useState("general");
  const [uploading, setUploading] = useState(false);

  const { data: files = [], isLoading } = useQuery({
    queryKey: mkey(projectId, "files"),
    queryFn: () => api<any[]>(`/api/projects/${projectId}/files`),
  });
  const { data: documents = [] } = useQuery({
    queryKey: mkey(projectId, "documents"),
    queryFn: () => api<any[]>(`/api/projects/${projectId}/documents`).catch(() => []),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: mkey(projectId, "files") });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/files/${id}`, { method: "DELETE" }),
    onSuccess: () => { void refresh(); notify("File deleted.", "info"); },
    onError: (e) => fail(e, "Couldn't delete that file."),
  });

  const upload = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (picked.canceled || !picked.assets?.[0]) return;
      const file = picked.assets[0];
      setUploading(true);
      const objectPath = await uploadFile({ uri: file.uri, name: file.name, mimeType: file.mimeType, size: file.size });
      await api(`/api/projects/${projectId}/files`, {
        method: "POST",
        body: { name: file.name, url: objectPath, fileType: file.mimeType || "application/octet-stream", size: file.size ?? null, folder },
      });
      await refresh();
      notify("File uploaded.");
    } catch (e) {
      fail(e, "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const folders = Array.from(new Set([...FILE_FOLDERS, ...files.map((f) => f.folder || "general")]));
  const shown = filter === "all" ? files : files.filter((f) => f.folder === filter);

  return (
    <View style={{ gap: spacing.md }}>
      <Card>
        <Text style={{ fontSize: font.lg, fontFamily: fontFamily.semibold, color: colors.text }}>Files & Assets</Text>
        <Meta style={{ fontSize: font.sm }}>
          {files.length} file{files.length === 1 ? "" : "s"}
          {documents.length > 0 ? ` · ${documents.length} Nova document${documents.length === 1 ? "" : "s"}` : ""}
        </Meta>
        <Row wrap gap={spacing.sm}>
          <Btn small icon="document-text-outline" label="New document with Nova" onPress={() => openWeb(`/projects/${projectId}/manage?tab=files`)} />
          <Btn small variant="outline" icon="cloud-upload-outline" label={`Upload to ${folder}`} loading={uploading} onPress={upload} />
        </Row>
        <Row wrap gap={6} center>
          <Meta>Upload folder:</Meta>
          {folders.map((f) => (
            <Pressable key={f} onPress={() => setFolder(f)} hitSlop={4}>
              <Tag label={f} solid={folder === f} color={folder === f ? colors.primary : colors.textSecondary} />
            </Pressable>
          ))}
        </Row>
      </Card>

      <Segments options={[{ value: "all", label: "All" }, ...folders.map((f) => ({ value: f, label: f }))]} value={filter} onChange={setFilter} />

      {filter === "all" && documents.length > 0 && (
        <View style={{ gap: spacing.sm }}>
          <Overline>Nova documents</Overline>
          {documents.map((d) => (
            <Pressable key={d.id} onPress={() => openWeb(`/projects/${projectId}/documents/${d.id}`)}
              style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: `${colors.primary}33` }, pressed && { opacity: 0.7 }]}>
              <Icon name="document-text" size={20} color={colors.primary} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text numberOfLines={1} style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.text }}>{d.title}</Text>
                <Meta>{d.status} · {d.pageCount} page{d.pageCount === 1 ? "" : "s"} · edited {new Date(d.updatedAt).toLocaleDateString()}</Meta>
              </View>
              <IconButton name="open-outline" size={17} label="Open the PDF" color={colors.textTertiary}
                onPress={() => { void WebBrowser.openBrowserAsync(`${API_URL}/api/documents/${d.id}/pdf`).catch(() => {}); }} />
            </Pressable>
          ))}
        </View>
      )}

      {isLoading ? <Loading /> : shown.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          {filter === "all" && documents.length > 0 && <Overline>Uploads</Overline>}
          {shown.map((file) => (
            <Card key={file.id} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              <Icon name="document-outline" size={20} color={colors.textTertiary} />
              <Pressable style={{ flex: 1, gap: 2 }} onPress={() => { const u = assetUri(file.url); if (u) void WebBrowser.openBrowserAsync(u).catch(() => {}); }}>
                <Text numberOfLines={1} style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.text }}>{file.name}</Text>
                <Meta numberOfLines={1}>
                  {[file.folder, file.uploader?.firstName || file.uploader?.email || "Unknown", new Date(file.createdAt).toLocaleDateString(), file.size ? `${(file.size / 1024).toFixed(0)}KB` : null].filter(Boolean).join(" · ")}
                </Meta>
              </Pressable>
              <IconButton name="trash-outline" size={18} label="Delete file" color={colors.textTertiary} onPress={() => remove.mutate(file.id)} />
            </Card>
          ))}
        </View>
      ) : (
        <View style={{ borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.md, padding: spacing.xl, alignItems: "center", gap: spacing.sm }}>
          <Icon name="folder-open-outline" size={40} color={colors.textTertiary} />
          <Text style={{ fontSize: font.base, fontFamily: fontFamily.medium, color: colors.text }}>No files yet</Text>
          <Meta style={{ textAlign: "center", fontSize: font.sm }}>Upload files to share with your team, or have Nova build a document from scratch.</Meta>
        </View>
      )}
    </View>
  );
}
