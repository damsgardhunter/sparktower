import { useState, useEffect, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  Briefcase,
  Zap,
  Laugh,
  Palette,
} from "lucide-react";

interface Scene {
  imageUrl: string;
  caption: string;
  prompt?: string;
}

interface StoryboardSlideshowProps {
  scenes: Scene[];
  title: string;
  style: string;
  storyboard: string;
  onClose: () => void;
}

const STYLE_CONFIG: Record<string, { label: string; icon: typeof Briefcase; gradient: string }> = {
  professional: { label: "Professional", icon: Briefcase, gradient: "from-slate-800 via-blue-900 to-slate-900" },
  futuristic: { label: "Futuristic", icon: Zap, gradient: "from-purple-900 via-cyan-900 to-black" },
  funny: { label: "Funny", icon: Laugh, gradient: "from-yellow-500 via-orange-500 to-pink-500" },
  cartoon: { label: "Cartoon", icon: Palette, gradient: "from-green-400 via-blue-500 to-purple-500" },
};

const AUTO_ADVANCE_MS = 5000;

export function StoryboardSlideshow({
  scenes,
  title,
  style,
  storyboard,
  onClose,
}: StoryboardSlideshowProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [activeTab, setActiveTab] = useState<"slideshow" | "storyboard">("slideshow");
  const [progress, setProgress] = useState(0);
  const [fadeClass, setFadeClass] = useState("opacity-100");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const styleInfo = STYLE_CONFIG[style] || STYLE_CONFIG.professional;
  const StyleIcon = styleInfo.icon;

  const goTo = useCallback(
    (index: number) => {
      setFadeClass("opacity-0");
      setTimeout(() => {
        setCurrentIndex(index);
        setProgress(0);
        setFadeClass("opacity-100");
      }, 200);
    },
    []
  );

  const goNext = useCallback(() => {
    goTo((currentIndex + 1) % scenes.length);
  }, [currentIndex, scenes.length, goTo]);

  const goPrev = useCallback(() => {
    goTo((currentIndex - 1 + scenes.length) % scenes.length);
  }, [currentIndex, scenes.length, goTo]);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (progressRef.current) clearInterval(progressRef.current);

    if (isPlaying && activeTab === "slideshow" && scenes.length > 1) {
      setProgress(0);
      const progressStep = 50;
      progressRef.current = setInterval(() => {
        setProgress((prev) => {
          const next = prev + (progressStep / AUTO_ADVANCE_MS) * 100;
          return Math.min(next, 100);
        });
      }, progressStep);

      timerRef.current = setInterval(() => {
        goNext();
      }, AUTO_ADVANCE_MS);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (progressRef.current) clearInterval(progressRef.current);
    };
  }, [isPlaying, currentIndex, activeTab, scenes.length, goNext]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (scenes.length === 0) return;
      if (e.key === "ArrowRight") goNext();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === " ") {
        e.preventDefault();
        setIsPlaying((p) => !p);
      }
    },
    [goNext, goPrev, scenes.length]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const currentScene = scenes.length > 0 ? scenes[currentIndex] : null;

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent
        className="max-w-4xl w-[95vw] max-h-[90vh] flex flex-col p-0 gap-0"
        data-testid="dialog-storyboard-slideshow"
      >
        <DialogHeader className="p-4 pb-2 flex flex-row items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <DialogTitle data-testid="text-slideshow-title">{title}</DialogTitle>
            <Badge variant="secondary" data-testid="badge-style">
              <StyleIcon className="mr-1 h-3 w-3" />
              {styleInfo.label}
            </Badge>
          </div>
        </DialogHeader>

        <div className="flex gap-1 px-4 pb-2">
          <Button
            variant={activeTab === "slideshow" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("slideshow")}
            data-testid="button-tab-slideshow"
          >
            Slideshow
          </Button>
          <Button
            variant={activeTab === "storyboard" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("storyboard")}
            data-testid="button-tab-storyboard"
          >
            Full Storyboard
          </Button>
        </div>

        {activeTab === "slideshow" && currentScene ? (
          <div className="flex flex-col flex-1 min-h-0">
            {scenes.length > 1 && (
              <div className="h-1 mx-4 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-100 ease-linear rounded-full"
                  style={{ width: `${progress}%` }}
                  data-testid="progress-auto-advance"
                />
              </div>
            )}

            <div className="relative flex-1 flex items-center justify-center px-4 py-3 min-h-0">
              <div className="relative w-full aspect-video max-h-[55vh] rounded-md overflow-hidden bg-muted">
                {currentScene.imageUrl ? (
                  <img
                    src={currentScene.imageUrl}
                    alt={currentScene.caption}
                    className={`w-full h-full object-contain transition-opacity duration-200 ${fadeClass}`}
                    data-testid={`img-scene-${currentIndex}`}
                  />
                ) : (
                  <div
                    className={`w-full h-full bg-gradient-to-br ${styleInfo.gradient} flex items-center justify-center p-8 transition-opacity duration-200 ${fadeClass}`}
                    data-testid={`img-scene-${currentIndex}`}
                  >
                    <div className="text-center max-w-lg">
                      <div className="mb-4 flex justify-center">
                        <StyleIcon className="h-12 w-12 text-white/60" />
                      </div>
                      <p className="text-white/90 text-lg font-medium leading-relaxed">
                        {currentScene.prompt || currentScene.caption}
                      </p>
                      <p className="text-white/50 text-sm mt-3">Scene {currentIndex + 1}</p>
                    </div>
                  </div>
                )}
              </div>

              {scenes.length > 1 && (
                <>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="absolute left-5 top-1/2 -translate-y-1/2 bg-background/60 backdrop-blur-sm"
                    onClick={goPrev}
                    data-testid="button-prev-scene"
                  >
                    <ChevronLeft />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="absolute right-5 top-1/2 -translate-y-1/2 bg-background/60 backdrop-blur-sm"
                    onClick={goNext}
                    data-testid="button-next-scene"
                  >
                    <ChevronRight />
                  </Button>
                </>
              )}
            </div>

            <div className={`px-4 pb-2 text-center transition-opacity duration-300 ${fadeClass}`}>
              <p className="text-sm text-muted-foreground" data-testid="text-scene-caption">
                {currentScene.caption}
              </p>
              <p className="text-xs text-muted-foreground mt-1" data-testid="text-scene-counter">
                {currentIndex + 1} / {scenes.length}
              </p>
            </div>

            <div className="flex items-center justify-center gap-2 px-4 pb-4">
              {scenes.length > 1 && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setIsPlaying((p) => !p)}
                  data-testid="button-play-pause"
                >
                  {isPlaying ? <Pause /> : <Play />}
                </Button>
              )}

              {scenes.length > 1 && (
                <div className="flex items-center gap-1.5" data-testid="dots-navigation">
                  {scenes.map((_, i) => (
                    <button
                      key={i}
                      className={`h-2 w-2 rounded-full transition-colors ${
                        i === currentIndex ? "bg-primary" : "bg-muted-foreground/30"
                      }`}
                      onClick={() => goTo(i)}
                      data-testid={`button-dot-${i}`}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <ScrollArea className="flex-1 min-h-0 max-h-[65vh]">
            <div className="p-4 pt-2">
              <div
                className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-sm"
                data-testid="text-full-storyboard"
              >
                {storyboard}
              </div>
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
