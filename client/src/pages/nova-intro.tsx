import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Cpu, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%&*!?<>{}[]=/\\|~^";

function useDecryptText(target: string, active: boolean, speed = 70) {
  const [display, setDisplay] = useState("");

  useEffect(() => {
    if (!active) {
      setDisplay("");
      return;
    }

    let frame = 0;
    const totalFrames = target.length * 3;
    const interval = setInterval(() => {
      frame++;
      const resolved = Math.floor((frame / totalFrames) * target.length);
      let result = "";
      for (let i = 0; i < target.length; i++) {
        if (i < resolved) {
          result += target[i];
        } else if (target[i] === " ") {
          result += " ";
        } else {
          result += CHARS[Math.floor(Math.random() * CHARS.length)];
        }
      }
      setDisplay(result);
      if (frame >= totalFrames) {
        setDisplay(target);
        clearInterval(interval);
      }
    }, speed);

    return () => clearInterval(interval);
  }, [target, active, speed]);

  return display;
}

function DecryptionLine({ active }: { active: boolean }) {
  const [chars, setChars] = useState<string[]>(Array(48).fill("\u00A0"));

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => {
      setChars(prev => prev.map(() => CHARS[Math.floor(Math.random() * CHARS.length)]));
    }, 150);
    return () => clearInterval(interval);
  }, [active]);

  if (!active) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="font-mono text-[10px] text-emerald-400/40 select-none mb-6 overflow-hidden"
      style={{ width: "28ch", letterSpacing: "0.3em" }}
    >
      <div className="flex justify-center">
        {chars.map((c, i) => (
          <span key={i} className="inline-block w-[0.6em] text-center">{c}</span>
        ))}
      </div>
    </motion.div>
  );
}

function ParticleField() {
  const particles = Array.from({ length: 40 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: Math.random() * 3 + 1,
    duration: Math.random() * 4 + 3,
    delay: Math.random() * 2,
  }));

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full bg-emerald-400/30"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size,
          }}
          animate={{
            y: [0, -30, 0],
            opacity: [0.2, 0.6, 0.2],
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

function GridOverlay() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-[0.04]">
      <div
        className="w-full h-full"
        style={{
          backgroundImage:
            "linear-gradient(rgba(16, 185, 129, 0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(16, 185, 129, 0.4) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />
    </div>
  );
}

function ChipIcon() {
  return (
    <div className="relative h-24 w-24 flex items-center justify-center">
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-green-400 via-emerald-500 to-purple-500 shadow-2xl shadow-emerald-500/30" />
      <div className="absolute inset-[3px] rounded-[13px] bg-background/90" />
      <div className="absolute inset-[6px] rounded-[10px] border border-emerald-500/30" />
      <Cpu className="relative h-10 w-10 text-emerald-400" />

      {[
        { side: "top", positions: [25, 50, 75] },
        { side: "bottom", positions: [25, 50, 75] },
        { side: "left", positions: [25, 50, 75] },
        { side: "right", positions: [25, 50, 75] },
      ].map(({ side, positions }) =>
        positions.map((pos, i) => {
          const isHorizontal = side === "top" || side === "bottom";
          const style: React.CSSProperties = isHorizontal
            ? {
                left: `${pos}%`,
                transform: "translateX(-50%)",
                width: 2,
                height: 10,
                ...(side === "top" ? { top: -10 } : { bottom: -10 }),
              }
            : {
                top: `${pos}%`,
                transform: "translateY(-50%)",
                height: 2,
                width: 10,
                ...(side === "left" ? { left: -10 } : { right: -10 }),
              };
          return (
            <motion.div
              key={`${side}-${i}`}
              className="absolute bg-emerald-400/50"
              style={style}
              animate={{ opacity: [0.3, 0.8, 0.3] }}
              transition={{
                duration: 1.5,
                delay: i * 0.2 + (side === "bottom" || side === "right" ? 0.5 : 0),
                repeat: Infinity,
              }}
            />
          );
        })
      )}
    </div>
  );
}

export default function NovaIntro() {
  const [, setLocation] = useLocation();
  const [phase, setPhase] = useState(0);

  const novaText = useDecryptText("Nova", phase >= 1, 50);
  const subtitleText = useDecryptText("Your AI Project Partner", phase >= 2, 25);
  const taglineText = useDecryptText("Let's build something extraordinary together.", phase >= 3, 18);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 600),
      setTimeout(() => setPhase(2), 1800),
      setTimeout(() => setPhase(3), 3000),
      setTimeout(() => setPhase(4), 4200),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="relative flex items-center justify-center h-full w-full bg-background overflow-hidden">
      <GridOverlay />
      <ParticleField />

      <div className="absolute inset-0 bg-gradient-radial from-emerald-500/5 via-transparent to-purple-500/5 pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center gap-6 text-center px-6">
        <DecryptionLine active={phase >= 0} />

        <AnimatePresence>
          {phase >= 0 && (
            <motion.div
              className="relative"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 150, damping: 12, delay: 0.1 }}
            >
              <motion.div
                className="absolute -inset-8 rounded-3xl bg-gradient-to-br from-green-400/20 via-emerald-500/10 to-purple-500/20 blur-2xl"
                animate={{
                  scale: [1, 1.4, 1],
                  opacity: [0.3, 0.7, 0.3],
                }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
              />
              <motion.div
                className="absolute -inset-4 rounded-3xl border border-emerald-500/20"
                animate={{
                  scale: [1, 1.15, 1],
                  opacity: [0.5, 0, 0.5],
                }}
                transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
              />
              <ChipIcon />
            </motion.div>
          )}
        </AnimatePresence>

        {phase >= 1 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="space-y-2 mt-2"
          >
            <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-emerald-400 via-green-300 to-purple-400 bg-clip-text text-transparent font-mono">
              {novaText}
            </h1>
            <motion.div
              className="h-[2px] w-16 mx-auto bg-gradient-to-r from-emerald-400 to-purple-500"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.8, delay: 0.3 }}
            />
          </motion.div>
        )}

        {phase >= 2 && (
          <motion.p
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-lg text-muted-foreground max-w-md leading-relaxed font-mono"
          >
            {subtitleText}
          </motion.p>
        )}

        {phase >= 3 && (
          <motion.p
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-sm text-muted-foreground/70 max-w-sm font-mono"
          >
            {taglineText}
          </motion.p>
        )}

        {phase >= 4 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
          >
            <Button
              size="lg"
              onClick={() => setLocation("/projects/new/create")}
              className="relative overflow-hidden text-base font-semibold shadow-lg shadow-emerald-500/25"
              data-testid="button-launch-nova"
            >
              <motion.div
                className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0"
                animate={{ x: ["-100%", "200%"] }}
                transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
              />
              <span className="relative flex items-center gap-2">
                Launch Nova
                <ArrowRight className="h-5 w-5" />
              </span>
            </Button>
          </motion.div>
        )}
      </div>

      <motion.div
        className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2 text-xs text-muted-foreground/40 font-mono"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 4.5, duration: 0.6 }}
      >
        <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span>SparkTower AI Systems Online</span>
      </motion.div>
    </div>
  );
}
