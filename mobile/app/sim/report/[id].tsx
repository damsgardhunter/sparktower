/**
 * The year-end report, on the phone.
 *
 * The web's own version of this screen opens by calling itself the most important
 * screen in the simulation, and the reasoning holds: a decision you cannot trace
 * to an outcome is a decision you cannot learn from, and the whole promise of a
 * fortnight-long season is fourteen chances to learn.
 *
 * The phone had none of it. `/api/sim/ventures/:id/reports` was never called from
 * `mobile/` at all, so a phone player saw the one-line summary of the period just
 * gone on their desk and could reach neither the accounts behind it nor any year
 * before it. In a fourteen-period season that is thirteen years of a team's own
 * history visible only to whoever happened to be on a laptop.
 *
 * One screen with a row of years rather than the web's route per year: fewer taps,
 * and the whole season is one gesture away instead of a walk through a navigation
 * stack. The year is still in the address (`?year=`) so a link keeps its place.
 */
import { useState } from "react";
import { Text } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { colors, font, fontFamily } from "../../../src/theme";
import { Btn, Card, Empty, Loading, Screen, errText } from "../../../src/components/ui";
import { useReport } from "../../../src/components/sim/useSim";
import {
  EverybodyElse, TheAccounts, TheCash, TheCustomers, TheNotes, TheResult, YearPicker,
} from "../../../src/components/sim/ReportKit";
import { yearToShow } from "../../../src/components/sim/report";

export default function Report() {
  const { id, year: asked } = useLocalSearchParams<{ id: string; year?: string }>();
  const router = useRouter();
  /*
   * The year in the address is where this starts, and a tap moves it. Held in
   * state rather than pushed as a new route: thirteen taps through a season should
   * not leave thirteen screens behind the back button.
   */
  const [picked, setPicked] = useState<number | null>(asked ? Number(asked) : null);
  const { data, isLoading, error } = useReport(id, picked);

  if (isLoading) {
    return (<><Stack.Screen options={{ title: "The year" }} /><Loading label="Reading the accounts…" /></>);
  }

  if (error || !data) {
    return (
      <>
        <Stack.Screen options={{ title: "The year" }} />
        <Screen canvas>
          <Empty
            icon="receipt-outline"
            title="That report isn't here"
            body={errText(error, "It either doesn't exist or you're not at that table.")}
          />
          <Btn label="Back to your desk" icon="arrow-back" variant="outline" onPress={() => router.replace(`/sim/desk/${id}`)} />
        </Screen>
      </>
    );
  }

  const report = data.report;
  const voice = data.niche?.voice;
  const showing = yearToShow(data.years ?? [], picked);

  /*
   * No year has resolved yet. Said plainly rather than drawn as five empty cards —
   * and it is a normal state, not an error: every season spends its first period
   * here.
   */
  if (!report || showing == null) {
    return (
      <>
        <Stack.Screen options={{ title: "The year" }} />
        <Screen canvas>
          <Card testID="report-none-yet">
            <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>Nothing has resolved yet</Text>
            <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 20, fontFamily: fontFamily.regular, marginTop: 4 }}>
              This is year one of {data.companyName ?? "your company"}. Once the five of you have filed and the year resolves, this
              is where the accounts will be — every cost with the seat that spent it, where the cash went, and who took your
              {" "}{voice?.customers ?? "customers"}.
            </Text>
          </Card>
          <Btn label="Back to your desk" icon="arrow-back" variant="outline" onPress={() => router.replace(`/sim/desk/${id}`)} />
        </Screen>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: `Year ${report.year}` }} />
      <Screen canvas>
        <YearPicker
          years={data.years ?? []}
          showing={report.year}
          onPick={(year) => {
            setPicked(year);
            /* Kept in the address too, so a reload or a shared link lands on the same year. */
            router.setParams({ year: String(year) });
          }}
        />

        {/* The order a team argues about a bad year. See `ReportKit`. */}
        <TheResult report={report} voice={voice} />
        {report.pnl ? <TheAccounts pnl={report.pnl} /> : null}
        {report.cashBridge ? <TheCash bridge={report.cashBridge} /> : null}
        {report.segments ? <TheCustomers segments={report.segments} voice={voice} /> : null}
        {report.rivals ? <EverybodyElse rivals={report.rivals} /> : null}
        <TheNotes notes={report.notes ?? []} />

        <Btn
          label="What the table decided"
          icon="hammer-outline"
          variant="outline"
          onPress={() => router.push(`/sim/past/${id}` as any)}
          testID="report-to-past"
        />
        <Btn
          label="Back to your desk"
          icon="arrow-back"
          variant="outline"
          onPress={() => router.replace(`/sim/desk/${id}`)}
        />
      </Screen>
    </>
  );
}
