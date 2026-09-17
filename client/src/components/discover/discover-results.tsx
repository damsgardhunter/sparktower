/**
 * What the search found — and, with nothing typed, what used to be /projects.
 *
 * Both lists come from one response, so they are rendered from one place:
 * projects first because that's what most people arrive looking for, people
 * under them, and neither section is drawn at all when the kind filter has
 * ruled it out.
 */
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ProjectCard } from "@/components/project-card";
import { UserCard } from "@/components/user-card";
import { useConnectionStates, useFollowedProjectIds } from "@/components/discover-actions";
import { FolderSearch, Plus, SearchX } from "lucide-react";
import type { Project, User, UserProfile } from "@shared/schema";
import type { ExploreUpdate } from "@/hooks/use-explore-updates";
import type { DiscoverFilterState } from "./use-discover-filters";

export type ProjectWithDetails = Project & { owner: User; profile?: UserProfile };
export type PersonWithProfile = User & { profile: UserProfile };

interface Props {
  filters: DiscoverFilterState;
  projects: ProjectWithDetails[];
  people: PersonWithProfile[];
  counts?: { projects: number; people: number };
  isLoading: boolean;
  isError: boolean;
  updateFor: (kind: "project" | "builder", id: string) => ExploreUpdate | undefined;
}

export function DiscoverResults({ filters, projects, people, counts, isLoading, isError, updateFor }: Props) {
  const followed = useFollowedProjectIds();
  const { data: connections } = useConnectionStates(people.map((p) => p.id));
  const showProjects = filters.kind !== "people";
  const showPeople = filters.kind !== "projects";

  if (isLoading) return <ResultsSkeleton />;

  if (isError) {
    return (
      <Panel
        icon={<SearchX className="h-5 w-5 text-muted-foreground" />}
        title="That search didn't come back"
        body="Something went wrong on our side. Try it again, or narrow it with a filter."
        testId="discover-results-error"
      />
    );
  }

  const nothing = (!showProjects || projects.length === 0) && (!showPeople || people.length === 0);
  if (nothing) {
    return (
      <Panel
        icon={<SearchX className="h-5 w-5 text-muted-foreground" />}
        title={filters.q ? `Nothing matches "${filters.q}"` : "Nothing matches those filters"}
        body="Try fewer filters, a broader word, or a role you'd want on the team rather than a product name."
        testId="discover-results-empty"
      />
    );
  }

  return (
    <div className="space-y-10" data-testid="discover-results">
      {showProjects && (
        <section className="space-y-4" data-testid="discover-results-projects">
          <SectionHeading
            title="Projects"
            count={counts?.projects ?? projects.length}
            shown={projects.length}
            action={
              <Button asChild size="sm" variant="outline" data-testid="discover-create-project">
                <Link href="/projects/new"><Plus className="h-3.5 w-3.5 mr-1.5" /> Create project</Link>
              </Button>
            }
          />
          {projects.length === 0 ? (
            <Panel
              icon={<FolderSearch className="h-5 w-5 text-muted-foreground" />}
              title="No projects here"
              body="People matched, though — the list below is them."
              testId="discover-no-projects"
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects.map((project, i) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  explore={{ source: "projects", rankPosition: i + 1 }}
                  following={followed.has(project.id)}
                  update={updateFor("project", project.id)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {showPeople && people.length > 0 && (
        <section className="space-y-4" data-testid="discover-results-people">
          <SectionHeading title="People" count={counts?.people ?? people.length} shown={people.length} />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {people.map((person, i) => (
              <UserCard
                key={person.id}
                profile={person.profile}
                userName={(person.firstName || person.email || "Anonymous") as string}
                explore={{ source: "discover", rankPosition: i + 1 }}
                connection={connections?.[person.id]}
                update={updateFor("builder", person.id)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** The count is the total before the server's cut, so say so when the list is shorter. */
function SectionHeading({ title, count, shown, action }: { title: string; count: number; shown: number; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
      <h2 className="text-lg font-semibold tracking-tight">
        {title} <span className="ml-1 text-sm font-normal text-muted-foreground">
          {shown < count ? `showing ${shown} of ${count}` : count}
        </span>
      </h2>
      {action}
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="space-y-4" data-testid="discover-results-loading">
      <Skeleton className="h-6 w-32" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="rounded-xl border border-border p-5">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="mt-3 h-3 w-full" />
            <Skeleton className="mt-2 h-3 w-4/5" />
            <div className="mt-4 flex gap-2">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="mt-5 h-8 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

function Panel({ icon, title, body, testId }: { icon: React.ReactNode; title: string; body: string; testId: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center" data-testid={testId}>
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-muted">{icon}</div>
      <h3 className="font-semibold">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
