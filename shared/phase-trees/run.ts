import type { PathTree, IntakeQuestion } from "./types";

/**
 * Part 3 — Run a company.
 *
 * For a business that already exists. The other two paths end: an MVP ships,
 * a business gets systemized, and then there is nothing to come back for. A
 * running company's needs don't end — the same jobs come round every week and
 * the same question every Monday: what changed, and what needs fixing now.
 *
 * So this path is short on purpose. Four weeks set the company up to be run
 * from here — the numbers it watches, the team's recurring work with an owner
 * on each job, the first thing to fix, and the money it runs on — and then it
 * hands over to the rhythm that doesn't end: the weekly check-in (shared/company-rhythm.ts), the
 * recurring jobs on the board, and the monthly "what improved" report. The
 * setup exists to make that rhythm worth doing from the first week.
 */

export const COMPANY_BASICS_QUESTIONS: IntakeQuestion[] = [
  {
    id: "size", prompt: "How many people work in the business, including you?",
    options: [
      { id: "1", label: "Just me" },
      { id: "2-5", label: "2–5" },
      { id: "6-20", label: "6–20" },
      { id: "21-100", label: "21–100" },
      { id: "100+", label: "More than 100" },
    ],
  },
  {
    id: "revenue", prompt: "Roughly what does it turn over in a year?",
    options: [
      { id: "<100k", label: "Under $100k" },
      { id: "100k-500k", label: "$100k–$500k" },
      { id: "500k-2m", label: "$500k–$2m" },
      { id: "2m-10m", label: "$2m–$10m" },
      { id: "10m+", label: "More than $10m" },
      { id: "unknown", label: "Not sure" },
    ],
  },
  {
    id: "years", prompt: "How long has it been trading?",
    options: [
      { id: "<1", label: "Less than a year" },
      { id: "1-3", label: "1–3 years" },
      { id: "3-10", label: "3–10 years" },
      { id: "10+", label: "More than 10 years" },
    ],
  },
  {
    id: "pain", prompt: "Where does the week go wrong most often?", multi: true,
    options: [
      { id: "cash", label: "Cash is tight or unpredictable" },
      { id: "customers", label: "Not enough new customers" },
      { id: "retention", label: "Customers don't come back" },
      { id: "team", label: "The team needs me for everything" },
      { id: "admin", label: "Admin eats the week" },
      { id: "quality", label: "Mistakes and complaints" },
    ],
  },
];

export const RUN_TREE: PathTree = {
  goal: "run_company",
  promise: "Run the business you already have with a weekly rhythm: the numbers that matter, the team's recurring work, and the next thing to fix",
  target: "4 weeks to set up, then a weekly check-in and a monthly report for as long as you run it",
  defaultTier: "evidence",
  phases: [
    {
      id: "run-1", title: "Week 1 — Where you stand this week",
      checkpoint: "The five numbers you'll watch every week, and the first check-in done with them.",
      milestones: [
        { id: "RUN.S1.1", title: "The business today", actor: "user-decides", estimateMinutes: 3, tier: "claimed", work: "intake", intake: COMPANY_BASICS_QUESTIONS,
          description: "Size, turnover, how long it has been going, and where the week goes wrong. Everything after this is shaped by the answers, so a ten-person café and a hundred-person agency don't get the same advice." },
        { id: "RUN.S1.2", title: "The five numbers you watch", actor: "nova-builds", estimateMinutes: 20, tier: "artifact", work: "plan",
          description: "Nova picks the five numbers that tell you whether this week went well for a business like yours — usually money in, cash in the bank, new customers, customers who came back, and the one cost that runs away — says where each comes from, and what a good and a worrying week looks like for each.",
          variants: {
            restaurant: { description: "Covers, average spend, food and labour cost as a share of sales, cash, and repeat guests — where each comes from in your till and rota, and what a good and a worrying week look like." },
            service: { description: "Billable hours or jobs done, money invoiced and money collected, pipeline for next month, cash, and repeat clients — where each comes from, and what a good and a worrying week look like." },
            retail: { description: "Sales, average basket, stock turn, cash, and returning customers — where each comes from in your till or shop platform, and what a good and a worrying week look like." },
            software: { description: "New revenue, churn, active customers, cash runway, and support load — where each comes from, and what a good and a worrying week look like." },
          } },
        { id: "RUN.S1.3", title: "Where the money goes", actor: "nova-builds", estimateMinutes: 20, tier: "artifact", work: "plan",
          description: "Your costs laid out the way an owner needs to see them: what is fixed, what moves with sales, what is growing faster than the business, and the three lines worth questioning first." },
        { id: "RUN.S1.4", title: "Your first weekly check-in", actor: "user-does", estimateMinutes: 5, tier: "claimed",
          description: "Five minutes from you: this week's numbers, what went right, what went wrong. Nova answers with what changed and the one thing worth doing about it. From here the check-in comes round every week on its own." },
      ],
    },
    {
      id: "run-2", title: "Week 2 — The team's recurring work",
      checkpoint: "Every job that comes round each week or month written down, with somebody's name on it.",
      milestones: [
        { id: "RUN.S2.1", title: "Bring the team in", actor: "user-does", estimateMinutes: 10, tier: "claimed",
          description: "You invite the people who do the work. A business run from your head stops when you are ill; one run from a shared board keeps going." },
        { id: "RUN.S2.2", title: "The jobs that come round", actor: "nova-builds", doneOn: { surface: "recurring-jobs", label: "the jobs list" }, estimateMinutes: 25, tier: "artifact", work: "plan",
          description: "Nova lists the jobs that happen every week, fortnight or month in a business like yours — payroll, invoicing and chasing, stock, reviews, the bank reconciliation — with an owner for each and when it's due. Add them to the board as recurring jobs and they'll reappear on time." },
        { id: "RUN.S2.3", title: "Who covers what", actor: "nova-drafts", estimateMinutes: 15, tier: "artifact",
          description: "A cover plan: for every recurring job, who does it when its owner is away, and where the instructions live. The difference between a holiday and a crisis." },
        { id: "RUN.S2.4", title: "Write down the job that breaks", actor: "nova-drafts", estimateMinutes: 20, tier: "artifact",
          description: "The recurring job that goes wrong most often, written as a step-by-step procedure anyone on the team could follow — drafted by Nova from what the owner describes, then checked by the person who does it." },
      ],
    },
    {
      id: "run-3", title: "Week 3 — The next thing to fix",
      checkpoint: "One improvement chosen from your own numbers, underway, and your first monthly report read.",
      milestones: [
        { id: "RUN.S3.1", title: "What is costing you most", actor: "nova-builds", estimateMinutes: 20, tier: "artifact", work: "plan",
          description: "Nova reads your check-ins so far and names the single thing costing the business the most — money, hours or customers — with the evidence from your own numbers, and two or three ways to fix it, cheapest first." },
        { id: "RUN.S3.2", title: "Ask five customers", actor: "user-does", estimateMinutes: 45, tier: "claimed",
          description: "You ask five customers — two regulars, two who stopped coming, one new — what nearly made them go elsewhere. Nobody else can have that conversation for you, and it is the cheapest research a running business can do." },
        { id: "RUN.S3.3", title: "Fix it this month", actor: "user-does", estimateMinutes: 60, tier: "claimed",
          description: "You pick one fix and do it, with an owner and a date. Next month's report will say whether the number moved." },
        { id: "RUN.S3.4", title: "Read your first monthly report", actor: "user-does", estimateMinutes: 10, tier: "claimed",
          description: "You read what improved this month, what slipped, the jobs done on time and late, and what the check-ins say to fix next. It arrives every month from now on." },
      ],
    },
    {
      id: "run-4", title: "Week 4 — The money it runs on",
      checkpoint: "Thirteen weeks of cash in view, prices checked against costs, three goals for the quarter, and an honest answer on how big this can get.",
      milestones: [
        { id: "RUN.S4.1", title: "Thirteen weeks of cash", actor: "nova-builds", estimateMinutes: 30, tier: "artifact", work: "plan",
          description: "A thirteen-week cash forecast built from your check-ins and costs: what comes in, what goes out, the week it gets tight, and what to move now so that week isn't a surprise." },
        { id: "RUN.S4.2", title: "Price check", actor: "nova-builds", estimateMinutes: 25, tier: "artifact", work: "plan",
          description: "Your prices against what each sale really costs and what similar businesses charge — where you're leaving money on the table, where you're priced out, and what a rise would do to the numbers." },
        { id: "RUN.S4.3", title: "The quarter's three goals", actor: "nova-drafts", doneOn: { surface: "quarter-goals", label: "this quarter's goals" }, estimateMinutes: 20, tier: "artifact",
          description: "Three goals for the next thirteen weeks, drawn from what the check-ins keep pointing at, each with the number that says it happened and who owns it. Next quarter's review starts from here." },
        { id: "RUN.S4.4", title: "Set the rhythm", actor: "user-does", estimateMinutes: 5, tier: "claimed",
          description: "You pick the day the weekly check-in happens and who joins it. A rhythm that is nobody's appointment is a rhythm that stops in week three." },
        /*
         * The one step that looks past the quarter. The rest of this path is
         * deliberately about the week in front of you, which works right up
         * until an owner wants to know whether any of it is going anywhere —
         * and then a weekly check-in has nothing to say. This is where that
         * question gets an answer made of the company's own numbers, including
         * the answer nobody wants: that the target chosen is a different
         * business, not a harder-working version of this one.
         */
        { id: "RUN.S4.5", title: "What would it take?", actor: "nova-builds", doneOn: { surface: "wwit", label: "the roadmap" }, estimateMinutes: 15, tier: "artifact",
          description: "You pick a size — $1m, $100m, $1bn or $50bn a year — and Nova builds the route there from the numbers your check-ins already hold: the arithmetic of the gap, the stages and how long each takes, what has to be true at each one, what breaks first and what it costs to fix, the first ninety days, and an honest verdict on whether it is reachable from here. Re-run it in six months to see whether the gap moved." },
      ],
    },
  ],
};
