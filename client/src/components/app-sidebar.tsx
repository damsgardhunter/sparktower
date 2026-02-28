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
import { Home, Compass, FolderKanban, Users, Trophy, LogOut, Plus, Medal, CreditCard, Sparkles } from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Progress } from "@/components/ui/progress";

const menuItems = [
  { title: "Home", url: "/", icon: Home },
  { title: "Discover", url: "/discover", icon: Compass },
  { title: "Projects", url: "/projects", icon: FolderKanban },
  { title: "Matches", url: "/matches", icon: Users },
  { title: "Leaderboard", url: "/leaderboard", icon: Trophy },
  { title: "Contests", url: "/contests", icon: Medal },
  { title: "Pricing", url: "/pricing", icon: CreditCard },
];

interface Subscription {
  tier: string;
  creditsUsed: number;
  creditsLimit: number;
  creditsRemaining: number;
}

const tierLabels: Record<string, string> = {
  free: "Free",
  spark_pro: "Spark Pro",
  spark_business: "Spark Business",
  spark_unlimited: "Unlimited",
};

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const displayName = user?.firstName ? `${user.firstName} ${user.lastName || ""}` : user?.email || "User";

  const { data: subscription } = useQuery<Subscription>({
    queryKey: ["/api/subscription"],
  });

  const isUnlimited = subscription?.tier === "spark_unlimited";
  const creditsUsed = subscription?.creditsUsed || 0;
  const creditsLimit = subscription?.creditsLimit || 20;
  const creditsRemaining = subscription?.creditsRemaining ?? 20;
  const progressPercent = isUnlimited ? 0 : Math.min(100, (creditsUsed / creditsLimit) * 100);

  return (
    <Sidebar className="border-r border-sidebar-border">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center font-bold text-primary-foreground">
            ST
          </div>
          <span className="font-bold text-xl tracking-tight">SparkTower</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    className="data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground"
                  >
                    <Link href={item.url} data-testid={`link-${item.title.toLowerCase()}`}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
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
        {subscription && (
          <div className="px-2 py-2 rounded-lg bg-sidebar-accent/50" data-testid="sidebar-credit-usage">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-muted-foreground">
                {tierLabels[subscription.tier] || "Free"} Plan
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
            {subscription.tier === "free" && (
              <Link href="/pricing" className="text-xs text-primary hover:underline mt-1 block" data-testid="link-upgrade">
                Upgrade for more credits
              </Link>
            )}
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
