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
import { sameOriginWrites } from "./csrf";
import { registerSecurityTxt } from "./security-txt";
import { WebhookHandlers, WebhookVerificationError } from "./webhookHandlers";
import { ModelResponseError } from "./ai-json";
import { enforceRejectionLimit, countRejection, ipKey } from "./moderation";
import { securityHeaders } from "./security-headers";
import { stripSealedFields } from "@shared/strip-sealed";
import { reportError, redact } from "./error-reporting";
import { pool } from "./db";

/**
 * Where an error happened, as a shape rather than as a URL.
 *
 * Express knows the pattern when the error came out of a route handler
 * (`req.route.path`). When it came out of middleware it doesn't, so the path is
 * reduced by hand: every id-looking segment becomes `:id`. Either way what
 * leaves the process is `/api/projects/:id/backings` and not the id, which is
 * the point — an error report shouldn't be a second copy of the access log.
 */
function routePattern(req: Request): string {
  const pattern = (req as any).route?.path;
  if (typeof pattern === "string") return `${req.baseUrl ?? ""}${pattern === "/" ? "" : pattern}` || "/";
  return (req.path || "/")
    .split("/")
    .map((segment) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment) || /^\d+$/.test(segment) || /^[0-9a-f]{16,}$/i.test(segment)
        ? ":id"
        : segment,
    )
    .join("/");
}

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

/**
 * The parts of an account row that are the account holder's business alone.
 *
 * Many routes embed whole `users` rows — a project's owner, its members, an
 * applicant, a post's author — and every one of them used to send the email,
 * Google and Stripe ids, plan and credits, platform role, suspension and
 * signup attribution of whoever it was about, to whoever asked, signed in or
 * not. A full account row is recognisable by `authProvider`, which every row
 * has; purpose-built objects (an investor's consented contact, say) don't, and
 * pass untouched. Your own row, and any row for a reviewer or admin, keep it all.
 */
const PRIVATE_ACCOUNT_FIELDS = new Set([
  "email", "authProvider", "googleId", "stripeCustomerId", "stripeSubscriptionId", "stripeConnectAccountId",
  "subscriptionTier", "creditsUsed", "creditsResetAt", "platformRole", "suspendedAt", "suspendedReason",
  "signupSource", "signupMedium", "signupCampaign", "signupReferrer", "signupLandingPath", "signupParams", "updatedAt",
  /*
   * Money and security state. These ride out on any embedded account row — a
   * project's owner, a leaderboard entry, a member card — and none of them is
   * anyone else's business: that a named builder's card was declined, and what
   * the processor said about it; whether they have two-factor on, which is
   * exactly what someone picking an account to attack would like to know.
   */
  "paymentFailedAt", "paymentFailureMessage", "subscriptionRefundedAt", "subscriptionEventAt",
  "emailVerifiedAt", "mfaEnabledAt", "accessTokensRevokedAt", "deletedAt",
]);

export function stripOthersAccountFields(obj: any, viewer: { id?: string; platformRole?: string } | undefined, depth = 0): any {
  if (depth > 12 || obj === null || obj === undefined || typeof obj !== "object") return obj;
  if (viewer?.platformRole === "reviewer" || viewer?.platformRole === "admin") return obj;
  if (Array.isArray(obj)) return obj.map((v) => stripOthersAccountFields(v, viewer, depth + 1));
  if (obj instanceof Date) return obj;
  const isOthersAccount = "authProvider" in obj && typeof obj.id === "string" && obj.id !== viewer?.id;
  const result: any = {};
  for (const key of Object.keys(obj)) {
    if (isOthersAccount && PRIVATE_ACCOUNT_FIELDS.has(key)) continue;
    result[key] = typeof obj[key] === "object" ? stripOthersAccountFields(obj[key], viewer, depth + 1) : obj[key];
  }
  return result;
}

/** Credentials that never leave the server, whoever's account and whatever route built the payload. */
const NEVER_SENT = new Set(["passwordHash", "mfaSecret", "mfaPendingSecret", "mfaRecoveryCodes", "mfaLastStep"]);

function stripPasswordHash(obj: any): any {
  if (obj === null || obj === undefined || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(stripPasswordHash);
  if (obj instanceof Date) return obj;
  const result: any = {};
  for (const key of Object.keys(obj)) {
    if (NEVER_SENT.has(key)) continue;
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
  app.disable("x-powered-by");
  // First, so every response — health checks, the webhook, errors — carries them.
  app.use(securityHeaders({ production: process.env.NODE_ENV === "production", enforce: process.env.CSP_ENFORCE === "1" }));

  // Sealed fields and password hashes never leave the server, whatever route
  // built the payload. The hash used to be stripped only by the request logger,
  // so it went out wherever logging was off.
  app.use((req: any, res, next) => {
    const json = res.json.bind(res);
    // Read at send time: by then authentication has run and req.user is who's asking.
    res.json = ((body: unknown) => json(stripOthersAccountFields(stripPasswordHash(stripSealedFields(body)), req.user))) as typeof res.json;
    next();
  });

  registerSecurityTxt(app);

  /*
   * Deliberately shallow: is this process alive and listening? That is the
   * question a platform's health check should ask, because the only thing it
   * can do about a "no" is restart the process — and restarting a server whose
   * *database* is unreachable turns one outage into a crash loop.
   */
  app.get("/_health", (_req, res) => {
    res.sendStatus(200);
  });

  /*
   * The deeper question, for a person or a monitor rather than the platform:
   * can this deployment actually do anything?
   *
   * The first deploy of this app to Render came up, announced itself live, and
   * answered /_health with a 200 while every single query failed — its
   * DATABASE_URL still pointed at a database on somebody's laptop. A deploy
   * that is comprehensively broken should not look identical to a working one,
   * so this asks the database and says which it is. It is not wired to the
   * platform's health check, on purpose (see above).
   */
  /*
   * One query at a time, however many are asking.
   *
   * This route is public and unauthenticated — a probe cannot sign in — and it
   * asks the database something, so anyone can make this process talk to the
   * database by asking. That is what CodeQL flags (js/missing-rate-limiting),
   * and it is a fair point about a public endpoint that does real work.
   *
   * Two instruments were wrong before this one. A rate limiter refuses the
   * caller, and the legitimate caller is a monitor on a schedule — being
   * refused is precisely what it would report as an outage. Caching the answer
   * refuses reality instead: `readiness.test.ts` breaks the database and
   * expects 503 on the very next request, and it is right to, because a
   * readiness probe that reports health for a second after the database has
   * gone is worse than the load it was saving.
   *
   * So neither the caller nor the answer is held back — the *queries* are
   * collapsed. While one is in flight every other request waits on that same
   * one and they all get its result, so a flood costs one query per round trip
   * rather than one per request, and nobody is ever told something that isn't
   * true right now.
   */
  let readyInFlight: Promise<{ status: number; body: Record<string, unknown> }> | null = null;

  const askTheDatabase = async () => {
    const started = Date.now();
    try {
      await pool.query("SELECT 1");
      return { status: 200, body: { ready: true, database: "ok", ms: Date.now() - started } };
    } catch (err) {
      const message = String((err as Error)?.message ?? err);
      return {
        status: 503,
        body: {
          ready: false,
          database: "unreachable",
          // The address it tried is the answer nine times out of ten: a localhost
          // here means the deployment carries a development connection string.
          detail: redact(message).slice(0, 200),
          ms: Date.now() - started,
        },
      };
    }
  };

  app.get("/_ready", async (_req, res) => {
    // Cleared in a `finally` so a rejection can't leave every later request
    // waiting on a promise that will never be replaced.
    readyInFlight ??= askTheDatabase().finally(() => { readyInFlight = null; });
    const { status, body } = await readyInFlight;
    res.status(status).json(body);
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
      // public-write: Stripe's signature over the raw body (WebhookHandlers.processWebhook, test/integration/stripe-webhook.test.ts); failed deliveries limited per address
      /*
       * Exempt from the global write floor (WRITE_FLOOR_EXEMPT) on purpose: a
       * busy account's legitimate deliveries all arrive from Stripe's
       * addresses, and a shared counter would drop real events. What limits it
       * instead is the rejection limiter below — an address whose deliveries
       * keep failing verification is refused — and every answer here uses the
       * same { message, code } shape as the rest of the API.
       */
      // An address whose deliveries keep failing it is refused before the next check.
      const sender = ipKey(req);
      if (!(await enforceRejectionLimit(res, sender, "webhookReject"))) return;
      const signature = req.headers["stripe-signature"];
      if (!signature) {
        await countRejection(sender, "webhookReject");
        return res.status(400).json({ message: "Missing stripe-signature", code: "missing_signature" });
      }
      try {
        const sig = Array.isArray(signature) ? signature[0] : signature;
        if (!Buffer.isBuffer(req.body)) {
          return res.status(500).json({ message: "Webhook processing error", code: "webhook_failed" });
        }
        const result = await WebhookHandlers.processWebhook(req.body as Buffer, sig);
        res.status(200).json({ received: true, duplicate: result.duplicate });
      } catch (error: any) {
        // A bad signature is the sender's problem: 400, no retry. Anything
        // after verification is ours: 500, so Stripe retries the delivery.
        if (error instanceof WebhookVerificationError) {
          await countRejection(sender, "webhookReject");
          console.error("Webhook rejected:", error.message);
          return res.status(400).json({ message: "Webhook signature verification failed", code: "invalid_signature" });
        }
        console.error("Webhook handler failed (Stripe will retry):", error?.message ?? error);
        res.status(500).json({ message: "Webhook processing error", code: "webhook_failed" });
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

  // Every cookie-carrying write must come from this site's own pages (server/csrf.ts).
  app.use(sameOriginWrites());

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

  /*
   * An API path nothing answers is a 404 in JSON — not the web app's HTML,
   * which the page-serving catch-all mounted after this would otherwise send
   * with a 200, so a retired or mistyped endpoint looked like it worked.
   */
  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ message: "Not found", code: "not_found" });
  });

  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
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

    if (err instanceof ModelResponseError) {
      console.error("[ai] unreadable model response:", err.raw?.slice(0, 200) ?? "(empty)");
      return res.status(502).json({ message: err.message, code: err.code });
    }
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    /*
     * And somewhere that outlives the terminal (server/error-reporting.ts). The
     * route *pattern* goes with it, never the URL: `/api/projects/:id` says
     * where to look in the code, while the URL carries an id, and a query
     * string carries whatever was in the box.
     */
    const report = reportError(err, { route: routePattern(req), method: req.method, userId: (req as any).user?.id, status });

    /*
     * A 4xx message is written for the person reading it and goes out as
     * written. A 5xx message is written by whatever threw, and in production
     * that is not ours to forward: a query failure's message is the entire SQL
     * statement, column names and all, and `GET /api/contests` was handing that
     * to anonymous callers on the live site. The reference is the report's id,
     * so someone can quote eight characters and have it found in the log.
     *
     * Outside production the real message stays, because that is where you want
     * it and nobody unknown is reading.
     */
    if (status >= 500 && process.env.NODE_ENV === "production") {
      return res.status(status).json({
        message: "Something went wrong on our end. It's been recorded.",
        code: "internal_error",
        reference: report?.id,
      });
    }
    return res.status(status).json({ message });
  });

  return app;
}
