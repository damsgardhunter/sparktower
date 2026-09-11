/**
 * Two ways to start a conversation, written from why you were matched.
 *
 * Restated from client/src/lib/message-templates.ts — Metro can't resolve the
 * web app's paths, the same reason src/projectSections.ts is a copy.
 * test/unit/message-templates.test.ts runs both on the same inputs and fails
 * the moment they'd say different things, so a change to one has to be made
 * to both.
 *
 * A blank message box is where a new connection stalls, so the composer opens
 * already written. No model call: a draft that costs a credit isn't lightweight.
 */
export interface TemplateSubject {
  name: string;
  /** Nova's match reason, when there is one. */
  reason?: string | null;
  headline?: string | null;
}

export interface MessageTemplate {
  id: string;
  label: string;
  body: string;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";

/** A reason as the end of a sentence: no trailing full stop, lower-case start, not a paragraph. */
function clause(text: string): string {
  let out = text.trim().replace(/[.!\s]+$/, "");
  if (out.length > 140) out = `${out.slice(0, 139).trimEnd()}…`;
  if (/^[A-Z][a-z]/.test(out)) out = out[0].toLowerCase() + out.slice(1);
  return out;
}

export function messageTemplates(subject: TemplateSubject): MessageTemplate[] {
  const first = firstName(subject.name);
  const topic = `${subject.reason ?? ""} ${subject.headline ?? ""}`.toLowerCase();

  const opener: MessageTemplate = subject.reason?.trim()
    ? { id: "reason", label: "Why we matched", body: `Hi ${first} — Nova matched us because ${clause(subject.reason)}. Would you be up for a quick call this week to swap notes?` }
    : subject.headline?.trim()
      ? { id: "headline", label: "What you're building", body: `Hi ${first} — "${subject.headline.trim()}" caught my eye. I'm building too and would love to swap notes this week.` }
      : { id: "hello", label: "Say hello", body: `Hi ${first} — now that we're connected, saying hello. What are you building?` };

  const ask = /fund|invest|pitch|rais(?:e|ing)|round|seed/.test(topic)
    ? "Happy to trade feedback on each other's pitch?"
    : /mvp|ship|launch|build/.test(topic)
      ? "Want to do a quick feedback swap on what we're each shipping?"
      : "What are you working on right now?";

  return [opener, { id: "short", label: "Short and direct", body: `Hey ${first}! ${ask}` }];
}
