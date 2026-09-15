import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, Volume1, Volume2, VolumeX } from "lucide-react";
import type { PromoVideo } from "@shared/promotions";

/**
 * A promotion's video, playing in the feed the way LinkedIn's do: muted, on
 * its own, while it's on screen, with captions on when the video has them.
 * Our own controls sit over it — the title across the top, a sound button
 * with a volume slider in the corner, and the middle to pause and play —
 * rather than YouTube's, so it looks like part of the page.
 *
 * YouTube videos go through YouTube's IFrame Player API (from the
 * privacy-enhanced youtube-nocookie.com host); an uploaded .mp4/.webm uses the
 * same controls on a <video>. Only one video has its sound on at a time, and
 * nothing autoplays for someone who asked their system for reduced motion.
 */

// ─── The few pieces of YouTube's player API used here ────────────────────────
interface YTPlayer {
  playVideo(): void; pauseVideo(): void; mute(): void; unMute(): void; isMuted(): boolean;
  setVolume(v: number): void; getVolume(): number; getPlayerState(): number; destroy(): void;
  getVideoData?(): { title?: string };
}
interface YTNamespace {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer;
  PlayerState: { PLAYING: number; PAUSED: number; ENDED: number; BUFFERING: number };
}
declare global { interface Window { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void } }

let apiPromise: Promise<YTNamespace> | null = null;
/** Loads YouTube's player API once for the whole page. */
function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(window.YT!); };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => { apiPromise = null; reject(new Error("YouTube player didn't load")); };
    document.head.appendChild(script);
  });
  return apiPromise;
}

/**
 * Calls into a YouTube player, safely. Its methods only exist once it's ready,
 * and they throw once it's destroyed — both easy to hit when scrolling fast —
 * so a call to a player in either state is skipped rather than crashing the feed.
 */
function ytCall<R>(player: YTPlayer, fn: (p: YTPlayer) => R): R | undefined {
  if (typeof player.getPlayerState !== "function") return undefined;
  try { return fn(player); } catch { return undefined; }
}

/** A playing video, whichever kind: what the controls and the one-sound rule need. */
interface Controls { play(): void; pause(): void; setMuted(m: boolean): void; setVolume(v: number): void }

/** Every player on the page, so turning one's sound on turns the others' off, and one autoplaying pauses the rest. */
const players = new Set<{ id: symbol; controls: () => Controls | null; onMutedElsewhere: () => void }>();

const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function PromoVideoPlayer({ video, label, fallbackTitle, onFirstPlay, testId }: {
  video: Extract<PromoVideo, { kind: "youtube" } | { kind: "file" }>;
  /** For screen readers: "Replit video". */
  label: string;
  /** Shown as the title until the video's own title is known (uploaded files keep it). */
  fallbackTitle: string;
  onFirstPlay?: () => void;
  testId: string;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLVideoElement>(null);
  const ytRef = useRef<YTPlayer | null>(null);
  const idRef = useRef(Symbol("promo-video"));
  const visibleRef = useRef(false);
  const userPausedRef = useRef(prefersReducedMotion());
  const reportedRef = useRef(false);
  // Held in a ref: a new callback each render mustn't rebuild the player.
  const onFirstPlayRef = useRef(onFirstPlay);
  onFirstPlayRef.current = onFirstPlay;

  const [near, setNear] = useState(false);
  const [ready, setReady] = useState(video.kind === "file");
  const [playing, setPlaying] = useState(false);
  const [muted, setMutedState] = useState(true);
  const [volume, setVolumeState] = useState(70);
  const [title, setTitle] = useState(fallbackTitle);
  const [failed, setFailed] = useState(false);
  const [ytState, setYtState] = useState<number | null>(null);

  const controls = useCallback((): Controls | null => {
    if (video.kind === "file") {
      const el = fileRef.current;
      return el ? {
        play: () => void el.play().catch(() => {}),
        pause: () => el.pause(),
        setMuted: (m) => { el.muted = m; },
        setVolume: (v) => { el.volume = v / 100; },
      } : null;
    }
    // Only a player that's finished loading: until onReady, YouTube's object has none of these methods.
    const p = ytRef.current;
    return p ? {
      // Asking a player that's already playing or buffering to play again stalls it: only ask when it isn't.
      play: () => ytCall(p, (x) => { if (![1, 3].includes(x.getPlayerState())) x.playVideo(); }),
      pause: () => ytCall(p, (x) => x.pauseVideo()),
      setMuted: (m) => ytCall(p, (x) => (m ? x.mute() : x.unMute())),
      setVolume: (v) => ytCall(p, (x) => x.setVolume(v)),
    } : null;
  }, [video.kind]);

  const started = useCallback(() => {
    setPlaying(true);
    if (!reportedRef.current) { reportedRef.current = true; onFirstPlayRef.current?.(); }
    // One video at a time: whichever just started, the others pause.
    for (const other of players) if (other.id !== idRef.current) other.controls()?.pause();
  }, []);

  // Registered for the one-sound, one-playing rules.
  useEffect(() => {
    const entry = { id: idRef.current, controls, onMutedElsewhere: () => setMutedState(true) };
    players.add(entry);
    return () => { players.delete(entry); };
  }, [controls]);

  // Loads the player when the card comes near the screen; plays while at least 60% of it is on screen.
  useEffect(() => {
    const el = frameRef.current;
    if (!el || typeof IntersectionObserver === "undefined") { setNear(true); return; }
    const nearIo = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setNear(true); nearIo.disconnect(); } }, { rootMargin: "400px 0px" });
    const viewIo = new IntersectionObserver(([e]) => {
      visibleRef.current = e.isIntersecting;
      const c = controls();
      if (!c) return;
      if (e.isIntersecting && !userPausedRef.current) c.play();
      if (!e.isIntersecting) c.pause();
    }, { threshold: 0.6 });
    nearIo.observe(el);
    viewIo.observe(el);
    return () => { nearIo.disconnect(); viewIo.disconnect(); };
  }, [controls, ready]);

  // YouTube: build the player once the card is near.
  useEffect(() => {
    if (video.kind !== "youtube" || !near || !mountRef.current) return;
    let cancelled = false;
    // Kept here, not in ytRef, until it's ready: scrolling past fast can reach the controls in between.
    let player: YTPlayer | null = null;
    const timers: number[] = [];
    loadYouTubeApi().then((YT) => {
      if (cancelled || !mountRef.current) return;
      player = new YT.Player(mountRef.current, {
        host: "https://www.youtube-nocookie.com",
        videoId: video.id,
        width: "100%", height: "100%",
        playerVars: {
          autoplay: 0, mute: 1, controls: 0, rel: 0, playsinline: 1, modestbranding: 1, iv_load_policy: 3, fs: 0, disablekb: 1,
          // Captions on whenever the video has them, in English where there's a choice.
          cc_load_policy: 1, cc_lang_pref: "en", hl: "en",
          origin: window.location.origin,
        },
        events: {
          onReady: (e: { target: YTPlayer }) => {
            if (cancelled) return;
            ytRef.current = e.target;
            ytCall(e.target, (x) => { x.mute(); x.setVolume(70); });
            const t = ytCall(e.target, (x) => x.getVideoData?.().title);
            if (t) setTitle(t);
            setReady(true);
            // Browsers only allow autoplay once the player is actually muted, which YouTube applies
            // asynchronously: ask now, and again shortly after if it hasn't started.
            const autoplay = () => {
              if (cancelled || !visibleRef.current || userPausedRef.current) return;
              ytCall(e.target, (x) => { if ([-1, 5].includes(x.getPlayerState())) { x.mute(); x.playVideo(); } });
            };
            autoplay();
            timers.push(window.setTimeout(autoplay, 600), window.setTimeout(autoplay, 1800));
          },
          onStateChange: (e: { data: number }) => {
            setYtState(e.data);
            if (e.data === YT.PlayerState.PLAYING) started();
            // Loops by starting over at the end (YouTube's own loop, a one-video playlist, stalls embeds).
            else if (e.data === YT.PlayerState.ENDED && ytRef.current) ytCall(ytRef.current, (x) => { (x as any).seekTo?.(0, true); x.playVideo(); });
            else if (e.data === YT.PlayerState.PAUSED) setPlaying(false);
          },
          onError: (e: { data: number }) => { setYtState(-100 - e.data); setFailed(true); },
        },
      });
    }).catch(() => setFailed(true));
    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
      ytRef.current = null;
      if (player) ytCall(player, (x) => x.destroy());
    };
    // Rebuilt only for a different video.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.kind === "youtube" ? video.id : null, near, started]);

  const togglePlay = () => {
    const c = controls();
    if (!c) return;
    if (playing) { userPausedRef.current = true; c.pause(); }
    else { userPausedRef.current = false; c.play(); }
  };
  const setMuted = (next: boolean) => {
    const c = controls();
    if (!c) return;
    if (!next) {
      // Sound on here means sound off everywhere else.
      for (const other of players) if (other.id !== idRef.current) { other.controls()?.setMuted(true); other.onMutedElsewhere(); }
      if (volume === 0) { c.setVolume(50); setVolumeState(50); }
      if (!playing) { userPausedRef.current = false; c.play(); }
    }
    c.setMuted(next);
    setMutedState(next);
  };
  const changeVolume = (v: number) => {
    const c = controls();
    if (!c) return;
    c.setVolume(v);
    setVolumeState(v);
    if (v === 0 && !muted) { c.setMuted(true); setMutedState(true); }
    if (v > 0 && muted) setMuted(false);
  };

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2;

  return (
    <div ref={frameRef} className="group/video relative aspect-video w-full overflow-hidden bg-black" data-testid={testId} data-playing={playing} data-muted={muted} data-player-state={ytState ?? undefined}>
      {video.kind === "youtube" ? (
        <>
          {/* The poster until the player is ready, so the card never flashes black. */}
          {!ready && <img src={video.posterUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />}
          {/* YouTube's own overlay is kept out of reach: the controls below are the ones that work. */}
          <div className="absolute inset-0 pointer-events-none [&>iframe]:h-full [&>iframe]:w-full"><div ref={mountRef} /></div>
        </>
      ) : (
        <video
          ref={fileRef} src={video.src} muted loop playsInline preload="metadata"
          className="absolute inset-0 h-full w-full object-cover"
          onPlay={started} onPause={() => setPlaying(false)} onLoadedData={() => setReady(true)} onError={() => setFailed(true)}
        />
      )}

      {/* Middle: pause and play. */}
      <button
        className="absolute inset-0 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80"
        onClick={togglePlay}
        aria-label={playing ? `Pause ${label}` : `Play ${label}`}
        data-testid={`${testId}-toggle`}
      >
        <span className={`h-14 w-14 rounded-full bg-black/55 text-white flex items-center justify-center backdrop-blur-sm transition-opacity ${playing ? "opacity-0 group-hover/video:opacity-100 group-focus-within/video:opacity-100" : "opacity-100"}`}>
          {playing ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6 translate-x-0.5" />}
        </span>
      </button>

      {/* Top: the video's title, always there. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 via-black/30 to-transparent px-3 pt-2 pb-6">
        <p className="text-white text-[13px] font-medium leading-snug line-clamp-2 drop-shadow" data-testid={`${testId}-title`}>{title}</p>
      </div>

      {/* Corner: sound on/off, and how loud. */}
      <div className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-full bg-black/60 text-white px-1.5 py-1 backdrop-blur-sm">
        <input
          type="range" min={0} max={100} step={1} value={muted ? 0 : volume}
          onChange={(e) => changeVolume(Number(e.target.value))}
          aria-label={`${label} volume`}
          className="w-0 opacity-0 transition-all duration-200 group-hover/video:w-20 group-hover/video:opacity-100 focus:w-20 focus:opacity-100 accent-white h-1 cursor-pointer"
          data-testid={`${testId}-volume`}
        />
        <button
          className="h-7 w-7 rounded-full flex items-center justify-center hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          onClick={() => setMuted(!muted)}
          aria-label={muted ? `Turn on sound for ${label}` : `Mute ${label}`}
          aria-pressed={!muted}
          data-testid={`${testId}-sound`}
        >
          <VolumeIcon className="h-4 w-4" />
        </button>
      </div>

      {failed && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-white text-sm px-6 text-center" data-testid={`${testId}-error`}>
          This video can't play here right now.
        </div>
      )}
    </div>
  );
}
