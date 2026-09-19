/**
 * Ideas shown on the landing page when nobody has started a project that day.
 *
 * Written, not generated per visitor. A model call on a public page with no
 * account behind it spends the platform's credits on anonymous traffic and is
 * trivially looped by anyone with curl — so the list is authored once, shipped
 * with the page, and rotated. If these should ever be genuinely fresh, the
 * shape to build is a daily job that generates a batch and caches it, not a
 * call per page view.
 *
 * Each one names the path it belongs to (shared/goals.ts), so the panel teaches
 * the three paths while it is filling a quiet afternoon. They are deliberately
 * small and specific: "an AI startup" is not an idea anyone can begin on a
 * Tuesday, and the point of this panel is that somebody begins.
 */
export interface StarterIdea {
  /** Ship, Systemize or Raise — matching PROJECT_GOALS' `short`. */
  path: "Ship" | "Systemize" | "Raise";
  title: string;
  line: string;
}

export const STARTER_IDEAS: StarterIdea[] = [
  { path: "Ship", title: "A booking page for one stubborn trade", line: "Pick mobile dog groomers or piano tuners. One calendar, one deposit, no app to install." },
  { path: "Ship", title: "Receipts to a tax-ready spreadsheet", line: "Photograph the pile, get a categorised sheet back. Sell it to sole traders in March." },
  { path: "Systemize", title: "The handover pack your agency never wrote", line: "Turn the way you actually do the work into a checklist somebody else can follow without you." },
  { path: "Ship", title: "A rota that texts the people on it", line: "Small teams still run on group chats and guesswork. Replace the guessing, not the chat." },
  { path: "Raise", title: "A data room a stranger can read in ten minutes", line: "Same numbers, told in the order an investor asks for them. The story is the product." },
  { path: "Ship", title: "Menus that read themselves out loud", line: "For anyone who can't read a menu in the dark, in a second language, or at all." },
  { path: "Systemize", title: "One invoice chase that runs itself", line: "Late payment is a process problem. Write the process once and stop doing it by hand." },
  { path: "Ship", title: "A tool that says what a contract actually commits you to", line: "Plain sentences, the clause beside each one, and nothing that pretends to be legal advice." },
];
