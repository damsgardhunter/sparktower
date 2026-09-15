import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Compass, ChevronRight } from "lucide-react";

interface DiscoverNews {
  count: number;
  more: boolean;
  updates: { kind: "builder" | "project"; id: string; name: string; newPosts: number }[];
}

/**
 * "New since you last looked", on the feed: the builders and projects you've
 * opened, followed, connected with or messaged have posted since your last
 * visit to Discover — and the way back there. Hidden when there's nothing new.
 */
export function DiscoverNewsLink() {
  const { data } = useQuery<DiscoverNews>({ queryKey: ["/api/discover/new-count"], refetchInterval: 60_000 });
  if (!data?.count) return null;
  const names = data.updates.slice(0, 2).map((u) => u.name);
  const others = data.updates.length - names.length;
  return (
    <Link
      href="/discover"
      className="flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2.5 text-sm hover:bg-primary/10 transition-colors"
      data-testid="link-discover-news"
    >
      <Compass className="h-4 w-4 text-primary shrink-0" />
      <span className="flex-1 min-w-0">
        <span className="font-medium">{data.count}{data.more ? "+" : ""} new since you last looked</span>
        <span className="text-muted-foreground"> · from {names.join(" and ")}{others > 0 ? ` and ${others} more` : ""}</span>
      </span>
      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </Link>
  );
}
