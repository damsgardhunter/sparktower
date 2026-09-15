/**
 * Starting a section asks one thing — what kind of project it is for that
 * path — then starts it. The native start-section-dialog.tsx.
 */
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Btn, ErrorNote, Icon, NovaGradient, errText } from "../ui";
import { Sheet } from "../Sheet";
import { useNotify } from "./bits";
import { sectionDef, subcategoriesFor, tracksKey, type ProjectGoal } from "../../sections";

export function StartSectionSheet({ projectId, goal, onClose, onStarted }: {
  projectId: string;
  goal: ProjectGoal | null;
  onClose: () => void;
  onStarted?: (goal: ProjectGoal) => void;
}) {
  const qc = useQueryClient();
  const { notify } = useNotify();
  const [kind, setKind] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setKind(null); setError(null); }, [goal]);

  const start = useMutation({
    mutationFn: (vars: { goal: ProjectGoal; subcategory: string }) => api(`/api/projects/${projectId}/tracks`, { method: "POST", body: vars }),
    onSuccess: async (_r, vars) => {
      await Promise.all(["tracks", "path", "kanban", "milestones"].map((k) => qc.invalidateQueries({ queryKey: ["manage", projectId, k] })));
      void qc.invalidateQueries({ queryKey: tracksKey(projectId) });
      void qc.invalidateQueries({ queryKey: ["next-steps"] });
      notify(`${sectionDef(vars.goal).label} started`);
      onStarted?.(vars.goal);
      onClose();
    },
    onError: (e) => setError(errText(e, "Couldn't start that section. Try again in a moment.")),
  });

  if (!goal) return null;
  const def = sectionDef(goal);
  const kinds = subcategoriesFor(goal);

  return (
    <Sheet visible={!!goal} onClose={onClose} title={`Start ${def.label}`} subtitle={def.blurb}>
      <View style={{ gap: spacing.md }} testID="start-section-sheet">
        <Row>
          <NovaGradient style={{ width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" }}>
            <Icon name={def.icon} size={20} color="#FFFFFF" />
          </NovaGradient>
          <Text style={{ flex: 1, fontSize: font.base, fontFamily: fontFamily.semibold, color: colors.text }}>{def.kindQuestion}</Text>
        </Row>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {kinds.map((k) => {
            const on = kind === k.id;
            return (
              <Pressable
                key={k.id}
                onPress={() => setKind(k.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                testID={`start-kind-${k.id}`}
                style={({ pressed }) => [{
                  width: "48%", flexGrow: 1, minHeight: 56, borderRadius: radius.md, borderWidth: 2,
                  borderColor: on ? colors.novaEmerald : colors.border, backgroundColor: on ? "#10B98112" : colors.surface,
                  paddingHorizontal: spacing.md, paddingVertical: spacing.md, flexDirection: "row", alignItems: "center", gap: 6,
                }, pressed && { opacity: 0.75 }]}
              >
                <Text style={{ flex: 1, fontSize: font.sm + 1, fontFamily: fontFamily.semibold, color: colors.text }}>{k.label}</Text>
                {on && <Icon name="checkmark-circle" size={18} color={colors.novaEmerald} />}
              </Pressable>
            );
          })}
        </View>
        {error ? <ErrorNote message={error} /> : null}
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm }}>
          <Btn small variant="ghost" label="Not now" onPress={onClose} />
          <Btn small icon="play" label="Start" disabled={!kind} loading={start.isPending} onPress={() => kind && start.mutate({ goal, subcategory: kind })} />
        </View>
      </View>
    </Sheet>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>{children}</View>;
}
