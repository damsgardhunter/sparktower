/**
 * AI visuals for the public project page.
 *
 * Five images, each placed beside a block of the brief (see
 * shared/project-visuals.ts). The logo is the primary reference — it goes to
 * the image *edit* endpoint first, so the pictures are visibly this project's
 * rather than stock art beside its name. The cover rides along second, for
 * mood and setting.
 *
 * Every slot is drawn independently and a slot that fails keeps whatever it
 * had before, so one content-filter refusal doesn't cost the other four.
 */
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { toFile } from "openai";
import { db } from "./db";
import { projects, type Project } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { openai } from "./replit_integrations/image/client";
import { ObjectStorageService } from "./replit_integrations/object_storage";
import { IMAGE_MODEL, IMAGE_QUALITY } from "./aiModels";
import { requireImages } from "./images";
import { storage } from "./storage";
import { CREDIT_COSTS , CHARGEABLE} from "@shared/plans";
import { rateLimit } from "./moderation";
import { respondToAiError } from "./ai-json";
import {
  PROJECT_VISUAL_SLOTS, isProjectVisualSlot,
  type ProjectVisualSlot, type ProjectVisualSlotDef, type ProjectVisuals,
  takeFor,
} from "@shared/project-visuals";

/** The formats the image edit endpoint takes, by magic bytes. */
function imageType(buf: Buffer): "image/png" | "image/jpeg" | "image/webp" | null {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Reads an uploaded image, or null when it isn't one the model can take. */
export async function readReference(url: string | null, name: string) {
  if (!url?.startsWith("/objects/")) return null;
  const buffer = await new ObjectStorageService()
    .readObjectBuffer(url, 15 * 1024 * 1024)
    .then((r) => r.buffer)
    .catch(() => null);
  if (!buffer) return null;
  const type = imageType(buffer);
  if (!type) return null;
  const ext = type.split("/")[1];
  return toFile(buffer, `${name}.${ext}`, { type });
}

const BRIEF_LABELS: Record<string, string> = {
  oneLiner: "One-liner",
  description: "About",
  mission: "Mission",
  problemStatement: "Problem",
  targetUser: "Who it's for",
  valueProposition: "Value proposition",
  targetCustomerProfile: "Target customer",
  successMetrics: "What success looks like",
};

/** Exported for the test that redrawing asks for a different picture, like postImagePrompt. */
export function visualPrompt(project: Project, def: ProjectVisualSlotDef, hasCover: boolean, draws: number) {
  const context = def.briefKeys
    .map((k) => {
      const v = String((project as Record<string, unknown>)[k] ?? "").trim();
      return v ? `${BRIEF_LABELS[k] ?? k}: ${v.slice(0, 500)}` : null;
    })
    .filter(Boolean)
    .join("\n");

  return [
    `An image for the public page of a project called "${project.title}"${project.category ? ` (${project.category})` : ""}.`,
    `The first supplied image is the project's logo. It is the primary reference: take the colour palette, shapes and visual identity from it,`,
    `and where the logo itself appears keep its shapes and proportions recognisable.`,
    hasCover
      ? `The second supplied image is the project's cover image — use it only as a secondary reference for mood and setting.`
      : "",
    `Subject: ${def.subject}`,
    context ? `What the project is about:\n${context}` : "",
    `Style: polished, modern, editorial; cohesive with the other images on the same page.`,
    def.shape === "wide" ? `Wide landscape composition.` : `Square composition, centred subject.`,
    /*
     * What makes a redraw a different picture. Everything above is fixed by
     * the project, so without this the second press sends the same prompt and
     * gets the same image — which is what "redo does nothing" actually was.
     * The take changes where the camera is and how it is lit, never the
     * subject or the palette, because those are the builder's choices.
     */
    takeFor(draws),
    draws > 0
      ? `This is attempt ${draws + 1} at this image. Compose it differently from a straightforward first attempt — a different viewpoint and arrangement, the same subject and the same brand.`
      : "",
    `No text, lettering, words or numbers anywhere in the image.`,
  ].filter(Boolean).join("\n");
}

/** Draws one slot and stores it. Throws when the model returns nothing. */
async function drawSlot(
  project: Project, def: ProjectVisualSlotDef,
  logo: Awaited<ReturnType<typeof readReference>>, cover: Awaited<ReturnType<typeof readReference>>,
  draws: number,
): Promise<string> {
  const response = await openai.images.edit({
    model: IMAGE_MODEL,
    prompt: visualPrompt(project, def, !!cover, draws),
    image: cover ? [logo!, cover] : [logo!],
    size: def.shape === "wide" ? "1536x1024" : "1024x1024",
    quality: IMAGE_QUALITY,
  } as any);
  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("The image model returned nothing");
  /*
   * Explicitly public, and explicitly owned.
   *
   * These are the pictures on the project's own page and in the feed, loaded
   * by <img> with no credentials at all — on mobile, by a native image view
   * that sends neither cookie nor bearer token. Marking them private would
   * blank them for everyone including the team. Saying "public" out loud is
   * still the fix: an object with no policy is public by accident, and the
   * next person reading this call site can't tell that from public by
   * decision. The owner is recorded so the object can be traced back.
   */
  return new ObjectStorageService().writeObjectBuffer(Buffer.from(b64, "base64"), "image/png", {
    owner: project.ownerId,
    visibility: "public",
  });
}

/** The project, when the caller owns it; otherwise the response is sent. */
async function ownedProject(req: any, res: any): Promise<Project | null> {
  const [project] = await db.select().from(projects).where(eq(projects.id, req.params.id));
  if (!project) { res.status(404).json({ message: "Project not found" }); return null; }
  if (project.ownerId !== req.user.id) {
    res.status(403).json({ message: "Only the project owner can change these visuals" });
    return null;
  }
  return project;
}

const currentVisuals = (project: Project): ProjectVisuals =>
  ({ ...((project.profileVisuals as ProjectVisuals) || {}) });

/** Drops a slot from the hidden list — putting a new picture in shows it. */
const unhide = (visuals: ProjectVisuals, slot: ProjectVisualSlot): ProjectVisuals => ({
  ...visuals,
  hidden: (visuals.hidden || []).filter((s) => s !== slot),
});

async function saveVisuals(projectId: string, visuals: ProjectVisuals) {
  const [updated] = await db.update(projects).set({ profileVisuals: visuals })
    .where(eq(projects.id, projectId)).returning();
  return updated.profileVisuals;
}

export function registerProjectVisualRoutes(app: Express) {
  /**
   * Draws every slot, or just `slot` when one is given (a redo from the
   * hover menu). Charged after at least one image came back — a run where the
   * model refused everything costs nothing.
   */
  app.post("/api/projects/:id/visuals", isAuthenticated, rateLimit("render"), async (req: any, res) => {
    const userId = req.user.id;
    try {
      const only = req.body?.slot;
      if (only != null && !isProjectVisualSlot(only)) {
        return res.status(400).json({ message: "Unknown image slot" });
      }

      const project = await ownedProject(req, res);
      if (!project) return;

      const logo = await readReference(project.logoUrl, "logo");
      if (!logo) {
        return res.status(400).json({
          message: "Upload a PNG, JPG or WebP logo first — the visuals are built from it.",
          code: "logo_required",
        });
      }

      const cover = await readReference(project.coverUrl, "cover");
      const slots = only ? PROJECT_VISUAL_SLOTS.filter((d) => d.slot === only) : PROJECT_VISUAL_SLOTS;

      /*
       * `wanted` is the real number, which for a full page is five. It used to
       * be one small action either way, so a dollar day pass drew the whole
       * page as often as somebody liked; now the hourly ceiling knows what it
       * is being asked for and the free go covers the first set rather than a
       * fifth of it.
       */
      // metering: priced as pictures, five of them for a whole page — the first
      // set is free per project, then the image pass. See server/images.ts.
      const permit = await requireImages(res, userId, {
        scope: "project", scopeId: project.id, wanted: slots.length,
        label: only ? "Redrawing that image" : "Adding visuals to your project page",
      });
      if (!permit) return;

      // How many times each slot has already been drawn — the take rotates on it.
      const takes = currentVisuals(project).takes ?? {};
      const results = await Promise.all(slots.map(async (def) => {
        try {
          return { slot: def.slot, path: await drawSlot(project, def, logo, cover, takes[def.slot] ?? 0), error: null };
        } catch (err: any) {
          return { slot: def.slot, path: null, error: String(err?.message || err) };
        }
      }));

      const made = results.filter((r) => r.path);
      if (made.length === 0) {
        console.error("Project visuals: every slot failed:", results[0]?.error);
        return res.status(502).json({ message: "Couldn't draw that this time. Nothing was charged — try again.", code: "model_unreadable" });
      }

      let visuals = currentVisuals(project);
      for (const r of made) visuals = unhide({ ...visuals, [r.slot]: r.path! }, r.slot);
      /*
       * Counted only for the slots that actually produced a picture, so a
       * failed draw doesn't burn a take and hand the next press the one after
       * the one it never saw.
       */
      visuals = { ...visuals, takes: { ...takes, ...Object.fromEntries(made.map((r) => [r.slot, (takes[r.slot] ?? 0) + 1])) } };
      const saved = await saveVisuals(project.id, visuals);

      // Recorded with what was actually drawn, so a slot that failed isn't billed against the hour.
      await permit.record(made.length);

      res.json({
        visuals: saved,
        failed: results.filter((r) => !r.path).map((r) => r.slot),
        free: permit.free,
      });
    } catch (error: any) {
      console.error("Project visuals error:", error);
      respondToAiError(res, error, "Couldn't add visuals");
    }
  });

  /** The owner's own picture in one slot, uploaded through the normal flow. */
  app.put("/api/projects/:id/visuals/:slot", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      const slot = req.params.slot;
      if (!isProjectVisualSlot(slot)) return res.status(400).json({ message: "Unknown image slot" });
      const imageUrl = String(req.body?.imageUrl ?? "");
      // Only an upload of ours — never an arbitrary link on someone's page.
      if (!/^\/objects\/[\w\-/.]+$/.test(imageUrl)) {
        return res.status(400).json({ message: "Upload the image first", code: "upload_required" });
      }

      const project = await ownedProject(req, res);
      if (!project) return;

      const visuals = unhide({ ...currentVisuals(project), [slot]: imageUrl }, slot);
      res.json({ visuals: await saveVisuals(project.id, visuals) });
    } catch (error) {
      console.error("Upload project visual error:", error);
      res.status(500).json({ message: "Couldn't use that image" });
    }
  });

  /** Hides or shows one slot on the public page. The image is kept either way. */
  app.patch("/api/projects/:id/visuals/:slot", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      const slot = req.params.slot;
      if (!isProjectVisualSlot(slot)) return res.status(400).json({ message: "Unknown image slot" });
      if (typeof req.body?.hidden !== "boolean") {
        return res.status(400).json({ message: "Say whether to hide it" });
      }

      const project = await ownedProject(req, res);
      if (!project) return;

      const visuals = unhide(currentVisuals(project), slot);
      if (req.body.hidden) visuals.hidden = [...(visuals.hidden || []), slot];
      res.json({ visuals: await saveVisuals(project.id, visuals) });
    } catch (error) {
      console.error("Hide project visual error:", error);
      res.status(500).json({ message: "Couldn't change that" });
    }
  });

  /** Takes every visual off the page. The stored images are left in place. */
  app.delete("/api/projects/:id/visuals", isAuthenticated, async (req: any, res) => {
    try {
      const project = await ownedProject(req, res);
      if (!project) return;
      res.json({ visuals: await saveVisuals(project.id, {}) });
    } catch (error) {
      console.error("Remove project visuals error:", error);
      res.status(500).json({ message: "Couldn't remove the visuals" });
    }
  });
}
