/**
 * The company rhythm's arithmetic, on its own: which week a date belongs to,
 * when a recurring job is next due, what the reply to a check-in says, and
 * whether the monthly report adds up. The routes only load rows and pass them
 * here, so this is where "down 12% on last week" is proven to mean it.
 */
import { describe, it, expect } from "vitest";
import {
  weekOf, isMonday, isYmd, weeksInMonth, addMonthsClamped, advanceDue, completeJob, isOverdue, missedDueDates,
  buildCheckinReply, buildMonthlyReport, defaultMetricsFor, metricsForProject, cleanNumbers, customMetricId, metricFor,
  themesIn, DEFAULT_METRICS, RUN_SUBCATEGORIES, type RhythmMetric, type CheckinLike,
  addMonthsAnchored, anchorFor, quarterOf, quarterRange, addQuarters, isQuarter, inQuarter, goalProgress, checkinDayOf, isCheckinDay,
} from "@shared/company-rhythm";
import { PROJECT_SUBCATEGORIES } from "@shared/goals";

describe("weeks", () => {
  it("keys every day of a week by its Monday, in UTC", () => {
    expect(weekOf("2026-09-14")).toBe("2026-09-14"); // a Monday
    expect(weekOf("2026-09-19")).toBe("2026-09-14"); // Saturday
    expect(weekOf("2026-09-20")).toBe("2026-09-14"); // Sunday belongs to the week before
    expect(weekOf("2026-01-01")).toBe("2025-12-29"); // across a year
    // 23:30 on Sunday in UTC is still Sunday, whatever the server's own zone.
    expect(weekOf(new Date("2026-09-20T23:30:00Z"))).toBe("2026-09-14");
    expect(weekOf(new Date("2026-09-21T00:10:00Z"))).toBe("2026-09-21");
  });

  it("knows a Monday and a real date", () => {
    expect(isMonday("2026-09-21")).toBe(true);
    expect(isMonday("2026-09-22")).toBe(false);
    expect(isYmd("2026-02-30")).toBe(false);
    expect(isYmd("2028-02-29")).toBe(true);
  });

  it("counts a month's weeks by the Mondays inside it", () => {
    expect(weeksInMonth("2026-09")).toEqual(["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"]);
    expect(weeksInMonth("2026-06")).toEqual(["2026-06-01", "2026-06-08", "2026-06-15", "2026-06-22", "2026-06-29"]);
  });
});

describe("recurring jobs", () => {
  it("advances by a week, a fortnight, or the same day next month clamped to month end", () => {
    expect(advanceDue("2026-09-18", "week")).toBe("2026-09-25");
    expect(advanceDue("2026-09-18", "fortnight")).toBe("2026-10-02");
    expect(advanceDue("2026-01-31", "month")).toBe("2026-02-28");
    expect(advanceDue("2028-01-31", "month")).toBe("2028-02-29");
    expect(advanceDue("2026-12-15", "month")).toBe("2027-01-15");
    expect(addMonthsClamped("2026-03-31", 1)).toBe("2026-04-30");
  });

  it("is on time on or before the due date, late after, and records the due date it was for", () => {
    const job = { nextDue: "2026-09-18", every: "week" as const };
    expect(completeJob(job, "2026-09-18")).toEqual({ dueOn: "2026-09-18", doneOn: "2026-09-18", onTime: true, nextDue: "2026-09-25" });
    expect(completeJob(job, "2026-09-16").onTime).toBe(true);
    expect(completeJob(job, "2026-09-19")).toMatchObject({ onTime: false, nextDue: "2026-09-25" });
  });

  it("is overdue only once its due day has passed, and only while active", () => {
    expect(isOverdue({ nextDue: "2026-09-18" }, "2026-09-18")).toBe(false);
    expect(isOverdue({ nextDue: "2026-09-18" }, "2026-09-19")).toBe(true);
    expect(isOverdue({ nextDue: "2026-09-18", active: false }, "2026-09-30")).toBe(false);
  });

  it("lists the occurrences nobody did", () => {
    const job = { id: "j", title: "Stock take", every: "week" as const, nextDue: "2026-09-01", active: true };
    expect(missedDueDates(job, "2026-09-19", "2026-09-30")).toEqual(["2026-09-01", "2026-09-08", "2026-09-15"]);
  });
});

describe("metrics", () => {
  it("has five or six numbers for every kind of running business", () => {
    const run = PROJECT_SUBCATEGORIES.run_company.map((s) => s.id).sort();
    expect([...RUN_SUBCATEGORIES].sort()).toEqual(run);
    for (const sub of RUN_SUBCATEGORIES) {
      expect(DEFAULT_METRICS[sub].length).toBeGreaterThanOrEqual(5);
      expect(DEFAULT_METRICS[sub].length).toBeLessThanOrEqual(6);
    }
    expect(defaultMetricsFor("restaurant").map((m) => m.id)).toContain("covers");
    expect(defaultMetricsFor("nonsense")).toBe(DEFAULT_METRICS.other);
  });

  it("follows the project's own list once it has filed, blanks and custom numbers included", () => {
    const own = metricsForProject("restaurant", { numbers: { covers: 400, cash: null, [customMetricId("Deliveries  out")]: 12 } });
    expect(own.map((m) => m.id)).toEqual(["covers", "cash", "custom:Deliveries out"]); // default order first, whatever order they came in
    expect(own[2].label).toBe("Deliveries out");
    expect(metricsForProject("retail", null)).toBe(DEFAULT_METRICS.retail);
    expect(metricFor("custom:Vans on the road").label).toBe("Vans on the road");
  });

  it("reads numbers leniently and refuses what isn't one", () => {
    expect(cleanNumbers({ sales: "12,500", cash: "", covers: 3 })).toEqual({ ok: true, numbers: { sales: 12500, cash: null, covers: 3 } });
    expect(cleanNumbers({ sales: "lots" }).ok).toBe(false);

    /*
     * Names that mean something to JavaScript and nothing to a business. Each
     * one is written straight onto the object that becomes the check-in's
     * jsonb, so "__proto__" as a metric name would set a prototype rather than
     * record a number.
     */
    for (const name of ["__proto__", "constructor", "prototype"]) {
      const answer = cleanNumbers({ [name]: 4 });
      expect(answer.ok, name).toBe(false);
      expect((answer as any).message, "and it says which name it won't take").toContain(name);
    }
    /*
     * And the object it builds is an ordinary one, with the pairs defined on
     * it rather than assigned. A prototype-less object would be safe here and
     * break further down: it reaches the Postgres driver on the way to jsonb,
     * and the driver asks every value for its constructor.
     */
    const clean = cleanNumbers({ sales: 10 }) as any;
    expect(Object.getPrototypeOf(clean.numbers)).toBe(Object.prototype);
    expect(clean.numbers.sales).toBe(10);
    expect(cleanNumbers({}).ok).toBe(false);
    expect(cleanNumbers([1, 2]).ok).toBe(false);
  });
});

const REV: RhythmMetric = { id: "revenue", label: "Revenue", unit: "money", better: "up", advice: "Call the biggest customer that went quiet." };
const COST: RhythmMetric = { id: "cost", label: "Food cost", unit: "percent", better: "down" };
const week = (weekOf: string, revenue: number | null, cost?: number, extra: Partial<CheckinLike> = {}): CheckinLike =>
  ({ weekOf, numbers: { revenue, ...(cost != null ? { cost } : {}) }, ...extra });

describe("the reply to a check-in", () => {
  it("says it's the first when there is nothing to compare", () => {
    const r = buildCheckinReply({ metrics: [REV], current: week("2026-09-14", 1000), history: [] });
    expect(r.text).toMatch(/first check-in/);
    expect(r.focusMetric).toBeNull();
  });

  it("names the change on last week and the five-week low, and makes the slipped number the one thing", () => {
    const history = [week("2026-08-10", 1100), week("2026-08-17", 1050), week("2026-08-24", 1200), week("2026-08-31", 1000), week("2026-09-07", 1000)];
    const r = buildCheckinReply({ metrics: [REV], current: week("2026-09-14", 880), history });
    expect(r.lines[0]).toBe("Revenue down 12% on last week, the lowest in five weeks.");
    expect(r.focusMetric).toBe("revenue");
    expect(r.focus).toMatch(/^The one thing: revenue\. Call the biggest customer/);
  });

  it("reads a cost going up as the worse week, and a gap in the weeks as 'your last check-in'", () => {
    const history = [week("2026-08-24", 900, 30)];
    const r = buildCheckinReply({ metrics: [REV, COST], current: week("2026-09-14", 990, 36), history });
    const cost = r.changes.find((c) => c.id === "cost")!;
    expect(cost.direction).toBe("up");
    expect(cost.goodness).toBeLessThan(0);
    expect(r.lines.join(" ")).toMatch(/Food cost up 20% on your last check-in/);
    expect(r.lines.join(" ")).toMatch(/Revenue up 10%/);
    expect(r.focusMetric).toBe("cost");
  });

  it("calls a tiny wobble flat, and turns to what went wrong when the numbers held", () => {
    const r = buildCheckinReply({
      metrics: [REV], current: week("2026-09-14", 1004, undefined, { wentWrong: "The fridge broke on Friday" }), history: [week("2026-09-07", 1000)],
    });
    expect(r.lines[0]).toBe("Revenue flat on last week at $1,004.");
    expect(r.focus).toMatch(/The fridge broke on Friday/);
  });

  it("notices three weeks running the wrong way", () => {
    const history = [week("2026-08-17", 1300), week("2026-08-24", 1200), week("2026-08-31", 1100), week("2026-09-07", 1000)];
    const r = buildCheckinReply({ metrics: [REV], current: week("2026-09-14", 900), history });
    expect(r.lines[0]).toMatch(/four weeks running the wrong way/);
  });
});

describe("the monthly report", () => {
  const checkins: CheckinLike[] = [
    week("2026-08-31", 1000, 30), // last month: the comparison for September's first week
    week("2026-09-07", 1100, 31, { wentWrong: "Two staff off sick and a supplier delivery late" }),
    week("2026-09-14", 900, 34, { wentWrong: "Short on staff again" }),
    week("2026-09-21", 1200, 29, { wentWrong: "Card machine broke" }),
  ];
  const jobs = [
    { id: "pay", title: "Payroll", every: "month" as const, nextDue: "2026-10-25", active: true },
    { id: "stock", title: "Stock take", every: "week" as const, nextDue: "2026-09-18", active: true },
  ];
  const runs = [
    { jobId: "pay", dueOn: "2026-09-25", doneOn: "2026-09-25", onTime: true },
    { jobId: "stock", dueOn: "2026-09-04", doneOn: "2026-09-04", onTime: true },
    { jobId: "stock", dueOn: "2026-09-11", doneOn: "2026-09-13", onTime: false },
    { jobId: "stock", dueOn: "2026-08-28", doneOn: "2026-09-01", onTime: false }, // August's, not September's
  ];
  const report = buildMonthlyReport({ month: "2026-09", metrics: [REV, COST], checkins, jobs, runs, today: "2026-09-30" });

  it("compares each number's first and last check-in of the month", () => {
    const rev = report.metrics.find((m) => m.id === "revenue")!;
    expect(rev).toMatchObject({ first: 1100, last: 1200, change: 100, verdict: "improved", firstWeek: "2026-09-07", lastWeek: "2026-09-21" });
    expect(rev.pct).toBeCloseTo(100 / 1100);
    const cost = report.metrics.find((m) => m.id === "cost")!;
    expect(cost).toMatchObject({ first: 31, last: 29, verdict: "improved" });
  });

  it("counts check-ins against the weeks of the month, and names the gap", () => {
    expect(report.weeks).toHaveLength(4);
    expect(report.filed).toBe(3);
    expect(report.missingWeeks).toEqual(["2026-09-28"]);
  });

  it("picks the best and worst week by numbers better and worse than the week before", () => {
    expect(report.bestWeek).toEqual({ weekOf: "2026-09-21", improved: 2, worsened: 0 });
    expect(report.worstWeek).toEqual({ weekOf: "2026-09-14", improved: 0, worsened: 2 });
  });

  it("counts jobs on time, late and missed in the month only", () => {
    // Stock take: on time on the 4th, late on the 11th, and the 18th and 25th never done.
    expect(report.jobs).toMatchObject({ onTime: 2, late: 1, missed: 2 });
    expect(report.jobs.byJob.find((j) => j.jobId === "stock")).toMatchObject({ onTime: 1, late: 1, missed: 2 });
  });

  it("groups what went wrong into themes that recur", () => {
    expect(themesIn("Two staff off sick")).toContain("staff");
    expect(report.themes.map((t) => t.id)).toEqual(["staff"]);
    expect(report.themes[0].weeks).toEqual(["2026-09-07", "2026-09-14"]);
  });

  it("says what to fix next: the job most often late when no number got worse", () => {
    expect(report.fixNext).toMatchObject({ kind: "job", id: "stock" });
    expect(report.fixNext!.text).toMatch(/Stock take.*late one time and missed two times/);
  });

  it("prefers the number that got worst when one did", () => {
    const worse = buildMonthlyReport({
      month: "2026-09", metrics: [REV, COST], jobs, runs, today: "2026-09-30",
      checkins: [week("2026-09-07", 1000, 30), week("2026-09-21", 700, 31)],
    });
    expect(worse.fixNext).toMatchObject({ kind: "metric", id: "revenue" });
    expect(worse.fixNext!.text).toMatch(/Revenue got 30% worse/);
  });
});

describe("a monthly job keeps its day", () => {
  it("goes 31 Jan → 28 Feb → 31 Mar, not 28 Mar", () => {
    const anchor = anchorFor("month", "2026-01-31");
    expect(anchor).toBe(31);
    const feb = advanceDue("2026-01-31", "month", anchor);
    expect(feb).toBe("2026-02-28");
    const mar = advanceDue(feb, "month", anchor);
    expect(mar).toBe("2026-03-31");
    expect(advanceDue(mar, "month", anchor)).toBe("2026-04-30");
    // A leap year lands on the 29th, and still comes back to the 31st.
    expect(advanceDue("2028-01-31", "month", 31)).toBe("2028-02-29");
    expect(advanceDue("2028-02-29", "month", 31)).toBe("2028-03-31");
  });

  it("walks the same way through completions, and across a year", () => {
    let job = { nextDue: "2026-12-31", every: "month" as const, anchorDay: 31 };
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) { job = { ...job, nextDue: completeJob(job, job.nextDue).nextDue }; seen.push(job.nextDue); }
    expect(seen).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
    expect(addMonthsAnchored("2026-11-30", 3, 30)).toBe("2027-02-28");
  });

  it("takes the anchor from the due date when a job has none", () => {
    // Saved before anchors existed and already settled on the 28th: the 28th is all it knows.
    expect(advanceDue("2026-02-28", "month", null)).toBe("2026-03-28");
    expect(advanceDue("2026-01-15", "month")).toBe("2026-02-15");
    expect(anchorFor("week", "2026-01-31")).toBeNull();
  });

  it("counts missed occurrences on the anchor day too", () => {
    const job = { id: "j", title: "Rent", every: "month" as const, nextDue: "2026-01-31", active: true, anchorDay: 31 };
    expect(missedDueDates(job, "2026-04-01", "2026-12-31")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });
});

describe("check-in days", () => {
  it("counts Monday as 0 and Sunday as 6, in UTC", () => {
    expect(checkinDayOf("2026-09-14")).toBe(0);
    expect(checkinDayOf("2026-09-20")).toBe(6);
    expect(checkinDayOf(new Date("2026-09-17T23:59:00Z"))).toBe(3);
    expect(isCheckinDay(6)).toBe(true);
    expect(isCheckinDay(7)).toBe(false);
    expect(isCheckinDay(1.5)).toBe(false);
  });
});

describe("quarters", () => {
  it("keys a date by its quarter and knows each quarter's days", () => {
    expect(quarterOf("2026-01-01")).toBe("2026-Q1");
    expect(quarterOf("2026-09-30")).toBe("2026-Q3");
    expect(quarterOf("2026-10-01")).toBe("2026-Q4");
    expect(quarterOf(new Date("2026-06-30T23:30:00Z"))).toBe("2026-Q2");
    expect(quarterRange("2026-Q1")).toEqual({ start: "2026-01-01", end: "2026-03-31" });
    expect(quarterRange("2028-Q1").end).toBe("2028-03-31");
    expect(quarterRange("2026-Q4")).toEqual({ start: "2026-10-01", end: "2026-12-31" });
    expect(addQuarters("2026-Q4", 1)).toBe("2027-Q1");
    expect(addQuarters("2026-Q1", -1)).toBe("2025-Q4");
    expect(isQuarter("2026-Q3")).toBe(true);
    expect(isQuarter("2026-Q5")).toBe(false);
    expect(inQuarter("2026-06-29", "2026-Q3")).toBe(false); // that week's Monday is in June
    expect(inQuarter("2026-07-06", "2026-Q3")).toBe(true);
  });
});

describe("goal progress", () => {
  const weeks = (vals: [string, number | null][]): CheckinLike[] => vals.map(([weekOf, v]) => ({ weekOf, numbers: { covers: v } }));
  const goal = { metricId: "covers", target: 600, direction: "up" as const };

  it("measures from where the quarter started to the target, not from zero", () => {
    const p = goalProgress(goal, weeks([["2026-07-06", 500], ["2026-08-03", 520], ["2026-08-17", 550]]), "2026-Q3", "2026-08-20");
    expect(p).toMatchObject({ first: 500, latest: 550, firstWeek: "2026-07-06", latestWeek: "2026-08-17", reached: false });
    expect(p.fraction).toBeCloseTo(0.5);
    // Seven weeks of thirteen gone and halfway there: on track.
    expect(p.state).toBe("on track");
  });

  it("is behind when it has come less far than the quarter has gone", () => {
    const p = goalProgress(goal, weeks([["2026-07-06", 500], ["2026-09-14", 510]]), "2026-Q3", "2026-09-19");
    expect(p.fraction).toBeCloseTo(0.1);
    expect(p.state).toBe("behind");
  });

  it("is reached once the number passes the target, either way round", () => {
    expect(goalProgress(goal, weeks([["2026-07-06", 500], ["2026-07-13", 610]]), "2026-Q3", "2026-07-15")).toMatchObject({ reached: true, fraction: 1, state: "reached" });
    const cost = { metricId: "prime_cost_pct", target: 30, direction: "down" as const };
    const c = (v: number, w: string): CheckinLike => ({ weekOf: w, numbers: { prime_cost_pct: v } });
    const half = goalProgress(cost, [c(36, "2026-07-06"), c(33, "2026-07-20")], "2026-Q3", "2026-07-22");
    expect(half.fraction).toBeCloseTo(0.5);
    expect(half.state).toBe("on track");
    expect(goalProgress(cost, [c(36, "2026-07-06"), c(29, "2026-08-03")], "2026-Q3", "2026-08-05").state).toBe("reached");
    // Moving the wrong way is no progress at all, not negative progress.
    expect(goalProgress(cost, [c(36, "2026-07-06"), c(40, "2026-09-07")], "2026-Q3", "2026-09-10")).toMatchObject({ fraction: 0, state: "behind" });
  });

  it("only counts the quarter's own check-ins, and says when there is nothing to measure", () => {
    const p = goalProgress(goal, weeks([["2026-06-29", 100], ["2026-07-06", 500], ["2026-07-13", null], ["2026-10-05", 900]]), "2026-Q3", "2026-07-15");
    expect(p).toMatchObject({ first: 500, latest: 500, fraction: 0 });
    expect(goalProgress(goal, [], "2026-Q3", "2026-07-15").state).toBe("no numbers yet");
    expect(goalProgress({ metricId: null, target: null, direction: null }, weeks([["2026-07-06", 1]]), "2026-Q3", "2026-07-15").state).toBe("not measured");
    expect(goalProgress({ metricId: "covers", target: null, direction: "up" }, weeks([["2026-07-06", 1]]), "2026-Q3", "2026-07-15").state).toBe("not measured");
  });

  it("gives an early quarter the benefit of the doubt", () => {
    // Two weeks in with no movement yet: within the slack, so not behind.
    expect(goalProgress(goal, weeks([["2026-07-06", 500]]), "2026-Q3", "2026-07-10").state).toBe("on track");
  });
});
