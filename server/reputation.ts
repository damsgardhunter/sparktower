import { type IStorage } from "./storage";
import OpenAI from "openai";

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    const _rawOpenAiBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const _openAiBaseURL = _rawOpenAiBase ? (_rawOpenAiBase.endsWith("/v1") ? _rawOpenAiBase : `${_rawOpenAiBase.replace(/\/$/,"")}/v1`) : undefined;
    _openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: _openAiBaseURL,
    });
  }
  return _openai;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(val)));
}

export async function calculateUserReputation(userId: string, storage: IStorage) {
  const stats = await storage.getReputationStats(userId);

  const executionScore = calculateExecution(stats);
  const contributionScore = calculateContribution(stats);
  const marketSignalScore = calculateMarketSignal(stats);
  const strategicThinkingScore = await calculateStrategicThinking(stats, storage, userId);

  const builderIndex = clamp(
    Math.round(
      executionScore * 0.30 +
      contributionScore * 0.25 +
      marketSignalScore * 0.25 +
      strategicThinkingScore * 0.20
    ), 0, 100
  );

  const details = {
    execution: {
      milestoneCompletion: stats.milestones.total > 0 ? Math.round((stats.milestones.completed / stats.milestones.total) * 100) : 0,
      deadlinesMet: stats.tasks.total > 0 ? Math.round((stats.tasks.onTime / Math.max(stats.tasks.done, 1)) * 100) : 0,
      sprintConsistency: stats.checkIns,
      projectCompletionRate: stats.ownedProjects.length > 0 ? Math.round((stats.ownedProjects.filter(p => p.status === "completed").length / stats.ownedProjects.length) * 100) : 0,
    },
    contribution: {
      projectCount: stats.ownedProjects.length + stats.memberProjects.length,
      taskCompletionRate: stats.tasks.total > 0 ? Math.round((stats.tasks.done / stats.tasks.total) * 100) : 0,
      followedProjects: stats.followedProjects,
      soloBuildCompletions: stats.ownedProjects.filter(p => p.soloMode && p.status === "completed").length,
    },
    marketSignal: {
      donationsReceived: stats.donationsReceived,
      applicationsSubmitted: stats.applicationsSubmitted,
      activityEngagement: stats.activityLogCount,
      externalTraction: stats.ownedProjects.filter(p => p.externalTractionUrl).length,
    },
    strategicThinking: {
      contestWins: stats.contestWins,
      bestGameScores: stats.bestGameScores,
    },
  };

  const reputation = await storage.upsertUserReputation({
    userId,
    executionScore,
    contributionScore,
    marketSignalScore,
    strategicThinkingScore,
    builderIndex,
    details,
  });

  return reputation;
}

function calculateExecution(stats: Awaited<ReturnType<IStorage["getReputationStats"]>>): number {
  let score = 0;

  if (stats.milestones.total > 0) {
    score += (stats.milestones.completed / stats.milestones.total) * 30;
  }

  if (stats.tasks.done > 0) {
    const onTimeRate = stats.tasks.onTime / stats.tasks.done;
    score += onTimeRate * 25;
  }

  const sprintScore = Math.min(stats.checkIns / 10, 1) * 20;
  score += sprintScore;

  if (stats.ownedProjects.length > 0) {
    const completionRate = stats.ownedProjects.filter(p => p.status === "completed").length / stats.ownedProjects.length;
    score += completionRate * 25;
  }

  return clamp(score, 0, 100);
}

function calculateContribution(stats: Awaited<ReturnType<IStorage["getReputationStats"]>>): number {
  let score = 0;

  const projectCount = stats.ownedProjects.length + stats.memberProjects.length;
  score += Math.min(projectCount / 5, 1) * 25;

  if (stats.tasks.total > 0) {
    score += (stats.tasks.done / stats.tasks.total) * 30;
  }

  score += Math.min(stats.followedProjects / 10, 1) * 20;

  const soloCompletions = stats.ownedProjects.filter(p => p.soloMode && p.status === "completed").length;
  score += Math.min(soloCompletions / 3, 1) * 25;

  return clamp(score, 0, 100);
}

function calculateMarketSignal(stats: Awaited<ReturnType<IStorage["getReputationStats"]>>): number {
  let score = 0;

  const donationScore = Math.min(stats.donationsReceived / 10000, 1) * 30;
  score += donationScore;

  score += Math.min(stats.applicationsSubmitted / 5, 1) * 20;

  score += Math.min(stats.activityLogCount / 20, 1) * 25;

  const tractionCount = stats.ownedProjects.filter(p => p.externalTractionUrl).length;
  score += Math.min(tractionCount / 3, 1) * 25;

  return clamp(score, 0, 100);
}

async function calculateStrategicThinking(
  stats: Awaited<ReturnType<IStorage["getReputationStats"]>>,
  storage: IStorage,
  userId: string
): Promise<number> {
  let score = 0;

  score += Math.min(stats.contestWins / 3, 1) * 25;

  if (stats.bestGameScores.length > 0) {
    const avgScore = stats.bestGameScores.reduce((sum, g) => sum + g.score, 0) / stats.bestGameScores.length;
    score += Math.min(avgScore / 1000, 1) * 25;
  }

  if (stats.ownedProjects.length > 0) {
    try {
      const projectSummaries = stats.ownedProjects.slice(0, 5).map(p => 
        `Title: ${p.title}\nDescription: ${p.description || "N/A"}\nCategory: ${p.category}\nProblem: ${p.problemStatement || "N/A"}\nTarget: ${p.targetUser || "N/A"}\nOne-liner: ${(p as any).oneLiner || "N/A"}\nValue Prop: ${(p as any).valueProposition || "N/A"}`
      ).join("\n---\n");

      const response = await getOpenAI().chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are evaluating the strategic thinking quality of a builder's projects. Score from 0-100 based on: clarity of problem definition, market understanding, value proposition strength, target audience specificity, and overall strategic coherence. Return ONLY a number 0-100, nothing else."
          },
          {
            role: "user",
            content: `Evaluate the strategic thinking behind these projects:\n\n${projectSummaries}`
          }
        ],
        max_completion_tokens: 10,
        temperature: 0.3,
      });

      const aiScore = parseInt(response.choices[0]?.message?.content?.trim() || "0");
      if (!isNaN(aiScore) && aiScore >= 0 && aiScore <= 100) {
        score += (aiScore / 100) * 50;
      }
    } catch (err) {
      console.error("AI strategic thinking evaluation failed:", err);
      score += 25;
    }
  }

  return clamp(score, 0, 100);
}
