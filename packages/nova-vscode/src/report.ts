/**
 * The two things that come back too big for a notification: an audit, and a
 * milestone. Rendered into a panel rather than the sidebar, because they're
 * read once and closed rather than lived in.
 */
import * as vscode from "vscode";
import type { AuditResult } from "@sparktower/nova-core";
import type { MilestoneDetail } from "./api";

const esc = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");

const STYLE = `
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 16px 24px; max-width: 900px; }
  h1 { font-size: 1.4em; } h2 { font-size: 1.1em; margin-top: 24px; }
  .muted { color: var(--vscode-descriptionForeground); }
  .bar { height: 6px; background: var(--vscode-panel-border); border-radius: 3px; overflow: hidden; margin: 8px 0 16px; }
  .bar > div { height: 100%; background: var(--vscode-charts-green); }
  table { border-collapse: collapse; width: 100%; }
  td, th { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: top; }
  .built { color: var(--vscode-charts-green); } .partial { color: var(--vscode-charts-yellow); }
  .missing, .high { color: var(--vscode-charts-red); }
  pre { background: var(--vscode-textCodeBlock-background); padding: 10px; border-radius: 4px; white-space: pre-wrap; }
  li { margin: 4px 0; }
`;

const page = (title: string, body: string) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
<style>${STYLE}</style></head><body><h1>${esc(title)}</h1>${body}</body></html>`;

export function showAudit(result: AuditResult): void {
  const audit = result.audit;
  const findings = audit.findings ?? {};
  const panel = vscode.window.createWebviewPanel("nova.audit", "Nova: codebase audit", vscode.ViewColumn.One, {});

  panel.webview.html = page(`${audit.stage} · ${audit.completionPercent}% complete`, `
    <div class="bar"><div style="width:${Math.max(0, Math.min(100, audit.completionPercent))}%"></div></div>
    <p>${esc(audit.summary)}</p>
    ${findings.stackSummary ? `<p class="muted">${esc(findings.stackSummary)}</p>` : ""}

    ${result.verifiedMilestones?.marked?.length ? `
      <h2>Milestones the code proved</h2>
      <ul>${result.verifiedMilestones.marked.map((id) => `<li>${esc(id)} — marked done from this audit</li>`).join("")}</ul>` : ""}

    ${findings.capabilities?.length ? `
      <h2>What exists</h2>
      <table>${findings.capabilities.map((c) => `
        <tr><td class="${esc(c.status)}"><strong>${esc(c.area)}</strong><br /><span class="muted">${esc(c.status)}</span></td>
        <td>${esc(c.summary)}${c.missing ? `<br /><span class="muted">Missing: ${esc(c.missing)}</span>` : ""}</td></tr>
      `).join("")}</table>` : ""}

    ${findings.risks?.length ? `
      <h2>Risks</h2>
      <table>${findings.risks.map((r) => `
        <tr><td class="${esc(r.severity)}">${esc(r.severity)}</td>
        <td><strong>${esc(r.area)}</strong><br />${esc(r.finding)}<br /><span class="muted">${esc(r.recommendation)}</span></td></tr>
      `).join("")}</table>` : ""}

    ${findings.nextThreeThings?.length ? `
      <h2>Next</h2>
      <ol>${findings.nextThreeThings.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>` : ""}

    <p class="muted">Charged ${esc(result.creditsCharged)} credits.</p>
  `);
}

export function showMilestone(detail: MilestoneDetail): void {
  const m = detail.milestone;
  const panel = vscode.window.createWebviewPanel("nova.milestone", `Nova: ${m.title}`, vscode.ViewColumn.Beside, {});
  panel.webview.html = page(m.title, `
    <p class="muted">${esc(detail.phase.title)} · ${esc(m.id)} · ${esc(m.tier)} · ${esc(m.actor)}</p>
    <p>${esc(m.description)}</p>
    ${detail.task ? `<p class="muted">Task: ${esc(detail.task.status)}${detail.task.how !== "not-done" ? ` (${esc(detail.task.how)})` : ""}</p>` : ""}
    ${detail.task?.answer ? `<h2>What's written under it</h2><pre>${esc(detail.task.answer)}</pre>` : ""}
    ${detail.steps?.length ? `
      <h2>Steps</h2>
      <ul>${detail.steps.map((s) => `<li>${esc(s.title)} — ${esc(s.status)}</li>`).join("")}</ul>` : ""}
  `);
}
