/**
 * A project's brand kit: the one place an advert's colours, logo, name, voice
 * and call to action come from.
 *
 * The tables and the rules existed before this did, and nothing could reach
 * them — so the first adverts this product generated had no brand in them at
 * all, because no project could have one. The user's words were "there was no
 * brand kit", and they were right: `shared/ad-brand.ts` validated kits nobody
 * could save.
 *
 * ## Why a partial kit saves
 *
 * A business fills this in over several sittings — colours now, the logo when
 * someone finds the file, the call to action once they decide what it is.
 * Refusing a save because the logo is missing means nobody ever gets as far as
 * the logo. So every field is optional and what gets rejected is a value that
 * is *present and wrong*: a colour that is not a colour would be drawn as
 * black and read as a bug in the renderer.
 *
 * ## Why the palette route proposes rather than saves
 *
 * Reading colours out of a logo is a guess. It is a good guess — it is the
 * business's actual logo — but the two colours it picks are the two most
 * common quantised buckets, and the most common colour in a logo is sometimes
 * the one nobody thinks of as the brand colour. So it answers with a proposal
 * and the swatches it came from, and a save is a separate decision somebody
 * makes by looking at it. A route that read a logo and silently rewrote the
 * brand would be the renderer choosing the colours again.
 */
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { projects, projectBrandKits } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { isOnTeam } from "./project-visibility";
import { rateLimit } from "./moderation";
import { ObjectStorageService } from "./replit_integrations/object_storage";
import { brandFromLogo } from "./logo-palette";
import {
  BRAND_VOICES, BRAND_FONTS, brandCompleteness, brandWarnings, resolvedBrand, validateBrandKit,
  type BrandKitInput,
} from "@shared/ad-brand";

/** A logo big enough to be a logo and small enough not to be a denial of service. */
const MAX_LOGO_BYTES = 12 * 1024 * 1024;

/**
 * The project, and whether this person may touch its brand.
 *
 * 404 for both "no such project" and "not your project", because the two are
 * the same answer to someone guessing ids: a 403 confirms the project exists.
 * The team can read and write it — a brand is not an owner-only secret, and a
 * co-founder who cannot fix the logo will ask the owner to, which is worse.
 */
async function reachable(projectId: string, viewerId: string | null | undefined) {
  const [project] = await db.select({ id: projects.id, ownerId: projects.ownerId, title: projects.title })
    .from(projects).where(eq(projects.id, projectId));
  if (!project) return null;
  return (await isOnTeam(viewerId, project)) ? project : null;
}

export async function brandKitFor(projectId: string): Promise<BrandKitInput | null> {
  const [row] = await db.select().from(projectBrandKits).where(eq(projectBrandKits.projectId, projectId));
  return row ?? null;
}

/**
 * Writes the kit, creating it the first time.
 *
 * `onConflictDoUpdate` on the one-kit-per-project constraint rather than
 * read-then-insert-or-update: two saves arriving together from two tabs would
 * both read no kit and both insert, and the second would fail on the
 * constraint with a 500 about a duplicate key.
 */
export async function saveBrandKit(projectId: string, value: BrandKitInput) {
  const whole = { ...EMPTY_KIT, ...value };
  const [row] = await db.insert(projectBrandKits)
    .values({ projectId, ...whole, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: projectBrandKits.projectId,
      set: { ...whole, updatedAt: new Date() },
    })
    .returning();
  return row;
}

/**
 * Every field, null.
 *
 * A PUT replaces the kit, and without this it only half did. `validateBrandKit`
 * returns the fields it was given — plus the free-text ones, which it sets to
 * null when they are absent because that is how it clears them. Spread
 * straight into the update, that made one request behave two ways: omitting
 * `displayName` wiped the name, omitting `primaryColor` left the colour
 * alone. A form that saves one section would quietly erase another, and the
 * only difference between the two fields is which branch of the validator
 * they happen to go down.
 *
 * So the whole kit is written every time, and a field that is not in the
 * request is a field being cleared. That is the behaviour a PUT promises, and
 * the one a client can predict without reading the validator.
 */
const EMPTY_KIT: Required<BrandKitInput> = {
  primaryColor: null, backgroundColor: null, accentColor: null, logoPath: null,
  fontFamily: null, displayName: null, tagline: null, voice: null,
  avoidWords: null, callToAction: null, websiteUrl: null,
};

export function registerAdBrandRoutes(app: Express) {
  /**
   * The kit as stored, the kit as the renderer will see it, and how much of it
   * is filled in.
   *
   * All three, because they answer different questions and a client that only
   * got the first would compute the other two — and then the fallback colour
   * in a progress bar would be whatever the web app guessed rather than what
   * the compositor is actually going to draw.
   */
  app.get("/api/projects/:id/ad-brand", isAuthenticated, async (req: any, res) => {
    try {
      const project = await reachable(req.params.id, req.user?.id);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const kit = await brandKitFor(project.id);
      res.json({
        kit,
        /* What the renderer will use, fallbacks included, so nothing guesses them twice. */
        resolved: resolvedBrand(kit),
        completeness: brandCompleteness(kit),
        warnings: brandWarnings(kit),
        /* The lists, so no screen hardcodes a voice that was renamed here. */
        voices: BRAND_VOICES,
        fonts: BRAND_FONTS,
        /* A kit with no name should offer the project's, not an empty field. */
        suggestedDisplayName: kit?.displayName ?? project.title ?? null,
      });
    } catch (error) {
      console.error("Ad brand read error:", error);
      res.status(500).json({ message: "Couldn't load the brand kit" });
    }
  });

  /**
   * Save, with the field named when something is wrong.
   *
   * A whole-kit PUT rather than per-field PATCHes, because some of what is
   * worth saying needs two fields at once: a primary colour that will not show
   * up against the background is a problem neither field has on its own.
   * `brandWarnings` reports those, and deliberately does not refuse them —
   * these are the business's own colours, and a form that will not accept a
   * brand is worse than a bar that is hard to see.
   */
  app.put("/api/projects/:id/ad-brand", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      const project = await reachable(req.params.id, req.user?.id);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const checked = validateBrandKit((req.body ?? {}) as Record<string, unknown>);
      if (!checked.ok) {
        /* The field, so the form can put the message under the input it belongs to. */
        return res.status(400).json({ message: checked.message, field: checked.field });
      }

      const row = await saveBrandKit(project.id, checked.value);
      res.json({ kit: row, resolved: resolvedBrand(row), completeness: brandCompleteness(row), warnings: brandWarnings(row) });
    } catch (error) {
      console.error("Ad brand save error:", error);
      res.status(500).json({ message: "Couldn't save the brand kit" });
    }
  });

  /**
   * Colours read out of the logo, offered rather than applied.
   *
   * Takes a path so this can run before the kit is saved — the sequence a
   * person actually follows is upload the logo, see the colours it suggests,
   * then save the lot once. Requiring a saved kit first would mean saving a
   * kit with no colours in order to find out what the colours should be.
   */
  app.post("/api/projects/:id/ad-brand/palette", isAuthenticated, rateLimit("upload"), async (req: any, res) => {
    try {
      const project = await reachable(req.params.id, req.user?.id);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const kit = await brandKitFor(project.id);
      const path = typeof req.body?.logoPath === "string" ? req.body.logoPath.trim() : kit?.logoPath ?? "";
      /*
       * Only our own uploads. The path is read straight out of object storage,
       * so anything else here is an instruction to this server about what to
       * open — and a brand kit is not a reason to let a request name a file.
       */
      if (!path.startsWith("/objects/")) {
        return res.status(400).json({ message: "Upload a logo first.", field: "logoPath" });
      }

      const { buffer } = await new ObjectStorageService().readObjectBuffer(path, MAX_LOGO_BYTES);
      const proposed = await brandFromLogo(buffer);
      /*
       * Named `proposed`, not `kit`. The shape is deliberately not a brand kit:
       * a client cannot mistake this for something that was saved and skip
       * showing it to the person.
       */
      res.json({ proposed, logoPath: path });
    } catch (error) {
      console.error("Ad brand palette error:", error);
      res.status(422).json({ message: "Couldn't read colours out of that logo. Try a PNG with the logo on its own." });
    }
  });
}
