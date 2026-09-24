/**
 * Everything a company account can do, registered in one place.
 *
 * Kept out of routes.ts so the company features can grow without every one of
 * them editing the same enormous file.
 */
import type { Express } from "express";
import { registerCompanyRoutes } from "./company-routes";
import { registerCompanyVerificationRoutes } from "./company-verification-routes";
import { registerCompanySeasonRoutes } from "./company-season-routes";
import { registerTalentRoutes } from "./talent-routes";
import { registerScoutingRoutes } from "./scouting-routes";
import { registerChallengeRoutes } from "./challenge-routes";
import { registerCompanyRhythmRoutes } from "./company-rhythm-routes";
import { registerWhatWouldItTakeRoutes } from "./what-would-it-take";
import { registerDecisionSimRoutes } from "./decision-sim-routes";
import { registerMarketingRoutes } from "./marketing-routes";

export function registerCompanyFeatures(app: Express): void {
  /* Before the company routes: a company cannot be created without one. */
  registerCompanyVerificationRoutes(app);
  registerCompanyRoutes(app);
  registerCompanySeasonRoutes(app);
  registerTalentRoutes(app);
  registerScoutingRoutes(app);
  registerChallengeRoutes(app);
  registerCompanyRhythmRoutes(app);
  registerWhatWouldItTakeRoutes(app);
  registerDecisionSimRoutes(app);
  registerMarketingRoutes(app);
}
