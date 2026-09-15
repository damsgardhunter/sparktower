import { Fragment, createElement, type ReactNode } from "react";

/**
 * Messages are rendered as React nodes, never as HTML: the only formatting is
 * **bold**, "- " bullets and line breaks, and everything else stays text, so a
 * message (or an echoed user message) can't inject markup or script.
 */
export function formatMessage(content: string): ReactNode[] {
  return content.replace(/\n- /g, "\n• ").split("\n").map((line, i) =>
    createElement(Fragment, { key: i },
      i > 0 ? createElement("br") : null,
      ...line.split(/\*\*(.*?)\*\*/g).map((part, j) => (j % 2 ? createElement("strong", { key: j }, part) : part)),
    ),
  );
}
