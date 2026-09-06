import { useState, useRef, useEffect, useCallback } from "react";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/user-avatar";
import { Loader2 } from "lucide-react";
import type { FeedMention } from "@shared/schema";

interface MentionCandidate {
  userId: string;
  name: string;
  handle: string | null;
  headline: string | null;
  avatarUrl: string | null;
}

/**
 * Textarea with @mention autocomplete.
 *
 * Typing `@` opens a people picker; choosing someone inserts their name and
 * records the resolved user id. The ids are what get stored, so a later
 * display-name change never breaks an old post's links.
 */
export function MentionTextarea({
  value, onChange, mentions, onMentionsChange, placeholder, className, maxLength, testId,
}: {
  value: string;
  onChange: (value: string) => void;
  mentions: FeedMention[];
  onMentionsChange: (mentions: FeedMention[]) => void;
  placeholder?: string;
  className?: string;
  maxLength?: number;
  testId?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<MentionCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  /** Where the active `@` sits, so we know what span to replace. */
  const [triggerAt, setTriggerAt] = useState<number | null>(null);

  /** Finds an unfinished @mention immediately before the caret. */
  const detectTrigger = useCallback((text: string, caret: number) => {
    const upto = text.slice(0, caret);
    const match = upto.match(/@([\w.-]*)$/);
    if (!match) return null;
    return { at: caret - match[0].length, term: match[1] };
  }, []);

  useEffect(() => {
    if (query === null) { setCandidates([]); return; }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/feed/mention-search?q=${encodeURIComponent(query)}`, { credentials: "include" });
        if (!res.ok) throw new Error("search failed");
        const data = await res.json();
        if (!cancelled) { setCandidates(data); setHighlighted(0); }
      } catch {
        if (!cancelled) setCandidates([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180); // debounce so typing doesn't hammer the endpoint
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  const insertMention = (candidate: MentionCandidate) => {
    if (triggerAt === null || !ref.current) return;
    const caret = ref.current.selectionStart ?? value.length;
    const before = value.slice(0, triggerAt);
    const after = value.slice(caret);
    const inserted = `@${candidate.name} `;
    onChange(before + inserted + after);

    if (!mentions.some((m) => m.userId === candidate.userId)) {
      onMentionsChange([...mentions, { userId: candidate.userId, name: candidate.name }]);
    }
    setQuery(null);
    setTriggerAt(null);

    // Restore the caret after the inserted name.
    requestAnimationFrame(() => {
      const pos = before.length + inserted.length;
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        className={className}
        data-testid={testId}
        onChange={(e) => {
          onChange(e.target.value);
          const trigger = detectTrigger(e.target.value, e.target.selectionStart ?? 0);
          setQuery(trigger?.term ?? null);
          setTriggerAt(trigger?.at ?? null);
        }}
        onKeyDown={(e) => {
          if (query === null || candidates.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlighted((h) => (h + 1) % candidates.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlighted((h) => (h - 1 + candidates.length) % candidates.length);
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            insertMention(candidates[highlighted]);
          } else if (e.key === "Escape") {
            setQuery(null);
            setTriggerAt(null);
          }
        }}
        onBlur={() => {
          // Delay so a click on a candidate still registers.
          setTimeout(() => { setQuery(null); setTriggerAt(null); }, 150);
        }}
      />

      {query !== null && (loading || candidates.length > 0) && (
        <div
          className="absolute z-50 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-popover shadow-lg"
          data-testid="mention-dropdown"
        >
          {loading && candidates.length === 0 ? (
            <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching people…
            </div>
          ) : (
            candidates.map((c, i) => (
              <button
                key={c.userId}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); insertMention(c); }}
                onMouseEnter={() => setHighlighted(i)}
                className={`w-full flex items-center gap-2.5 p-2.5 text-left ${
                  i === highlighted ? "bg-accent" : ""
                }`}
                data-testid={`mention-option-${c.userId}`}
              >
                <UserAvatar src={c.avatarUrl || undefined} name={c.name} className="h-7 w-7 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{c.name}</p>
                  {c.headline && <p className="text-xs text-muted-foreground truncate">{c.headline}</p>}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Renders post text with **bold** spans and @mentions highlighted.
 * Mentions are matched against the stored list so only real tags light up.
 */
export function FeedContent({ content, mentions }: { content: string; mentions: FeedMention[] }) {
  const names = mentions.map((m) => m.name).filter(Boolean).sort((a, b) => b.length - a.length);
  // Longest names first so "@Ann Lee" wins over "@Ann".
  const pattern = names.length
    ? new RegExp(`(\\*\\*[^*]+\\*\\*|@(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}))`, "g")
    : /(\*\*[^*]+\*\*)/g;

  const parts = content.split(pattern).filter((p) => p !== undefined && p !== "");

  return (
    <p className="text-sm leading-relaxed whitespace-pre-line break-words">
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("@") && names.includes(part.slice(1))) {
          return (
            <span key={i} className="text-primary font-medium" data-testid="feed-mention">
              {part}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </p>
  );
}
