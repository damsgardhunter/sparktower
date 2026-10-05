/**
 * Shots: how long each one is, what the camera does, and how they are cut.
 *
 * An advert is not one clip, it is a rhythm. The three lengths below are the
 * ones that read as professional, and mixing them is most of what separates a
 * finished advert from a generated video:
 *
 *   - **punch** (1–2s) — a cut that lands. Used in runs, for momentum.
 *   - **scene** (3–5s) — long enough to understand, short enough to leave.
 *   - **sweep** (5–10s) — a continuous camera move, usually a rotation, used
 *     to carry the viewer between ideas rather than to show a new one.
 *
 * ## Nothing on screen is ever still
 *
 * Every shot kind carries camera movement and there is no "static" option,
 * because a still frame on a feed is a frame somebody scrolls past. Where
 * nothing in the scene moves, the camera does — a slow push, a drift, a rack
 * of focus. That is also the cheapest kind of motion to generate well: a
 * model asked for a slow push on a table produces something usable far more
 * often than one asked for a person performing an action.
 *
 * ## The economics, which decide the whole design
 *
 * The model sells clips in fixed lengths — 5 or 10 seconds — and bills per
 * generation, so the question is how many generations an advert needs. Shots
 * are therefore planned onto **plates**: a run of punches comes out of one
 * continuous move, taken at different windows of it, rather than one
 * generation each.
 *
 * Measured across all six styles and all three lengths, that saves one or two
 * generations out of seven to ten — a 30-second advert plans to 8 plates
 * rather than 10 shots, a 15-second one to 5 rather than 7. Worth having and
 * not transformative, and the first version of this comment claimed "fifteen
 * down to three", which was rhetoric rather than arithmetic. The limit is
 * that a plate is one continuous move through one setting, so shots only
 * share one when they share a beat — cutting from the problem to the product
 * inside a single camera move is a cut that does not read.
 *
 * A sweep is always its own plate, because its whole value is being unbroken.
 */
import type { AdBeatId } from "./ads";

export const SHOT_KINDS = [
  {
    id: "punch", label: "Punch", minSeconds: 1, maxSeconds: 2,
    camera: ["hard push in", "whip pan settling", "snap zoom", "quick tilt up"],
    use: "Momentum. Three or four in a row, on the beat, where the ad needs energy rather than information.",
  },
  {
    id: "scene", label: "Scene", minSeconds: 3, maxSeconds: 5,
    camera: ["slow push in", "slow pull out", "gentle drift left", "rack focus to subject", "handheld sway"],
    use: "The workhorse. Long enough to take something in, short enough that nobody leaves.",
  },
  {
    id: "sweep", label: "Sweep", minSeconds: 5, maxSeconds: 10,
    camera: ["slow orbit around the subject", "arc from left to right", "crane down to table height", "dolly through and past"],
    use: "Carrying the viewer from one idea to the next. Its value is being unbroken, so it is never cut into.",
  },
] as const;
export type ShotKindId = (typeof SHOT_KINDS)[number]["id"];
export const shotKind = (id: string) => SHOT_KINDS.find((k) => k.id === id) ?? null;

/** The clip lengths the model sells. Shots are cut out of these. */
export const PLATE_SECONDS = [5, 10] as const;
export type PlateSeconds = (typeof PLATE_SECONDS)[number];

export interface Shot {
  kind: ShotKindId;
  seconds: number;
  /** Which beat of the script this shot belongs to. */
  beat: AdBeatId;
  /** What the camera does, chosen from the kind's list. */
  camera: string;
  /**
   * Whether the brand is *in* this shot beyond the persistent logo — a colour
   * wash, the product with its packaging, the name typeset large. Not every
   * shot: a brand on every frame of every shot reads as a screensaver.
   */
  brandMoment: boolean;
}

/**
 * A generated clip, and the shots cut from it.
 *
 * `windows` are offsets into the plate. Two shots from one plate are two
 * different moments of the same continuous camera move, which is why they cut
 * together — and why this is not the same as using one clip twice.
 */
export interface Plate {
  seconds: PlateSeconds;
  camera: string;
  beats: AdBeatId[];
  windows: { shotIndex: number; startSeconds: number; seconds: number }[];
}

/**
 * The rhythm for one beat of the script.
 *
 * Each beat gets shots whose lengths suit what it is doing. A hook is punches
 * — it has two seconds to work and no time to establish anything. A product
 * beat is scenes, because somebody has to actually see the thing. A transition
 * between problem and product is where a sweep belongs.
 */
const BEAT_RHYTHM: Record<AdBeatId, ShotKindId[]> = {
  hook: ["punch", "punch"],
  problem: ["scene", "punch"],
  product: ["scene", "scene"],
  proof: ["scene"],
  cta: ["scene"],
};

/**
 * Turn a beat plan into a shot list.
 *
 * Fills each beat with its rhythm, repeating the pattern until the beat's
 * seconds are used, and never leaves a shot shorter than its kind allows —
 * a 0.4-second "punch" is a glitch, not a cut. Where the remainder is too
 * small to be its own shot it is given to the previous one, which is why the
 * seconds always add up.
 */
export function planShots(
  beats: { id: AdBeatId; seconds: number }[],
  /** A sweep is inserted before this beat, when there is room. Usually the product. */
  sweepBefore: AdBeatId | null = "product",
): Shot[] {
  const shots: Shot[] = [];

  for (const beat of beats) {
    let left = beat.seconds;
    const pattern = BEAT_RHYTHM[beat.id] ?? ["scene"];

    /*
     * The sweep that carries us into this beat. Only if it fits without
     * eating the beat it is introducing — a ten-second orbit in front of a
     * six-second product beat is a transition that became the advert.
     */
    /*
     * Twice the sweep's own minimum, not an eyeballed eight.
     *
     * The first version said `left >= 8` and then took half, which produced a
     * four-second sweep — under the five-second floor that makes a sweep a
     * sweep. A continuous camera move that only lasts four seconds is just a
     * scene with a slower start.
     */
    const sweepKind = SHOT_KINDS.find((k) => k.id === "sweep")!;
    if (beat.id === sweepBefore && left >= sweepKind.minSeconds * 2) {
      const sweep = sweepKind;
      /* Half the beat at most, so the beat it introduces is still the beat. */
      const seconds = Math.min(sweep.maxSeconds, Math.floor(left / 2));
      shots.push({ kind: "sweep", seconds, beat: beat.id, camera: sweep.camera[0], brandMoment: false });
      left -= seconds;
    }

    let i = 0;
    while (left > 0) {
      /*
       * The kind the rhythm asks for, unless it does not fit in what is left.
       *
       * This is the part the first version got wrong: it forced the kind's
       * minimum, so one second of a beat remaining became a three-second
       * scene, and a six-second advert came out at nine. A cut list that
       * overruns the runtime is not a rounding error — it is either a late
       * call to action or an advert that stops mid-sentence.
       *
       * So: ask for the pattern's kind, fall back to the longest kind that
       * fits, and if nothing fits give the remainder to the previous shot.
       */
      const wanted = SHOT_KINDS.find((k) => k.id === pattern[i % pattern.length])!;
      const kind = wanted.minSeconds <= left
        ? wanted
        : [...SHOT_KINDS].reverse().find((k) => k.minSeconds <= left);

      if (!kind) {
        /* Under a second left. Nothing is a shot at that length, so it joins the shot before it. */
        const previous = shots[shots.length - 1];
        if (previous) previous.seconds += left;
        left = 0;
        break;
      }

      const seconds = Math.min(kind.maxSeconds, left);
      const remainder = left - seconds;
      /* A remainder too short to be its own shot belongs to this one. */
      const take = remainder > 0 && remainder < SHOT_KINDS[0].minSeconds ? left : seconds;

      shots.push({ kind: kind.id, seconds: take, beat: beat.id, camera: kind.camera[i % kind.camera.length], brandMoment: false });
      left -= take;
      i += 1;
    }
  }

  return markBrandMoments(shots);
}

/**
 * Which shots carry the brand beyond the persistent logo.
 *
 * The first shot and the last, always: the first because a viewer who leaves
 * after two seconds should still have seen whose advert it was, and the last
 * because that is the one they act on. Then roughly every third shot, so the
 * brand recurs without being on every frame — a brand on every frame reads as
 * a screensaver and stops being noticed at all.
 */
function markBrandMoments(shots: Shot[]): Shot[] {
  return shots.map((s, i) => ({
    ...s,
    brandMoment: i === 0 || i === shots.length - 1 || i % 3 === 0,
  }));
}

/**
 * Group shots onto the fewest generated clips.
 *
 * A sweep is always its own plate: cutting into it destroys the only thing it
 * was for. Everything else is packed into 5- and 10-second plates, each shot
 * taking a window of the same continuous move — so three two-second punches
 * cost one generation rather than three.
 *
 * Shots are only packed together when they share a beat, because a plate is
 * one continuous camera move through one setting, and cutting from the problem
 * to the product inside a single move is a cut that does not read.
 */
export function planPlates(shots: Shot[]): Plate[] {
  const plates: Plate[] = [];
  let current: Plate | null = null;

  shots.forEach((shot, shotIndex) => {
    if (shot.kind === "sweep") {
      const seconds: PlateSeconds = shot.seconds > 5 ? 10 : 5;
      plates.push({
        seconds, camera: shot.camera, beats: [shot.beat],
        windows: [{ shotIndex, startSeconds: 0, seconds: shot.seconds }],
      });
      current = null;
      return;
    }

    const used = current?.windows.reduce((sum, w) => sum + w.seconds, 0) ?? 0;
    const sameBeat = current?.beats[0] === shot.beat;
    if (!current || !sameBeat || used + shot.seconds > current.seconds) {
      const seconds: PlateSeconds = shot.seconds > 5 ? 10 : 5;
      current = { seconds, camera: shot.camera, beats: [shot.beat], windows: [] };
      plates.push(current);
    }
    const start = current.windows.reduce((sum, w) => sum + w.seconds, 0);
    current.windows.push({ shotIndex, startSeconds: start, seconds: shot.seconds });
  });

  return plates;
}

/** What the plan will cost in generations, which is what a unit is spent on. */
export const generationsFor = (plates: Plate[]): number => plates.length;

/* ─── YouTube intros and outros ──────────────────────────────────────────── */

/**
 * The two pieces a channel needs that an advert does not.
 *
 * An intro is three seconds and the same every week — that sameness is the
 * point, it is what makes a channel recognisable. An outro is longer and
 * mostly empty on purpose: YouTube draws its end screens over the last twenty
 * seconds, and an outro with the brand in the middle is an outro with a
 * subscribe button over the brand.
 */
export const CHANNEL_PIECES = [
  {
    id: "intro", label: "Intro", seconds: 3,
    purpose: "The same three seconds every week. Recognition, not information.",
    shots: [{ kind: "punch" as ShotKindId, seconds: 1 }, { kind: "punch" as ShotKindId, seconds: 2 }],
    brand: "The mark lands on the beat and holds. Channel name typeset, tagline under it if there is one.",
    /** Where the renderer must leave room. */
    safeAreas: "None — nothing else is on screen during an intro.",
  },
  {
    id: "outro", label: "Outro", seconds: 20,
    purpose: "Twenty seconds for YouTube to put its end screens on. Keep the middle clear.",
    shots: [{ kind: "sweep" as ShotKindId, seconds: 10 }, { kind: "scene" as ShotKindId, seconds: 10 }],
    brand: "Mark and name low and to one side, never centred.",
    safeAreas:
      "The centre and the right two thirds belong to YouTube's end screens — a subscribe button and two video cards. " +
      "Anything rendered there is covered up, so the brand goes bottom-left and the rest stays empty.",
  },
] as const;
export type ChannelPieceId = (typeof CHANNEL_PIECES)[number]["id"];
export const channelPiece = (id: string) => CHANNEL_PIECES.find((p) => p.id === id) ?? null;
