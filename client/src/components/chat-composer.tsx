import { useCallback, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * A chat input that grows with what you type.
 *
 * A single-line input is fine for a search box and wrong for a conversation:
 * describing a project idea runs to a paragraph, and a one-line field scrolls
 * the beginning of your own sentence out of view while you're still writing
 * it. This starts at one line and grows to `maxRows`, then scrolls internally.
 *
 * Enter sends, Shift+Enter breaks the line — the convention everywhere else,
 * and the reason a plain textarea can't just be dropped in unchanged.
 */
export function ChatComposer({
  value, onChange, onSubmit, placeholder, disabled, maxRows = 8, className, testId,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  maxRows?: number;
  className?: string;
  testId?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Collapse first, or scrollHeight only ever reports the current height and
    // the box can grow but never shrink again.
    el.style.height = "auto";

    const cs = window.getComputedStyle(el);
    const lineHeight = parseFloat(cs.lineHeight) || 20;
    const chrome =
      parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) +
      parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    const max = lineHeight * maxRows + chrome;

    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [maxRows]);

  // Layout effect rather than effect: resizing after paint shows a one-frame
  // jump on every keystroke.
  useLayoutEffect(resize, [value, resize]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onSubmit();
        }
      }}
      placeholder={placeholder}
      disabled={disabled}
      data-testid={testId}
      className={cn(
        "flex-1 resize-none bg-background px-4 py-2.5 text-sm",
        "border border-input rounded-2xl shadow-sm",
        "placeholder:text-muted-foreground",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    />
  );
}
