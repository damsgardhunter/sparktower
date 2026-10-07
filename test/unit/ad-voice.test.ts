/**
 * The audio mux, which had no tests until it had already shipped three bugs.
 *
 * `mixArgs` builds one ffmpeg command and the command either plays or it does
 * not, so every mistake here looked the same from outside: a render that sat in
 * "composing" forever, or a fifteen-second advert that came out shorter than it
 * was sold as, or a voice only in the left ear. All three were found by watching
 * a real render instead of by running the suite, at the cost of real generation
 * units each time, because this function was never covered.
 *
 * It is pure — lines in, argv out — so what follows is cheap and could have
 * caught all three.
 */
import { describe, it, expect } from "vitest";
import { mixArgs, SPEECH_LUFS, SPEECH_PEAK_DBTP, SPEECH_COMPRESSOR, type SpokenLine } from "../../server/ad-voice";

const lines: SpokenLine[] = [
  { atSeconds: 0, file: "/tmp/a.mp3", seconds: 2.4 },
  { atSeconds: 5.5, file: "/tmp/b.mp3", seconds: 3.1 },
];

const args = mixArgs(lines, "/tmp/film.mp4", "/tmp/out.mp4", 15);
const graph = args[args.indexOf("-filter_complex") + 1];

describe("laying the speech onto the film", () => {
  it("takes the film first and then each line, in order", () => {
    /* The filter graph names inputs by index, so the order is the contract. */
    expect(args.slice(0, 2)).toEqual(["-y", "-i"]);
    expect(args[2]).toBe("/tmp/film.mp4");
    expect(args.filter((a, i) => args[i - 1] === "-i")).toEqual([
      "/tmp/film.mp4", "/tmp/a.mp3", "/tmp/b.mp3",
    ]);
  });

  it("delays each line to where the picture put it", () => {
    expect(graph).toContain("[1:a]adelay=0|0[d0]");
    expect(graph).toContain("[2:a]adelay=5500|5500[d1]");
  });

  it("delays both channels, not just the first", () => {
    /*
     * `adelay` takes one value per channel and leaves any channel it was not
     * given at zero — so a single value on a stereo stream puts the line in one
     * ear and an undelayed copy of it in the other.
     */
    for (const delay of graph.match(/adelay=[^[\]]*/g) ?? []) {
      expect(delay, `${delay} delays one channel`).toMatch(/adelay=(\d+)\|\1/);
    }
  });

  it("mixes without renormalising, so a quiet line stays where it was spoken", () => {
    expect(graph).toContain(`amix=inputs=${lines.length}`);
    expect(graph).toContain("normalize=0");
  });
});

describe("the length the advert was sold as", () => {
  it("is stated on the output rather than inferred from the streams", () => {
    /*
     * `-t` on the output side. Before the input (and `-shortest` before that)
     * it cut at the demuxer, and a fifteen-second advert was delivered at
     * 14.75s — paid for as fifteen.
     */
    const t = args.indexOf("-t");
    expect(t).toBeGreaterThan(args.lastIndexOf("-i"));
    expect(args[t + 1]).toBe("15.000");
  });

  it("pads the speech to a stated length and never forever", () => {
    /*
     * Bare `apad` is an infinite stream. With the video stream-copied nothing
     * downstream reliably ends it: three renders stuck in "composing", one of
     * them burning CPU for six hours.
     */
    expect(graph).toContain("apad=whole_dur=15000ms");
    expect(graph).not.toMatch(/apad(?![=\w])/);
    expect(args).not.toContain("-shortest");
  });

  it("trims the padding back to the film", () => {
    expect(graph).toContain("atrim=0:15.000");
  });

  it("rounds sub-millisecond starts rather than emitting fractions ffmpeg will not parse", () => {
    const odd = mixArgs([{ atSeconds: 1.23456, file: "/tmp/a.mp3", seconds: 1 }], "/f.mp4", "/o.mp4", 6);
    const odder = odd[odd.indexOf("-filter_complex") + 1];
    expect(odder).toContain("adelay=1235|1235");
    expect(odder).toContain("apad=whole_dur=6000ms");
  });
});

describe("the level it is handed over at", () => {
  it("normalises to what the platforms play at", () => {
    /*
     * The first film with sound measured -24.3 LUFS: audible, but ten decibels
     * under everything either side of it in a feed.
     */
    expect(graph).toContain(`loudnorm=I=${SPEECH_LUFS}`);
    expect(SPEECH_LUFS).toBe(-14);
  });

  it("leaves headroom for what lossy encoding does to peaks", () => {
    expect(graph).toContain(`TP=${SPEECH_PEAK_DBTP}`);
    expect(SPEECH_PEAK_DBTP).toBeLessThan(0);
  });

  it("narrows the range before asking for the level", () => {
    /*
     * The order is the whole reason the target is reachable. `loudnorm` will
     * not raise a track past the point its peaks breach the ceiling, and
     * narrated speech peaks seventeen decibels over its own average — so after
     * the normaliser a compressor is too late, and the advert sits two
     * decibels low with the gain already clamped.
     */
    expect(graph).toContain(SPEECH_COMPRESSOR);
    expect(graph.indexOf("acompressor")).toBeGreaterThan(graph.indexOf("amix"));
    expect(graph.indexOf("acompressor")).toBeLessThan(graph.indexOf("loudnorm"));
  });

  it("resamples after normalising, because loudnorm emits at 192 kHz", () => {
    const [norm, resample] = [graph.indexOf("loudnorm"), graph.indexOf("aresample=48000")];
    expect(norm).toBeGreaterThan(-1);
    expect(resample, "aresample must follow loudnorm or the encoder gets 192 kHz").toBeGreaterThan(norm);
  });

  it("levels the speech before it is padded with silence", () => {
    /* Padding first would hand the measurement a track that is mostly silence. */
    expect(graph.indexOf("loudnorm")).toBeLessThan(graph.indexOf("apad"));
  });
});

describe("what comes out", () => {
  it("copies the picture and encodes only the sound", () => {
    /* Re-encoding the video would cost a generation's worth of quality for nothing. */
    expect(args).toContain("-c:v");
    expect(args[args.indexOf("-c:v") + 1]).toBe("copy");
    expect(args[args.indexOf("-c:a") + 1]).toBe("aac");
  });

  it("maps the film's video and the mixed speech, and nothing else", () => {
    const maps = args.filter((a, i) => args[i - 1] === "-map");
    expect(maps).toEqual(["0:v", "[speech]"]);
  });

  it("writes a file that starts playing before it has finished downloading", () => {
    expect(args[args.indexOf("-movflags") + 1]).toBe("+faststart");
    expect(args[args.length - 1]).toBe("/tmp/out.mp4");
  });
});
