/**
 * The work a Nova dashboard recommendation hands over to the tab that owns it.
 *
 * A recommendation used to POST its endpoint from the dashboard itself. That
 * left the builder watching a spinner on the dashboard while the thing they
 * paid for happened somewhere they couldn't see, and for the endpoints whose
 * answer lives in a tab's local state — next actions, people recommendations —
 * the reply was parsed, toasted about, and thrown away.
 *
 * So the dashboard runs nothing. It navigates to the tab that owns the work
 * and hands the job over; that tab runs it with its own button state, its own
 * error copy, and somewhere to put the result.
 *
 * Each id is mapped here to the tab that answers for it, so a recommendation's
 * destination and the component that picks it up can't drift apart.
 */

export const NOVA_HANDOFF_TABS = {
  "roadmap.nextActions": "roadmap",
  "roadmap.update": "roadmap",
  "roadmap.rebuild": "roadmap",
  "kanban.generate": "kanban",
  "personas.generate": "personas",
  "team.recommendPeople": "team",
  "strategy.readiness": "strategy",
  "strategy.pricing": "strategy",
  "analytics.healthCheck": "analytics",
  "activity.checkIn": "activity",
} as const;

export type NovaHandoff = keyof typeof NOVA_HANDOFF_TABS;

export const novaHandoffTab = (action: NovaHandoff): string => NOVA_HANDOFF_TABS[action];
