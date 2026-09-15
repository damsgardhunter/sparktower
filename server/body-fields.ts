/**
 * The fields a client may write, per resource.
 *
 * Request bodies are never spread into a write or passed to storage whole.
 * Spreading trusts every key the client sent — `projectId` moves a row to
 * someone else's project, `role` promotes a member, `amount` records money that
 * was never paid — and a schema that later grows a server-owned column quietly
 * starts accepting it. Each route instead picks the keys listed here, and sets
 * ids, owners and timestamps from the session and the URL itself.
 *
 * Adding a column a client should edit means adding it here, on purpose.
 */

/** Only the listed keys that are present on the body; anything else is dropped. */
export function pickFields<K extends string>(body: unknown, keys: readonly K[]): { [P in K]?: any } {
  const out: { [P in K]?: any } = {};
  if (!body || typeof body !== "object" || Array.isArray(body)) return out;
  for (const key of keys) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    if (Object.prototype.hasOwnProperty.call(body, key)) out[key] = (body as Record<string, unknown>)[key];
  }
  return out;
}

export const WRITABLE = {
  waitlist: ["email", "name", "source"],
  interviews: ["intervieweeName", "intervieweeRole", "date", "notes", "keyInsights", "sentiment", "status"],
  experiments: ["hypothesis", "method", "status", "result", "startDate", "endDate", "metrics", "learnings"],
  pricing: ["name", "price", "billingPeriod", "features", "limits", "isFeatured", "sortOrder"],
  analyticsEvents: ["eventName", "category", "description", "trackingStatus", "track"],
  legalDocs: ["docType", "title", "content", "status"],
  deployChecklist: ["item", "category", "isCompleted", "sortOrder"],
  supportTickets: ["submitterEmail", "submitterName", "subject", "description", "status", "priority"],
  launchTasks: ["channel", "task", "status", "targetDate", "notes"],
  decisions: ["title", "decision", "context", "status"],
  files: ["name", "url", "folder", "fileType", "size"],
  links: ["label", "url", "category"],
  /** A member's own availability; their role changes only through the team routes. */
  member: ["timezone", "availability", "hoursPerWeek", "skills"],
  sprintTask: ["title", "description", "status", "order", "assigneeId"],
} as const;
