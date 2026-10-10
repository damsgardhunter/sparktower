/**
 * The character, speaking.
 *
 * Every film this pipeline has made is silent, which on a platform where most
 * watching happens with sound on is a joke told with the punchline muted — a
 * vlog of a talking printer that nobody can hear is a slideshow of a printer.
 * The brief that set these formats out lists "a voice talking to you" as one
 * of the things that makes a film feel native, beside the selfie angle and the
 * captions, and it is the only one of the three that was never built.
 *
 * ## Why the lines are already written
 *
 * `ScriptLine.onScreen` is what the character says; the captions are a
 * transcript of it, not a summary. So nothing new has to be written for the
 * audio, and the words a viewer reads are the words they hear — which is how
 * captions work on the platforms these are made for, and which means the two
 * cannot drift.
 *
 * ## Why delivery is directed and not left to the voice
 *
 * The same voice reading the same sentence flat or brightly is the difference
 * between a character and a screen reader, and these formats live on tone: the
 * fake-out is only funny if the narration is completely sincere, and the vlog
 * is only funny if the character never reaches for the joke. The model takes a
 * direction, so it is given one per format.
 */
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import { openai } from "./openai-client";
import { SPEECH_MODEL } from "./aiModels";
import { aiStubbed } from "./ai-stub";
import { runFfmpeg } from "./ad-compositor";

/**
 * The fastest a line may be spoken to make it fit its beat.
 *
 * Speech that is hurried to fit reads as hurried, and past about a quarter
 * faster than natural it stops sounding like somebody talking and starts
 * sounding like a disclaimer at the end of a radio advert. A line that will
 * not fit at this speed is allowed to run past its beat instead — speech
 * carrying over a cut is ordinary, and a chipmunk is not.
 */
export const MAX_SPEEDUP = 1.25;

/**
 * The loudness the finished track is levelled to, and the ceiling it keeps.
 *
 * -14 LUFS is what the short-video platforms normalise to, so delivering at it
 * means nothing is turned down on the way in and nothing has to be turned up by
 * the viewer. The -1.5 dBTP ceiling is the usual allowance for what lossy
 * encoding does to peaks on the way to a phone.
 *
 * The first film with sound came in at -24.3 LUFS. The speech model returns a
 * conservatively quiet file and `amix` with `normalize=0` faithfully keeps it
 * quiet, so the advert played ten decibels under everything either side of it
 * in a feed — a commercial a viewer has to reach for the volume to hear.
 */
export const SPEECH_LUFS = -14;
export const SPEECH_PEAK_DBTP = -1.5;

/**
 * A gentle compressor ahead of the normaliser, which is what makes the target
 * reachable at all.
 *
 * Narrated speech has peaks seventeen decibels above its own average, and
 * `loudnorm` will not raise a track past the point where those peaks breach the
 * ceiling — so on the raw file it stopped at -15.8 LUFS however it was asked
 * and whatever it was told about the file beforehand. A measured two-pass run
 * was tried and reached -15.3: the limit is the crest factor, not the
 * measurement.
 *
 * Narrowing the range first gets the same filter to -14.9. The settings are
 * deliberately mild — 3:1 from -20 dB, with a release long enough not to pump
 * between words. Four-to-one from -24 dB was also tried: it bought a tenth of a
 * decibel and took two more units of range off a performance that is the whole
 * point of having a voice.
 */
export const SPEECH_COMPRESSOR = "acompressor=threshold=-20dB:ratio=3:attack=5:release=150:makeup=2";

export interface SpokenLine {
  /** Where this line starts in the finished film, in seconds. */
  atSeconds: number;
  file: string;
  seconds: number;
}

/** How long an audio file is, read back rather than assumed. */
export async function audioSeconds(file: string): Promise<number> {
  const { spawnSync } = await import("child_process");
  const probe = spawnSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file,
  ]);
  return Number(String(probe.stdout).trim()) || 0;
}

/**
 * One line, spoken to a file.
 *
 * Stubbed, it is silence of roughly the right length: the point of the stub is
 * that the whole pipeline runs for nothing, and a muxing step that only ever
 * executes against the real provider is a muxing step nobody tests.
 */
export async function speakLine(input: {
  text: string;
  voice: string;
  delivery: string;
  speed?: number;
  intoDir: string;
}): Promise<string> {
  const file = path.join(input.intoDir, `line-${randomUUID().slice(0, 8)}.mp3`);

  if (aiStubbed()) {
    /* About the length the words would take, so the timing code gets exercised. */
    const seconds = Math.max(1, Math.round(input.text.length / 14));
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", `anullsrc=channel_layout=mono:sample_rate=24000`,
      "-t", String(seconds), "-q:a", "9", file,
    ]);
    return file;
  }

  const response: any = await openai.audio.speech.create({
    model: SPEECH_MODEL,
    voice: input.voice,
    input: input.text,
    instructions: input.delivery,
    speed: input.speed ?? 1,
    response_format: "mp3",
  } as any);
  await fs.writeFile(file, Buffer.from(await response.arrayBuffer()));
  return file;
}

/**
 * A line spoken to fit the time it has, or as close as it can get honestly.
 *
 * Measures what came back and asks again faster when it overran, once. Not in
 * a loop: a second miss means the line is simply too long for the beat, and
 * the right answer then is to let it run over rather than to keep accelerating
 * until it is unlistenable.
 */
export async function speakToFit(input: {
  text: string;
  voice: string;
  delivery: string;
  seconds: number;
  intoDir: string;
}): Promise<{ file: string; seconds: number }> {
  const first = await speakLine(input);
  const spoken = await audioSeconds(first);
  if (spoken <= input.seconds || spoken === 0) return { file: first, seconds: spoken };

  const needed = Math.min(MAX_SPEEDUP, spoken / input.seconds);
  const retry = await speakLine({ ...input, speed: Number(needed.toFixed(2)) });
  return { file: retry, seconds: await audioSeconds(retry) };
}

/**
 * The spoken lines laid onto one track at their own start times.
 *
 * `adelay` per line and then `amix`, which is the arrangement that keeps each
 * line where the picture put it. The alternative — concatenating the speech
 * and hoping it lines up — drifts the moment any line is shorter than its
 * beat, and every line is shorter than its beat.
 */
/**
 * The spoken lines laid onto one track at their own start times, levelled, and
 * muxed onto the film.
 *
 * `adelay` per line and then `amix`, which is the arrangement that keeps each
 * line where the picture put it. The alternative — concatenating the speech
 * and hoping it lines up — drifts the moment any line is shorter than its
 * beat, and every line is shorter than its beat.
 */
export function mixArgs(
  lines: SpokenLine[],
  videoFile: string,
  output: string,
  /**
   * How long the finished film is, in seconds.
   *
   * Given rather than inferred. The first version padded the speech with
   * `apad` and let `-shortest` decide, which does not reliably terminate when
   * the video is stream-copied: three renders sat in "composing" with ffmpeg
   * spinning at full tilt, one of them for six hours. The length is already
   * known — it is what the advert was sold as — so it is stated.
   */
  seconds: number,
): string[] {
  const args = ["-y", "-i", videoFile];
  for (const line of lines) args.push("-i", line.file);

  const delays = lines.map((line, i) =>
    /* Both channels, because `adelay` is per channel and a mono input silently stays at zero on the second. */
    `[${i + 1}:a]adelay=${Math.round(line.atSeconds * 1000)}|${Math.round(line.atSeconds * 1000)}[d${i}]`);

  const ms = Math.round(seconds * 1000);
  const mix = [
    `${lines.map((_, i) => `[d${i}]`).join("")}amix=inputs=${lines.length}:dropout_transition=0:normalize=0`,
    SPEECH_COMPRESSOR,
    `loudnorm=I=${SPEECH_LUFS}:TP=${SPEECH_PEAK_DBTP}:LRA=11`,
    /* `loudnorm` works internally at 192 kHz and emits at that rate; the AAC encoder should not be handed it. */
    "aresample=48000",
    /*
     * Padded to a stated length rather than forever. `apad` on its own is an
     * infinite stream, which is only safe if something downstream reliably
     * stops it, and `-shortest` past a copied video stream does not.
     */
    `apad=whole_dur=${ms}ms`,
    `atrim=0:${seconds.toFixed(3)}[speech]`,
  ].join(",");

  args.push(
    "-filter_complex", [...delays, mix].join(";"),
    "-map", "0:v", "-map", "[speech]",
    "-c:v", "copy",
    "-c:a", "aac", "-b:a", "128k",
    /* The length is stated, not inferred — see `seconds`. */
    "-t", seconds.toFixed(3),
    "-movflags", "+faststart",
    output,
  );
  return args;
}

/** A scratch directory for one render's audio, cleaned up by the caller. */
export const voiceWorkDir = async (): Promise<string> =>
  fs.mkdtemp(path.join(os.tmpdir(), "ad-voice-"));
