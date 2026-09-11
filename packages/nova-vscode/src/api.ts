/**
 * The endpoints this extension uses, named.
 *
 * The MCP shim goes through Nova's tool catalogue because its whole job is to
 * offer whatever Nova offers. A UI is the other shape: it has a button per
 * thing it does, so it names the endpoint and gets a typed answer back.
 */
import type { NovaClient } from "@sparktower/nova-core";
import type {
  AuditResult, LoopsResult, NovaProject, PathStatus, VerifyResult, Work, WorkPayload,
} from "@sparktower/nova-core";
import type { Actor, VerificationTier } from "@sparktower/nova-core";
import type { CollectedFile } from "@sparktower/nova-core";

const base = (projectId: string) => `/api/mcp/projects/${encodeURIComponent(projectId)}`;

export const listProjects = (api: NovaClient) =>
  api.fetch<{ projects: NovaProject[] }>("GET", "/api/mcp/projects").then((r) => r.projects);

export const getStatus = (api: NovaClient, projectId: string) =>
  api.fetch<PathStatus>("GET", `${base(projectId)}/status`);

export const getMilestone = (api: NovaClient, projectId: string, backboneId: string) =>
  api.fetch<MilestoneDetail>("GET", `${base(projectId)}/milestones/${encodeURIComponent(backboneId)}`);

export const readWork = (api: NovaClient, projectId: string, taskId: string) =>
  api.fetch<{ work: Work | null; actor: Actor; tier: VerificationTier; task: { id: string; title: string; status: string } }>(
    "GET", `${base(projectId)}/work/${encodeURIComponent(taskId)}`);

/** Costs credits. Only ever called from an explicit press. */
export const produceWork = (api: NovaClient, projectId: string, taskId: string, fresh = false) =>
  api.fetch<{ id: string; kind: string; payload: WorkPayload; actor: Actor; reused: boolean }>(
    "POST", `${base(projectId)}/work`, { taskId, fresh });

export const chooseWork = (
  api: NovaClient, projectId: string, workId: string,
  choice: { index?: number; text?: string; done?: boolean },
) =>
  api.fetch<{ taskId: string; status: string; answer: string }>(
    "POST", `${base(projectId)}/work/${encodeURIComponent(workId)}/choose`, choice);

export const submitWork = (
  api: NovaClient, projectId: string,
  body: { taskId: string; summary: string; files?: { path: string }[]; commit?: string; notes?: string },
) => api.fetch<{ recorded: boolean; tier: string; next: string }>("POST", `${base(projectId)}/submit`, body);

export const verify = (api: NovaClient, projectId: string, files: CollectedFile[]) =>
  api.fetch<VerifyResult>("POST", `${base(projectId)}/verify`, { files });

export const audit = (api: NovaClient, projectId: string, files: CollectedFile[], label: string) =>
  api.fetch<AuditResult>("POST", `${base(projectId)}/audit`, { files, label });

export const getLoops = (api: NovaClient, projectId: string) =>
  api.fetch<LoopsResult>("GET", `${base(projectId)}/loops`);

export const addLoop = (api: NovaClient, projectId: string, body: { title: string; description?: string }) =>
  api.fetch<{ taskId: string; title: string }>("POST", `${base(projectId)}/loops`, body);

export const dropLoop = (api: NovaClient, projectId: string, taskId: string) =>
  api.fetch<{ removedSteps: number; keptSteps: number }>("DELETE", `${base(projectId)}/loops/${encodeURIComponent(taskId)}`);

/** Costs credits. Comes back as a draft to edit when the loop has nothing written under it. */
export const loopSteps = (
  api: NovaClient, projectId: string, taskId: string,
  body: { artifact?: string; draft?: boolean },
) =>
  api.fetch<{
    applied: boolean;
    draft?: string;
    sourceTitle?: string;
    created?: { taskId: string; title: string; description: string }[];
    existing?: { taskId: string; title: string; status: string }[];
  }>("POST", `${base(projectId)}/loops/${encodeURIComponent(taskId)}/steps`, body);

export const markDone = (api: NovaClient, projectId: string, ids: string[], evidence: string) =>
  api.fetch<{ marked: string[]; ignored: string[] }>("POST", `${base(projectId)}/mark`, { ids, evidence });

export interface MilestoneDetail {
  phase: { id: string; title: string; optional: boolean };
  milestone: {
    id: string; title: string; description: string; actor: Actor;
    tier: VerificationTier; estimateMinutes: number | null;
  };
  task: { taskId: string; title: string; status: string; how: string; answer: string | null; work: Work | null } | null;
  steps: { taskId: string; title: string; status: string; answer: string | null }[];
}
