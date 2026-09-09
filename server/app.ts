/**
 * Building the Express app, separately from starting it.
 *
 * These two used to be one thing: `server/index.ts` created the app, wired the
 * middleware, and called `listen()` at module load. That makes the app
 * untestable — importing it to make a request starts a real server on a real
 * port and kicks off the background jobs.
 *
 * So the wiring lives here and the starting lives there. The point of the split
 * is that a test exercises *this* stack, not a re-creation of it: a harness that
 * assembles its own middleware is testing a fiction, and the first thing it
 * stops catching is a bug in the order things are mounted — which is where a
 * surprising number of them live, since body parsing, auth, and the raw-body
 * webhook all care deeply about what runs before them.
 */
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import type { Server } from "http";
import { ZodError } from "zod";
import { registerRoutes } from "./routes";
import { WebhookHandlers } from "./webhookHandlers";

export interface CreateAppOptions {
  /** Routes are registered against this — some attach to the server itself. */
  httpServer: Server;
  /**
   * Whether the app has finished booting. Before it has, `GET /` answers a
   * bare 200 so a platform health probe doesn't fail the deploy while startup
   * work is still running. Tests are ready by construction.
   */
  isReady?: () => boolean;
  /** Per-request logging. Off in tests, where it buries the actual failure. */
  logRequests?: boolean;
}

function stripPasswordHash(obj: any): any {
  if (obj === null || obj === undefined || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(stripPasswordHash);
  if (obj instanceof Date) return obj;
  const result: any = {};
  for (const key of Object.keys(obj)) {
    if (key === "passwordHash") continue;
    result[key] = typeof obj[key] === "object" ? stripPasswordHash(obj[key]) : obj[key];
  }
  return result;
}

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

/**
 * Everything from the first middleware to the error handler.
 *
 * Deliberately stops short of the static/Vite catch-all and of `listen()`.
 * The catch-all has to be mounted after the API routes or it swallows them,
 * and it serves the built client — neither of which a request-level test wants.
 */
export async function createApp(opts: CreateAppOptions): Promise<Express> {
  const { httpServer, isReady = () => true, logRequests = false } = opts;
  const app = express();

  app.get("/_health", (_req, res) => {
    res.sendStatus(200);
  });

  app.use((req, res, next) => {
    if (!isReady() && req.path === "/" && req.method === "GET") {
      return res.status(200).send("OK");
    }
    next();
  });

  /*
   * Above express.json, and it must stay there: Stripe signs the raw bytes, so
   * a parsed and re-serialised body fails verification.
   */
  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    async (req, res) => {
      const signature = req.headers["stripe-signature"];
      if (!signature) {
        return res.status(400).json({ error: "Missing stripe-signature" });
      }
      try {
        const sig = Array.isArray(signature) ? signature[0] : signature;
        if (!Buffer.isBuffer(req.body)) {
          return res.status(500).json({ error: "Webhook processing error" });
        }
        await WebhookHandlers.processWebhook(req.body as Buffer, sig);
        res.status(200).json({ received: true });
      } catch (error: any) {
        console.error("Webhook error:", error.message);
        res.status(400).json({ error: "Webhook processing error" });
      }
    },
  );

  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: false }));

  /*
   * Express 5 leaves `req.body` as `undefined` when a request carries no body,
   * where Express 4 left it `{}`. Handlers all over this codebase read
   * `req.body.foo` directly, so a bodyless POST — which is exactly what
   * `apiRequest("POST", url)` sends with no data — threw
   * "Cannot read properties of undefined" and surfaced as a generic 500.
   */
  app.use((req, _res, next) => {
    if (req.body === undefined) req.body = {};
    next();
  });

  if (logRequests) {
    app.use((req, res, next) => {
      const start = Date.now();
      const path = req.path;
      let capturedJsonResponse: Record<string, any> | undefined;

      const originalResJson = res.json;
      res.json = function (bodyJson, ...args) {
        const sanitized = stripPasswordHash(bodyJson);
        capturedJsonResponse = sanitized;
        return originalResJson.apply(res, [sanitized, ...args]);
      };

      res.on("finish", () => {
        const duration = Date.now() - start;
        if (path.startsWith("/api")) {
          let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
          if (capturedJsonResponse) logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
          log(logLine);
        }
      });

      next();
    });
  }

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);

    /*
     * A schema rejection is the caller's mistake, not the server's. Before
     * this, every route that called `.parse()` answered a missing field with
     * a 500 and a raw Zod dump as the message — the person saw "Internal
     * Server Error" for their own empty box, and the error log filled with
     * things that weren't errors. One sentence, the field it's about, and a
     * status that says whose problem it is.
     */
    if (err instanceof ZodError) {
      const first = err.issues[0];
      const field = first?.path?.map(String).join(".") || undefined;
      return res.status(400).json({
        message: first?.message || "Some of that isn't right.",
        code: "invalid_input",
        field,
        issues: err.issues.map((i) => ({ field: i.path.map(String).join("."), message: i.message })),
      });
    }

    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    return res.status(status).json({ message });
  });

  return app;
}
