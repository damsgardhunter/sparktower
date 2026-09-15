import { PinnedBadges } from "@/components/pinned-badges";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "@/components/ui/sidebar";
import { Home, Compass, FolderKanban, Users, Trophy, LogOut, Plus, Medal, CreditCard, Sparkles, MessageSquare, Handshake, ShieldCheck, ChevronDown } from "lucide-react";
import { useState } from "react";
import { PRIMARY_NAV, SECONDARY_NAV } from "@/lib/navigation";
import { Badge } from "@/components/ui/badge";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Progress } from "@/components/ui/progress";
import { useEntitlements } from "@/hooks/use-entitlements";
import { TierSwitcher } from "@/components/tier-switcher";
import { PLAN_PRESENTATION } from "@shared/plans";
import { useSurfaces } from "@/hooks/use-surfaces";

const ICONS = { Home, FolderKanban, Compass, Users, Handshake, MessageSquare, Trophy, Medal, CreditCard };
const MORE_OPEN_KEY = "st_nav_more_open";

export function AppSidebar() {
  const [location] = useLocation();
  const { on } = useSurfaces();
  // An item whose surface is switched off disappears; the path loops' own items are always there.
  const primaryItems = PRIMARY_NAV.filter((item) => !item.surface || on(item.surface));
  const secondaryItems = SECONDARY_NAV.filter((item) => !item.surface || on(item.surface));
  const [moreOpen, setMoreOpen] = useState(() => { try { return localStorage.getItem(MORE_OPEN_KEY) !== "0"; } catch { return true; } });
  const toggleMore = () => setMoreOpen((open) => { try { localStorage.setItem(MORE_OPEN_KEY, open ? "0" : "1"); } catch { /* remembered for this visit only */ } return !open; });
  const { user, logout } = useAuth();
  const displayName = user?.firstName ? `${user.firstName} ${user.lastName || ""}` : user?.email || "User";

  const {
    tier, plan, subscription, creditsUsed, creditsLimit, creditsRemaining, isUnlimited,
  } = useEntitlements();

  // Not polled for a surface that's switched off: its endpoint answers 404 then anyway.
  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/messages/unread-count"],
    enabled: !!user && on("messages"),
    refetchInterval: 10000,
  });
  const unreadCount = unreadData?.count || 0;

  // What's new from the builders and projects you've looked at since you last opened Discover.
  const { data: discoverNews } = useQuery<{ count: number; more: boolean }>({
    queryKey: ["/api/discover/new-count"],
    enabled: !!user && on("discover"),
    refetchInterval: 60_000,
  });
  const discoverNew = discoverNews?.count ?? 0;

  // Reviewers get the daily safety review, badged when alerts are waiting or a review is due.
  const isReviewer = !!user && ["reviewer", "admin"].includes((user as any).platformRole);
  const { data: safety } = useQuery<{ reviewDue: boolean; alerts: number }>({
    queryKey: ["/api/admin/safety/status"],
    enabled: isReviewer,
    refetchInterval: 5 * 60_000,
  });

  const progressPercent = isUnlimited || creditsLimit <= 0
    ? 0
    : Math.min(100, (creditsUsed / creditsLimit) * 100);

  return (
    <Sidebar className="border-r border-sidebar-border">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          <img src="/favicon.png" alt="SparkTower" className="h-8 w-8 rounded-lg object-contain" />
          <span className="font-bold text-xl tracking-tight">SparkTower</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {/* The path loops: where the work is. */}
        <SidebarGroup>
          <SidebarGroupLabel>Build</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {primaryItems.map((item) => {
                const Icon = ICONS[item.icon];
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={location === item.url} className="data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground">
                      <Link href={item.url} data-testid={`link-${item.title.toLowerCase()}`}>
                        <Icon className="h-4 w-4" />
                        <span className="flex-1">{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {/* Everything else: reachable, quieter, and each behind its surface flag. */}
        {secondaryItems.length > 0 && (
          <SidebarGroup className="pt-0" data-testid="nav-secondary">
            <button type="button" onClick={toggleMore} className="flex items-center gap-1 px-2 h-7 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80 hover:text-foreground" aria-expanded={moreOpen} data-testid="nav-secondary-toggle">
              More
              <ChevronDown className={`h-3 w-3 transition-transform ${moreOpen ? "" : "-rotate-90"}`} />
              {!moreOpen && (unreadCount > 0 || discoverNew > 0) && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-primary" aria-label="New in More" />}
            </button>
            {moreOpen && (
              <SidebarGroupContent>
                <SidebarMenu>
                  {secondaryItems.map((item) => {
                    const Icon = ICONS[item.icon];
                    return (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton asChild size="sm" isActive={location === item.url} className="text-muted-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground">
                          <Link href={item.url} data-testid={`link-${item.title.toLowerCase()}`}>
                            <Icon className="h-3.5 w-3.5" />
                            <span className="flex-1 text-[13px]">{item.title}</span>
                            {item.title === "Discover" && discoverNew > 0 && (
                              <Badge variant="default" className="no-default-hover-elevate no-default-active-elevate text-xs" data-testid="badge-discover-new" title="New posts from people and projects you've looked at">
                                {discoverNew > 99 ? "99+" : `${discoverNew}${discoverNews?.more ? "+" : ""} new`}
                              </Badge>
                            )}
                            {item.title === "Messages" && unreadCount > 0 && (
                              <Badge variant="default" className="no-default-hover-elevate no-default-active-elevate text-xs" data-testid="badge-unread-messages">
                                {unreadCount > 99 ? "99+" : unreadCount}
                              </Badge>
                            )}
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            )}
          </SidebarGroup>
        )}
        {isReviewer && (
          <SidebarGroup>
            <SidebarGroupLabel>Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location === "/admin/safety"}
                    className="data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground"
                  >
                    <Link href="/admin/safety" data-testid="link-safety-review">
                      <ShieldCheck className="h-4 w-4" />
                      <span className="flex-1">Safety review</span>
                      {safety && (safety.alerts > 0 || safety.reviewDue) && (
                        <Badge
                          variant={safety.alerts > 0 ? "destructive" : "secondary"}
                          className="no-default-hover-elevate no-default-active-elevate text-xs"
                          data-testid="badge-safety"
                        >
                          {safety.alerts > 0 ? safety.alerts : "Due"}
                        </Badge>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        <SidebarGroup>
          <SidebarGroupContent>
            <div className="px-2">
              <Button asChild className="w-full gap-2" data-testid="button-create-project-sidebar">
                <Link href="/projects/new">
                  <Plus className="h-4 w-4" />
                  Create Project
                </Link>
              </Button>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4 mt-auto space-y-3">
        <TierSwitcher />
        {subscription && (
          <div className="px-2 py-2 rounded-lg bg-sidebar-accent/50" data-testid="sidebar-credit-usage">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-muted-foreground">
                {plan.name} Plan
              </span>
              {isUnlimited ? (
                <span className="text-xs text-primary flex items-center gap-1">
                  <Sparkles className="h-3 w-3" /> Unlimited
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {creditsRemaining} left
                </span>
              )}
            </div>
            {!isUnlimited && (
              <Progress value={progressPercent} className="h-1.5" />
            )}
            {tier === "free" ? (
              <Link href="/pricing" className="text-xs text-primary hover:underline mt-1 block" data-testid="link-upgrade">
                {PLAN_PRESENTATION.builder.promise}
              </Link>
            ) : tier !== "pro" ? (
              <Link href="/pricing" className="text-xs text-primary hover:underline mt-1 block" data-testid="link-upgrade">
                Compare plans
              </Link>
            ) : null}
          </div>
        )}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="h-12">
              <Link href="/profile" className="flex items-center gap-3">
                <UserAvatar src={user?.profileImageUrl} name={displayName} className="h-8 w-8" />
                <div className="flex flex-col flex-1 overflow-hidden">
                  <span className="text-sm font-medium line-clamp-1">{displayName}</span>
                  <span className="text-xs text-tertiary line-clamp-1">View Profile</span>
                </div>
              </Link>
            </SidebarMenuButton>
            {/* Your chosen badges under your name — outside the profile link, so each opens its own project. */}
            <PinnedBadges userId={user?.id} size="xs" max={5} className="pl-[3.25rem] -mt-1 pb-1" />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => logout()}
              className="text-destructive hover:text-destructive"
              data-testid="button-logout"
            >
              <LogOut className="h-4 w-4" />
              <span>Logout</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
