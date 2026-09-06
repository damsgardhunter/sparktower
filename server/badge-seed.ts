import { storage } from "./storage";

/**
 * Badges the game routes award by hard-coded id.
 *
 * `user_badges.badge_id` has a foreign key to `badges.id`, so these rows have
 * to exist or every award throws — which used to take down the whole score
 * submission at the end of a game. Seeded on boot rather than by a migration
 * because the ids are referenced from application code, not data.
 */
export const GAME_BADGES = [
  {
    id: "badge-typing-first",
    name: "First Race",
    description: "Finished your first typing race.",
    icon: "⌨️",
    rarity: "common" as const,
    category: "games",
  },
  {
    id: "badge-typing-speed",
    name: "Fast Hands",
    description: "Hit 80 words per minute in a race.",
    icon: "⚡",
    rarity: "rare" as const,
    category: "games",
  },
  {
    id: "badge-typing-perfect",
    name: "Flawless",
    description: "Finished a race with 100% accuracy.",
    icon: "🎯",
    rarity: "epic" as const,
    category: "games",
  },
  {
    id: "badge-signal-first",
    name: "Signal Found",
    description: "Completed your first Signal vs. Noise round.",
    icon: "📡",
    rarity: "common" as const,
    category: "games",
  },
  {
    id: "badge-signal-streak",
    name: "On a Streak",
    description: "Called 10 cards correctly in a row.",
    icon: "🔥",
    rarity: "rare" as const,
    category: "games",
  },
  {
    id: "badge-signal-ace",
    name: "Sharp Instincts",
    description: "Scored 90% or better on an advanced scenario.",
    icon: "🧠",
    rarity: "legendary" as const,
    category: "games",
  },
];

/**
 * Inserts any missing game badge. Idempotent, and non-fatal — a failure here
 * shouldn't stop the server from booting.
 */
export async function ensureGameBadges(): Promise<void> {
  try {
    const existing = await storage.getBadges();
    const have = new Set(existing.map((b) => b.id));
    const missing = GAME_BADGES.filter((b) => !have.has(b.id));
    if (missing.length === 0) return;

    for (const badge of missing) {
      await storage.createBadge(badge as any);
    }
    console.log(`Seeded ${missing.length} game badge(s).`);
  } catch (error) {
    console.error("Badge seed failed (non-fatal):", error);
  }
}
