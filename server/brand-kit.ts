/**
 * "Draw me a logo and cover" — the dollar outcome behind shared/brand-kit.ts.
 *
 * Read that file first: it says why this exists, why there are four styles and
 * why the cover is drawn from the logo rather than beside it.
 *
 * Two pictures, in order, because the second needs the first:
 *
 *   1. the logo, from the project's name and brief, in the style that was
 *      picked, on the image *generate* endpoint — there is nothing to reference
 *      yet, which is the whole point of this feature;
 *   2. the cover, on the image *edit* endpoint with that logo handed in as the
 *      reference, so the banner is demonstrably the same business rather than a
 *      second picture of the same idea.
 *
 * ## What happens when only one of them works
 *
 * The logo is the thing being bought — the cover is built out of it, and half
 * the surfaces in the product read the logo while only the public page reads
 * the cover. So a logo with no cover is a partial success worth keeping and
 * charging for, and the response says which one is missing. A failed logo is
 * nothing at all: there is no reference to draw a cover from, so the request
 * ends there and the dollar goes back.
 *
 * ## What it does to what was already there
 *
 * It replaces the project's logo and cover, and hands the old paths back in
 * `replaced` so the client can offer to put them back. Nothing is deleted:
 * both are object-storage paths and both still resolve afterwards, so undo is
 * one PATCH of two fields. A generated logo silently eating an uploaded one
 * with no way back would be the worst thing this route could do, and it is a
 * dollar feature — the mistake has to be cheap in both directions.
 */
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { projects, type Project } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { openai } from "./replit_integrations/image/client";
import { ObjectStorageService } from "./replit_integrations/object_storage";
import { IMAGE_MODEL, IMAGE_QUALITY } from "./aiModels";
import { imagesThisHour } from "./images";
import { readReference } from "./project-visuals";
import { requireCredits } from "./entitlements";
import { storage } from "./storage";
import { rateLimit, refuseWithRetry } from "./moderation";
import { hasBuildPass } from "./wallet";
import {
  CHARGEABLE, OUTCOME_COPY, OUTCOME_PRICE_CENTS, IMAGE_PASS_HOURLY_LIMIT, formatMoney,
} from "@shared/plans";
import { BRAND_KIT_IMAGES, isLogoStyle, logoStyle, type LogoStyleDef } from "@shared/brand-kit";

/** The brief, as much of it as says something, for grounding both pictures. */
const BRIEF_FIELDS: [key: keyof Project | string, label: string][] = [
  ["oneLiner", "One-liner"],
  ["description", "About"],
  ["mission", "Mission"],
  ["problemStatement", "The problem it solves"],
  ["targetUser", "Who it's for"],
  ["valueProposition", "Value proposition"],
];

function briefOf(project: Project): string {
  return BRIEF_FIELDS
    .map(([key, label]) => {
      const value = String((project as Record<string, unknown>)[key as string] ?? "").trim();
      return value ? `${label}: ${value.slice(0, 400)}` : null;
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * The logo prompt. Exported for the test that the four styles really do ask
 * for four different drawings, and that only the name logo asks for lettering
 * — the difference between the styles is this string and nothing else, so a
 * style whose direction stopped reaching the model would look exactly like a
 * style the model ignored.
 */
export function logoPrompt(project: Project, style: LogoStyleDef): string {
  const brief = briefOf(project);
  return [
    `A logo for a business called "${project.title}"${project.category ? `, working in ${project.category}` : ""}.`,
    style.direction,
    brief ? `What the business is:\n${brief}` : "",
    /*
     * The palette is left to the model on purpose. It is the one decision here
     * the brief cannot answer — nothing in a project record says what colour
     * the business is — and a prompt that picks for it produces the same blue
     * roundel for everybody, which is the failure this feature is most likely
     * to have.
     */
    "Choose a small palette that suits what the business does, and use it consistently.",
    "Centred in a square, generous even margin, nothing cropped at the edges.",
    "Flat plain white background, no photographic background, no mock-up, no business card, no packaging, no screen, no hand holding it.",
    style.lettering
      ? `The only text in the image is the name, spelled exactly "${project.title}". No other words, no tagline, no URL, no lorem ipsum.`
      : "No text, letters, words or numbers anywhere in the image. Not the name, not initials, not a tagline.",
  ].filter(Boolean).join("\n");
}

/**
 * The cover prompt. The logo is the supplied image, and the instruction that
 * matters is the one telling the model to keep it recognisable: an edit call
 * given a reference and no instruction about it will happily redraw the mark
 * into something adjacent, which is exactly the mismatch drawing the cover
 * from the logo was meant to prevent.
 */
export function coverPrompt(project: Project, style: LogoStyleDef): string {
  const brief = briefOf(project);
  return [
    `A wide banner image for the public page of a business called "${project.title}".`,
    "The supplied image is that business's logo, drawn moments ago.",
    "Take its exact palette, and place the logo itself in the composition — unchanged in shape and proportion, not redrawn, not restyled, not reinterpreted.",
    "Everything around it is a setting the logo sits in: shapes, texture and light that extend the same palette.",
    brief ? `What the business is:\n${brief}` : "",
    `Keep it consistent with a ${style.label.toLowerCase()} — the banner and the mark have to look like one piece of work.`,
    "Wide landscape composition, uncluttered, plenty of quiet space; the page puts a title over the middle of it.",
    style.lettering
      ? `The only text is the name in the logo, spelled exactly "${project.title}". No tagline, no other words.`
      : "No text, letters, words or numbers anywhere in the image.",
  ].filter(Boolean).join("\n");
}

/** Stores one picture and hands back its object path. Throws when the model gave nothing. */
async function draw(
  call: Promise<any>, ownerId: string,
): Promise<string> {
  const response = await call;
  const b64 = response?.data?.[0]?.b64_json;
  if (!b64) throw new Error("no image");
  /*
   * Public by decision, as everywhere else that writes a picture: a logo and a
   * cover are loaded by <img> with no credentials on a page built for
   * strangers, and marking them private would blank them for everybody
   * including the owner. The owner is recorded so the object traces back to
   * the account that paid for it.
   */
  return new ObjectStorageService().writeObjectBuffer(Buffer.from(b64, "base64"), "image/png", {
    owner: ownerId,
    visibility: "public",
  });
}

export function registerBrandKitRoutes(app: Express) {
  /**
   * Draw a placeholder logo, then a cover built around it. One dollar, or free
   * on a project the whole-business build has bought — which is what that
   * purchase means everywhere else, so it means it here too.
   */
  app.post("/api/projects/:id/brand-kit", isAuthenticated, rateLimit("render"), async (req: any, res) => {
    const userId = req.user.id as string;

    if (!isLogoStyle(req.body?.style)) {
      return res.status(400).json({
        message: "Pick one of the four looks: a name logo, artistic, simple or symmetric.",
        code: "invalid_input", field: "style",
      });
    }
    const style = logoStyle(req.body.style);

    const [project] = await db.select().from(projects).where(eq(projects.id, req.params.id));
    if (!project) return res.status(404).json({ message: "Project not found" });
    /*
     * The owner, not the team. This spends money from one person's balance and
     * replaces the two images every other surface in the product reads, which
     * is not a thing a collaborator should be able to do to somebody else's
     * project on their behalf.
     */
    if (project.ownerId !== userId) {
      return res.status(403).json({ message: "Only the project's owner can change its logo.", code: "forbidden" });
    }

    /*
     * The brief, before the money. A logo drawn from a title alone is a logo
     * drawn from nothing — the model has no idea what the business does, and
     * what comes back is generic in a way no amount of re-rolling fixes. Said
     * before charging rather than after, because "that'll be a dollar, and by
     * the way it won't be any good" is not a thing to do to somebody.
     */
    if (!briefOf(project).trim()) {
      return res.status(400).json({
        message: "Write a one-liner or a description in your brief first — the logo is drawn from what the business does, and there is nothing to draw from yet.",
        code: "brief_empty", field: "oneLiner",
      });
    }

    /*
     * The same hourly ceiling the image pass carries, applied however this was
     * paid for. A dollar a press is its own limit; a project covered by the
     * whole-business build has no such limit, and unbounded free image
     * generation is the one line on the price list that could cost more in a
     * night than the rest earns in a month. See server/images.ts.
     */
    const already = await imagesThisHour(userId);
    if (already + BRAND_KIT_IMAGES > IMAGE_PASS_HOURLY_LIMIT) {
      return refuseWithRetry(res, {
        action: "ai",
        message:
          `That's ${already} images in the last hour, and ${IMAGE_PASS_HOURLY_LIMIT} is the ceiling. ` +
          `It frees up as the hour rolls on — nothing was charged.`,
        retryAfterSeconds: 300,
        code: "image_hourly_limit",
        extra: { madeThisHour: already, hourlyLimit: IMAGE_PASS_HOURLY_LIMIT, wanted: BRAND_KIT_IMAGES },
      });
    }

    // Covered projects are free, and `requireCredits` is what knows that — it
    // consults the build pass itself, so this is here only for the reply.
    const covered = await hasBuildPass(userId, project.id);
    // metering: a priced outcome — $1 for the pair, or nothing on a project the
    // whole-business build has bought. Charged after a logo exists.
    const ent = await requireCredits(res, userId, CHARGEABLE, OUTCOME_COPY.brand.name, {
      outcome: "brand", projectId: project.id, action: "brandKit",
    });
    if (!ent) return;

    try {
      const logoUrl = await draw(openai.images.generate({
        model: IMAGE_MODEL,
        prompt: logoPrompt(project, style),
        size: "1024x1024",
        quality: IMAGE_QUALITY,
      } as any), project.ownerId);

      /*
       * The cover, from the logo that now exists. It is read back out of object
       * storage rather than kept in memory as a buffer, because that is the
       * only way to be sure the thing handed to the model is the thing the
       * project will actually show — a cover drawn from a buffer that failed to
       * store would match a logo nobody can see.
       */
      let coverUrl: string | null = null;
      const reference = await readReference(logoUrl, "logo");
      if (reference) {
        coverUrl = await draw(openai.images.edit({
          model: IMAGE_MODEL,
          prompt: coverPrompt(project, style),
          image: [reference],
          size: "1536x1024",
          quality: IMAGE_QUALITY,
        } as any), project.ownerId).catch((err) => {
          // Kept, not failed: see the file comment. The logo is the purchase.
          console.error("[brand-kit] the cover failed, keeping the logo:", err?.message || err);
          return null;
        });
      }

      const replaced = { logoUrl: project.logoUrl ?? null, coverUrl: project.coverUrl ?? null };
      const [updated] = await db.update(projects)
        .set({ logoUrl, ...(coverUrl ? { coverUrl } : {}) })
        .where(eq(projects.id, project.id))
        .returning();

      // Settles the hold requireCredits took. After the pictures, never before,
      // and never in a catch — see test/unit/ai-metering.test.ts.
      await storage.deductCredits(userId, CHARGEABLE);

      res.json({
        style: style.id,
        logoUrl: updated.logoUrl,
        coverUrl: updated.coverUrl,
        /** So the client can offer to put back what was there, without keeping its own copy. */
        replaced,
        coverFailed: !coverUrl,
        paidCents: covered ? 0 : OUTCOME_PRICE_CENTS.brand,
        covered,
      });
    } catch (err: any) {
      console.error("[brand-kit] couldn't draw it:", err?.message || err);
      // The image model's own refusals carry a reason worth passing on; everything else is ours.
      const refused = /safety|content policy|moderation/i.test(String(err?.message ?? ""));
      if (res.headersSent) return;
      res.status(refused ? 400 : 502).json({
        message: refused
          ? "The image model wouldn't draw that. Try a different look, or reword your one-liner. Nothing was charged."
          : `Couldn't draw it this time. Nothing was charged — the ${formatMoney(OUTCOME_PRICE_CENTS.brand)} is back on your balance.`,
        code: refused ? "image_refused" : "model_unreadable",
      });
    }
  });
}
