/**
 * Profile build-out: Nova résumé evaluation and the public "looking for" call.
 */
import { parseModelJson } from "./ai-json";
import type { Express } from "express";
import OpenAI from "openai";
import { storage } from "./storage";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { requireCredits, modelFor, coachingDirectiveFor } from "./entitlements";
import { CREDIT_COSTS } from "@shared/plans";
import {
  LOOKING_FOR_ROLES, LOOKING_FOR_STAGES, LOOKING_FOR_COMMITMENTS,
  type ProfileEducation, type ProfileExperience, type ProfileLookingFor,
  type ProfilePortfolioProject,
} from "@shared/schema";

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    const raw = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const baseURL = raw ? (raw.endsWith("/v1") ? raw : `${raw.replace(/\/$/, "")}/v1`) : undefined;
    _openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL });
  }
  return _openai;
}

const MAX_RESUME_CHARS = 20_000;
/** Résumés above this are rejected rather than sent to the model. */
const MAX_RESUME_BYTES = 10 * 1024 * 1024;

type ResumeKind = "pdf" | "text" | "docx" | "doc" | "unknown";

/**
 * Identifies a résumé from its bytes.
 *
 * Uploads are stored under a bare UUID with no extension, and the local-dev
 * storage fallback reports every file as application/octet-stream — so neither
 * the path nor the metadata can be trusted. Magic bytes can.
 */
function detectResumeKind(buffer: Buffer): ResumeKind {
  if (buffer.length >= 4) {
    // "%PDF"
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) return "pdf";
    // "PK\x03\x04" — zip container, which is what a .docx is.
    if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) return "docx";
    // Legacy OLE2 .doc
    if (buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0) return "doc";
  }

  // Treat it as text if a sample decodes cleanly and is mostly printable.
  const sample = buffer.subarray(0, 2048).toString("utf8");
  if (!sample.includes("�")) {
    const printable = sample.replace(/[^\x09\x0a\x0d\x20-\x7e -￿]/g, "");
    if (printable.length / Math.max(1, sample.length) > 0.9) return "text";
  }
  return "unknown";
}

/**
 * Builds the user message for the model from an uploaded résumé.
 *
 * PDFs go straight to the model as a file part — it reads them natively, which
 * is more reliable than any local text extractor and preserves layout cues
 * like columns and section headers. Plain text is inlined. DOC/DOCX has no
 * server-side extractor available, so those ask for a PDF export instead.
 */
async function buildResumeMessage(objectPath: string): Promise<
  | { ok: true; content: any }
  | { ok: false; message: string }
> {
  const { ObjectStorageService } = await import("./replit_integrations/object_storage");
  const storageService = new ObjectStorageService();

  let file: { buffer: Buffer; contentType: string; size: number };
  try {
    file = await storageService.readObjectBuffer(objectPath, MAX_RESUME_BYTES);
  } catch (err: any) {
    console.error("Failed to read stored résumé:", err?.message || err);
    return {
      ok: false,
      message: "We couldn't open the résumé on file. Try uploading it again.",
    };
  }

  if (file.size === 0) {
    return { ok: false, message: "The résumé on file is empty. Try re-uploading it." };
  }

  const kind = detectResumeKind(file.buffer);

  if (kind === "pdf") {
    // The model reads PDFs natively, which handles columns and section
    // headings better than any local text extractor would.
    return {
      ok: true,
      content: [
        {
          type: "file",
          file: {
            filename: "resume.pdf",
            file_data: `data:application/pdf;base64,${file.buffer.toString("base64")}`,
          },
        },
        { type: "text", text: "Build a builder profile from this résumé." },
      ],
    };
  }

  if (kind === "text") {
    const text = file.buffer.toString("utf8").slice(0, MAX_RESUME_CHARS);
    if (!text.trim()) {
      return { ok: false, message: "That file has no readable text. Try uploading a PDF." };
    }
    return { ok: true, content: text };
  }

  if (kind === "docx" || kind === "doc") {
    return {
      ok: false,
      message:
        "Word documents can't be read automatically. Export it as a PDF and upload that instead.",
    };
  }

  return {
    ok: false,
    message: "We couldn't tell what kind of file that is. Try uploading a PDF.",
  };
}

const str = (v: unknown, max = 300): string => String(v ?? "").trim().slice(0, max);
const strOrNull = (v: unknown, max = 300): string | null => {
  const s = str(v, max);
  return s || null;
};
const strArray = (v: unknown, max = 12): string[] =>
  Array.isArray(v) ? v.map((x) => str(x, 60)).filter(Boolean).slice(0, max) : [];

export function registerProfileRoutes(app: Express) {
  /** Option lists for the "looking for" editor. */
  app.get("/api/profile/looking-for-options", (_req, res) => {
    res.json({
      roles: LOOKING_FOR_ROLES,
      stages: LOOKING_FOR_STAGES,
      commitments: LOOKING_FOR_COMMITMENTS,
    });
  });

  /** Whether there's a readable résumé on file, and the reason if not. */
  app.get("/api/profile/resume-status", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await storage.getUserProfile(req.user.id);
      const url = profile?.resumeUrl || null;
      if (!url) return res.json({ hasResume: false, readable: false });

      // Sniff the real file so the UI's default path is right. Stored paths
      // have no extension, so guessing from the URL would be wrong.
      const built = await buildResumeMessage(url);
      res.json({
        hasResume: true,
        readable: built.ok,
        fileName: url.split("/").pop(),
        parsedAt: (profile as any)?.resumeParsedAt || null,
        note: built.ok ? null : built.message,
      });
    } catch (error) {
      console.error("Resume status error:", error);
      res.status(500).json({ message: "Failed to check your résumé" });
    }
  });

  /**
   * Saves a freshly uploaded résumé onto the profile and reports whether Nova
   * can actually read it, so the client can tell the user immediately rather
   * than failing later at evaluation time.
   */
  app.post("/api/profile/attach-resume", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { resumeUrl } = req.body as { resumeUrl?: string };
      if (!resumeUrl?.startsWith("/objects/")) {
        return res.status(400).json({ message: "That doesn't look like an uploaded file." });
      }

      const existing = await storage.getUserProfile(userId);
      if (!existing) return res.status(400).json({ message: "Set up your profile first." });

      const built = await buildResumeMessage(resumeUrl);

      await storage.upsertUserProfile({ ...existing, userId, resumeUrl } as any);

      res.json({
        resumeUrl,
        readable: built.ok,
        note: built.ok ? null : built.message,
      });
    } catch (error) {
      console.error("Attach résumé error:", error);
      res.status(500).json({ message: "Failed to save your résumé" });
    }
  });

  /**
   * Nova reads a résumé and builds out the profile: experience, education,
   * portfolio projects, skills, and a short summary of what they're good at.
   *
   * Reads the résumé already on the profile by default — most people upload
   * one during onboarding, so asking them to paste it again is redundant.
   * Pasted text is accepted as an override, and as the path for people with no
   * résumé file at all.
   */
  app.post("/api/profile/evaluate-resume", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { resumeText, apply } = req.body as { resumeText?: string; apply?: boolean };

      let userContent: any;
      let source: "upload" | "paste";

      if (resumeText?.trim()) {
        if (resumeText.length > MAX_RESUME_CHARS) {
          return res.status(400).json({
            message: `That's longer than ${MAX_RESUME_CHARS.toLocaleString()} characters — trim it to the relevant parts.`,
          });
        }
        userContent = resumeText.trim();
        source = "paste";
      } else {
        // Fall back to the file they already uploaded.
        const profile = await storage.getUserProfile(userId);
        if (!profile?.resumeUrl) {
          return res.status(400).json({
            message: "No résumé on file. Upload one to get started.",
            code: "no_resume",
          });
        }
        const built = await buildResumeMessage(profile.resumeUrl);
        if (!built.ok) {
          return res.status(422).json({ message: built.message, code: "resume_unreadable" });
        }
        userContent = built.content;
        source = "upload";
      }

      const ent = await requireCredits(res, userId, CREDIT_COSTS.resumeEvaluation, "a résumé evaluation");
      if (!ent) return;

      const completion = await getOpenAI().chat.completions.create({
        model: modelFor(ent),
        messages: [
          {
            role: "system",
            content: `You are Nova, turning someone's résumé into a builder profile. ${coachingDirectiveFor(ent)}

Extract only what's actually in the text. Never invent an employer, a date, a degree, or a skill — a profile that overstates someone is worse than a sparse one. Leave a field null if the résumé doesn't say.

For "skills", list concrete, checkable capabilities (languages, tools, disciplines). Not "team player", not "hard worker".

For "novaSummary", write 2-3 sentences on what this person is genuinely good at and the kind of project they'd strengthen. Address it about them in third person, no fluff.

Respond ONLY with valid JSON (no markdown, no code fences):
{
  "headline": "Short professional headline, under 80 chars",
  "novaSummary": "",
  "skills": [""],
  "interests": [""],
  "experienceLevel": "beginner" | "intermediate" | "expert",
  "experience": [
    { "title": "", "company": "", "location": null, "startDate": null, "endDate": null, "current": false, "description": "1-2 sentences on what they did and delivered", "skills": [""] }
  ],
  "education": [
    { "school": "", "degree": null, "field": null, "startYear": null, "endYear": null, "description": null }
  ],
  "portfolioProjects": [
    { "name": "", "role": null, "description": "", "url": null, "technologies": [""] }
  ]
}`,
          },
          { role: "user", content: userContent },
        ],
      });

      let parsed: any;
      try {
        parsed = parseModelJson(completion.choices[0].message.content, "resume evaluation");
      } catch (err) {
        console.error("Resume parse failed:", err);
        return res.status(502).json({
          code: "model_unreadable",
          message: source === "upload"
            ? "Nova couldn't read that file. Try pasting the text instead."
            : "Nova couldn't read that. Try pasting plain text.",
        });
      }

      const experience: ProfileExperience[] = (Array.isArray(parsed.experience) ? parsed.experience : [])
        .slice(0, 15)
        .map((e: any) => ({
          title: str(e?.title, 160),
          company: str(e?.company, 160),
          location: strOrNull(e?.location, 120),
          startDate: strOrNull(e?.startDate, 40),
          endDate: strOrNull(e?.endDate, 40),
          current: e?.current === true,
          description: strOrNull(e?.description, 1200),
          skills: strArray(e?.skills, 10),
        }))
        .filter((e: ProfileExperience) => e.title || e.company);

      const education: ProfileEducation[] = (Array.isArray(parsed.education) ? parsed.education : [])
        .slice(0, 10)
        .map((e: any) => ({
          school: str(e?.school, 160),
          degree: strOrNull(e?.degree, 120),
          field: strOrNull(e?.field, 120),
          startYear: strOrNull(e?.startYear, 20),
          endYear: strOrNull(e?.endYear, 20),
          description: strOrNull(e?.description, 600),
        }))
        .filter((e: ProfileEducation) => e.school);

      const portfolioProjects: ProfilePortfolioProject[] = (Array.isArray(parsed.portfolioProjects) ? parsed.portfolioProjects : [])
        .slice(0, 12)
        .map((p: any) => ({
          name: str(p?.name, 160),
          role: strOrNull(p?.role, 120),
          description: strOrNull(p?.description, 800),
          url: strOrNull(p?.url, 500),
          technologies: strArray(p?.technologies, 12),
        }))
        .filter((p: ProfilePortfolioProject) => p.name);

      const draft = {
        headline: str(parsed.headline, 120),
        novaSummary: str(parsed.novaSummary, 1000),
        skills: strArray(parsed.skills, 30),
        interests: strArray(parsed.interests, 20),
        experienceLevel: ["beginner", "intermediate", "expert"].includes(parsed.experienceLevel)
          ? parsed.experienceLevel
          : "intermediate",
        experience,
        education,
        portfolioProjects,
      };

      await storage.deductCredits(userId, CREDIT_COSTS.resumeEvaluation);

      // `apply: false` returns a preview so the user can review before it
      // overwrites what they already have.
      if (apply === false) {
        return res.json({ draft, applied: false, source, creditsCharged: CREDIT_COSTS.resumeEvaluation });
      }

      const existing = await storage.getUserProfile(userId);
      const profile = await storage.upsertUserProfile({
        ...(existing || {}),
        userId,
        // Don't clobber a headline or bio they wrote themselves.
        headline: existing?.headline || draft.headline,
        bio: existing?.bio || draft.novaSummary,
        novaSummary: draft.novaSummary,
        skills: draft.skills.length ? draft.skills : existing?.skills || [],
        interests: draft.interests.length ? draft.interests : existing?.interests || [],
        experienceLevel: draft.experienceLevel as any,
        experience: draft.experience,
        education: draft.education,
        portfolioProjects: draft.portfolioProjects,
        resumeParsedAt: new Date(),
      } as any);

      res.json({ draft, profile, applied: true, source, creditsCharged: CREDIT_COSTS.resumeEvaluation });
    } catch (error) {
      console.error("Resume evaluation error:", error);
      res.status(500).json({ message: "Failed to evaluate the résumé" });
    }
  });

  /**
   * Saves a reviewed draft. Used when the client asked for a preview and the
   * user then edited it — no second AI call, no second charge.
   */
  app.post("/api/profile/apply-resume-draft", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { draft } = req.body as { draft?: any };
      if (!draft) return res.status(400).json({ message: "No draft to apply" });

      const existing = await storage.getUserProfile(userId);
      const profile = await storage.upsertUserProfile({
        ...(existing || {}),
        userId,
        headline: str(draft.headline, 120) || existing?.headline || null,
        novaSummary: strOrNull(draft.novaSummary, 1000),
        skills: strArray(draft.skills, 30),
        interests: strArray(draft.interests, 20),
        experience: Array.isArray(draft.experience) ? draft.experience.slice(0, 15) : [],
        education: Array.isArray(draft.education) ? draft.education.slice(0, 10) : [],
        portfolioProjects: Array.isArray(draft.portfolioProjects) ? draft.portfolioProjects.slice(0, 12) : [],
        resumeParsedAt: new Date(),
      } as any);

      res.json({ profile });
    } catch (error) {
      console.error("Apply draft error:", error);
      res.status(500).json({ message: "Failed to save your profile" });
    }
  });

  /** Sets or clears the public "looking for" call. */
  app.post("/api/profile/looking-for", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const body = req.body as Partial<ProfileLookingFor> & { clear?: boolean };

      const existing = await storage.getUserProfile(userId);
      if (!existing) return res.status(400).json({ message: "Set up your profile first." });

      if (body.clear) {
        const profile = await storage.upsertUserProfile({ ...existing, userId, lookingFor: null } as any);
        return res.json({ profile, lookingFor: null });
      }

      if (!body.role?.trim()) {
        return res.status(400).json({ message: "Pick what you're looking for." });
      }

      const lookingFor: ProfileLookingFor = {
        isActive: body.isActive !== false,
        role: str(body.role, 80),
        industries: strArray(body.industries, 6),
        commitment: strOrNull(body.commitment, 40),
        stage: strOrNull(body.stage, 40),
        equityAvailable: typeof body.equityAvailable === "boolean" ? body.equityAvailable : null,
        details: strOrNull(body.details, 600),
      };

      const profile = await storage.upsertUserProfile({ ...existing, userId, lookingFor } as any);
      res.json({ profile, lookingFor });
    } catch (error) {
      console.error("Looking-for error:", error);
      res.status(500).json({ message: "Failed to save what you're looking for" });
    }
  });

  /**
   * Browse people with an active call out. Powers a "who's looking" list and
   * makes the feature discoverable rather than something only visible if you
   * happen to land on a profile.
   */
  app.get("/api/looking-for", async (req: any, res) => {
    try {
      const role = str(req.query.role, 80);
      const all = await storage.getProfilesLookingFor();
      const filtered = role
        ? all.filter((p) => (p.lookingFor as ProfileLookingFor)?.role === role)
        : all;
      res.json(filtered.slice(0, 60));
    } catch (error) {
      console.error("Looking-for list error:", error);
      res.status(500).json({ message: "Failed to load who's looking" });
    }
  });
}
