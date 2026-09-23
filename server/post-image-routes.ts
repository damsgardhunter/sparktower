/**
 * An AI image for a feed post.
 *
 * The post is the subject: what the builder wrote is what the picture is of.
 * When the post is on one of their projects, the project's logo comes second
 * — a reference for palette and a light brand presence, never the focus — and
 * its brief (name, one-liner, what it does) fills in what the product is. The
 * image is stored like an upload and handed back to the composer, which adds
 * it to the post's media; nothing is posted until the builder publishes.
 *
 * Charged only when an image comes back: a refusal or an empty answer costs
 * nothing.
 */
import type { Express } from "express";
import { openai } from "./replit_integrations/image/client";
import { ObjectStorageService } from "./replit_integrations/object_storage";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { IMAGE_MODEL, IMAGE_QUALITY } from "./aiModels";
import { requireImages } from "./images";
import { storage } from "./storage";
import { CREDIT_COSTS , CHARGEABLE} from "@shared/plans";
import { MAX_POST_LENGTH, POST_TYPES_BY_KEY } from "@shared/feed";
import { readReference } from "./project-visuals";

/** Shortest post worth drawing: a picture needs something to be about. */
export const POST_IMAGE_MIN_CHARS = 12;

const BRIEF: [key: string, label: string][] = [
  ["oneLiner", "One-liner"], ["description", "What it is"], ["valueProposition", "Value"], ["targetUser", "Who it's for"],
];

export function postImagePrompt(opts: {
  content: string; postTypeLabel?: string | null;
  project?: { title: string; category?: string | null; [k: string]: unknown } | null;
  hasLogo: boolean;
}) {
  const { content, postTypeLabel, project, hasLogo } = opts;
  const brief = project
    ? BRIEF.map(([k, label]) => {
      const v = String(project[k] ?? "").trim();
      return v ? `${label}: ${v.slice(0, 300)}` : null;
    }).filter(Boolean).join("\n")
    : "";
  return [
    `Create an image to go with a founder's post on a builders' social feed.`,
    `THE POST IS THE MAIN SUBJECT. Depict what the post is about — its moment, its idea, its news — as a single striking scene.`,
    postTypeLabel ? `Kind of post: ${postTypeLabel}.` : "",
    `The post:\n"""\n${content.slice(0, MAX_POST_LENGTH)}\n"""`,
    project ? `It's about a project called "${project.title}"${project.category ? ` (${project.category})` : ""}. Use this only as background on what the product is:\n${brief || "(no brief written yet)"}` : "",
    hasLogo
      ? `The supplied image is the project's logo. It is SECONDARY: borrow its colour palette and let the brand be present subtly (for example the mark small on a screen, a sign or an object in the scene). Do not make the logo the focus, do not centre it, and do not just redraw it.`
      : "",
    `Style: polished, modern, editorial; bright and optimistic; wide landscape composition that reads well small in a feed.`,
    `No text, lettering, words, captions or numbers anywhere in the image.`,
  ].filter(Boolean).join("\n\n");
}

export function registerPostImageRoutes(app: Express) {
  app.post("/api/feed/image", isAuthenticated, async (req: any, res) => {
    const userId = req.user.id as string;
    try {
      const content = String(req.body?.content ?? "").trim();
      if (content.length < POST_IMAGE_MIN_CHARS) {
        return res.status(400).json({ message: "Write a little more first — the image is drawn from your post.", code: "invalid_input", field: "content" });
      }
      if (content.length > MAX_POST_LENGTH) {
        return res.status(400).json({ message: `Posts are limited to ${MAX_POST_LENGTH} characters.`, code: "invalid_input", field: "content" });
      }
      const postType = typeof req.body?.postType === "string" ? req.body.postType : null;
      const postTypeLabel = postType ? (POST_TYPES_BY_KEY as Record<string, { label: string }>)[postType]?.label ?? null : null;

      // A project's logo and brief only when the builder is on that project.
      let project: any = null;
      const projectId = typeof req.body?.projectId === "string" && req.body.projectId !== "none" ? req.body.projectId : null;
      if (projectId) {
        const found = await storage.getProject(projectId);
        const members = found ? await storage.getProjectMembers(projectId).catch(() => []) : [];
        if (!found || (found.ownerId !== userId && !members.some((m) => m.userId === userId))) {
          return res.status(403).json({ message: "You can only use the logo of a project you're on.", code: "forbidden" });
        }
        project = found;
      }

      /*
       * Priced as a picture, not as a small action. A post image with no
       * project behind it is scoped to the account, so the free go is one per
       * person rather than one per post — which would be no limit at all.
       */
      // metering: priced as a picture — the first go is free per project (or per
      // account for a post with none), then the image pass. See server/images.ts.
      const permit = await requireImages(res, userId, {
        scope: project ? "project" : "account",
        scopeId: project ? project.id : userId,
        wanted: 1,
        label: "An image for your post",
      });
      if (!permit) return;

      const logo = project ? await readReference(project.logoUrl ?? null, "logo") : null;
      const prompt = postImagePrompt({ content, postTypeLabel, project, hasLogo: !!logo });
      const response = logo
        ? await openai.images.edit({ model: IMAGE_MODEL, prompt, image: [logo], size: "1536x1024", quality: IMAGE_QUALITY } as any)
        : await openai.images.generate({ model: IMAGE_MODEL, prompt, size: "1536x1024", quality: IMAGE_QUALITY } as any);
      const b64 = response.data?.[0]?.b64_json;
      // An answer with no image in it is an unreadable answer: same 502 and machine code as every other AI route, so a client can tell "try again" from "we're broken".
      if (!b64) return res.status(502).json({ message: "Couldn't draw that this time. Nothing was charged — try again.", code: "model_unreadable" });

      // Public by decision, not by omission: this image is drawn to be attached
      // to a feed post that strangers and signed-out visitors will scroll past,
      // and it loads through <img> with no credentials. The owner is recorded
      // so an object written here can be traced back to the account that paid
      // for it. (An object with no policy at all is served to anyone too — the
      // difference is that nobody chose it.)
      const url = await new ObjectStorageService().writeObjectBuffer(Buffer.from(b64, "base64"), "image/png", {
        owner: userId,
        visibility: "public",
      });
      await permit.record(1);
      res.json({ url, usedLogo: !!logo, free: permit.free });
    } catch (error: any) {
      console.error("Post image error:", error?.message || error);
      // The image model's refusals carry a message worth passing on; everything else is ours.
      const refused = /safety|content policy|moderation/i.test(String(error?.message ?? ""));
      if (!res.headersSent) {
        res.status(refused ? 400 : 500).json({
          message: refused ? "That post couldn't be turned into an image. Try rewording it. Nothing was charged." : "Couldn't make an image right now. Nothing was charged.",
          code: refused ? "image_refused" : "image_failed",
        });
      }
    }
  });
}
