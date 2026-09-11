/**
 * The next step, and Nova's work on it.
 *
 * A webview rather than a tree, for one reason: the packet is prose and code,
 * and a tree can't show either. Options need their full body visible before
 * someone picks one; a build needs its summary, its assumptions and its run
 * steps; a template needs to be readable and copyable.
 *
 * What it deliberately does not do is act on its own. Every button posts a
 * message and the extension host decides — including the expensive ones, so
 * that "this costs a credit" is a decision made in one place rather than in
 * markup.
 */
import * as vscode from "vscode";
import type { BuildPayload, PathStatus, Work, WorkPayload } from "@sparktower/nova-core";
import { ACTOR_LABEL } from "@sparktower/nova-core";

export interface NextViewState {
  status: PathStatus | null;
  work: Work | null;
  /**
   * Sign in, here, rather than in the quick-input that floats at the top of the
   * window. The sidebar is where the person is looking — it's the thing that
   * said "sign in" — and sending them to the top of the screen to type a secret
   * into a bar that also runs commands is a jump they have to make on trust.
   */
  signIn: { baseUrl: string; error?: string; busy?: boolean } | null;
  /** Shown in place of everything else: no project, or a failed load. */
  notice: { text: string; action?: { command: string; label: string } } | null;
  busy: string | null;
  /**
   * A loop step being built, shown in place of the path's next step.
   *
   * The Loops view is where someone picks what to build; this panel is where a
   * packet is read and applied. Two copies of the packet UI would drift, so a
   * step opened from the Loops view borrows this one — with its own header so
   * it's never mistaken for the path's next step, and a way back.
   */
  focus: { taskId: string; title: string; description: string; loopTitle: string } | null;
}

/** Everything the view is allowed to ask the extension host to do. */
const VIEW_COMMANDS = new Set([
  "nova.signInWith", "nova.signIn", "nova.selectProject", "nova.setServerUrl",
  "nova.work", "nova.applyPacket", "nova.diffPath", "nova.stageRunSteps",
  "nova.chooseOption", "nova.chooseOwn", "nova.recordBuild", "nova.copyTemplate",
  "nova.verify", "nova.markDone",
  "nova.addLoop", "nova.dropLoop", "nova.loopSteps",
  "nova.buildStep", "nova.unfocus",
  "nova.copyRun", "nova.runGroup",
]);

export class NextViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | null = null;
  private state: NextViewState = { status: null, work: null, signIn: null, notice: null, busy: null, focus: null };

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    view.webview.onDidReceiveMessage((message) => {
      /*
       * An allowlist, not the command name as sent.
       *
       * This channel now carries a token, and the page it comes from is built
       * partly out of text a language model wrote about a codebase. That text
       * is escaped, so getting a crafted message onto this channel is hard —
       * but "hard" is the wrong bar for `executeCommand(whatever, ...whatever)`
       * inside someone's editor. The set of things this view can ask for is
       * small and known, so it's written down.
       */
      if (typeof message?.command !== "string" || !VIEW_COMMANDS.has(message.command)) return;
      vscode.commands.executeCommand(message.command, ...(Array.isArray(message.args) ? message.args : []));
    });
    this.render();
  }

  update(patch: Partial<NextViewState>): void {
    this.state = { ...this.state, ...patch };
    this.render();
  }

  private render(): void {
    if (!this.view) return;
    this.view.webview.html = html(this.state, cspNonce());
  }
}

const cspNonce = () => {
  let text = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
};

/**
 * Everything from the model is escaped before it reaches the page.
 *
 * A packet is text a language model wrote about a codebase; codebases contain
 * angle brackets. Interpolating that into HTML unescaped is a script injection
 * with extra steps, and the fact that it came from our own server makes no
 * difference to what a browser does with it.
 */
const esc = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");

const button = (label: string, command: string, args: unknown[] = [], primary = false) =>
  `<button class="${primary ? "primary" : ""}" data-command="${esc(command)}" data-args='${esc(JSON.stringify(args))}'>${esc(label)}</button>`;

function packetHtml(payload: WorkPayload, workId: string): string {
  if (payload.kind === "options") {
    return `
      ${payload.existing ? `<p class="muted">Already there: ${esc(payload.existing)}</p>` : ""}
      <p>${esc(payload.intro)}</p>
      ${payload.options.map((option, index) => `
        <div class="option">
          <h4>${esc(option.title)}</h4>
          ${option.why ? `<p class="muted">${esc(option.why)}</p>` : ""}
          <pre>${esc(option.body)}</pre>
          ${button("Use this", "nova.chooseOption", [workId, index], true)}
        </div>
      `).join("")}
      <p class="muted">Or write your own — ${button("edit before saving", "nova.chooseOwn", [workId])}</p>
    `;
  }

  if (payload.kind === "build") {
    return `
      ${payload.existing ? `<p class="muted">Already there: ${esc(payload.existing)}</p>` : ""}
      ${payload.model ? `<p class="muted small">Written by ${esc(payload.model)}</p>` : ""}
      <p>${esc(payload.summary)}</p>
      <ul class="files">
        ${payload.files.map((file) => `
          <li>
            <a href="#" data-command="nova.diffPath" data-args='${esc(JSON.stringify([file.path]))}'>${esc(file.path)}</a>
            ${file.purpose ? `<span class="muted"> — ${esc(file.purpose)}</span>` : ""}
          </li>
        `).join("")}
      </ul>
      ${payload.files.length ? button("Preview and apply", "nova.applyPacket", [], true) : ""}
      ${runHtml(payload)}
      ${payload.verify ? `<p class="muted"><strong>Proves it works:</strong> ${esc(payload.verify)}</p>` : ""}
      ${payload.assumptions.length ? `
        <details><summary>Assumptions Nova made</summary>
          <ul>${payload.assumptions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
        </details>` : ""}
      <div class="row">${button("Record what was built", "nova.recordBuild", [workId])}</div>
    `;
  }

  return `
    <p>${esc(payload.intro)}</p>
    <pre>${esc(payload.template)}</pre>
    <div class="row">
      ${button("Copy", "nova.copyTemplate", [], true)}
      ${button("Done — record it", "nova.chooseOption", [workId, -1])}
    </div>
    <p class="muted">${esc(payload.whatIsLeft)}</p>
  `;
}


/**
 * Run steps as blocks to copy.
 *
 * The server groups them — by where they run, with a break wherever you have
 * to stop — and computes what each Copy button copies, so this panel and the
 * web app show the same blocks. A terminal block can also be typed into a
 * terminal as one line, for one Enter. Typed, never run: a model wrote it.
 */
function runHtml(payload: BuildPayload): string {
  const groups = payload.runGroups ?? [];
  if (!groups.length) {
    // A server older than the blocks: the list, as it was.
    return payload.runSteps.length ? `
      <h4>Then run</h4>
      <ol>${payload.runSteps.map((step) => `<li><code>${esc(step)}</code></li>`).join("")}</ol>
      ${button("Open a terminal here", "nova.stageRunSteps")}` : "";
  }
  return `<h4>Then run</h4>${groups.map((group, index) => {
    const inTerminal = group.where === "terminal" || group.where === "new-terminal";
    return `
      ${group.before ? `<p class="run-break">${esc(group.before)}</p>` : ""}
      <div class="run">
        <div class="run-head">${esc(group.label)}${group.cwd ? ` <span class="muted">· in ${esc(group.cwd)}/</span>` : ""}</div>
        ${group.copy ? `
          <pre class="run-code">${esc(group.copy)}</pre>
          <div class="row">
            ${button("Copy", "nova.copyRun", [index])}
            ${inTerminal ? button(group.where === "new-terminal" ? "Type into a new terminal" : "Type into a terminal", "nova.runGroup", [index]) : ""}
          </div>` : ""}
        ${group.note ? `<p class="muted small">${esc(group.note)}</p>` : ""}
      </div>`;
  }).join("")}`;
}

/**
 * Asking for a new packet when there is one already.
 *
 * Without this, a packet was final: pressing the step's build button again
 * re-showed the saved one (deliberately — a click shouldn't spend credits),
 * and nothing on screen offered another. The web app has had "Have Nova redo
 * it" all along; same words here. The command confirms the cost before it
 * asks the server for a fresh packet rather than the saved one.
 */
function redoRow(): string {
  return `<div class="row">${button("Have Nova redo it", "nova.work")}<span class="muted">costs credits — makes a new packet</span></div>`;
}

/**
 * The sign-in form.
 *
 * Both fields, because the URL is the one people can't guess and getting it
 * wrong is what the first person to use this hit. It's prefilled with whatever
 * is configured, so the common case is one paste and a click.
 *
 * The token field is a password field and its value is never written to
 * webview state — a view that restores itself with a secret still in it is a
 * secret sitting in workspace storage.
 */
function signInHtml(signIn: NonNullable<NextViewState["signIn"]>): string {
  return `
    <div class="signin">
      <h3>Connect to Nova</h3>
      <p class="muted small">
        Create a token in SparkTower — your project dashboard, then <strong>Connect</strong>.
      </p>

      <label for="nova-url">Server</label>
      <input id="nova-url" type="text" value="${esc(signIn.baseUrl)}" spellcheck="false" ${signIn.busy ? "disabled" : ""} />

      <label for="nova-token">Access token</label>
      <input id="nova-token" type="password" placeholder="nova_pat_…" autocomplete="off" spellcheck="false" ${signIn.busy ? "disabled" : ""} />

      ${signIn.error ? `<p class="error">${esc(signIn.error)}</p>` : ""}

      <div class="row">
        <button class="primary" data-submit ${signIn.busy ? "disabled" : ""}>${signIn.busy ? "Connecting…" : "Sign in"}</button>
      </div>
      <p class="muted small">The token is kept in VS Code's secret storage, not in your settings.</p>
    </div>
  `;
}

/**
 * A loop step, opened from the Loops view.
 *
 * Headed with its loop rather than a phase, so nobody reads it as the path's
 * next step — and with a way back, because the path hasn't moved while you
 * were building something else.
 */
function focusHtml(focus: NonNullable<NextViewState["focus"]>, work: Work | null): string {
  return `
    <div class="head">
      <div class="phase">Loop · ${esc(focus.loopTitle || "a loop step")}</div>
      <h3>${esc(focus.title)}</h3>
      <div class="meta"><span class="badge">${esc(ACTOR_LABEL["nova-builds"])}</span></div>
    </div>
    ${focus.description ? `<p>${esc(focus.description)}</p>` : ""}

    ${work
      ? `<div class="packet">${packetHtml(work.payload, work.id)}</div>${redoRow()}`
      : `<div class="row">
           ${button("Build it with Nova", "nova.buildStep", [focus.taskId], true)}
           <span class="muted">costs credits</span>
         </div>`}

    <div class="row footer">
      ${button("Verify against the code", "nova.verify")}
      ${button("Back to the next step", "nova.unfocus")}
    </div>
  `;
}

function bodyHtml(state: NextViewState): string {
  if (state.signIn) return signInHtml(state.signIn);
  if (state.notice) {
    return `<div class="notice">
      <p>${esc(state.notice.text)}</p>
      ${state.notice.action ? button(state.notice.action.label, state.notice.action.command, [], true) : ""}
    </div>`;
  }
  if (state.busy) return `<p class="muted">${esc(state.busy)}</p>`;

  const status = state.status;
  if (!status) return `<p class="muted">Loading…</p>`;
  if (!status.adopted) return `<div class="notice"><p>${esc(status.message ?? "This project isn't on a path yet.")}</p></div>`;
  if (state.focus) return focusHtml(state.focus, state.work);
  if (!status.next) {
    return `<div class="notice"><p>Every milestone on this path is done. ${esc(status.promise)}</p></div>`;
  }

  const next = status.next;
  const step = next.step;
  const title = step?.title ?? next.title;
  const description = step?.description || next.description;
  const humanOnly = next.actor === "user-does";
  const projected = status.pace?.projectedAt ? new Date(status.pace.projectedAt).toLocaleDateString() : null;

  return `
    <div class="head">
      <div class="phase">${esc(status.phase?.title ?? "")} · step ${esc(status.phase?.step)} of ${esc(status.phase?.of)}</div>
      <h3>${esc(title)}</h3>
      <div class="meta">
        <span class="badge">${esc(ACTOR_LABEL[next.actor] ?? next.actor)}</span>
        <span class="badge tier">${esc(next.tier)}</span>
        ${next.estimateMinutes ? `<span class="muted">~${Math.round(next.estimateMinutes / 60 * 10) / 10}h</span>` : ""}
      </div>
    </div>
    <p>${esc(description)}</p>

    ${state.work
      ? `<div class="packet">${packetHtml(state.work.payload, state.work.id)}</div>${redoRow()}`
      : `<div class="row">
           ${button(humanOnly ? "Get Nova's template" : "Work this step", "nova.work", [], true)}
           <span class="muted">costs credits</span>
         </div>`}

    <div class="row footer">
      ${button("Verify against the code", "nova.verify")}
      ${button("Mark done", "nova.markDone")}
    </div>
    <p class="muted small">
      ${projected ? `Projected finish ${esc(projected)}. ` : ""}${esc(status.progress?.done)} of ${esc(status.progress?.total)} milestones done.
    </p>
  `;
}

function html(state: NextViewState, nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 0 4px 12px; }
  h3 { margin: 4px 0 6px; font-size: 1.1em; }
  h4 { margin: 12px 0 4px; font-size: 1em; }
  .phase { text-transform: uppercase; letter-spacing: .04em; font-size: .85em; opacity: .7; }
  .meta { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
  .badge { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 3px; padding: 1px 6px; font-size: .85em; }
  .badge.tier { background: transparent; border: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); }
  .muted { color: var(--vscode-descriptionForeground); }
  .small { font-size: .85em; }
  pre { background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 4px; white-space: pre-wrap; word-break: break-word; max-height: 320px; overflow: auto; }
  code { background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; }
  button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; font-size: .95em; }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:hover { filter: brightness(1.1); }
  .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin: 10px 0; }
  .footer { border-top: 1px solid var(--vscode-panel-border); padding-top: 10px; }
  .option { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 8px; margin-bottom: 8px; }
  .loops { border-top: 1px solid var(--vscode-panel-border); margin-top: 12px; padding-top: 8px; }
  .loop { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 8px; margin-bottom: 8px; }
  .loop-head { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
  .steps { margin: 6px 0 0; padding-left: 20px; }
  .steps li.done { text-decoration: line-through; opacity: .6; }
  .files { list-style: none; padding-left: 0; }
  .files li { margin: 3px 0; }
  a { color: var(--vscode-textLink-foreground); text-decoration: none; }
  .notice { padding: 8px 0; }
  .signin label { display: block; font-size: .85em; opacity: .8; margin: 10px 0 3px; }
  .signin input { width: 100%; box-sizing: border-box; padding: 5px 6px; border-radius: 3px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); font-family: inherit; font-size: inherit; }
  .signin input:focus { outline: 1px solid var(--vscode-focusBorder); }
  .error { color: var(--vscode-errorForeground); font-size: .9em; }
  details { margin: 8px 0; }
  .run { margin: 6px 0 10px; }
  .run-head { font-size: .9em; opacity: .85; margin-bottom: 4px; }
  .run-code { margin: 0 0 6px; white-space: pre; overflow-x: auto; }
  .run-break { margin: 12px 0 6px; padding-top: 8px; border-top: 1px solid var(--vscode-panel-border);
    color: var(--vscode-editorWarning-foreground); font-weight: 600; font-size: .9em; }
</style>
</head>
<body>
${bodyHtml(state)}
<script nonce="${nonce}">
  const vscodeApi = acquireVsCodeApi();

  document.addEventListener("click", (event) => {
    const el = event.target.closest("[data-command]");
    if (!el) return;
    event.preventDefault();
    vscodeApi.postMessage({ command: el.dataset.command, args: JSON.parse(el.dataset.args || "[]") });
  });

  // Sign in. The token is read at submit time and never stored in view state.
  const submit = () => {
    const url = document.getElementById("nova-url");
    const token = document.getElementById("nova-token");
    if (!token || !token.value.trim()) return;
    vscodeApi.postMessage({ command: "nova.signInWith", args: [url ? url.value.trim() : "", token.value.trim()] });
  };
  const trigger = document.querySelector("[data-submit]");
  if (trigger) trigger.addEventListener("click", submit);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && document.querySelector("[data-submit]")) submit();
  });

  // Focus the field that's still empty, so a paste lands where it should.
  const token = document.getElementById("nova-token");
  if (token) token.focus();
</script>
</body>
</html>`;
}
