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
import { Home, Compass, Telescope, FolderKanban, Users, Trophy, LogOut, Plus, Medal, CreditCard, Sparkles, MessageSquare, Handshake, Gamepad2, ShieldCheck, ChevronDown, Banknote, Wallet as WalletIcon, Megaphone, ShieldAlert, LifeBuoy, MessageSquareWarning } from "lucide-react";
import { useState } from "react";
import { PRIMARY_NAV, SECONDARY_NAV } from "@/lib/navigation";
import { Badge } from "@/components/ui/badge";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { TierSwitcher } from "@/components/tier-switcher";
import { formatMoney } from "@shared/plans";
import { useWallet } from "@/components/payment-dialog";
import { useSurfaces } from "@/hooks/use-surfaces";

const ICONS = { Home, FolderKanban, Compass, Telescope, Users, Handshake, Gamepad2, MessageSquare, Trophy, Medal, CreditCard, Banknote };
const MORE_OPEN_KEY = "st_nav_more_open";

/**
 * Money on the account and this month's free Nova actions — the two numbers
 * that decide whether the next thing someone presses will ask them for
 * anything. A link to the price list rather than to an upgrade, because there
 * is nothing to upgrade to.
 */
function WalletSummary() {
  const { user } = useAuth();
  const { data: wallet } = useWallet(!!user);
  if (!user || !wallet) return null;
  return (
    <div className="px-2 py-2 rounded-lg bg-sidebar-accent/50" data-testid="sidebar-wallet">
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-xs font-medium text-muted-foreground">Balance</span>
        <span className="text-xs font-semibold tabular-nums" data-testid="text-sidebar-balance">{wallet.balanceDisplay}</span>
      </div>
      <p className="text-xs text-muted-foreground" data-testid="text-sidebar-allowance">
        {wallet.dayPassActive
          ? "Day pass on — small actions unlimited"
          : wallet.actionsBought > 0
            ? `${wallet.allowanceRemaining} free + ${wallet.actionsBought} bought Nova actions left`
            : `${wallet.allowanceRemaining} of ${wallet.allowanceLimit} free Nova actions left`}
      </p>
      <Link href="/pricing" className="text-xs text-primary hover:underline mt-1 block" data-testid="link-pricing">
        {wallet.balanceCents > 0 ? "Add to your balance" : `Top up from ${formatMoney(500)}`}
      </Link>
    </div>
  );
}

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
  // Featured tools is the one admin page reviewers can't use — /api/admin/promotions is admins only.
  const isAdmin = !!user && (user as any).platformRole === "admin";
  /*
   * Owner, which is not a platform role but an allowlisted email — so it has
   * to be asked for rather than read off the user. Fetched once and left
   * alone: the app's default staleTime is Infinity and this answer does not
   * change inside a session.
   */
  const { data: ownerAccess } = useQuery<{ owner: boolean }>({
    queryKey: ["/api/admin/analytics/access"],
    enabled: !!user,
  });
  const isOwner = !!ownerAccess?.owner;
  const { data: safety } = useQuery<{ reviewDue: boolean; alerts: number }>({
    queryKey: ["/api/admin/safety/status"],
    enabled: isReviewer,
    refetchInterval: 5 * 60_000,
  });

  /*
   * How many problem reports nobody has read. Badged, because a queue with no
   * count on it is a queue somebody opens once and then forgets exists — and
   * the whole point of taking reports is reading them.
   *
   * Five minutes, like the safety poll beside it: a bug report is not urgent
   * to the minute, and this runs on every admin's sidebar on every screen.
   */
  const { data: problems } = useQuery<{ new: number }>({
    queryKey: ["/api/admin/problem-reports/unread"],
    enabled: isAdmin,
    refetchInterval: 5 * 60_000,
  });

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
                        {item.title === "Discover" && discoverNew > 0 && (
                          <Badge variant="default" className="no-default-hover-elevate no-default-active-elevate text-xs" data-testid="badge-discover-new" title="New posts from people and projects you've looked at">
                            {discoverNew > 99 ? "99+" : `${discoverNew}${discoverNews?.more ? "+" : ""} new`}
                          </Badge>
                        )}
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
              {!moreOpen && unreadCount > 0 && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-primary" aria-label="New in More" />}
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
                {isAdmin && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      isActive={location === "/admin/problems"}
                      className="data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground"
                    >
                      {/* What people said is broken, as opposed to who reported whom. */}
                      <Link href="/admin/problems" data-testid="link-admin-problems">
                        <MessageSquareWarning className="h-4 w-4" />
                        <span className="flex-1">Problems</span>
                        {problems && problems.new > 0 && (
                          <Badge
                            variant="destructive"
                            className="no-default-hover-elevate no-default-active-elevate text-xs"
                            data-testid="badge-problems"
                          >
                            {problems.new}
                          </Badge>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
                {isAdmin && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      isActive={location === "/admin/security"}
                      className="data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground"
                    >
                      {/* Admin only: it can take somebody's second factor off. */}
                      <Link href="/admin/security" data-testid="link-security-console">
                        <ShieldAlert className="h-4 w-4" />
                        <span className="flex-1">Security</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
                {isAdmin && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      isActive={location === "/admin/console"}
                      className="data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground"
                    >
                      {/*
                        * Where a support request gets answered. Admin to open;
                        * the money and ownership actions inside it are the
                        * owner's alone, and the page draws them as such.
                        */}
                      <Link href="/admin/console" data-testid="link-customer-console">
                        <LifeBuoy className="h-4 w-4" />
                        <span className="flex-1">Customers</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location === "/admin/backing"}
                    className="data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground"
                  >
                    <Link href="/admin/backing" data-testid="link-backing-review">
                      <Banknote className="h-4 w-4" />
                      <span className="flex-1">Backing review</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {/* What the platform has taken and what of it is actually ours. */}
                {isOwner && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      isActive={location === "/admin/revenue"}
                      className="data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground"
                    >
                      <Link href="/admin/revenue" data-testid="link-admin-revenue">
                        <WalletIcon className="h-4 w-4" />
                        <span className="flex-1">Revenue</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
                {isAdmin && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      isActive={location === "/admin/promotions"}
                      className="data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground"
                    >
                      <Link href="/admin/promotions" data-testid="link-admin-promotions">
                        <Megaphone className="h-4 w-4" />
                        <span className="flex-1">Featured tools</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
                {/*
                  * The only way into the contest editor. Admins only, and under
                  * the contests flag: with the surface off there is nothing for
                  * a contest to appear on, so offering to make one is a trap.
                  */}
                {isAdmin && on("contests") && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      isActive={location === "/admin/contests"}
                      className="data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground"
                    >
                      <Link href="/admin/contests" data-testid="link-admin-contests">
                        <Trophy className="h-4 w-4" />
                        <span className="flex-1">Contests</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
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
        {/*
          * What they actually have: money on the account, and this month's
          * free Nova actions. It used to be a plan name, a credit bar and a
          * link to upgrade — three things that stopped being true when
          * subscriptions went, and the most-seen place in the app to be wrong
          * about what somebody is paying for.
          */}
        <WalletSummary />
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
            <SidebarMenuButton asChild>
              <Link href="/settings/security" data-testid="link-security-settings">
                <ShieldCheck className="h-4 w-4" />
                <span>Security</span>
              </Link>
            </SidebarMenuButton>
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
