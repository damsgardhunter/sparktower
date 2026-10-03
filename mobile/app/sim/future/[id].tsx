/**
 * What is coming, on the phone.
 *
 * The third of the web desk's three tabs, and the one whose absence cost the
 * most. `desk.forecast` and `desk.idleCostPerUnit` have been in the payload
 * since the forecast existed and nothing in `mobile/` read either, so a phone
 * operations seat typed a capacity number against nothing at all while a web
 * player on the same team had the range, the room, and the price of being wrong
 * in each direction. Capacity binds both ways — empty room is paid for, and a
 * customer turned away goes to a rival — so guessing at it is the most expensive
 * thing the phone used to ask anybody to do.
 *
 * Read at the drafted price and the drafted room, not only at what has been
 * filed. The server keeps each seat's draft (`desk.draft`), so a seat that has
 * moved a lever and not filed it still sees what it did — which is the whole
 * point of looking.
 */
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Btn, Empty, Loading, Screen, errText } from "../../../src/components/ui";
import { useDesk } from "../../../src/components/sim/useSim";
import { ForecastCard, OnItsWay } from "../../../src/components/sim/FutureKit";
import { ProjectionCard } from "../../../src/components/sim/ProjectionCard";
import { whoseBet } from "../../../src/components/sim/future";

const num = (v: unknown, fallback = 0): number =>
  Number.isFinite(Number(v)) ? Number(v) : fallback;

export default function Future() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data, isLoading, error } = useDesk(id);

  if (isLoading) {
    return (<><Stack.Screen options={{ title: "What's coming" }} /><Loading label="Looking ahead…" /></>);
  }

  if (error || !data) {
    return (
      <>
        <Stack.Screen options={{ title: "What's coming" }} />
        <Screen canvas>
          <Empty
            icon="telescope-outline"
            title="That season isn't here"
            body={errText(error, "It either doesn't exist or you're not at that table.")}
          />
          <Btn label="Back to your desk" icon="arrow-back" variant="outline" onPress={() => router.replace(`/sim/desk/${id}`)} />
        </Screen>
      </>
    );
  }

  const company = data.company;
  const filed = (data.filed ?? {}) as Record<string, any>;
  const draft = (data.draft ?? {}) as Record<string, any>;
  const holds = (role: string) => data.yourRole === role;

  /*
   * The price on the table: this seat's own draft if marketing is theirs,
   * otherwise whatever marketing filed, otherwise what the company charges now.
   * The same order the web reads them in — a seat looking at a forecast wants it
   * at the price the company is actually going to charge, and the draft is the
   * most recent answer to that.
   */
  const price = num(
    holds("cmo") && draft.price !== undefined ? draft.price : filed.cmo?.price,
    num(company?.price, 0),
  );

  /*
   * The room, in two readings, because they answer different questions.
   *
   * `capacity` is what serves the period in front of you. A cut is immediate —
   * you can close a floor faster than you can fit one out — so a drafted number
   * below what exists takes effect now, which is why this is the smaller of the
   * two. Leased and borrowed room counts.
   *
   * `ordered` is what the lever is actually setting, and it opens next period.
   * The web runs it through `capacityBuild` to get exactly what opens; this uses
   * the order itself, which is the number the over-ordering warning is about and
   * is never smaller than what opens.
   */
  const have = num(company?.capacity, 0);
  const asset = num(company?.assetCapacity, 0);
  const ordered = num(
    holds("coo") && draft.capacityTarget !== undefined ? draft.capacityTarget : filed.coo?.capacityTarget,
    have,
  );
  const capacity = Math.min(have, ordered) + asset;

  return (
    <>
      <Stack.Screen options={{ title: "What's coming" }} />
      <Screen canvas>
        {/*
          * The year as it stands, run by the server rather than guessed at here —
          * everything the table has filed, with each headline number carrying what
          * the unfiled change is doing to it. Already built for the desk; it
          * belongs on this screen too, above the forecast, because "what will this
          * plan earn" is the question the range underneath it feeds.
          */}
        <ProjectionCard
          ventureId={id!}
          draft={data.draft ?? null}
          filedStamp={JSON.stringify(data.filed ?? {})}
          currency={(data as any)?.currency}
        />

        {data.forecast ? (
          <ForecastCard
            forecast={data.forecast}
            price={price}
            capacity={capacity}
            capacityNext={ordered + asset}
            idleCostPerUnit={num(data.idleCostPerUnit, 0)}
            yours={whoseBet(data.yourRole)}
            voice={data.niche?.voice}
          />
        ) : null}

        <OnItsWay
          company={company ?? {}}
          outlook={data.economy?.outlook}
          outlookMeans={data.economy?.outlookMeans}
        />

        <Btn
          label="What the table decided"
          icon="hammer-outline"
          variant="outline"
          onPress={() => router.push(`/sim/past/${id}`)}
          testID="future-to-past"
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
