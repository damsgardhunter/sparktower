/**
 * Managing a recurring job, on the phone.
 *
 * The week was already there, and so were the quarter's goals, the settings and
 * the monthly report. What was missing was the one thing that made the jobs
 * card half a feature: the phone could tick a job off and could not create the
 * thing it was ticking. Its own comment said so — "adding and editing them is
 * configuration, and that is on the web".
 *
 * `GET /rhythm/jobs` and `GET /rhythm/checkins` still have no phone caller, and
 * that is correct rather than missing: `GET /rhythm` returns both lists in one
 * payload, so calling them again would be a second request for data already in
 * hand. A test below pins that reasoning so it is not mistaken for a gap again.
 */
import { describe, it, expect } from "vitest";
import { JOB_INTERVALS } from "@shared/company-rhythm";
import { readSource, withoutComments } from "../helpers/source-parity";

const screen = withoutComments(readSource("mobile/app/rhythm/[id].tsx"));
const routes = readSource("server/company-rhythm-routes.ts");

describe("the three job writes now have a caller", () => {
  it("adds one", () => {
    expect(screen).toMatch(/\/rhythm\/jobs`, \{ method: "POST"/);
  });

  it("edits one", () => {
    expect(screen).toMatch(/\/rhythm\/jobs\/\$\{job\.id\}`, \{ method: "PATCH", body \}/);
  });

  it("deletes one", () => {
    expect(screen).toMatch(/\/rhythm\/jobs\/\$\{job!\.id\}`, \{ method: "DELETE" \}/);
  });

  it("still marks one done, which was already there", () => {
    expect(screen).toMatch(/\/rhythm\/jobs\/\$\{jobId\}\/done`/);
  });

  it("no longer says that adding them is on the web", () => {
    const whole = readSource("mobile/app/rhythm/[id].tsx");
    expect(whole).not.toMatch(/Adding and editing them is configuration, and that is on the web/);
  });
});

describe("the card is reachable before a job exists", () => {
  it("is not gated on there being one, or the first could never be added", () => {
    /* It used to render only inside `{d.jobs.length ? ... }`. */
    expect(screen).not.toMatch(/\{d\.jobs\.length \? \(\s*<TitledCard icon="repeat"/);
    expect(screen).toMatch(/<TitledCard icon="repeat" title="Recurring jobs">/);
  });

  it("says what a recurring job is when there are none", () => {
    expect(screen).toMatch(/Nothing recurring yet/);
  });

  it("opens the sheet from a job and from the add button", () => {
    expect(screen).toMatch(/setEditingJob\(j\)/);
    expect(screen).toMatch(/setEditingJob\("new"\)/);
  });
});

describe("stopping and deleting are different things", () => {
  it("stops by setting active false rather than deleting", () => {
    /*
     * A job that ran for a year and then stopped is part of the record of how
     * the company was run, and deleting it takes that away.
     */
    expect(screen).toMatch(/body: \{ active: false \}/);
    expect(screen).toMatch(/It stays in the record/);
  });

  it("offers the delete separately, worded for a mistake", () => {
    expect(screen).toMatch(/For a job added by mistake/);
    expect(screen).toMatch(/stop it instead/);
  });

  it("confirms the delete and not the stop", () => {
    /* Stopping is reversible; deleting is not. */
    expect(screen).toMatch(/Alert\.alert\(\s*`Delete "\$\{job\.title\}"\?`/);
    const stopFn = screen.slice(screen.indexOf("const stop = useMutation"), screen.indexOf("const remove = useMutation"));
    expect(stopFn).not.toContain("Alert.alert");
  });
});

describe("the intervals are the server's", () => {
  it("offers exactly the three it accepts, in the same order", () => {
    expect(screen).toMatch(/const JOB_INTERVALS = \["week", "fortnight", "month"\] as const;/);
    /* Executed rather than eyeballed: the phone's copy has to equal the shared one. */
    expect(JOB_INTERVALS).toEqual(["week", "fortnight", "month"]);
  });

  it("builds the picker from that list rather than from literals", () => {
    expect(screen).toMatch(/JOB_INTERVALS\.map\(/);
  });
});

describe("the two GETs with no caller are not a gap", () => {
  it("because GET /rhythm already returns both lists", () => {
    const main = routes.slice(routes.indexOf('app.get("/api/projects/:id/rhythm"'), routes.indexOf('app.get("/api/projects/:id/rhythm/checkins"'));
    expect(main).toMatch(/jobs,/);
    expect(main).toMatch(/checkins:/);
  });

  it("and the phone reads them from that payload", () => {
    expect(screen).toMatch(/d\.jobs/);
    expect(screen).toMatch(/d\.overdue/);
  });
});
