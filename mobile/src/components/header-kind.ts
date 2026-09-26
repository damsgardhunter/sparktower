/**
 * Which header a tab wears, in one place.
 *
 * ## Why this file exists rather than a prop
 *
 * The tabs layout decides the header and the *screen* has to leave room for
 * it — and those two facts lived in different files with nothing keeping them
 * in step. The header floats over the scene (`headerTransparent`), so a screen
 * that leaves the wrong amount of room does not look slightly off: it puts its
 * first rows underneath the header, permanently, where nobody can reach them.
 * That is exactly what happened to Simulations, the leaderboard and your own
 * profile — each left about sixteen points for a header two hundred and twenty
 * tall.
 *
 * So the list is here, `useHeaderSpace` reads it, and the layout reads it. A
 * tab added to one is a tab added to both.
 */

/**
 * Tabs that get the plain title bar instead of the profile header.
 *
 * The profile header — your cover, your face, your three numbers — is the top
 * of *Home*. It is what you see when you open the app, and it slides away the
 * moment you start reading. It is not a page decoration, and putting it above
 * every list in the app was a quarter of the screen spent showing somebody
 * themselves on the way to something else.
 *
 *   - `more` — a menu is for getting somewhere else.
 *   - `messages` — your face above a list of other people's.
 *   - `sprints` — Simulations. Its content was behind the header entirely.
 *   - `notifications` — reached by the bell *inside* the profile header, so
 *     showing that same header above it is a loop.
 *   - `profile` — your cover and face, above a screen whose first element is
 *     your cover and your face.
 */
export const PLAIN_HEADER_TABS = ["more", "messages", "sprints", "notifications", "profile"] as const;

/** What the plain header says, where the tab's own title is not the right word. */
export const PLAIN_HEADER_TITLES: Record<string, string> = {
  more: "Menu",
  messages: "Messages",
  sprints: "Simulations",
  notifications: "Notifications",
  profile: "Profile",
};

export const usesPlainHeader = (tab: string | undefined): boolean =>
  !!tab && (PLAIN_HEADER_TABS as readonly string[]).includes(tab);
