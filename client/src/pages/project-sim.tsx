/**
 * One simulation, on its own page.
 *
 * The three business simulations used to sit stacked on the project's
 * Simulations tab: a decision to ask about, a marketing scheme to score, and
 * the ten-year question — each with its own inputs, its own price and its own
 * long form, one under the other. Opening that tab meant meeting all three at
 * once and scrolling past two of them to reach the one you came for, and the
 * "where you're starting from" form sat in the middle of it asking for
 * fourteen numbers before anything would answer.
 *
 * So each is a page you open into, and the tab is a place to choose from.
 * Same components, same data, same prices — what changes is that a page has
 * room for the thing it is about, and the header tells you which one you are
 * in and how to get back.
 *
 * Routed as one component with a `game` parameter rather than three pages,
 * because the only thing that differs between them is a title, an icon and a
 * sentence. Three files that were 90% the same would drift.
 */
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Beaker, Megaphone, Telescope } from "lucide-react";
import { SimHeader } from "@/components/sim/sim-header";
import { DecisionLab } from "@/components/sim/decision-lab";
import { MarketingSchemes } from "@/components/sim/marketing-schemes";
import { TenYearsFromNow } from "@/components/sim/ten-years-from-now";

/** What each page is called, and what it is for, in one sentence. */
export const SIM_GAMES = {
  decision: {
    slug: "decision",
    icon: Beaker,
    title: "Simulate a decision",
    blurb: "Ask what happens if you hire, spend, borrow or change what you charge, and see it month by month on your own numbers.",
    lead: "Three ways it could go, and against doing nothing at all.",
  },
  scheme: {
    slug: "scheme",
    icon: Megaphone,
    title: "Test a marketing scheme",
    blurb: "Write the plan — who it is for, where it runs, what it offers, and how you would know it worked — and Nova scores it against your own figures.",
    lead: "For a product that already exists.",
  },
  "ten-years": {
    slug: "ten-years",
    icon: Telescope,
    title: "Ten years from now",
    blurb: "You have been lent $50k and a year. Where does it go? Then it says where that puts you in ten years.",
    lead: "Everything Nova needs about your business is already here.",
  },
} as const;

export type SimGame = keyof typeof SIM_GAMES;

export const isSimGame = (value: string | undefined): value is SimGame =>
  !!value && value in SIM_GAMES;

export default function ProjectSimPage() {
  const params = useParams<{ id: string; game: string }>();
  const [, navigate] = useLocation();
  const projectId = params.id;
  const game = isSimGame(params.game) ? params.game : "decision";
  const meta = SIM_GAMES[game];

  /*
   * The project's name in the subtitle, because a page about *your* numbers
   * should say whose. Loading is not worth a spinner for one line of text —
   * the simulation underneath is what people came for and it loads itself.
   */
  const { data: project } = useQuery<{ title?: string }>({ queryKey: [`/api/projects/${projectId}`] });

  /*
   * Back means back, not "the project page".
   *
   * This navigated to the Simulations tab whatever route you arrived by, so
   * somebody who came from their desk, a link or another simulation was sent
   * somewhere they had never been and lost the place they had. History knows
   * where they came from; the tab is only right when there is no history to
   * go back to — a fresh tab, a pasted link — and then it is the best guess
   * there is.
   */
  const goBack = () => {
    if (window.history.length > 1) window.history.back();
    else navigate(`/projects/${projectId}?tab=simulations`);
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-6" data-testid={`project-sim-${game}`}>
      <SimHeader
        icon={meta.icon}
        title={meta.title}
        titleTestId={`sim-title-${game}`}
        subtitle={project?.title ? `${meta.lead} · ${project.title}` : meta.lead}
        onBack={goBack}
        backLabel="Back"
        backTestId="button-back-simulations"
      />
      <p className="px-1 text-sm text-muted-foreground">{meta.blurb}</p>

      {game === "decision" && <DecisionLab projectId={projectId} />}
      {game === "scheme" && <MarketingSchemes projectId={projectId} />}
      {game === "ten-years" && <TenYearsFromNow projectId={projectId} />}
    </div>
  );
}
