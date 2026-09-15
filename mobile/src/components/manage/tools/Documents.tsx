/**
 * "New document with Nova": the ask, then Nova plans the document's shape.
 * Editing happens on the document's own screen, the same path the web uses.
 */
import { useState } from "react";
import { View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../api/client";
import { spacing } from "../../../theme";
import { Btn, ErrorNote, Meta, Row, errText } from "../../ui";
import { EditorSheet } from "../bits";
import { mkey } from "../shared";
import { Input, PlanNote, ShortOfCredits, invalidateCredits, useCredits } from "./kit";

/** Collects the ask, has Nova plan the structure, then opens the document screen on it (app/project/[id]/documents/[docId].tsx). */
export function DocumentStartSheet({ projectId, visible, onClose, onCreated }: { projectId: string; visible: boolean; onClose: () => void; onCreated: (docId: string) => void }) {
  const qc = useQueryClient();
  const { can, cost, cantAfford, creditsRemaining } = useCredits();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pageHint, setPageHint] = useState("");
  const [error, setError] = useState<string | null>(null);
  const price = cost("documentPlan");

  const plan = useMutation({
    mutationFn: () => api<{ document: { id: string } }>(`/api/projects/${projectId}/documents/plan`, {
      method: "POST", body: { title, description, pageHint: pageHint ? Number(pageHint) : undefined },
    }),
    onMutate: () => setError(null),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: mkey(projectId, "documents") });
      void invalidateCredits(qc);
      setTitle(""); setDescription(""); setPageHint("");
      onCreated(r.document.id);
    },
    onError: (e) => setError(errText(e, "Nova couldn't plan that document.")),
  });

  return (
    <EditorSheet visible={visible} onClose={onClose} title="Build this document with Nova"
      subtitle="Nova works out how many pages it needs, lays out a grid, and writes a headline for every block. You approve the shape before anything gets written."
      footer={
        <Row gap={spacing.sm} style={{ justifyContent: "flex-end" }}>
          <Btn small variant="outline" label="Cancel" onPress={onClose} />
          <Btn small icon="sparkles" label={plan.isPending ? "Nova is planning…" : `Plan it (${price})`} loading={plan.isPending}
            disabled={!title.trim() || cantAfford("documentPlan")} onPress={() => plan.mutate()} />
        </Row>
      }>
      {!can("aiMilestones") && <PlanNote title="The document builder is on the Builder plan" body="Have a look around — starting one will tell you what to upgrade to." />}
      {error ? <ErrorNote message={error} /> : null}
      <Input label="What's the document? *" value={title} onChangeText={setTitle} placeholder="e.g. Write the 1-page weekly check-in loop spec" />
      <Input label="What has to be in it?" value={description} onChangeText={setDescription} multiline rows={5}
        placeholder="The more specific the better — exact sections, what's explicitly out of scope, what you'll measure against." />
      <View style={{ gap: spacing.xs }}>
        <View style={{ width: 200 }}><Input label="Roughly how many pages? (optional)" value={pageHint} numeric onChangeText={(v) => setPageHint(v.replace(/[^0-9]/g, "").slice(0, 2))} placeholder="Leave blank and Nova decides" /></View>
        <Meta>Nova won't pad a one-pager, and it'll build out a chaptered plan with a title page when the work actually calls for one.</Meta>
      </View>
      {cantAfford("documentPlan") && <ShortOfCredits what="A document plan" cost={price} have={creditsRemaining} />}
    </EditorSheet>
  );
}
