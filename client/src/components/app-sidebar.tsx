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
import { Inbox, Home, Compass, FolderKanban, Users, Trophy, LogOut, Plus, Medal, CreditCard, Sparkles, MessageSquare, Handshake } from "lucide-react";
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

/*
 * `surface` ties a nav item to its kill switch — an item whose surface is off
 * disappears from the sidebar. Items with no surface are always shown, which
 * is right for Home, Projects and Pricing: they aren't feature areas that can
 * be switched off.
 */
const menuItems: { title: string; url: string; icon: typeof Home; surface?: string }[] = [
  { title: "Home", url: "/", icon: Home },
  { title: "Discover", url: "/discover", icon: Compass, surface: "discover" },
  { title: "Projects", url: "/projects", icon: FolderKanban },
  { title: "Matches", url: "/matches", icon: Users, surface: "matches" },
  { title: "Sprints", url: "/sprints", icon: Handshake, surface: "sprints" },
  { title: "Messages", url: "/messages", icon: MessageSquare, surface: "messages" },
  { title: "Leaderboard", url: "/leaderboard", icon: Trophy, surface: "leaderboard" },
  { title: "Contests", url: "/contests", icon: Trophy, surface: "contests" },
  { title: "Needs feedback", url: "/feedback", icon: Inbox, surface: "checkIns" },
  { title: "Pricing", url: "/pricing", icon: CreditCard },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { on } = useSurfaces();
  const visibleItems = menuItems.filter((item) => !item.surface || on(item.surface));
  const { user, logout } = useAuth();
  const displayName = user?.firstName ? `${user.firstName} ${user.lastName || ""}` : user?.email || "User";

  const {
    tier, plan, subscription, creditsUsed, creditsLimit, creditsRemaining, isUnlimited,
  } = useEntitlements();

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/messages/unread-count"],
    refetchInterval: 10000,
  });
  const unreadCount = unreadData?.count || 0;

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
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    className="data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground"
                  >
                    <Link href={item.url} data-testid={`link-${item.title.toLowerCase()}`}>
                      <item.icon className="h-4 w-4" />
                      <span className="flex-1">{item.title}</span>
                      {item.title === "Messages" && unreadCount > 0 && (
                        <Badge variant="default" className="no-default-hover-elevate no-default-active-elevate text-xs" data-testid="badge-unread-messages">
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </Badge>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
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
