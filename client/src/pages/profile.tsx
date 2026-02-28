import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { type UserProfile, type Project, type User, type UserBadge, type Badge as BadgeType } from "@shared/schema";
import { UserAvatar } from "@/components/user-avatar";
import { SkillBadge } from "@/components/skill-badge";
import { ProjectCard } from "@/components/project-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, Globe, Github, Linkedin, Mail, MessageSquare, UserPlus, Edit, Loader2, FileText, Award, Rocket, Star, Users as UsersIcon, Sparkles, Trophy } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertUserProfileSchema, type InsertUserProfile } from "@shared/schema";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type ProjectWithDetails = Project & { owner: User; profile?: UserProfile };

export default function Profile() {
  const { id } = useParams<{ id?: string }>();
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isEditing, setIsEditing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isOwnProfile = !id || (currentUser && id === currentUser.id);
  const userId = id || currentUser?.id;

  const { data: profileData, isLoading: profileLoading } = useQuery<any>({
    queryKey: [id ? `/api/users/${id}` : "/api/profile"],
    queryFn: async ({ queryKey }) => {
      const res = await fetch(queryKey.join("/"), { credentials: "include" });
      if (res.status === 404 || res.status === 401) return null;
      if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
      return res.json();
    },
    enabled: !!userId,
    retry: false,
  });

  const profile: UserProfile | undefined = id ? profileData?.profile : profileData;
  const projects: ProjectWithDetails[] = id ? (profileData?.projects || []) : [];

  const { data: ownProjects, isLoading: projectsLoading } = useQuery<ProjectWithDetails[]>({
    queryKey: [`/api/users/${userId}`],
    enabled: !!userId && !!isOwnProfile,
    select: (data: any) => data?.projects || [],
  });

  const { data: userBadges } = useQuery<(UserBadge & { badge: BadgeType })[]>({
    queryKey: ["/api/users", userId, "badges"],
    queryFn: async () => {
      const res = await fetch(`/api/users/${userId}/badges`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!userId,
  });

  const form = useForm<InsertUserProfile>({
    resolver: zodResolver(insertUserProfileSchema),
    values: profile ? {
      userId: profile.userId,
      displayName: profile.displayName || "",
      username: profile.username || "",
      headline: profile.headline || "",
      bio: profile.bio || "",
      location: profile.location || "",
      skills: profile.skills || [],
      interests: profile.interests || [],
      experienceLevel: profile.experienceLevel || "beginner",
      githubUrl: profile.githubUrl || "",
      linkedinUrl: profile.linkedinUrl || "",
      websiteUrl: profile.websiteUrl || "",
      isOnboarded: profile.isOnboarded,
    } : undefined,
  });

  const onUpdateProfile = async (data: InsertUserProfile) => {
    setIsSubmitting(true);
    try {
      await apiRequest("POST", "/api/profile", data);
      queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
      setIsEditing(false);
      toast({
        title: "Profile updated",
        description: "Your profile has been updated successfully.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update profile",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (profileLoading || !userId) {
    return (
      <div className="container max-w-5xl mx-auto py-10 px-4 space-y-8">
        <Skeleton className="h-48 w-full rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <Skeleton className="h-96 rounded-xl" />
          <div className="md:col-span-2 space-y-8">
            <Skeleton className="h-64 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!profile && !isOwnProfile) {
    return (
      <div className="container max-w-5xl mx-auto py-20 px-4 text-center">
        <h2 className="text-2xl font-bold">User profile not found</h2>
        <Button className="mt-4" onClick={() => setLocation("/")}>Go Home</Button>
      </div>
    );
  }

  if (!profile && isOwnProfile) {
    return (
      <div className="container max-w-5xl mx-auto py-20 px-4 text-center space-y-4">
        <h2 className="text-2xl font-bold">Welcome to SparkTower!</h2>
        <p className="text-muted-foreground">Complete your profile to get started and connect with other creators.</p>
        <Button onClick={() => setLocation("/onboarding")} data-testid="button-complete-profile">
          Complete Your Profile
        </Button>
      </div>
    );
  }

  return (
    <div className="container max-w-5xl mx-auto py-10 px-4 space-y-8">
      {/* Profile Header */}
      <Card className="overflow-hidden border-border/50">
        <div className="h-32 bg-gradient-to-r from-primary/20 via-accent/20 to-primary/20" />
        <div className="px-6 pb-6 relative">
          <div className="absolute -top-12 left-6">
            <UserAvatar 
              src={profile?.avatarUrl} 
              name={profile?.displayName || profile?.headline || "User"} 
              className="h-24 w-24 border-4 border-background text-2xl" 
            />
          </div>
          <div className="pt-16 flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div className="space-y-1">
              <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-profile-name">
                {profile?.displayName || profile?.headline || "Untitled Profile"}
                {profile?.experienceLevel && (
                  <Badge variant="outline" className="capitalize text-xs">
                    {profile.experienceLevel}
                  </Badge>
                )}
              </h1>
              {profile?.username && (
                <p className="text-sm text-muted-foreground" data-testid="text-profile-username">@{profile.username}</p>
              )}
              {profile?.headline && profile?.displayName && (
                <p className="text-sm text-muted-foreground">{profile.headline}</p>
              )}
              <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                {profile?.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-4 w-4" />
                    {profile.location}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Mail className="h-4 w-4" />
                  Contact
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isOwnProfile ? (
                <Dialog open={isEditing} onOpenChange={setIsEditing}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2" data-testid="button-edit-profile">
                      <Edit className="h-4 w-4" />
                      Edit Profile
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Edit Profile</DialogTitle>
                    </DialogHeader>
                    <Form {...form}>
                      <form onSubmit={form.handleSubmit(onUpdateProfile)} className="space-y-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                          <FormField
                            control={form.control}
                            name="displayName"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Full Name</FormLabel>
                                <FormControl>
                                  <Input {...field} value={field.value || ''} data-testid="input-edit-display-name" />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="username"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Username</FormLabel>
                                <FormControl>
                                  <Input {...field} value={field.value || ''} data-testid="input-edit-username" />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                        <FormField
                          control={form.control}
                          name="headline"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Headline</FormLabel>
                              <FormControl>
                                <Input {...field} value={field.value || ''} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="bio"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Bio</FormLabel>
                              <FormControl>
                                <Textarea className="min-h-[100px]" {...field} value={field.value || ''} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <div className="grid grid-cols-2 gap-4">
                          <FormField
                            control={form.control}
                            name="location"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Location</FormLabel>
                                <FormControl>
                                  <Input {...field} value={field.value || ''} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="websiteUrl"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Website</FormLabel>
                                <FormControl>
                                  <Input {...field} value={field.value || ''} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <FormField
                            control={form.control}
                            name="githubUrl"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>GitHub URL</FormLabel>
                                <FormControl>
                                  <Input {...field} value={field.value || ''} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="linkedinUrl"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>LinkedIn URL</FormLabel>
                                <FormControl>
                                  <Input {...field} value={field.value || ''} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                        <DialogFooter className="pt-4">
                          <Button type="button" variant="ghost" onClick={() => setIsEditing(false)}>Cancel</Button>
                          <Button type="submit" disabled={isSubmitting} data-testid="button-save-profile">
                            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Save Changes
                          </Button>
                        </DialogFooter>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>
              ) : (
                <>
                  <Button variant="outline" size="sm" className="gap-2" data-testid="button-connect">
                    <UserPlus className="h-4 w-4" />
                    Connect
                  </Button>
                  <Button size="sm" className="gap-2" data-testid="button-message">
                    <MessageSquare className="h-4 w-4" />
                    Message
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Left Column: Info & Links */}
        <div className="space-y-6">
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-sm font-semibold uppercase text-muted-foreground">About</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm whitespace-pre-wrap">{profile?.bio || "No bio yet."}</p>
              <div className="flex flex-col gap-2 pt-2">
                {profile?.githubUrl && (
                  <a href={profile.githubUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                    <Github className="h-4 w-4" /> GitHub Profile
                  </a>
                )}
                {profile?.linkedinUrl && (
                  <a href={profile.linkedinUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                    <Linkedin className="h-4 w-4" /> LinkedIn Profile
                  </a>
                )}
                {profile?.websiteUrl && (
                  <a href={profile.websiteUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                    <Globe className="h-4 w-4" /> Portfolio Website
                  </a>
                )}
                {profile?.resumeUrl && (
                  <a href={profile.resumeUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="link-resume">
                    <FileText className="h-4 w-4" /> Resume
                  </a>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-sm font-semibold uppercase text-muted-foreground">Interests</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {profile?.interests?.map(i => (
                  <Badge key={i} variant="secondary" className="bg-accent/10 text-accent-foreground border-accent/20">
                    {i}
                  </Badge>
                ))}
                {(!profile?.interests || profile.interests.length === 0) && (
                  <p className="text-sm text-muted-foreground">No interests listed.</p>
                )}
              </div>
            </CardContent>
          </Card>
          {userBadges && userBadges.length > 0 && (
            <Card className="border-border/50">
              <CardHeader>
                <CardTitle className="text-sm font-semibold uppercase text-muted-foreground">Earned Badges</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-3">
                  {userBadges.map((ub) => {
                    const BADGE_ICONS: Record<string, typeof Award> = {
                      rocket: Rocket,
                      star: Star,
                      trophy: Trophy,
                      users: UsersIcon,
                      sparkles: Sparkles,
                      award: Award,
                    };
                    const RARITY_STYLES: Record<string, string> = {
                      common: "bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-600",
                      rare: "bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-600",
                      epic: "bg-purple-50 dark:bg-purple-900/30 border-purple-300 dark:border-purple-600",
                      legendary: "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-400 dark:border-yellow-500",
                    };
                    const IconComp = BADGE_ICONS[ub.badge.icon] || Award;
                    return (
                      <div
                        key={ub.id}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${RARITY_STYLES[ub.badge.rarity]} transition-colors`}
                        title={ub.badge.description}
                        data-testid={`badge-earned-${ub.badge.id}`}
                      >
                        <IconComp className="h-4 w-4" />
                        <div>
                          <p className="text-xs font-medium leading-tight">{ub.badge.name}</p>
                          <p className="text-[10px] text-muted-foreground capitalize">{ub.badge.rarity}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Column: Skills & Projects */}
        <div className="md:col-span-2 space-y-6">
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-sm font-semibold uppercase text-muted-foreground">Skills & Expertise</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {profile?.skills?.map(s => (
                  <SkillBadge key={s} skill={s} />
                ))}
                {(!profile?.skills || profile.skills.length === 0) && (
                  <p className="text-sm text-muted-foreground">No skills listed.</p>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Projects</h2>
              {isOwnProfile && (
                <Button variant="ghost" size="sm" onClick={() => setLocation("/projects/new")}>
                  New Project
                </Button>
              )}
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {projectsLoading ? (
                Array.from({ length: 2 }).map((_, i) => (
                  <Skeleton key={i} className="h-48 rounded-xl" />
                ))
              ) : (isOwnProfile ? ownProjects || [] : projects).length > 0 ? (
                (isOwnProfile ? ownProjects || [] : projects).map((project: ProjectWithDetails) => (
                  <ProjectCard key={project.id} project={project} />
                ))
              ) : (
                <Card className="col-span-2 border-dashed border-border/50 bg-transparent py-10">
                  <CardContent className="flex flex-col items-center justify-center text-center space-y-2">
                    <p className="text-muted-foreground">No projects yet.</p>
                    {isOwnProfile && (
                      <Button variant="outline" size="sm" onClick={() => setLocation("/projects/new")}>
                        Create your first project
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
