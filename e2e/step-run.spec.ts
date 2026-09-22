/**
 * Doing a step, on each of the three paths, all the way to a page a stranger
 * can read.
 *
 * The step-run used to end at "done": the artifact was made later, by a
 * different button, in a dialog somebody had to know to open — so the thing
 * the growth loop runs on was produced only by people who already knew it
 * existed. A step now ends where it should, and this walks that in a browser:
 * write the answer, finish, and the page it made is offered on the spot;
 * publish it, and it loads for somebody with no account and no session, with
 * the title, description, canonical link and preview tags a link needs.
 *
 * One test per path, because the three trees differ in what their first
 * milestone asks for, and "it works on ship_mvp" has been true of several
 * things that were broken on the other two.
 */
import { test, expect, type Browser } from "./test";
import { verifyEmail } from "./verify-email";

const password = "Testpass123!";
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

const PATHS = [
  {
    goal: "ship_mvp", subcategory: "saas", first: "Product statement",
    answer: "A week of dinners planned from what is already in the fridge, for people who cook on weeknights and hate deciding at 6pm.",
    title: "What we decided to build first",
  },
  {
    goal: "systemize_business", subcategory: "restaurant", first: null,
    answer: "Opening runs off one checklist: fridge temperatures logged, prep list done, float counted, specials written up before the doors open.",
    title: "How we open the restaurant",
  },
  {
    // Run a company — the third path, since funding folded into Systemize.
    goal: "run_company", subcategory: "software", first: null,
    answer: "Eighteen months of runway buys the second city and the team to run it. The raise is sized to that and to nothing else.",
    title: "What the money is actually for",
  },
] as const;

for (const path of PATHS) {
  test(`a ${path.goal} step is run, makes a page, and the page loads for a stranger`, async ({ page, browser }) => {
    await page.goto("/");
    expect((await page.request.post("/api/auth/register", {
      data: { email: `e2e-run-${stamp()}@example.test`, password, firstName: "Ren", lastName: "Run" },
    })).ok()).toBeTruthy();
    await verifyEmail(page.request);
    expect((await page.request.post("/api/profile/complete-onboarding", {
      data: { displayName: "Ren Run", headline: "Building something", bio: "Here for the path." },
    })).ok()).toBeTruthy();

    const project = await (await page.request.post("/api/projects", {
      data: {
        title: `Step Run ${stamp()}`, description: "A project whose steps should leave something behind.",
        category: "saas", goal: path.goal, subcategory: path.subcategory,
      },
    })).json();

    await page.goto(`/projects/${project.id}/manage?section=${path.goal}`);
    await page.getByTestId("btn-skip-onboarding").click({ timeout: 8_000 }).catch(() => {});
    const stepTitle = page.getByTestId("next-action-title");
    await expect(stepTitle).toBeVisible({ timeout: 40_000 });
    if (path.first) await expect(stepTitle).toHaveText(path.first);

    // 1. Run the step: the answer is the work, and the work is the artifact.
    await page.getByTestId("button-next-write").click();
    await page.getByTestId("input-next-answer").fill(path.answer);
    await page.getByTestId("button-next-save-done").click();

    /*
     * 2. Finishing ends with what it made, not with a tick. This is the whole
     *    change: the page exists already and is offered here, rather than
     *    waiting behind a control somebody has to go and find.
     */
    const finished = page.getByTestId("step-finished");
    await expect(finished).toBeVisible({ timeout: 30_000 });
    await expect(finished).toContainText("made a page");

    // 3. Publishing is the next click, with the step's own title ready to go.
    await page.getByTestId("button-finished-publish").click();
    await expect(page.getByTestId("publish-artifact-dialog")).toBeVisible();
    await expect(page.getByTestId("artifact-preview"), "the answer is what goes out").toContainText(path.answer.slice(0, 40));
    await page.getByTestId("input-artifact-title").fill(path.title);
    await page.getByTestId("button-publish-artifact").click();

    const url = page.getByTestId("text-artifact-url");
    await expect(url).toBeVisible({ timeout: 30_000 });
    // It is an input, so the address is its value rather than its text.
    const publicPath = ((await url.inputValue()) ?? "").trim().replace(/^.*(\/a\/)/, "/a/");
    expect(publicPath, "a public address for the step").toMatch(/^\/a\/[A-Za-z0-9-]{8,}$/);

    /*
     * 4. A stranger: a browser with no cookies, no session and no account.
     *    Fetched as well as rendered, because a link shared anywhere is read
     *    first by something that never runs JavaScript.
     */
    const outside = await browser.newContext();
    const strangerPage = await outside.newPage();
    const served = await strangerPage.request.get(publicPath);
    expect(served.status(), "the page is served to anybody").toBe(200);
    const html = await served.text();
    expect(html, "a title a link can show").toContain(`<meta property="og:title"`);
    expect(html).toContain(path.title);
    expect(html, "a description").toMatch(/<meta name="description" content="[^"]{10,}"/);
    expect(html, "and one canonical address for it").toContain(`<link rel="canonical" href=`);
    expect(html).toContain(`<meta property="og:type" content="article" />`);

    await strangerPage.goto(publicPath);
    await expect(strangerPage.getByTestId("button-start-own-path"), "and a way in for whoever reads it").toBeVisible({ timeout: 30_000 });
    /* The published title, and the answer the step was run with — the page is their words. */
    await expect(strangerPage.locator("body")).toContainText(path.title);
    await expect(strangerPage.locator("body")).toContainText(path.answer.slice(0, 40));
    await outside.close();
  });
}
