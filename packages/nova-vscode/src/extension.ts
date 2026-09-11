/**
 * Nova in VS Code.
 *
 * The same bridge the MCP server talks to, driven by buttons instead of by an
 * agent. Layer 1 is for people whose editor already has an agent that reads and
 * writes; this is for everyone else, and it has to be the polished one — a
 * sidebar showing where the project is, one button that produces the next
 * step's work, and a diff before anything is written.
 *
 * Three rules the whole extension keeps:
 *
 *  1. **Nothing is written that hasn't been shown.** Every file in a packet is
 *     classified against disk and openable as a diff before it lands, and the
 *     write is one undoable edit.
 *  2. **Nothing costs money by accident.** The two calls that spend credits —
 *     working a step and auditing — happen on an explicit press, never on a
 *     refresh, a redraw or a file save.
 *  3. **Nova decides what's done.** The extension records and verifies; it
 *     never closes a milestone because the code looks right.
 */
import * as vscode from "vscode";
import { collectTree, type LoopsResult, NovaError, type CollectedFile, type Work, type BuildPayload } from "@sparktower/nova-core";
import { Session, describe, isUnreachable } from "./session";
import * as api from "./api";
import { PathTreeProvider, RemoteMilestones } from "./path-view";
import { LoopsTreeProvider, type StepNode } from "./loops-view";
import { NextViewProvider } from "./next-view";
import { ProposedContentProvider, PROPOSED_SCHEME } from "./proposed";
import { applyFiles, classify, pickFiles, describeRisk, showDiff, stageRunSteps, stageRunGroup, type ClassifiedFile } from "./apply";
import { showAudit, showMilestone } from "./report";

let log: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
  log = vscode.window.createOutputChannel("Nova");
  const session = new Session(context);
  const proposed = new ProposedContentProvider();
  const milestones = new RemoteMilestones(session);
  const tree = new PathTreeProvider(session, milestones);
  const loopsTree = new LoopsTreeProvider();
  const next = new NextViewProvider(context.extensionUri);

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = "nova.work";

  /** The packet currently on screen. The diff and apply commands act on this and nothing else. */
  let current: { work: Work | null; taskId: string | null } = { work: null, taskId: null };
  /** An answer being edited in an untitled document, waiting to be saved back. */
  let pendingAnswer: { workId: string; uri: vscode.Uri } | null = null;
  /** A loop step opened from the Loops view, shown in the panel in place of the next step. */
  let focus: { taskId: string; title: string; description: string; loopTitle: string } | null = null;
  /** The last loops read, so a step opened by id (from the panel) can still say which loop it's in. */
  let lastLoops: LoopsResult | null = null;

  context.subscriptions.push(
    log, session, status, proposed,
    vscode.workspace.registerTextDocumentContentProvider(PROPOSED_SCHEME, proposed),
    vscode.window.registerTreeDataProvider("nova.path", tree),
    vscode.window.registerTreeDataProvider("nova.loops", loopsTree),
    vscode.window.registerWebviewViewProvider("nova.next", next),
  );

  // --- helpers -------------------------------------------------------------

  const root = (): vscode.Uri | null => vscode.workspace.workspaceFolders?.[0]?.uri ?? null;

  /** Both of the things every command needs, or a notice explaining which is missing. */
  async function ready(): Promise<{ api: NonNullable<Awaited<ReturnType<Session["api"]>>>; projectId: string } | null> {
    const client = await session.api();
    if (!client) {
      // The view becomes the sign-in form. No token, nothing to show, and the
      // thing to do is right there rather than behind a command.
      next.update({ signIn: { baseUrl: session.baseUrl }, notice: null, status: null, work: null });
      return null;
    }
    const projectId = session.projectId;
    if (!projectId) {
      next.update({ signIn: null, notice: { text: "Pick the project this workspace belongs to.", action: { command: "nova.selectProject", label: "Choose project" } } });
      return null;
    }
    return { api: client, projectId };
  }

  function fail(error: unknown, what: string): void {
    const message = describe(error);
    log.appendLine(`[${new Date().toISOString()}] ${what}: ${error instanceof NovaError ? `${error.status} ` : ""}${message}`);
    // An unreachable server has one useful action and it isn't reading a log.
    const actions = isUnreachable(error) ? ["Change the server URL"] : ["Show log"];
    vscode.window.showErrorMessage(`Nova: ${message}`, ...actions).then((pick) => {
      if (pick === "Show log") log.show();
      if (pick === "Change the server URL") void vscode.commands.executeCommand("nova.setServerUrl");
    });
  }

  /** Reads the workspace once, with the server's own limits. */
  async function snapshot(title: string): Promise<CollectedFile[] | null> {
    const folder = root();
    if (!folder) {
      vscode.window.showWarningMessage("Nova: open a folder first — there's no tree to read.");
      return null;
    }
    const manifest = await session.manifest();
    if (!manifest) return null;

    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title },
      async () => {
        const collected = await collectTree(folder.fsPath, manifest.limits);
        if (collected.truncated) {
          vscode.window.showWarningMessage(
            `Nova read ${collected.files.length} files and stopped at the limit. What it couldn't see, it can't verify.`,
          );
        }
        return collected.files;
      },
    );
  }

  async function refresh(): Promise<void> {
    const ctx = await ready();
    if (!ctx) {
      tree.setStatus(null);
      loopsTree.setLoops(null);
      status.hide();
      return;
    }
    try {
      milestones.invalidate();
      const path = await api.getStatus(ctx.api, ctx.projectId);
      tree.setStatus(path);

      // Whatever packet already exists comes back free with the status, or is
      // read by task. Neither call spends anything.
      const taskId = path.next?.workTaskId ?? null;
      const work = path.next?.work ?? (taskId ? (await api.readWork(ctx.api, ctx.projectId, taskId)).work : null);
      /*
       * The loops, every refresh, into their own view. Where the path has got
       * to doesn't matter: they belong to the product, and the view sits
       * between the next step and the map for exactly that reason.
       */
      const loops = path.adopted ? await api.getLoops(ctx.api, ctx.projectId).catch(() => null) : null;
      lastLoops = loops;
      loopsTree.setLoops(loops);

      // A focused step that's been finished or removed hands the panel back to the path.
      if (focus) {
        const still = loopsTree.findStep(focus.taskId);
        if (!still || still.step.status === "done") focus = null;
      }
      if (focus) {
        const focused = (await api.readWork(ctx.api, ctx.projectId, focus.taskId).catch(() => null))?.work ?? null;
        current = { work: focused, taskId: focus.taskId };
      } else {
        current = { work, taskId };
      }
      next.update({ status: path, work: current.work, focus, signIn: null, notice: null, busy: null });

      if (path.adopted && path.next) {
        status.text = `$(rocket) ${path.next.step?.title ?? path.next.title}`;
        status.tooltip = `Nova · ${path.progress?.done}/${path.progress?.total} milestones`;
        status.show();
      } else {
        status.hide();
      }
    } catch (error) {
      tree.setStatus(null, describe(error));
      next.update({ signIn: null, notice: { text: describe(error) }, busy: null });
      fail(error, "refresh");
    }
  }

  const buildPacket = (): BuildPayload | null =>
    current.work?.payload.kind === "build" ? current.work.payload : null;

  // --- account and project -------------------------------------------------

  const command = (name: string, handler: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(name, handler));

  /**
   * Asks where SparkTower is.
   *
   * The default is a guess about someone else's deployment, and a self-hosted
   * or local instance is the normal case — so an unreachable host is a
   * question, not an error. The first thing anyone saw otherwise was "couldn't
   * reach Nova at <a domain they've never heard of>", with no hint that the
   * URL was the thing to change.
   */
  async function askForBaseUrl(): Promise<boolean> {
    const url = await vscode.window.showInputBox({
      title: "Where is SparkTower?",
      prompt: "The address you open in your browser. For a local server, http://localhost:5001.",
      value: session.baseUrl,
      ignoreFocusOut: true,
      validateInput: (value) => (/^https?:\/\/.+/.test(value.trim()) ? undefined : "Start with http:// or https://"),
    });
    if (!url) return false;
    await session.setBaseUrl(url.trim());
    return true;
  }

  command("nova.setServerUrl", askForBaseUrl);

  /** Stores the token only once it's known to work, and returns the account it belongs to. */
  async function connect(token: string): Promise<string | null> {
    await session.setToken(token);
    try {
      const manifest = await session.manifest();
      return manifest?.account.email ?? "your account";
    } catch (error) {
      // A token saved and then found not to work leaves someone signed in to
      // nothing, with a sidebar that fails on every action.
      await session.setToken(null);
      throw error;
    }
  }

  /**
   * Sign in from the sidebar form.
   *
   * Failures come back into the panel rather than as a toast: the person is
   * looking at the form, the form is what was wrong, and a notification that
   * disappears while they're re-reading their token is no help. The URL is
   * saved only once the pair actually works, so a typo doesn't quietly become
   * the configured server.
   */
  command("nova.signInWith", async (url: string, token: string) => {
    const trimmed = String(token ?? "").trim();
    const target = String(url ?? "").trim() || session.baseUrl;
    if (!trimmed) return;
    if (!/^https?:\/\/.+/.test(target)) {
      next.update({ signIn: { baseUrl: target, error: "The server needs to start with http:// or https://" } });
      return;
    }

    next.update({ signIn: { baseUrl: target, busy: true } });
    const previous = session.baseUrl;
    try {
      if (target !== previous) await session.setBaseUrl(target);
      const who = await connect(trimmed);
      vscode.window.showInformationMessage(`Nova: signed in as ${who}.`);
    } catch (error) {
      if (target !== previous) await session.setBaseUrl(previous);
      next.update({
        signIn: {
          baseUrl: target,
          error: isUnreachable(error)
            ? `Couldn't reach ${target}. If you're running SparkTower yourself, this is the address you open in your browser.`
            : describe(error),
        },
      });
      return;
    }

    const manifest = await session.manifest().catch(() => null);
    if (manifest?.pinnedProjectId) await session.setProjectId(manifest.pinnedProjectId);
    else if (!session.projectId) await vscode.commands.executeCommand("nova.selectProject");
    await refresh();
  });

  /**
   * The palette's "Sign in" and the welcome view's link both land here, and
   * both do the same thing the form does: show the form. One way in beats two
   * that drift — the quick-input version had its own retry loop, its own error
   * wording, and no way to see the server it was about to use.
   */
  command("nova.signIn", async () => {
    next.update({ signIn: { baseUrl: session.baseUrl }, notice: null });
    // Reveals the view, resolving it first if this is the first time.
    await vscode.commands.executeCommand("nova.next.focus");
  });

  command("nova.signOut", async () => {
    await session.setToken(null);
    tree.setStatus(null);
    status.hide();
    next.update({ status: null, work: null, notice: null, signIn: { baseUrl: session.baseUrl } });
  });

  command("nova.selectProject", async () => {
    const client = await session.api();
    if (!client) return vscode.commands.executeCommand("nova.signIn");
    try {
      const projects = await api.listProjects(client);
      if (!projects.length) {
        return vscode.window.showInformationMessage("Nova: this account has no projects yet.");
      }
      const picked = await vscode.window.showQuickPick(
        projects.map((p) => ({ label: p.title, description: p.goal.replace(/_/g, " "), detail: p.oneLiner ?? undefined, id: p.id })),
        { title: "Which project is this workspace?", ignoreFocusOut: true },
      );
      if (!picked) return;
      await session.setProjectId(picked.id);
      await refresh();
    } catch (error) {
      fail(error, "list projects");
    }
  });

  command("nova.refresh", refresh);
  command("nova.showLog", () => log.show());

  command("nova.openMilestone", async (backboneId: string) => {
    const ctx = await ready();
    if (!ctx) return;
    try {
      showMilestone(await api.getMilestone(ctx.api, ctx.projectId, backboneId));
    } catch (error) {
      fail(error, "open milestone");
    }
  });

  // --- working a step ------------------------------------------------------

  command("nova.work", async () => {
    const ctx = await ready();
    if (!ctx || !current.taskId) return;

    const already = current.work;
    if (already) {
      const again = await vscode.window.showWarningMessage(
        "Nova has already worked this step. Producing another costs credits.",
        { modal: true }, "Work it again",
      );
      if (again !== "Work it again") return;
    }

    next.update({ busy: "Nova is working on it…" });
    try {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Nova is working this step…" },
        () => api.produceWork(ctx.api, ctx.projectId, current.taskId!, !!already),
      );
      current = { ...current, work: { id: result.id, kind: result.kind as Work["kind"], payload: result.payload } };
      proposed.clear();
      next.update({ work: current.work, busy: null });
    } catch (error) {
      next.update({ busy: null });
      fail(error, "work step");
    }
  });

  // --- the diff and apply flow --------------------------------------------

  /** From the packet's file list: open one diff. */
  command("nova.diffPath", async (path: string) => {
    const payload = buildPacket();
    const folder = root();
    if (!payload || !folder) return;
    const file = payload.files.find((f) => f.path === path);
    if (!file) return;
    const [entry] = await classify(folder, [file]);
    if (!entry.target) {
      return vscode.window.showErrorMessage(`Nova: "${path}" points outside this workspace, so it won't be written.`);
    }
    await showDiff(entry, proposed);
  });

  /** From the picker's per-row button. Not in the palette: it takes an object. */
  command("nova.diffEntry", (entry: ClassifiedFile) => showDiff(entry, proposed));

  command("nova.applyPacket", async () => {
    const ctx = await ready();
    const payload = buildPacket();
    const folder = root();
    if (!ctx || !payload || !folder) return;
    if (!payload.files.length) return vscode.window.showInformationMessage("Nova: this packet has no files.");

    try {
      const entries = await classify(folder, payload.files);
      const outside = entries.filter((e) => !e.target);
      if (outside.length) {
        vscode.window.showWarningMessage(
          `Nova: ${outside.length} file(s) point outside the workspace and won't be offered: ${outside.map((e) => e.file.path).join(", ")}`,
        );
      }

      const chosen = await pickFiles(entries);
      if (!chosen || !chosen.length) return;

      /*
       * A destructive rewrite that someone ticked anyway gets one more
       * question, with the names in it. Not a block — they may know the file
       * better than the warning does — but not something to do by accident.
       */
      const risky = chosen.filter((e) => e.risk?.destructive);
      if (risky.length) {
        const go = await vscode.window.showWarningMessage(
          risky.length === 1 ? "This file would lose code Nova never saw." : `${risky.length} files would lose code Nova never saw.`,
          {
            modal: true,
            detail: risky.map((e) => `${e.file.path} — ${describeRisk(e.risk!)}`).join("\n")
              + "\n\nNova wrote these as whole files from a summary of your project, not from the files themselves. "
              + "Undo restores them, but anything that imports what's deleted will break until it does.",
          },
          "Write them anyway",
        );
        if (go !== "Write them anyway") return;
      }

      const { written, failed } = await applyFiles(chosen);
      if (failed.length) return vscode.window.showErrorMessage("Nova: the edit was refused; nothing was written.");

      log.appendLine(`[${new Date().toISOString()}] applied ${written.length} file(s): ${written.join(", ")}`);
      const first = chosen[0]?.target;
      if (first) await vscode.window.showTextDocument(first, { preview: false });

      // Applied is not done. What happens next is the person's call, and both
      // options are the honest ones: tell Nova what changed, or let it look.
      const pick = await vscode.window.showInformationMessage(
        `Nova wrote ${written.length} file${written.length === 1 ? "" : "s"}. Undo puts it all back.`,
        "Tell Nova what changed", "Verify against the code",
      );
      if (pick === "Tell Nova what changed") await submitApplied(ctx, payload, written);
      if (pick === "Verify against the code") await vscode.commands.executeCommand("nova.verify");
    } catch (error) {
      fail(error, "apply packet");
    }
  });

  command("nova.stageRunSteps", () => {
    const payload = buildPacket();
    const folder = root();
    if (payload && folder) stageRunSteps(payload, folder);
  });

  /** A block's exact clipboard text — computed by the server, so it matches what the web app copies. */
  command("nova.copyRun", async (index: number) => {
    const group = buildPacket()?.runGroups?.[Number(index)];
    if (!group?.copy) return;
    await vscode.env.clipboard.writeText(group.copy);
    vscode.window.showInformationMessage("Nova: copied.");
  });

  command("nova.runGroup", (index: number) => {
    const group = buildPacket()?.runGroups?.[Number(index)];
    const folder = root();
    if (group && folder) stageRunGroup(group, folder);
  });

  async function submitApplied(
    ctx: { api: NonNullable<Awaited<ReturnType<Session["api"]>>>; projectId: string },
    payload: BuildPayload,
    written: string[],
  ): Promise<void> {
    if (!current.taskId) return;
    const summary = await vscode.window.showInputBox({
      title: "What changed?",
      prompt: "In your own words. A person reads this later.",
      value: payload.summary.slice(0, 300),
      ignoreFocusOut: true,
    });
    if (!summary) return;
    try {
      const result = await api.submitWork(ctx.api, ctx.projectId, {
        taskId: current.taskId, summary, files: written.map((path) => ({ path })),
      });
      vscode.window.showInformationMessage(`Nova: recorded. ${result.next}`);
      await refresh();
    } catch (error) {
      fail(error, "submit");
    }
  }

  // --- answering a packet --------------------------------------------------

  command("nova.chooseOption", async (workId: string, index: number) => {
    const ctx = await ready();
    if (!ctx) return;
    try {
      // -1 is the template case: there's nothing to pick, the answer is the
      // template itself, and the server fills it in.
      await api.chooseWork(ctx.api, ctx.projectId, workId, index >= 0 ? { index } : {});
      await refresh();
      vscode.window.showInformationMessage("Nova: saved, and the step is closed.");
    } catch (error) {
      fail(error, "choose option");
    }
  });

  command("nova.chooseOwn", async (workId: string) => {
    const payload = current.work?.payload;
    const seed = payload?.kind === "options" ? payload.options[0]?.body ?? "" : "";
    const doc = await vscode.workspace.openTextDocument({ content: seed, language: "markdown" });
    await vscode.window.showTextDocument(doc, { preview: false });
    pendingAnswer = { workId, uri: doc.uri };
    const pick = await vscode.window.showInformationMessage(
      "Edit this, then save it to Nova as your answer.",
      "Save to Nova",
    );
    if (pick === "Save to Nova") await vscode.commands.executeCommand("nova.saveAnswer");
  });

  command("nova.saveAnswer", async () => {
    const ctx = await ready();
    if (!ctx || !pendingAnswer) return;
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === pendingAnswer!.uri.toString());
    const text = doc?.getText().trim();
    if (!text) return vscode.window.showWarningMessage("Nova: nothing to save — the document is empty.");
    try {
      await api.chooseWork(ctx.api, ctx.projectId, pendingAnswer.workId, { text });
      pendingAnswer = null;
      await refresh();
      vscode.window.showInformationMessage("Nova: your answer is saved.");
    } catch (error) {
      fail(error, "save answer");
    }
  });

  command("nova.recordBuild", async (workId: string) => {
    const ctx = await ready();
    if (!ctx) return;
    const confirm = await vscode.window.showWarningMessage(
      "Record this build as the milestone's answer and close the step?",
      { modal: true, detail: "Nova can still verify it against the code afterwards." },
      "Record it",
    );
    if (confirm !== "Record it") return;
    try {
      await api.chooseWork(ctx.api, ctx.projectId, workId, {});
      await refresh();
    } catch (error) {
      fail(error, "record build");
    }
  });

  command("nova.copyTemplate", async () => {
    const payload = current.work?.payload;
    if (payload?.kind !== "template") return;
    await vscode.env.clipboard.writeText(payload.template);
    vscode.window.showInformationMessage("Nova: copied.");
  });


  // --- loops ---------------------------------------------------------------

  /**
   * Which loop a command is about.
   *
   * The webview's buttons send ids; a right-click in the tree sends the node
   * itself. Both are the same request, so both are accepted — a command that
   * only understood one of them would sit in the context menu and do nothing.
   */
  const loopArg = (arg: unknown, title?: string): { taskId: string | null; title: string } => {
    if (typeof arg === "string") return { taskId: arg, title: title ?? "" };
    const loop = (arg as { kind?: string; loop?: { taskId?: string; title?: string } } | null)?.loop;
    return { taskId: loop?.taskId ?? null, title: loop?.title ?? "" };
  };

  command("nova.addLoop", async () => {
    const ctx = await ready();
    if (!ctx) return;
    const title = await vscode.window.showInputBox({
      title: "Add a loop",
      prompt: "A sequence the same person repeats and gets something from each time.",
      placeHolder: "Explore",
      ignoreFocusOut: true,
    });
    if (!title?.trim()) return;

    const description = await vscode.window.showInputBox({
      title: `The ${title.trim()} loop`,
      prompt: "The steps, in order. Leave it empty and Nova can draft them later.",
      placeHolder: "Open Discover → view matched builders → follow or message → return for new matches",
      ignoreFocusOut: true,
    });
    try {
      await api.addLoop(ctx.api, ctx.projectId, { title: title.trim(), description: description?.trim() || undefined });
      await refresh();
    } catch (error) {
      fail(error, "add loop");
    }
  });

  command("nova.dropLoop", async (arg: unknown, titleArg?: string) => {
    const { taskId, title } = loopArg(arg, titleArg);
    const ctx = await ready();
    if (!ctx || !taskId) return;
    // Modal, because it's remembered: the title goes on a rejected list so
    // nothing proposes it again, which is not what someone expects from a
    // stray click.
    const confirm = await vscode.window.showWarningMessage(
      `Remove "${title}" as a loop?`,
      { modal: true, detail: "Nova won't suggest it again. Unfinished steps under it go too; finished ones stay on the board." },
      "Not a loop",
    );
    if (confirm !== "Not a loop") return;
    try {
      const result = await api.dropLoop(ctx.api, ctx.projectId, taskId);
      await refresh();
      if (result.keptSteps) {
        vscode.window.showInformationMessage(`Nova: removed. ${result.keptSteps} finished step(s) stayed on the board.`);
      }
    } catch (error) {
      fail(error, "drop loop");
    }
  });

  /**
   * Breaking a loop into steps.
   *
   * Two passes when the loop has nothing written under it: Nova drafts the
   * sequence, that comes back as a draft in an editor for the person to fix,
   * and their version is what the steps get built from. A draft is not a
   * decision — nothing is written to the loop until they send it.
   */
  command("nova.loopSteps", async (arg: unknown) => {
    const { taskId } = loopArg(arg);
    const ctx = await ready();
    if (!ctx || !taskId) return;
    try {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Nova is breaking the loop into steps…" },
        () => api.loopSteps(ctx.api, ctx.projectId, taskId, {}),
      );

      await refresh();
      if (result.created?.length) {
        vscode.window.showInformationMessage(`Nova: ${result.created.length} steps ready. Work them one at a time.`);
      } else if (result.existing?.length) {
        vscode.window.showInformationMessage("Nova: this loop already has its steps.");
      }
    } catch (error: any) {
      // `artifact_missing` is the expected first answer for an unwritten
      // loop, not a failure — it means "ask for a draft".
      if (error?.code === "artifact_missing") {
        const pick = await vscode.window.showInformationMessage(error.message, "Have Nova draft it");
        if (pick === "Have Nova draft it") {
          await vscode.commands.executeCommand("nova.loopStepsDraft", taskId);
        }
        return;
      }
      fail(error, "loop steps");
    }
  });

  command("nova.loopStepsDraft", async (taskId: string) => {
    const ctx = await ready();
    if (!ctx) return;
    try {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Nova is drafting the loop…" },
        () => api.loopSteps(ctx.api, ctx.projectId, taskId, { draft: true }),
      );
      if (!result.draft) return;
      const doc = await vscode.workspace.openTextDocument({ content: result.draft, language: "markdown" });
      await vscode.window.showTextDocument(doc, { preview: false });
      const pick = await vscode.window.showInformationMessage(
        `Nova drafted the ${result.sourceTitle ?? "loop"} sequence. Edit it, then build the steps from your version.`,
        "Build the steps",
      );
      if (pick !== "Build the steps") return;
      const artifact = doc.getText().trim();
      if (!artifact) return vscode.window.showWarningMessage("Nova: nothing to build from — the document is empty.");
      await api.loopSteps(ctx.api, ctx.projectId, taskId, { artifact });
      await refresh();
    } catch (error) {
      fail(error, "draft loop");
    }
  });

  // --- building a loop step ------------------------------------------------

  /** A step from a tree node (click, sparkle, right-click) or by id (the panel's button). */
  const stepFrom = (arg: unknown): { taskId: string; title: string; description: string; loopTitle: string } | null => {
    const node = typeof arg === "string"
      ? loopsTree.findStep(arg)
      : (arg as { kind?: string } | null)?.kind === "step" ? (arg as StepNode) : null;
    if (!node) return null;
    return { taskId: node.step.taskId, title: node.step.title, description: node.step.description ?? "", loopTitle: node.loopTitle };
  };

  /**
   * Opening and building a loop step.
   *
   * A click opens it — the step and whatever packet it already has, read for
   * free. Building is a separate, explicit press, because it costs credits and
   * a click on a tree row is something people do to look. Either way the
   * packet lands in the Next step panel, which already knows how to preview
   * and apply one.
   */
  async function openStep(arg: unknown, build: boolean): Promise<void> {
    const ctx = await ready();
    const step = stepFrom(arg);
    if (!ctx || !step) return;

    focus = step;
    proposed.clear();
    current = { work: null, taskId: step.taskId };
    next.update({ focus, work: null, busy: build ? "Nova is building it…" : "Opening…", signIn: null, notice: null });
    await vscode.commands.executeCommand("nova.next.focus");

    try {
      const existing = (await api.readWork(ctx.api, ctx.projectId, step.taskId)).work;
      current = { work: existing, taskId: step.taskId };

      /*
       * Build pressed on a step that already has a packet. It used to just
       * re-show the saved one — no charge, but also no way to get a new one,
       * which looked like Nova ignoring the button. Now it shows the one you
       * have and asks. Dismissing is free; "Build it again" asks the server
       * for a fresh packet rather than the saved one.
       */
      let fresh = false;
      if (existing && build) {
        next.update({ work: existing, busy: null });
        const pick = await vscode.window.showWarningMessage(
          `Nova already built "${step.title}".`,
          { modal: true, detail: "Building it again makes a new packet and costs credits. The one you have stays on screen until the new one arrives." },
          "Build it again",
        );
        fresh = pick === "Build it again";
      }
      if (!build || (existing && !fresh)) {
        next.update({ work: existing, busy: null });
        return;
      }

      next.update({ busy: "Nova is building it…" });
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Nova is building "${step.title}"…` },
        () => api.produceWork(ctx.api, ctx.projectId, step.taskId, fresh),
      );
      current = { work: { id: result.id, kind: result.kind as Work["kind"], payload: result.payload }, taskId: step.taskId };
      next.update({ work: current.work, busy: null });
    } catch (error) {
      next.update({ busy: null });
      fail(error, "build step");
    }
  }

  command("nova.openStep", (arg: unknown) => openStep(arg, false));
  command("nova.buildStep", (arg: unknown) => openStep(arg, true));
  command("nova.unfocus", async () => {
    focus = null;
    proposed.clear();
    await refresh();
  });

  // --- verification --------------------------------------------------------

  command("nova.verify", async () => {
    const ctx = await ready();
    if (!ctx) return;
    const files = await snapshot("Nova is reading your code…");
    if (!files) return;
    try {
      const result = await api.verify(ctx.api, ctx.projectId, files);
      await refresh();

      const proven = result.checks.filter((c) => c.proven);
      const message = result.marked.length
        ? `Nova verified ${result.marked.join(", ")} from the code.`
        : proven.length
        ? "Nothing new — what the code proves was already marked."
        : "Nova couldn't prove any milestone from this tree.";
      const pick = await vscode.window.showInformationMessage(`${message}`, "What couldn't it see?");
      if (pick) {
        log.appendLine(`\nVerify · ${new Date().toISOString()} · read ${result.scanned.read} of ${result.scanned.files} files`);
        for (const check of result.checks) {
          log.appendLine(`  ${check.proven ? "proven " : "unproven"} ${check.backboneId}${check.evidence ? ` — ${check.evidence}` : ""}`);
        }
        log.appendLine(`  ${result.note}`);
        log.show();
      }
    } catch (error) {
      fail(error, "verify");
    }
  });

  command("nova.audit", async () => {
    const ctx = await ready();
    if (!ctx) return;
    const confirm = await vscode.window.showWarningMessage(
      "Run a full codebase audit?",
      { modal: true, detail: "Nova reads the whole tree and reconciles it against the plan. This costs credits and takes a minute." },
      "Run the audit",
    );
    if (confirm !== "Run the audit") return;

    const files = await snapshot("Nova is reading your code…");
    if (!files) return;
    try {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Nova is auditing the codebase…" },
        () => api.audit(ctx.api, ctx.projectId, files, vscode.workspace.name ?? "working tree"),
      );
      showAudit(result);
      await refresh();
    } catch (error) {
      fail(error, "audit");
    }
  });

  command("nova.markDone", async () => {
    const ctx = await ready();
    if (!ctx) return;
    // Read the id fresh rather than trusting what's on screen: the sidebar may
    // have been open since before someone else moved the path.
    const id = (await api.getStatus(ctx.api, ctx.projectId).catch(() => null))?.next?.backboneId;
    if (!id) return vscode.window.showInformationMessage("Nova: there's no open milestone to mark.");
    const evidence = await vscode.window.showInputBox({
      title: `Mark ${id} done`,
      prompt: "Why is it done? Nova records this as your word, not as something it verified.",
      ignoreFocusOut: true,
    });
    if (!evidence) return;
    try {
      await api.markDone(ctx.api, ctx.projectId, [id], evidence);
      await refresh();
    } catch (error) {
      fail(error, "mark done");
    }
  });


  /**
   * `vscode://sparktower.nova-sparktower/connect?...` — the button in the web app.
   *
   * It carries the three things nobody should have to type: which server, which
   * token, which project. Typing them is where this goes wrong, and the URL is
   * the one people can't guess.
   *
   * Confirmed before it lands, always. The link arrives from outside the
   * editor, and silently replacing a signed-in session because someone clicked
   * something is not a thing an extension should do.
   */
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      async handleUri(uri: vscode.Uri) {
        if (uri.path !== "/connect") return;
        const params = new URLSearchParams(uri.query);
        const token = params.get("token");
        const url = params.get("url");
        if (!token || !url) {
          vscode.window.showErrorMessage("Nova: that connection link is incomplete.");
          return;
        }

        const existing = await session.token();
        const confirm = await vscode.window.showInformationMessage(
          `Connect this window to Nova at ${url}?`,
          { modal: true, detail: existing ? "This replaces the account you're currently signed in as." : undefined },
          "Connect",
        );
        if (confirm !== "Connect") return;

        try {
          await session.setBaseUrl(url);
          const who = await connect(token);
          const project = params.get("project");
          if (project) await session.setProjectId(project);
          vscode.window.showInformationMessage(`Nova: connected as ${who}.`);
          await refresh();
        } catch (error) {
          fail(error, "connect from link");
        }
      },
    }),
  );

  // --- lifecycle -----------------------------------------------------------

  context.subscriptions.push(
    session.onDidChange(() => void refresh()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("nova.baseUrl")) session.reset();
      else if (event.affectsConfiguration("nova.projectId")) void refresh();
    }),
  );

  void refresh();
}

export function deactivate(): void {
  log?.dispose();
}
