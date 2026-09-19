/**
 * "End the year now" on the phone — for developers, and for companies running
 * their own training seasons. The web's `client/src/components/sim/advance-year.tsx`
 * is the twin; `server/season-control.ts` decides who may.
 *
 * Asks first, because ending a year ends it for every team in the season.
 */
import { Alert, Platform, Text, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { colors, font, fontFamily, spacing } from "../../theme";
import { Btn, Card, errText } from "../ui";

function confirmAsk(title: string, message: string, onYes: () => void) {
  if (Platform.OS === "web") { if (window.confirm(`${title}\n\n${message}`)) onYes(); return; }
  Alert.alert(title, message, [{ text: "Not yet", style: "cancel" }, { text: "Resolve it now", style: "destructive", onPress: onYes }]);
}

export function AdvanceYearCard({ seasonId, ventureId, year, totalYears, as, onDone }: {
  seasonId: string;
  ventureId: string;
  year: number;
  totalYears: number;
  /** "dev_flag" is any seat on a development server with SIM_DEV_ADVANCE on; it reads as developer controls. */
  as: "developer" | "company" | "dev_flag";
  onDone: (notice: { tone: "success" | "error"; text: string }) => void;
}) {
  const qc = useQueryClient();
  const last = year >= totalYears;

  const advance = useMutation({
    mutationFn: () => api<{ resolvedYear: number; status: string }>(`/api/sim/seasons/${seasonId}/advance`, { method: "POST", body: {} }),
    onSuccess: (body) => {
      onDone({
        tone: "success",
        text: body.status === "finished" ? "Season over — that was the last year." : `Year ${body.resolvedYear} resolved. Year ${body.resolvedYear + 1} is open.`,
      });
      void qc.invalidateQueries({ queryKey: ["sim-desk", ventureId] });
      void qc.invalidateQueries({ queryKey: ["sim-projection", ventureId] });
    },
    onError: (err: any) => onDone({ tone: "error", text: errText(err, "Couldn't resolve the year.") }),
  });

  const ask = () => confirmAsk(
    last ? "End the season now?" : `End year ${year} now?`,
    ((as === "developer" || as === "dev_flag")
      ? "This resolves the year for every team in this market — including real players who may still be deciding. Whatever they haven't filed runs on last year's plan. It is recorded in the moderation log."
      : "This resolves the year for every table in this training season, including anyone still deciding. Whatever they haven't filed runs on last year's plan.")
      + (last ? " It is the last year, so the season ends." : ` Year ${year + 1} opens straight away.`),
    () => advance.mutate(),
  );

  return (
    <Card>
      <View style={{ gap: spacing.sm }}>
        <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.base, color: colors.text }}>
          {(as === "developer" || as === "dev_flag") ? "Developer controls" : "Training season controls"}
        </Text>
        <Text style={{ fontFamily: fontFamily.regular, fontSize: font.sm, color: colors.textSecondary }}>
          {(as === "developer" || as === "dev_flag")
            ? "You can end this year now rather than waiting for its clock."
            : "Your company runs this season, so you can end the year whenever the room is ready."}
        </Text>
        <Btn
          label={last ? "End the season now" : `End year ${year} now`}
          variant="outline"
          small
          icon="play-forward-outline"
          loading={advance.isPending}
          disabled={advance.isPending}
          onPress={ask}
          testID="button-advance-year"
        />
      </View>
    </Card>
  );
}
