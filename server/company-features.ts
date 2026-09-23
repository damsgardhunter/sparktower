/**
 * Everything a company account can do, registered in one place.
 *
 * Kept out of routes.ts so the company features can grow without every one of
 * them editing the same enormous file.
 */
import type { Express } from "express";
import { registerCompanyRoutes } from "./company-routes";
import { registerCompanySeasonRoutes } from "./company-season-routes";
import { registerTalentRoutes } from "./talent-routes";
import { registerScoutingRoutes } from "./scouting-routes";
import { registerChallengeRoutes } from "./challenge-routes";
import { registerCompanyRhythmRoutes } from "./company-rhythm-routes";
import { registerWhatWouldItTakeRoutes } from "./what-would-it-take";
import { registerDecisionSimRoutes } from "./decision-sim-routes";

export function registerCompanyFeatures(app: Express): void {
  registerCompanyRoutes(app);
  registerCompanySeasonRoutes(app);
  registerTalentRoutes(app);
  registerScoutingRoutes(app);
  registerChallengeRoutes(app);
  registerCompanyRhythmRoutes(app);
  registerWhatWouldItTakeRoutes(app);
  registerDecisionSimRoutes(app);
}
