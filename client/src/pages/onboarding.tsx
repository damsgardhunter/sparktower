import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertUserProfileSchema, type InsertUserProfile } from "@shared/schema";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Plus, Github, Linkedin, Globe, MapPin, Loader2, Upload, FileText, CheckCircle, Clock, Zap, Shield, Users, Handshake } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUpload } from "@/hooks/use-upload";

const STEPS = [
  "Basic Info",
  "Skills",
  "Interests",
  "Experience",
  "Co-Founder Preferences",
  "Resume",
  "Links",
  "Review"
];

const COMMON_SKILLS = [
  "React", "TypeScript", "Node.js", "Python", "Go", "Rust", "Next.js", "Tailwind CSS",
  "PostgreSQL", "MongoDB", "AWS", "Docker", "Kubernetes", "GraphQL", "Figma"
];

const COMMON_INTERESTS = [
  "Entrepreneurship", "Web Development", "Mobile Apps", "AI/ML", "Fintech", "Healthtech",
  "SaaS", "Open Source", "Game Dev", "Blockchain"
];

export default function Onboarding() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resumeFileName, setResumeFileName] = useState("");
  const resumeInputRef = useRef<HTMLInputElement>(null);

  const { uploadFile, isUploading: isUploadingResume, progress: uploadProgress } = useUpload({
    onSuccess: (response) => {
      form.setValue("resumeUrl", `/objects/${response.objectPath}`);
      toast({ title: "Resume uploaded", description: "Your resume has been uploaded successfully." });
    },
    onError: (error) => {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
  });

  const form = useForm<InsertUserProfile>({
    resolver: zodResolver(insertUserProfileSchema),
    defaultValues: {
      userId: "",
      displayName: "",
      username: "",
      headline: "",
      bio: "",
      location: "",
      skills: [],
      interests: [],
      experienceLevel: "beginner",
      hoursPerWeek: undefined,
      riskTolerance: undefined,
      speedVsPolish: undefined,
      scheduleStyle: undefined,
      conflictStyle: undefined,
      builderType: undefined,
      resumeUrl: "",
      githubUrl: "",
      linkedinUrl: "",
      websiteUrl: "",
      isOnboarded: false,
    },
  });

  const skills = form.watch("skills") || [];
  const interests = form.watch("interests") || [];
  const resumeUrl = form.watch("resumeUrl");

  const addSkill = (skill: string) => {
    if (!skills.includes(skill)) {
      form.setValue("skills", [...skills, skill]);
    }
  };

  const removeSkill = (skill: string) => {
    form.setValue("skills", skills.filter((s) => s !== skill));
  };

  const addInterest = (interest: string) => {
    if (!interests.includes(interest)) {
      form.setValue("interests", [...interests, interest]);
    }
  };

  const removeInterest = (interest: string) => {
    form.setValue("interests", interests.filter((i) => i !== interest));
  };

  const handleResumeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setResumeFileName(file.name);
    await uploadFile(file);
  };

  const next = async () => {
    const fieldsToValidate: (keyof InsertUserProfile)[] = [];
    if (step === 0) fieldsToValidate.push("displayName", "bio", "location");
    if (step === 6) fieldsToValidate.push("githubUrl", "linkedinUrl", "websiteUrl");

    if (fieldsToValidate.length > 0) {
      const isValid = await form.trigger(fieldsToValidate);
      if (!isValid) return;
    }

    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const prev = () => setStep((s) => Math.max(s - 1, 0));

  const onSubmit = async (data: InsertUserProfile) => {
    setIsSubmitting(true);
    try {
      await apiRequest("POST", "/api/profile", data);
      await apiRequest("POST", "/api/profile/complete-onboarding");

      queryClient.invalidateQueries({ queryKey: ["/api/profile"] });

      toast({
        title: "Welcome to SparkTower!",
        description: "Your profile has been set up successfully.",
      });

      setLocation("/");
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to complete onboarding",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const progress = ((step + 1) / STEPS.length) * 100;

  return (
    <div className="h-full overflow-y-auto">
      <div className="container max-w-2xl mx-auto py-10 px-4">
        <div className="mb-8 space-y-2">
          <h1 className="text-3xl font-bold text-center">Complete Your Profile</h1>
          <p className="text-muted-foreground text-center">Let's get you ready to connect and collaborate.</p>
          <div className="pt-4">
            <Progress value={progress} className="h-2" data-testid="progress-onboarding" />
            <div className="flex justify-between mt-2 text-sm text-muted-foreground">
              <span>Step {step + 1} of {STEPS.length}: {STEPS[step]}</span>
              <span>{Math.round(progress)}%</span>
            </div>
          </div>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <Card className="border-border/50">
              <CardHeader>
                <CardTitle>{STEPS[step]}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {step === 0 && (
                  <>
                    <FormField
                      control={form.control}
                      name="displayName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Full Name</FormLabel>
                          <FormControl>
                            <Input placeholder="John Doe" {...field} value={field.value || ''} data-testid="input-display-name" />
                          </FormControl>
                          <FormDescription>This will be displayed on your profile.</FormDescription>
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
                            <Input placeholder="johndoe" {...field} value={field.value || ''} data-testid="input-username" />
                          </FormControl>
                          <FormDescription>Choose a username. Use this if you prefer to stay anonymous.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="headline"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Professional Headline</FormLabel>
                          <FormControl>
                            <Input placeholder="Full Stack Developer | AI Enthusiast" {...field} value={field.value || ''} data-testid="input-headline" />
                          </FormControl>
                          <FormDescription>A short tagline about what you do.</FormDescription>
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
                            <Textarea
                              placeholder="Tell us about your background and what you're looking for..."
                              className="min-h-[120px] resize-none"
                              {...field}
                              value={field.value || ''}
                              data-testid="input-bio"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="location"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Location</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input className="pl-9" placeholder="San Francisco, CA" {...field} value={field.value || ''} data-testid="input-location" />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                )}

                {step === 1 && (
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-2 mb-4">
                      {skills.map((s) => (
                        <Badge key={s} variant="secondary" className="flex items-center gap-1 py-1" data-testid={`badge-skill-${s}`}>
                          {s}
                          <button type="button" onClick={() => removeSkill(s)} className="hover:text-destructive">
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                      {skills.length === 0 && <p className="text-sm text-muted-foreground">No skills added yet.</p>}
                    </div>
                    <div className="space-y-2">
                      <Label>Common Skills</Label>
                      <div className="flex flex-wrap gap-2">
                        {COMMON_SKILLS.filter(s => !skills.includes(s)).map((s) => (
                          <Button
                            key={s}
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => addSkill(s)}
                            className="rounded-full"
                            data-testid={`button-add-skill-${s}`}
                          >
                            <Plus className="h-3 w-3 mr-1" /> {s}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <div className="pt-2">
                      <Label htmlFor="custom-skill">Add Custom Skill</Label>
                      <div className="flex gap-2 mt-1">
                        <Input id="custom-skill" placeholder="e.g. Solidity" className="h-9" onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const val = e.currentTarget.value.trim();
                            if (val) {
                              addSkill(val);
                              e.currentTarget.value = '';
                            }
                          }
                        }} data-testid="input-custom-skill" />
                      </div>
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-2 mb-4">
                      {interests.map((i) => (
                        <Badge key={i} variant="secondary" className="flex items-center gap-1 py-1" data-testid={`badge-interest-${i}`}>
                          {i}
                          <button type="button" onClick={() => removeInterest(i)} className="hover:text-destructive">
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                      {interests.length === 0 && <p className="text-sm text-muted-foreground">No interests added yet.</p>}
                    </div>
                    <div className="space-y-2">
                      <Label>Common Interests</Label>
                      <div className="flex flex-wrap gap-2">
                        {COMMON_INTERESTS.filter(i => !interests.includes(i)).map((i) => (
                          <Button
                            key={i}
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => addInterest(i)}
                            className="rounded-full"
                            data-testid={`button-add-interest-${i}`}
                          >
                            <Plus className="h-3 w-3 mr-1" /> {i}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {step === 3 && (
                  <FormField
                    control={form.control}
                    name="experienceLevel"
                    render={({ field }) => (
                      <FormItem className="space-y-3">
                        <FormControl>
                          <RadioGroup
                            onValueChange={field.onChange}
                            defaultValue={field.value || undefined}
                            className="grid grid-cols-1 gap-4"
                          >
                            <FormItem className="flex items-center space-x-3 space-y-0 p-4 border rounded-md cursor-pointer hover:bg-accent/50 transition-colors">
                              <FormControl>
                                <RadioGroupItem value="beginner" data-testid="radio-exp-beginner" />
                              </FormControl>
                              <div className="space-y-1">
                                <FormLabel className="font-medium">Beginner</FormLabel>
                                <p className="text-sm text-muted-foreground">Just starting out, eager to learn and contribute.</p>
                              </div>
                            </FormItem>
                            <FormItem className="flex items-center space-x-3 space-y-0 p-4 border rounded-md cursor-pointer hover:bg-accent/50 transition-colors">
                              <FormControl>
                                <RadioGroupItem value="intermediate" data-testid="radio-exp-intermediate" />
                              </FormControl>
                              <div className="space-y-1">
                                <FormLabel className="font-medium">Intermediate</FormLabel>
                                <p className="text-sm text-muted-foreground">Comfortable with core concepts and has some project experience.</p>
                              </div>
                            </FormItem>
                            <FormItem className="flex items-center space-x-3 space-y-0 p-4 border rounded-md cursor-pointer hover:bg-accent/50 transition-colors">
                              <FormControl>
                                <RadioGroupItem value="expert" data-testid="radio-exp-expert" />
                              </FormControl>
                              <div className="space-y-1">
                                <FormLabel className="font-medium">Expert</FormLabel>
                                <p className="text-sm text-muted-foreground">Deep technical knowledge and significant experience leading projects.</p>
                              </div>
                            </FormItem>
                          </RadioGroup>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {step === 4 && (
                  <div className="space-y-5">
                    <p className="text-sm text-muted-foreground">
                      These preferences help us find your ideal co-founder match. All fields are optional.
                    </p>

                    <FormField
                      control={form.control}
                      name="hoursPerWeek"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Hours per Week</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min={1}
                              max={80}
                              placeholder="e.g. 20"
                              {...field}
                              value={field.value ?? ""}
                              onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                              data-testid="input-hours-per-week"
                            />
                          </FormControl>
                          <FormDescription>How many hours per week can you dedicate to a co-founder project?</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="riskTolerance"
                      render={({ field }) => (
                        <FormItem className="space-y-3">
                          <FormLabel>Risk Tolerance</FormLabel>
                          <FormControl>
                            <RadioGroup
                              onValueChange={field.onChange}
                              value={field.value || undefined}
                              className="grid grid-cols-1 gap-3"
                            >
                              <FormItem className="flex items-start space-x-3 space-y-0 p-3 border rounded-md cursor-pointer hover:bg-accent/50 transition-colors">
                                <FormControl>
                                  <RadioGroupItem value="low" data-testid="radio-risk-low" />
                                </FormControl>
                                <div className="space-y-0.5">
                                  <FormLabel className="font-medium">Low Risk</FormLabel>
                                  <p className="text-xs text-muted-foreground">Prefer proven ideas with stable revenue potential. Cautious approach.</p>
                                </div>
                              </FormItem>
                              <FormItem className="flex items-start space-x-3 space-y-0 p-3 border rounded-md cursor-pointer hover:bg-accent/50 transition-colors">
                                <FormControl>
                                  <RadioGroupItem value="moderate" data-testid="radio-risk-moderate" />
                                </FormControl>
                                <div className="space-y-0.5">
                                  <FormLabel className="font-medium">Moderate Risk</FormLabel>
                                  <p className="text-xs text-muted-foreground">Open to some uncertainty with calculated bets. Balanced approach.</p>
                                </div>
                              </FormItem>
                              <FormItem className="flex items-start space-x-3 space-y-0 p-3 border rounded-md cursor-pointer hover:bg-accent/50 transition-colors">
                                <FormControl>
                                  <RadioGroupItem value="high" data-testid="radio-risk-high" />
                                </FormControl>
                                <div className="space-y-0.5">
                                  <FormLabel className="font-medium">High Risk</FormLabel>
                                  <p className="text-xs text-muted-foreground">Comfortable with moonshots and high-uncertainty ventures. Bold approach.</p>
                                </div>
                              </FormItem>
                            </RadioGroup>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="speedVsPolish"
                      render={({ field }) => (
                        <FormItem className="space-y-3">
                          <FormLabel>Speed vs Polish</FormLabel>
                          <FormControl>
                            <RadioGroup
                              onValueChange={field.onChange}
                              value={field.value || undefined}
                              className="grid grid-cols-1 gap-3"
                            >
                              <FormItem className="flex items-start space-x-3 space-y-0 p-3 border rounded-md cursor-pointer hover:bg-accent/50 transition-colors">
                                <FormControl>
                                  <RadioGroupItem value="speed" data-testid="radio-speed-speed" />
                                </FormControl>
                                <div className="space-y-0.5">
                                  <FormLabel className="font-medium">Speed First</FormLabel>
                                  <p className="text-xs text-muted-foreground">Ship fast, iterate later. Get feedback early even if rough.</p>
                                </div>
                              </FormItem>
                              <FormItem className="flex items-start space-x-3 space-y-0 p-3 border rounded-md cursor-pointer hover:bg-accent/50 transition-colors">
                                <FormControl>
                                  <RadioGroupItem value="balanced" data-testid="radio-speed-balanced" />
                                </FormControl>
                                <div className="space-y-0.5">
                                  <FormLabel className="font-medium">Balanced</FormLabel>
                                  <p className="text-xs text-muted-foreground">Move quickly but maintain reasonable quality standards.</p>
                                </div>
                              </FormItem>
                              <FormItem className="flex items-start space-x-3 space-y-0 p-3 border rounded-md cursor-pointer hover:bg-accent/50 transition-colors">
                                <FormControl>
                                  <RadioGroupItem value="polish" data-testid="radio-speed-polish" />
                                </FormControl>
                                <div className="space-y-0.5">
                                  <FormLabel className="font-medium">Polish First</FormLabel>
                                  <p className="text-xs text-muted-foreground">Take time to get it right. Quality over speed.</p>
                                </div>
                              </FormItem>
                            </RadioGroup>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="scheduleStyle"
                      render={({ field }) => (
                        <FormItem className="space-y-3">
                          <FormLabel>Schedule Style</FormLabel>
                          <FormControl>
                            <RadioGroup
                              onValueChange={field.onChange}
                              value={field.value || undefined}
                              className="grid grid-cols-1 gap-3"
                            >
                              <FormItem className="flex items-start space-x-3 space-y-0 p-3 border rounded-md cursor-pointer hover:bg-accent/50 transition-colors">
                                <FormControl>
                                  <RadioGroupItem value="structured" data-testid="radio-schedule-structured" />
                                </FormControl>
                                <div className="space-y-0.5">
                                  <FormLabel className="font-medium">Structured</FormLabel>
                                  <p className="text-xs text-muted-foreground">Fixed daily/weekly schedule. Clear deadlines and milestones.</p>
                                </div>
                              </FormItem>
                              <FormItem className="flex items-start space-x-3 space-y-0 p-3 border rounded-md cursor-pointer hover:bg-accent/50 transition-colors">
                                <FormControl>
                                  <RadioGroupItem value="flexible" data-testid="radio-schedule-flexible" />
                                </FormControl>
                                <div className="space-y-0.5">
                                  <FormLabel className="font-medium">Flexible</FormLabel>
                                  <p className="text-xs text-muted-foreground">Work when inspired. Async-first communication style.</p>
                                </div>
                              </FormItem>
                              <FormItem className="flex items-start space-x-3 space-y-0 p-3 border rounded-md cursor-pointer hover:bg-accent/50 transition-colors">
                                <FormControl>
                                  <RadioGroupItem value="hybrid" data-testid="radio-schedule-hybrid" />
                                </FormControl>
                                <div className="space-y-0.5">
                                  <FormLabel className="font-medium">Hybrid</FormLabel>
                                  <p className="text-xs text-muted-foreground">Some scheduled check-ins, but flexible work hours.</p>
                                </div>
                              </FormItem>
                            </RadioGroup>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="conflictStyle"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Conflict Resolution Style</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || undefined}>
                            <FormControl>
                              <SelectTrigger data-testid="select-conflict-style">
                                <SelectValue placeholder="Select your conflict style" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="direct" data-testid="option-conflict-direct">
                                Direct — Address issues head-on with honest feedback
                              </SelectItem>
                              <SelectItem value="diplomatic" data-testid="option-conflict-diplomatic">
                                Diplomatic — Navigate disagreements with tact and empathy
                              </SelectItem>
                              <SelectItem value="avoidant" data-testid="option-conflict-avoidant">
                                Avoidant — Prefer to step back and let things cool down
                              </SelectItem>
                              <SelectItem value="collaborative" data-testid="option-conflict-collaborative">
                                Collaborative — Work through issues together as a team
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <FormDescription>How do you prefer to handle disagreements with a partner?</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="builderType"
                      render={({ field }) => (
                        <FormItem className="space-y-3">
                          <FormLabel>Builder Type</FormLabel>
                          <FormControl>
                            <RadioGroup
                              onValueChange={field.onChange}
                              value={field.value || undefined}
                              className="grid grid-cols-1 gap-3"
                            >
                              <FormItem className="flex items-start space-x-3 space-y-0 p-3 border rounded-md cursor-pointer hover:bg-accent/50 transition-colors">
                                <FormControl>
                                  <RadioGroupItem value="long-term" data-testid="radio-builder-longterm" />
                                </FormControl>
                                <div className="space-y-0.5">
                                  <FormLabel className="font-medium">Long-Term Builder</FormLabel>
                                  <p className="text-xs text-muted-foreground">Committed to growing a product over months or years.</p>
                                </div>
                              </FormItem>
                              <FormItem className="flex items-start space-x-3 space-y-0 p-3 border rounded-md cursor-pointer hover:bg-accent/50 transition-colors">
                                <FormControl>
                                  <RadioGroupItem value="experimental" data-testid="radio-builder-experimental" />
                                </FormControl>
                                <div className="space-y-0.5">
                                  <FormLabel className="font-medium">Experimenter</FormLabel>
                                  <p className="text-xs text-muted-foreground">Love trying new ideas quickly. Build, test, move on.</p>
                                </div>
                              </FormItem>
                              <FormItem className="flex items-start space-x-3 space-y-0 p-3 border rounded-md cursor-pointer hover:bg-accent/50 transition-colors">
                                <FormControl>
                                  <RadioGroupItem value="both" data-testid="radio-builder-both" />
                                </FormControl>
                                <div className="space-y-0.5">
                                  <FormLabel className="font-medium">Both</FormLabel>
                                  <p className="text-xs text-muted-foreground">Happy with either approach depending on the project.</p>
                                </div>
                              </FormItem>
                            </RadioGroup>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                {step === 5 && (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Upload your resume so collaborators and project leads can learn more about your background. Accepted formats: PDF, DOC, DOCX.
                    </p>
                    <input
                      ref={resumeInputRef}
                      type="file"
                      accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      onChange={handleResumeUpload}
                      className="hidden"
                      data-testid="input-resume-file"
                    />
                    {resumeUrl ? (
                      <div className="flex items-center gap-3 p-4 border border-emerald-500/30 rounded-md bg-emerald-50 dark:bg-emerald-950/20">
                        <CheckCircle className="h-5 w-5 text-emerald-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{resumeFileName || "Resume uploaded"}</p>
                          <p className="text-xs text-muted-foreground">Your resume has been uploaded successfully.</p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            form.setValue("resumeUrl", "");
                            setResumeFileName("");
                          }}
                          data-testid="button-remove-resume"
                        >
                          Remove
                        </Button>
                      </div>
                    ) : (
                      <div
                        className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                        onClick={() => resumeInputRef.current?.click()}
                        data-testid="button-upload-resume"
                      >
                        {isUploadingResume ? (
                          <div className="space-y-2">
                            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                            <p className="text-sm text-muted-foreground">Uploading... {uploadProgress}%</p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <FileText className="h-8 w-8 mx-auto text-muted-foreground" />
                            <p className="text-sm font-medium">Click to upload your resume</p>
                            <p className="text-xs text-muted-foreground">PDF, DOC, or DOCX up to 10MB</p>
                          </div>
                        )}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground italic">
                      This step is optional — you can always upload or update your resume later.
                    </p>
                  </div>
                )}

                {step === 6 && (
                  <div className="space-y-4">
                    <FormField
                      control={form.control}
                      name="githubUrl"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>GitHub URL</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Github className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input className="pl-9" placeholder="https://github.com/username" {...field} value={field.value || ''} data-testid="input-github" />
                            </div>
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
                            <div className="relative">
                              <Linkedin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input className="pl-9" placeholder="https://linkedin.com/in/username" {...field} value={field.value || ''} data-testid="input-linkedin" />
                            </div>
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
                          <FormLabel>Personal Website</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input className="pl-9" placeholder="https://example.com" {...field} value={field.value || ''} data-testid="input-website" />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                {step === 7 && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground uppercase">Name</Label>
                        <p className="font-medium">{form.getValues("displayName") || "Not set"}</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground uppercase">Username</Label>
                        <p className="font-medium">{form.getValues("username") ? `@${form.getValues("username")}` : "Not set"}</p>
                      </div>
                      <div className="space-y-1 col-span-2">
                        <Label className="text-xs text-muted-foreground uppercase">Headline</Label>
                        <p className="text-sm">{form.getValues("headline") || "Not set"}</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground uppercase">Location</Label>
                        <p className="font-medium">{form.getValues("location") || "Not set"}</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground uppercase">Experience</Label>
                        <Badge variant="outline" className="capitalize">{form.getValues("experienceLevel")}</Badge>
                      </div>
                      <div className="space-y-1 col-span-2">
                        <Label className="text-xs text-muted-foreground uppercase">Bio</Label>
                        <p className="text-sm line-clamp-3">{form.getValues("bio") || "Not set"}</p>
                      </div>
                      <div className="space-y-1 col-span-2">
                        <Label className="text-xs text-muted-foreground uppercase">Skills</Label>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {skills.length > 0 ? skills.map(s => <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>) : <p className="text-sm text-muted-foreground">None</p>}
                        </div>
                      </div>
                      {resumeUrl && (
                        <div className="space-y-1 col-span-2">
                          <Label className="text-xs text-muted-foreground uppercase">Resume</Label>
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-emerald-500" />
                            <span className="text-sm">{resumeFileName || "Uploaded"}</span>
                          </div>
                        </div>
                      )}
                      {(form.getValues("riskTolerance") || form.getValues("scheduleStyle") || form.getValues("hoursPerWeek")) && (
                        <>
                          <div className="col-span-2 pt-2">
                            <Label className="text-xs text-muted-foreground uppercase">Co-Founder Preferences</Label>
                          </div>
                          {form.getValues("hoursPerWeek") && (
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Hours/Week</Label>
                              <p className="text-sm">{form.getValues("hoursPerWeek")}h</p>
                            </div>
                          )}
                          {form.getValues("riskTolerance") && (
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Risk Tolerance</Label>
                              <Badge variant="outline" className="capitalize">{form.getValues("riskTolerance")}</Badge>
                            </div>
                          )}
                          {form.getValues("speedVsPolish") && (
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Speed vs Polish</Label>
                              <Badge variant="outline" className="capitalize">{form.getValues("speedVsPolish")}</Badge>
                            </div>
                          )}
                          {form.getValues("scheduleStyle") && (
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Schedule</Label>
                              <Badge variant="outline" className="capitalize">{form.getValues("scheduleStyle")}</Badge>
                            </div>
                          )}
                          {form.getValues("conflictStyle") && (
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Conflict Style</Label>
                              <Badge variant="outline" className="capitalize">{form.getValues("conflictStyle")}</Badge>
                            </div>
                          )}
                          {form.getValues("builderType") && (
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Builder Type</Label>
                              <Badge variant="outline" className="capitalize">{form.getValues("builderType")}</Badge>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
              <CardFooter className="flex justify-between gap-4">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={prev}
                  disabled={step === 0 || isSubmitting}
                  data-testid="button-prev"
                >
                  Back
                </Button>
                {step === STEPS.length - 1 ? (
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="bg-primary hover:bg-primary/90"
                    data-testid="button-submit-onboarding"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Completing...
                      </>
                    ) : (
                      "Complete Profile"
                    )}
                  </Button>
                ) : (
                  <Button type="button" onClick={next} data-testid="button-next">
                    Next Step
                  </Button>
                )}
              </CardFooter>
            </Card>
          </form>
        </Form>
      </div>
    </div>
  );
}
