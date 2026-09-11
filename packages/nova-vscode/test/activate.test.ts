/**
 * Activation, and the promise the manifest makes.
 *
 * Every command in `contributes.commands` shows up in the palette whether or
 * not anything registered a handler for it — VS Code takes the manifest's word
 * for it. So the failure this catches is a command someone renamed in one
 * place: it stays in the palette, someone runs it, and the editor says
 * "command 'nova.thing' not found". Nothing else notices, because everything
 * still compiles.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { commands, registeredCommands, registeredViews, fakeContext, uriHandler, messages, Uri, setNextChoice, webviewProviders, fakeWebviewView, executed } from "./vscode-stub.js";
import { activate } from "../src/extension.js";

const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"));

beforeAll(() => {
  // No token in the fake secret store, so this is the cold-start path: the one
  // every user hits first, and the one where an unguarded call would throw.
  activate(fakeContext() as never);
});

describe("activation", () => {
  it("registers a handler for every command the manifest advertises", () => {
    const advertised: string[] = manifest.contributes.commands.map((c: { command: string }) => c.command);
    const missing = advertised.filter((name) => !registeredCommands.has(name));
    expect(missing, `advertised in package.json but never registered: ${missing.join(", ")}`).toEqual([]);
  });

  it("registers both views the manifest declares", () => {
    const declared: string[] = manifest.contributes.views.nova.map((v: { id: string }) => v.id);
    for (const id of declared) expect(registeredViews, id).toContain(id);
  });

  it("registers the internal commands the UI calls but the palette shouldn't offer", () => {
    // These take objects or ids as arguments, so they're deliberately absent
    // from contributes.commands — and correspondingly easy to forget.
    for (const name of ["nova.diffEntry", "nova.diffPath", "nova.chooseOption", "nova.chooseOwn", "nova.saveAnswer", "nova.recordBuild", "nova.stageRunSteps", "nova.copyTemplate", "nova.dropLoop", "nova.loopSteps", "nova.loopStepsDraft"]) {
      expect(registeredCommands.has(name), name).toBe(true);
    }
  });

  it("does nothing expensive before anyone signs in", async () => {
    // Refresh runs on activation. With no token it must fall through to the
    // sign-in notice rather than reaching for the network.
    const handler = registeredCommands.get("nova.refresh")!;
    await expect(handler()).resolves.not.toThrow();
    expect(commands).toBeTruthy();
  });
});

describe("the connection link", () => {
  it("registers a handler, so the web app's one-click button has somewhere to land", () => {
    expect(uriHandler).not.toBeNull();
  });

  it("ignores a path it doesn't own and refuses an incomplete link", async () => {
    messages.length = 0;
    await uriHandler!.handleUri(Uri.parse("vscode://sparktower.nova-sparktower/something-else"));
    expect(messages).toEqual([]);

    // A link with a token but no server URL is the case worth refusing: acting
    // on it would mean guessing the address, which is the thing the link exists
    // to carry.
    await uriHandler!.handleUri(Uri.parse("vscode://sparktower.nova-sparktower/connect?token=nova_pat_x"));
    expect(messages.some((m) => m.kind === "error" && /incomplete/.test(m.text))).toBe(true);
  });

  it("does nothing when the person declines the confirmation", async () => {
    messages.length = 0;
    setNextChoice(undefined);
    await uriHandler!.handleUri(Uri.parse("vscode://sparktower.nova-sparktower/connect?token=nova_pat_x&url=https://example.test"));
    // Asked, and stopped there — no attempt to reach the server.
    expect(messages.filter((m) => m.kind === "info")).toHaveLength(1);
    expect(messages.some((m) => m.kind === "error")).toBe(false);
  });
});

describe("signing in", () => {
  /** The sidebar view, resolved and rendered the way the editor would. */
  const render = () => {
    const view = fakeWebviewView();
    webviewProviders.get("nova.next")!.resolveWebviewView(view);
    return view;
  };

  it("puts the form in the sidebar rather than sending people to the top of the window", async () => {
    const view = render();
    await registeredCommands.get("nova.refresh")!();

    // With no token, the view *is* the sign-in form.
    expect(view.webview.html).toContain("Connect to Nova");
    expect(view.webview.html).toContain('id="nova-token"');
    expect(view.webview.html).toContain('type="password"');
    // And the server, prefilled, because it's the field people get wrong.
    expect(view.webview.html).toContain('id="nova-url"');
  });

  it("answers a bad server address in the form, not in a notification", async () => {
    const view = render();
    messages.length = 0;

    await registeredCommands.get("nova.signInWith")!("not-a-url", "nova_pat_x");

    expect(view.webview.html).toContain("start with http:// or https://");
    // Nothing was shown as a toast: the person is looking at the form.
    expect(messages).toEqual([]);
  });

  it("ignores an empty token instead of making a request", async () => {
    const view = render();
    messages.length = 0;
    await registeredCommands.get("nova.signInWith")!("https://example.test", "   ");
    expect(view.webview.html).not.toContain("Connecting…");
    expect(messages).toEqual([]);
  });

  it("only runs commands it knows, whatever the page sends", async () => {
    const view = render();
    executed.length = 0;

    // The page is built partly from text a model wrote; this channel now also
    // carries a token. An unknown command name is dropped, not executed.
    view.post({ command: "workbench.action.terminal.sendSequence", args: [{ text: "rm -rf /" }] });
    expect(executed).toEqual([]);

    view.post({ command: "nova.selectProject", args: [] });
    expect(executed.map((e) => e.command)).toContain("nova.selectProject");
  });
});
