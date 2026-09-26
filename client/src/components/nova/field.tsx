/**
 * A labelled text box that says what it wants and where you are.
 *
 * ## What the default one does not do
 *
 * The shadcn field is a one-pixel grey rectangle that becomes a slightly
 * different grey when focused. On a form of six, "which box am I in" is a
 * question you answer by hunting for the caret — and the label above it is the
 * only thing that ever says what belongs inside, so anything that needs
 * explaining gets explained in a placeholder that vanishes the moment somebody
 * starts typing.
 *
 * So: a focused field wears Nova's gradient in its border (`.nova-field`,
 * index.css), the same ring the cards wear, and the hint is a real line under
 * the box that stays put while you type. Placeholders go back to being an
 * *example* of the answer, which is the only thing they are any good at.
 *
 * ## The error is where the mistake is
 *
 * Under the box it belongs to, not collected at the top of the form. A form
 * that reports "3 problems" and leaves you to find them is a form people
 * abandon, and the field can mark itself invalid for a screen reader at the
 * same time.
 */
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";

const BASE =
  "nova-field w-full rounded-lg px-3 text-base placeholder:text-muted-foreground/70 " +
  "disabled:cursor-not-allowed disabled:opacity-50 md:text-sm";

/**
 * Taller than the default.
 *
 * 44px is the smallest comfortable touch target, and this product is used on a
 * phone as often as not. It also gives the gradient border room to read as a
 * border rather than as a coloured edge.
 */
const HEIGHT = "h-11";

/**
 * The same treatment for a control this module does not render.
 *
 * A Select is somebody else's trigger button, and a form where the text boxes
 * are 44px with a gradient focus and the dropdowns are 36px with a grey one
 * looks like two forms glued together. This is the class to hand it.
 */
export const NOVA_FIELD_CLASS = `${BASE} ${HEIGHT}`;

export const NovaInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = "", ...props }, ref) => (
    <input ref={ref} className={`${BASE} ${HEIGHT} py-2 ${className}`} {...props} />
  ),
);
NovaInput.displayName = "NovaInput";

export const NovaTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className = "", rows = 3, ...props }, ref) => (
    <textarea ref={ref} rows={rows} className={`${BASE} min-h-[80px] py-2.5 ${className}`} {...props} />
  ),
);
NovaTextarea.displayName = "NovaTextarea";

export interface FieldProps {
  label: ReactNode;
  /** One line on what belongs in the box. Stays put while they type, unlike a placeholder. */
  hint?: ReactNode;
  /** What is wrong with what they typed. Replaces the hint, since both at once is noise. */
  error?: ReactNode;
  /** Shown beside the label for anything genuinely optional, so the rest read as required. */
  optional?: boolean;
  children: (props: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => ReactNode;
}

/**
 * The label, the box, and the line underneath.
 *
 * Takes its child as a function so the id and the ARIA wiring are done here
 * rather than by every caller — a label that is not actually joined to its
 * input is a label a screen reader does not read, and it is invisible in
 * review because it looks right.
 */
export function Field({ label, hint, error, optional, children }: FieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="flex items-center gap-1.5 text-sm font-medium">
        {label}
        {optional && <span className="text-xs font-normal text-muted-foreground">optional</span>}
      </label>
      {children({
        id,
        ...(error ? { "aria-invalid": true } : {}),
        ...(note ? { "aria-describedby": noteId } : {}),
      })}
      {note && (
        <p id={noteId} className={`text-xs ${error ? "text-destructive" : "text-muted-foreground"}`}>
          {note}
        </p>
      )}
    </div>
  );
}
