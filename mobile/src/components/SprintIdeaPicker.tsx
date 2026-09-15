import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { colors, font, fontFamily, radius, spacing } from "../theme";
import { Btn, ErrorNote, Icon, NovaGradient, errText } from "./ui";
import { Pill } from "./MoreKit";
import type { SprintIdea } from "./SprintKit";

/**
 * Three sprint ideas from Nova to pick from — the web's SprintIdeaPicker.
 * Name and hook first, then the pitch, then twist and audience as labelled
 * rows, so each card can be judged at a glance.
 */
export function SprintIdeaPicker({ productStyle, partnerId, onChoose, isSubmitting, chooseLabel = "Build this one" }: {
  productStyle: string;
  partnerId?: string;
  onChoose: (idea: SprintIdea) => void;
  isSubmitting?: boolean;
  chooseLabel?: string;
}) {
  const qc = useQueryClient();
  const [ideas, setIdeas] = useState<SprintIdea[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = useMutation({
    mutationFn: () => api<{ ideas: SprintIdea[] }>("/api/sprints/idea-options", { method: "POST", body: { productStyle, partnerId } }),
    onSuccess: (r) => {
      setIdeas(r.ideas || []);
      setSelected(null);
      setError(null);
      qc.invalidateQueries({ queryKey: ["subscription"] });
    },
    onError: (e) => setError(errText(e, "Nova couldn't come up with ideas right now.")),
  });

  if (ideas.length === 0) {
    return (
      <View style={{ borderRadius: radius.md, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.border, padding: spacing.lg, alignItems: "center", gap: spacing.sm }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
          <Icon name="bulb" size={22} color={colors.primary} />
        </View>
        <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>Need something to build?</Text>
        <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, textAlign: "center", fontFamily: fontFamily.regular }}>
          Nova will pitch three ideas for this style. Pick whichever sounds most fun — you can reshuffle if none land.
        </Text>
        <Btn label={generate.isPending ? "Nova is thinking…" : "Show me 3 ideas"} icon="sparkles" loading={generate.isPending} onPress={() => generate.mutate()} />
        <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular }}>1 credit for all three</Text>
        {error && <ErrorNote message={error} />}
      </View>
    );
  }

  const picked = ideas.find((i) => i.name === selected);
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>Pick the one you'd enjoy building</Text>
        <Btn label="Reshuffle (1)" icon="refresh" small variant="ghost" loading={generate.isPending} disabled={isSubmitting} onPress={() => generate.mutate()} />
      </View>
      {ideas.map((idea) => {
        const on = selected === idea.name;
        return (
          <Pressable key={idea.name} onPress={() => !isSubmitting && setSelected(idea.name)}
            style={({ pressed }) => [{
              borderRadius: radius.md, borderWidth: on ? 2 : 1, borderColor: on ? colors.primary : colors.border,
              backgroundColor: colors.surface, padding: spacing.md, gap: spacing.sm, overflow: "hidden",
            }, pressed && { opacity: 0.85 }]}
          >
            {on && <NovaGradient style={{ position: "absolute", left: 0, right: 0, top: 0, height: 3 }} />}
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: colors.text, fontSize: font.lg, fontFamily: fontFamily.bold }}>{idea.name}</Text>
                {idea.tagline ? <Text style={{ color: colors.primary, fontSize: font.sm, fontFamily: fontFamily.semibold }}>{idea.tagline}</Text> : null}
              </View>
              <Icon name={on ? "checkmark-circle" : "ellipse-outline"} size={22} color={on ? colors.primary : colors.border} />
            </View>
            {idea.vibe ? <Pill label={idea.vibe} color={colors.novaEmerald} /> : null}
            <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>{idea.pitch}</Text>
            {idea.twist ? <IdeaRow icon="flash" label="The twist" text={idea.twist} /> : null}
            {idea.whoItsFor ? <IdeaRow icon="people" label="Who it's for" text={idea.whoItsFor} /> : null}
          </Pressable>
        );
      })}
      <Btn label={picked ? `${chooseLabel}: ${picked.name}` : "Pick an idea above"} icon="rocket" disabled={!picked} loading={isSubmitting} onPress={() => picked && onChoose(picked)} />
      {error && <ErrorNote message={error} />}
    </View>
  );
}

function IdeaRow({ icon, label, text }: { icon: "flash" | "people"; label: string; text: string }) {
  return (
    <View style={{ flexDirection: "row", gap: spacing.sm }}>
      <Icon name={icon} size={14} color={colors.textTertiary} />
      <Text style={{ flex: 1, color: colors.text, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
        <Text style={{ fontFamily: fontFamily.semibold }}>{label}: </Text>{text}
      </Text>
    </View>
  );
}
