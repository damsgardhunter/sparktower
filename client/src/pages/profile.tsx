import { useQuery, useMutation } from "@tanstack/react-query";
import { BackerCredits } from "@/components/backer-credits";
import { BackerBadgeShowcase } from "@/components/backer-badge-showcase";
import { ImageUploadField } from "@/components/image-upload-field";
import { useParams, useLocation } from "wouter";
import { type UserProfile, type Project, type User, type UserBadge, type Badge as BadgeType, type Connection } from "@shared/schema";
import { UserAvatar } from "@/components/user-avatar";
import { SkillBadge } from "@/components/skill-badge";
import { ProjectCard } from "@/components/project-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapPin, Globe, Github, Linkedin, Mail, MessageSquare, UserPlus, UserMinus, Edit, Loader2, FileText, Award, Rocket, Star, Users as UsersIcon, Sparkles, Trophy, Upload, CheckCircle, X, Clock, DollarSign, ExternalLink, Search, Heart, Activity } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useAuth } from "@/hooks/use-auth";
import { useState, useRef } from "react";
import { useUpload } from "@/hooks/use-upload";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertUserProfileSchema, type InsertUserProfile } from "@shared/schema";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { UserCard } from "@/components/user-card";
import { ReputationCard } from "@/components/reputation-card";
import { ProfileCredentials } from "@/components/profile-credentials";
import { ProfileResumePanel } from "@/components/profile-resume-panel";
import { LookingForCard } from "@/components/looking-for-card";
import { ProfileFeed } from "@/components/profile-feed";

type ProjectWithDetails = Project & { owner: User; profile?: UserProfile };

export default function Profile() {
  const { id } = useParams<{ id?: string }>();
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isEditing, setIsEditing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [connectionSearch, setConnectionSearch] = useState("");
  const resumeInputRef = useRef<HTMLInputElement>(null);

  const { uploadFile, isUploading: isUploadingResume, progress: uploadProgress } = useUpload({
    onSuccess: (response) => {
      form.setValue("resumeUrl", response.objectPath);
      toast({ title: "Resume uploaded", description: "Your resume has been uploaded successfully." });
    },
    onError: (error) => {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
  });

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
  const otherProjects: ProjectWithDetails[] = id ? (profileData?.projects || []) : [];

  const { data: userProjects, isLoading: projectsLoading } = useQuery<Project[]>({
    queryKey: ["/api/user/projects"],
    enabled: !!isOwnProfile,
  });

  const { data: otherUserProjects } = useQuery<any>({
    queryKey: [`/api/users/${userId}`],
    enabled: !!userId && !isOwnProfile,
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

  const { data: connectionStatus } = useQuery<any>({
    queryKey: ["/api/connections/status", userId],
    queryFn: async () => {
      const res = await fetch(`/api/connections/status/${userId}`, { credentials: "include" });
      if (!res.ok) return { status: "none" };
      return res.json();
    },
    enabled: !!userId && !isOwnProfile && !!currentUser,
  });

  const { data: myConnections } = useQuery<(Connection & { user: User; profile?: UserProfile })[]>({
    queryKey: ["/api/connections"],
    enabled: !!isOwnProfile,
  });

  const { data: connectionRequests } = useQuery<(Connection & { user: User; profile?: UserProfile })[]>({
    queryKey: ["/api/connections/requests"],
    enabled: !!isOwnProfile,
  });

  const { data: followedProjects } = useQuery<ProjectWithDetails[]>({
    queryKey: ["/api/user/followed-projects"],
    enabled: !!isOwnProfile,
  });

  const { data: payoutInfo } = useQuery<any>({
    queryKey: ["/api/payouts"],
    enabled: !!isOwnProfile,
  });

  /*
   * Whether this account owns the site. Only the owner sees the Behaviour tab,
   * and the server refuses the data to everyone else regardless — this only
   * decides whether the tab is drawn.
   */
  const { data: analyticsAccess } = useQuery<{ owner: boolean }>({
    queryKey: ["/api/admin/analytics/access"],
    queryFn: async () => {
      const res = await fetch("/api/admin/analytics/access", { credentials: "include" });
      if (!res.ok) return { owner: false };
      return res.json();
    },
    enabled: !!isOwnProfile,
    retry: false,
  });
  const isSiteOwner = !!analyticsAccess?.owner;

  const { data: analyticsPeek } = useQuery<any>({
    queryKey: ["/api/admin/analytics/summary", 7],
    queryFn: async () => {
      const res = await fetch("/api/admin/analytics/summary?days=7", { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    enabled: isSiteOwner,
    refetchInterval: 30_000,
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/connections/request", { userId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/connections/status", userId] });
      toast({ title: "Connection request sent" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const acceptMutation = useMutation({
    mutationFn: async (connId: string) => {
      const res = await apiRequest("POST", `/api/connections/${connId}/accept`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/connections/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/connections/status"] });
      toast({ title: "Connection accepted" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (connId: string) => {
      const res = await apiRequest("POST", `/api/connections/${connId}/reject`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/connections/requests"] });
      toast({ title: "Connection rejected" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (connId: string) => {
      await apiRequest("DELETE", `/api/connections/${connId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/connections"] });
      toast({ title: "Connection removed" });
    },
  });

  const connectAccountMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/stripe/connect-account");
      const res = await fetch("/api/stripe/connect-onboarding", { credentials: "include" });
      const data = await res.json();
      return data;
    },
    onSuccess: (data) => {
      if (data.url) window.location.href = data.url;
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
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
      resumeUrl: profile.resumeUrl || "",
      hoursPerWeek: profile.hoursPerWeek ?? undefined,
      riskTolerance: profile.riskTolerance ?? undefined,
      speedVsPolish: profile.speedVsPolish ?? undefined,
      scheduleStyle: profile.scheduleStyle ?? undefined,
      conflictStyle: profile.conflictStyle ?? undefined,
      builderType: profile.builderType ?? undefined,
      isOnboarded: profile.isOnboarded,
    } : undefined,
  });

  /**
   * Avatar and cover save the moment they're picked, separately from the form.
   *
   * Routing them through react-hook-form would mean an upload only landed if
   * the person also pressed Save — and a picture that appears in the dialog
   * but vanishes on close is worse than no upload at all.
   */
  const imageMutation = useMutation({
    mutationFn: async (patch: { avatarUrl?: string | null; coverUrl?: string | null }) => {
      const res = await apiRequest("POST", "/api/profile", patch);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
      queryClient.invalidateQueries({ queryKey: [`/api/users/${userId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/profile/summary"] });
      toast({ title: "Photo updated" });
    },
    onError: () => toast({ title: "Couldn't save that photo", variant: "destructive" }),
  });

  const onUpdateProfile = async (data: InsertUserProfile) => {
    setIsSubmitting(true);
    try {
      await apiRequest("POST", "/api/profile", data);
      queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
      queryClient.invalidateQueries({ queryKey: [`/api/users/${userId}`] });
      setIsEditing(false);
      toast({ title: "Profile updated", description: "Your profile has been updated successfully." });
    } catch (error) {
      toast({ title: "Error", description: error instanceof Error ? error.message : "Failed to update profile", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResumeUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = [".pdf", ".doc", ".docx"];
    const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
    if (!allowed.includes(ext)) {
      toast({ title: "Invalid file type", description: "Please upload a PDF, DOC, or DOCX file.", variant: "destructive" });
      return;
    }
    uploadFile(file);
  };

  if (profileLoading || !userId) {
    return (
      <div className="container max-w-5xl mx-auto py-10 px-4 space-y-8">
        <Skeleton className="h-48 w-full rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <Skeleton className="h-96 rounded-xl" />
          <div className="md:col-span-2 space-y-8">
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

  const displayProjects = isOwnProfile ? (userProjects || []) : (otherUserProjects || otherProjects);
  const filteredConnections = (myConnections || []).filter(c => {
    if (!connectionSearch) return true;
    const name = (c.profile?.displayName || c.user.firstName || "").toLowerCase();
    return name.includes(connectionSearch.toLowerCase());
  });

  const renderConnectionButton = () => {
    if (!currentUser || isOwnProfile) return null;
    const status = connectionStatus?.status;

    if (status === "accepted") {
      return (
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <CheckCircle className="h-3 w-3" /> Connected
          </Badge>
          <Button size="sm" className="gap-2" onClick={() => setLocation(`/messages?user=${userId}`)} data-testid="button-message">
            <MessageSquare className="h-4 w-4" /> Message
          </Button>
        </div>
      );
    }
    if (status === "pending") {
      if (connectionStatus?.requesterId === currentUser.id) {
        return (
          <Badge variant="secondary" className="gap-1">
            <Clock className="h-3 w-3" /> Request Sent
          </Badge>
        );
      }
      return (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="default" onClick={() => acceptMutation.mutate(connectionStatus.id)} data-testid="button-accept-connection">
            Accept
          </Button>
          <Button size="sm" variant="outline" onClick={() => rejectMutation.mutate(connectionStatus.id)} data-testid="button-reject-connection">
            Decline
          </Button>
        </div>
      );
    }
    return (
      <Button variant="outline" size="sm" className="gap-2" onClick={() => connectMutation.mutate()} disabled={connectMutation.isPending} data-testid="button-connect">
        <UserPlus className="h-4 w-4" /> Connect
      </Button>
    );
  };

  return (
    <div className="container max-w-5xl mx-auto py-10 px-4 space-y-8">
      <Card className="overflow-hidden border-border/50">
        {/*
          * The cover photo. This used to be a hardcoded gradient, so a cover
          * set anywhere else in the app was stored and then never shown here —
          * which read as the upload having failed. The gradient is now the
          * fallback rather than the only option.
          */}
        <div
          className="h-32 bg-gradient-to-r from-primary/20 via-accent/20 to-primary/20 bg-cover bg-center"
          style={profile?.coverUrl ? { backgroundImage: `url(${profile.coverUrl})` } : undefined}
          data-testid="profile-cover"
        />
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
                  <Badge variant="outline" className="capitalize text-xs">{profile.experienceLevel}</Badge>
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
                  <span className="flex items-center gap-1"><MapPin className="h-4 w-4" />{profile.location}</span>
                )}
                {isOwnProfile && myConnections && (
                  <span className="flex items-center gap-1"><UsersIcon className="h-4 w-4" />{myConnections.length} connections</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isOwnProfile ? (
                <Dialog open={isEditing} onOpenChange={setIsEditing}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2" data-testid="button-edit-profile">
                      <Edit className="h-4 w-4" /> Edit Profile
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Edit Profile</DialogTitle>
                    </DialogHeader>
                    <Form {...form}>
                      <form onSubmit={form.handleSubmit(onUpdateProfile)} className="space-y-4 py-4">
                        {/*
                          * Pictures first — it's what people came into this
                          * dialog to change, and neither was editable here at
                          * all before. Both save on pick rather than waiting
                          * for the form's Save, so the header updates while
                          * the dialog is still open.
                          */}
                        <div className="grid grid-cols-2 gap-4">
                          <ImageUploadField
                            label="Profile photo"
                            value={profile?.avatarUrl}
                            onChange={(p) => imageMutation.mutate({ avatarUrl: p })}
                            hint="Square works best."
                            testId="upload-avatar"
                          />
                          <ImageUploadField
                            label="Cover photo"
                            value={profile?.coverUrl}
                            onChange={(p) => imageMutation.mutate({ coverUrl: p })}
                            aspect="wide"
                            hint="Wide banner behind your avatar."
                            testId="upload-cover"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <FormField control={form.control} name="displayName" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Full Name</FormLabel>
                              <FormControl><Input {...field} value={field.value || ''} data-testid="input-edit-display-name" /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                          <FormField control={form.control} name="username" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Username</FormLabel>
                              <FormControl><Input {...field} value={field.value || ''} data-testid="input-edit-username" /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                        </div>
                        <FormField control={form.control} name="headline" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Headline</FormLabel>
                            <FormControl><Input {...field} value={field.value || ''} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name="bio" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Bio</FormLabel>
                            <FormControl><Textarea className="min-h-[100px]" {...field} value={field.value || ''} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <div className="grid grid-cols-2 gap-4">
                          <FormField control={form.control} name="location" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Location</FormLabel>
                              <FormControl><Input {...field} value={field.value || ''} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                          <FormField control={form.control} name="websiteUrl" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Website</FormLabel>
                              <FormControl><Input {...field} value={field.value || ''} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <FormField control={form.control} name="githubUrl" render={({ field }) => (
                            <FormItem>
                              <FormLabel>GitHub URL</FormLabel>
                              <FormControl><Input {...field} value={field.value || ''} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                          <FormField control={form.control} name="linkedinUrl" render={({ field }) => (
                            <FormItem>
                              <FormLabel>LinkedIn URL</FormLabel>
                              <FormControl><Input {...field} value={field.value || ''} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                        </div>

                        <div className="border-t pt-4 mt-2">
                          <p className="text-sm font-medium mb-3">Co-Founder Preferences</p>
                          <div className="grid grid-cols-2 gap-4">
                            <FormField control={form.control} name="hoursPerWeek" render={({ field }) => (
                              <FormItem>
                                <FormLabel>Hours/Week</FormLabel>
                                <FormControl>
                                  <Input
                                    type="number"
                                    min={1}
                                    max={80}
                                    placeholder="e.g. 20"
                                    {...field}
                                    value={field.value ?? ""}
                                    onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                                    data-testid="input-edit-hours-per-week"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )} />
                            <FormField control={form.control} name="riskTolerance" render={({ field }) => (
                              <FormItem>
                                <FormLabel>Risk Tolerance</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value || undefined}>
                                  <FormControl>
                                    <SelectTrigger data-testid="select-edit-risk-tolerance">
                                      <SelectValue placeholder="Select" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="low">Low</SelectItem>
                                    <SelectItem value="moderate">Moderate</SelectItem>
                                    <SelectItem value="high">High</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )} />
                            <FormField control={form.control} name="speedVsPolish" render={({ field }) => (
                              <FormItem>
                                <FormLabel>Speed vs Polish</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value || undefined}>
                                  <FormControl>
                                    <SelectTrigger data-testid="select-edit-speed-vs-polish">
                                      <SelectValue placeholder="Select" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="speed">Speed First</SelectItem>
                                    <SelectItem value="balanced">Balanced</SelectItem>
                                    <SelectItem value="polish">Polish First</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )} />
                            <FormField control={form.control} name="scheduleStyle" render={({ field }) => (
                              <FormItem>
                                <FormLabel>Schedule Style</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value || undefined}>
                                  <FormControl>
                                    <SelectTrigger data-testid="select-edit-schedule-style">
                                      <SelectValue placeholder="Select" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="structured">Structured</SelectItem>
                                    <SelectItem value="flexible">Flexible</SelectItem>
                                    <SelectItem value="hybrid">Hybrid</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )} />
                            <FormField control={form.control} name="conflictStyle" render={({ field }) => (
                              <FormItem>
                                <FormLabel>Conflict Style</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value || undefined}>
                                  <FormControl>
                                    <SelectTrigger data-testid="select-edit-conflict-style">
                                      <SelectValue placeholder="Select" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="direct">Direct</SelectItem>
                                    <SelectItem value="diplomatic">Diplomatic</SelectItem>
                                    <SelectItem value="avoidant">Avoidant</SelectItem>
                                    <SelectItem value="collaborative">Collaborative</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )} />
                            <FormField control={form.control} name="builderType" render={({ field }) => (
                              <FormItem>
                                <FormLabel>Builder Type</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value || undefined}>
                                  <FormControl>
                                    <SelectTrigger data-testid="select-edit-builder-type">
                                      <SelectValue placeholder="Select" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="long-term">Long-Term</SelectItem>
                                    <SelectItem value="experimental">Experimenter</SelectItem>
                                    <SelectItem value="both">Both</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )} />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <FormLabel>Resume</FormLabel>
                          <div className="flex items-center gap-3">
                            {form.watch("resumeUrl") ? (
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <FileText className="h-4 w-4" />
                                <span>Resume uploaded</span>
                                <CheckCircle className="h-4 w-4 text-green-500" />
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground">No resume uploaded</p>
                            )}
                            <Button type="button" variant="outline" size="sm" onClick={() => resumeInputRef.current?.click()} disabled={isUploadingResume} data-testid="button-upload-resume">
                              {isUploadingResume ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1" />}
                              {form.watch("resumeUrl") ? "Replace" : "Upload"}
                            </Button>
                            <input ref={resumeInputRef} type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={handleResumeUpload} />
                          </div>
                          {isUploadingResume && (
                            <div className="w-full bg-muted rounded-full h-2">
                              <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
                            </div>
                          )}
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
                renderConnectionButton()
              )}
            </div>
          </div>
        </div>
      </Card>

      <Tabs defaultValue="about" className="space-y-6">
        <TabsList data-testid="profile-tabs">
          <TabsTrigger value="about" data-testid="tab-about">About</TabsTrigger>
          <TabsTrigger value="projects" data-testid="tab-projects">
            Projects {displayProjects.length > 0 && `(${displayProjects.length})`}
          </TabsTrigger>
          {isOwnProfile && (
            <TabsTrigger value="connections" data-testid="tab-connections">
              Connections {myConnections && myConnections.length > 0 && `(${myConnections.length})`}
              {connectionRequests && connectionRequests.length > 0 && (
                <Badge variant="destructive" className="ml-1 h-5 w-5 p-0 flex items-center justify-center text-[10px]">
                  {connectionRequests.length}
                </Badge>
              )}
            </TabsTrigger>
          )}
          {isOwnProfile && (
            <TabsTrigger value="following" data-testid="tab-following">
              Following {followedProjects && followedProjects.length > 0 && `(${followedProjects.length})`}
            </TabsTrigger>
          )}
          {isOwnProfile && (
            <TabsTrigger value="earnings" data-testid="tab-earnings">Earnings</TabsTrigger>
          )}
          {isOwnProfile && isSiteOwner && (
            <TabsTrigger value="behaviour" data-testid="tab-behaviour">Behaviour</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="about">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
            <div className="space-y-4">
              {/* The public ask sits at the top — it's the most actionable
                  thing on the page for whoever is reading it. */}
              <LookingForCard
                lookingFor={(profile as any)?.lookingFor || null}
                isOwnProfile={!!isOwnProfile}
              />

              {isOwnProfile && (
                <ProfileResumePanel
                  hasProfileContent={
                    ((profile as any)?.experience?.length || 0) > 0 ||
                    ((profile as any)?.education?.length || 0) > 0
                  }
                />
              )}

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

              {/* Résumé-derived credentials. Each card hides when empty. */}
              <ProfileCredentials
                novaSummary={(profile as any)?.novaSummary}
                experience={(profile as any)?.experience}
                education={(profile as any)?.education}
                portfolioProjects={(profile as any)?.portfolioProjects}
                skills={profile?.skills}
                resumeParsedAt={(profile as any)?.resumeParsedAt}
              />

              {(profile?.interests?.length || 0) > 0 && (
                <Card className="border-border/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold uppercase text-muted-foreground">Interests</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {profile!.interests!.map(i => (
                        <Badge key={i} variant="secondary" className="bg-accent/10 text-accent-foreground border-accent/20">{i}</Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {userBadges && userBadges.length > 0 && (
                <Card className="border-border/50">
                  <CardHeader>
                    <CardTitle className="text-sm font-semibold uppercase text-muted-foreground">Earned Badges</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-3">
                      {userBadges.map((ub) => {
                        const BADGE_ICONS: Record<string, typeof Award> = { rocket: Rocket, star: Star, trophy: Trophy, users: UsersIcon, sparkles: Sparkles, award: Award };
                        const RARITY_STYLES: Record<string, string> = {
                          common: "bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-600",
                          rare: "bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-600",
                          epic: "bg-purple-50 dark:bg-purple-900/30 border-purple-300 dark:border-purple-600",
                          legendary: "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-400 dark:border-yellow-500",
                        };
                        const IconComp = BADGE_ICONS[ub.badge.icon] || Award;
                        return (
                          <div key={ub.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${RARITY_STYLES[ub.badge.rarity]} transition-colors`} title={ub.badge.description} data-testid={`badge-earned-${ub.badge.id}`}>
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

              {/* Believer numbers and founding credit only work because
                  other people can see them. Renders nothing if they've
                  backed nobody. */}
              {userId && <BackerBadgeShowcase userId={userId} isOwnProfile={!!isOwnProfile} />}
              {userId && <BackerCredits userId={userId} isOwnProfile={!!isOwnProfile} />}
            </div>

            {/* Main column: posts first, then the projects they're building,
                then the Builder Index — the order someone actually judges a
                builder in. */}
            <div className="md:col-span-2 space-y-6">
              <section className="space-y-3">
                <h2 className="text-lg font-bold">
                  {isOwnProfile
                    ? "Your posts"
                    : `${(profile?.displayName || "This builder").split(" ")[0]}'s posts`}
                </h2>
                <ProfileFeed userId={userId!} isOwnProfile={!!isOwnProfile} />
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-bold">
                    {displayProjects.length > 0 ? "Building" : "Projects"}
                  </h2>
                  {isOwnProfile && (
                    <Button variant="ghost" size="sm" onClick={() => setLocation("/projects/new")} data-testid="button-new-project-about">
                      New project
                    </Button>
                  )}
                </div>
                {projectsLoading ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
                  </div>
                ) : displayProjects.length > 0 ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {displayProjects.slice(0, 4).map((project: any) => (
                      <ProjectCard key={project.id} project={project} />
                    ))}
                  </div>
                ) : (
                  <Card className="border-dashed border-border/50 bg-transparent py-8">
                    <CardContent className="flex flex-col items-center justify-center text-center space-y-2">
                      <p className="text-sm text-muted-foreground">
                        {isOwnProfile ? "You're not building anything yet." : "Nothing public yet."}
                      </p>
                      {isOwnProfile && (
                        <Button variant="outline" size="sm" onClick={() => setLocation("/projects/new")}>
                          Start your first project
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                )}
              </section>

              {userId && (
                <ReputationCard userId={userId} isOwnProfile={!!isOwnProfile} />
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="projects">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Projects</h2>
              {isOwnProfile && (
                <Button variant="ghost" size="sm" onClick={() => setLocation("/projects/new")} data-testid="button-new-project">
                  New Project
                </Button>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {projectsLoading ? (
                Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)
              ) : displayProjects.length > 0 ? (
                displayProjects.map((project: any) => (
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
        </TabsContent>

        {isOwnProfile && (
          <TabsContent value="connections">
            <div className="space-y-6">
              {connectionRequests && connectionRequests.length > 0 && (
                <Card className="border-border/50">
                  <CardHeader>
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      Pending Requests
                      <Badge variant="destructive" className="text-xs">{connectionRequests.length}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {connectionRequests.map(req => (
                      <div key={req.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50" data-testid={`connection-request-${req.id}`}>
                        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setLocation(`/profile/${req.user.id}`)}>
                          <UserAvatar src={req.profile?.avatarUrl} name={req.profile?.displayName || req.user.firstName || "User"} className="h-10 w-10" />
                          <div>
                            <p className="font-medium text-sm">{req.profile?.displayName || req.user.firstName || "User"}</p>
                            {req.profile?.headline && <p className="text-xs text-muted-foreground">{req.profile.headline}</p>}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => acceptMutation.mutate(req.id)} disabled={acceptMutation.isPending} data-testid={`button-accept-${req.id}`}>
                            Accept
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => rejectMutation.mutate(req.id)} disabled={rejectMutation.isPending} data-testid={`button-reject-${req.id}`}>
                            Decline
                          </Button>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">My Connections</h2>
                <div className="relative w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Search connections..." value={connectionSearch} onChange={e => setConnectionSearch(e.target.value)} className="pl-9" data-testid="input-search-connections" />
                </div>
              </div>

              {filteredConnections.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredConnections.map(conn => (
                    <Card key={conn.id} className="border-border/50" data-testid={`connection-card-${conn.user.id}`}>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="cursor-pointer" onClick={() => setLocation(`/profile/${conn.user.id}`)}>
                            <UserAvatar src={conn.profile?.avatarUrl} name={conn.profile?.displayName || conn.user.firstName || "User"} className="h-12 w-12" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate cursor-pointer hover:underline" onClick={() => setLocation(`/profile/${conn.user.id}`)}>
                              {conn.profile?.displayName || conn.user.firstName || "User"}
                            </p>
                            {conn.profile?.headline && <p className="text-xs text-muted-foreground truncate">{conn.profile.headline}</p>}
                          </div>
                        </div>
                        <div className="flex gap-2 mt-3">
                          <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => setLocation(`/messages?user=${conn.user.id}`)} data-testid={`button-message-${conn.user.id}`}>
                            <MessageSquare className="h-3 w-3" /> Message
                          </Button>
                          <Button size="sm" variant="ghost" className="gap-1 text-destructive hover:text-destructive" onClick={() => removeMutation.mutate(conn.id)} disabled={removeMutation.isPending} data-testid={`button-remove-${conn.user.id}`}>
                            <UserMinus className="h-3 w-3" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <Card className="border-dashed border-border/50 bg-transparent py-10">
                  <CardContent className="flex flex-col items-center justify-center text-center space-y-2">
                    <UsersIcon className="h-8 w-8 text-muted-foreground" />
                    <p className="text-muted-foreground">
                      {connectionSearch ? "No connections match your search." : "No connections yet."}
                    </p>
                    {!connectionSearch && (
                      <Button variant="outline" size="sm" onClick={() => setLocation("/discover")}>
                        Discover People
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>
        )}

        {isOwnProfile && (
          <TabsContent value="following">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Heart className="h-5 w-5" /> Projects You Follow
                </h2>
              </div>
              {followedProjects && followedProjects.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {followedProjects.map((follow: any) => (
                    <ProjectCard key={follow.project?.id || follow.id} project={follow.project || follow} />
                  ))}
                </div>
              ) : (
                <Card className="border-dashed border-border/50 bg-transparent py-10">
                  <CardContent className="flex flex-col items-center justify-center text-center space-y-2">
                    <Heart className="h-8 w-8 text-muted-foreground" />
                    <p className="text-muted-foreground">You haven't followed any projects yet.</p>
                    <Button variant="outline" size="sm" onClick={() => setLocation("/discover")}>
                      Discover Projects
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>
        )}

        {/*
          * Sits beside Earnings because that's where the owner already comes to
          * see how the site is doing. The numbers here are a glance; the live
          * feed and the visit trails are a page of their own.
          */}
        {isOwnProfile && isSiteOwner && (
          <TabsContent value="behaviour">
            <Card className="border-border/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5" /> Behaviour
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex flex-wrap items-baseline gap-8">
                  <div>
                    <p className="text-3xl font-bold tabular-nums" data-testid="text-online-now">
                      {analyticsPeek?.onlineNow ?? "—"}
                    </p>
                    <p className="text-sm text-muted-foreground">On the site right now</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold tabular-nums">
                      {analyticsPeek?.totals?.visitors ?? "—"}
                    </p>
                    <p className="text-sm text-muted-foreground">People this week</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold tabular-nums">
                      {analyticsPeek?.totals?.actions ?? "—"}
                    </p>
                    <p className="text-sm text-muted-foreground">Actions taken</p>
                  </div>
                </div>

                <Button onClick={() => setLocation("/admin/analytics")} data-testid="button-open-analytics">
                  Open the live console <ExternalLink className="h-4 w-4 ml-2" />
                </Button>

                <p className="text-xs text-muted-foreground">
                  Only this account can see any of this. Page views and actions are recorded —
                  never the contents of what anyone writes.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {isOwnProfile && (
          <TabsContent value="earnings">
            <div className="space-y-6">
              <Card className="border-border/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <DollarSign className="h-5 w-5" /> Donation Earnings
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-8">
                    <div>
                      <p className="text-3xl font-bold" data-testid="text-total-earnings">
                        ${((payoutInfo?.totalEarnings || 0) / 100).toFixed(2)}
                      </p>
                      <p className="text-sm text-muted-foreground">Total earned from donations</p>
                    </div>
                    <div>
                      <p className="text-lg font-semibold">{payoutInfo?.donations?.length || 0}</p>
                      <p className="text-sm text-muted-foreground">Donations received</p>
                    </div>
                  </div>

                  {!payoutInfo?.connectAccountId ? (
                    <div className="p-4 border border-dashed border-border rounded-lg space-y-3">
                      <p className="text-sm font-medium">Connect your bank account to receive payouts</p>
                      <p className="text-xs text-muted-foreground">Set up a Stripe Connect account to securely receive donation payouts directly to your bank account or card.</p>
                      <Button onClick={() => connectAccountMutation.mutate()} disabled={connectAccountMutation.isPending} data-testid="button-connect-bank">
                        {connectAccountMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                        Connect Bank Account
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      <Button variant="outline" onClick={async () => {
                        const res = await fetch("/api/stripe/connect-dashboard", { credentials: "include" });
                        const data = await res.json();
                        if (data.url) window.open(data.url, "_blank");
                      }} data-testid="button-stripe-dashboard">
                        <ExternalLink className="h-4 w-4 mr-2" /> Stripe Dashboard
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {payoutInfo?.donations && payoutInfo.donations.length > 0 && (
                <Card className="border-border/50">
                  <CardHeader>
                    <CardTitle className="text-sm font-semibold uppercase text-muted-foreground">Recent Donations</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {payoutInfo.donations.slice(0, 10).map((d: any) => (
                        <div key={d.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                          <div>
                            <p className="text-sm font-medium">${(d.amount / 100).toFixed(2)}</p>
                            {d.message && <p className="text-xs text-muted-foreground">{d.message}</p>}
                          </div>
                          <p className="text-xs text-muted-foreground">{new Date(d.createdAt).toLocaleDateString()}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
