import { useState } from "react";
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
import { X, Plus, Github, Linkedin, Globe, MapPin, Loader2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";

const STEPS = [
  "Basic Info",
  "Skills",
  "Interests",
  "Experience",
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

  const form = useForm<InsertUserProfile>({
    resolver: zodResolver(insertUserProfileSchema),
    defaultValues: {
      userId: "", // Will be handled by backend, but needed for schema
      headline: "",
      bio: "",
      location: "",
      skills: [],
      interests: [],
      experienceLevel: "beginner",
      githubUrl: "",
      linkedinUrl: "",
      websiteUrl: "",
      isOnboarded: false,
    },
  });

  const skills = form.watch("skills") || [];
  const interests = form.watch("interests") || [];

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

  const next = async () => {
    const fieldsToValidate: (keyof InsertUserProfile)[] = [];
    if (step === 0) fieldsToValidate.push("headline", "bio", "location");
    if (step === 4) fieldsToValidate.push("githubUrl", "linkedinUrl", "websiteUrl");

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
    <div className="container max-w-2xl mx-auto py-10 px-4 min-h-screen flex flex-col justify-center">
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
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ x: 20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -20, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <Card className="border-border/50">
                <CardHeader>
                  <CardTitle>{STEPS[step]}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {step === 0 && (
                    <>
                      <FormField
                        control={form.control}
                        name="headline"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Professional Headline</FormLabel>
                            <FormControl>
                              <Input placeholder="Full Stack Developer | AI Enthusiast" {...field} value={field.value || ''} data-testid="input-headline" />
                            </FormControl>
                            <FormDescription>A short summary of who you are.</FormDescription>
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

                  {step === 5 && (
                    <div className="space-y-6">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground uppercase">Headline</Label>
                          <p className="font-medium">{form.getValues("headline") || "Not set"}</p>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground uppercase">Location</Label>
                          <p className="font-medium">{form.getValues("location") || "Not set"}</p>
                        </div>
                        <div className="space-y-1 col-span-2">
                          <Label className="text-xs text-muted-foreground uppercase">Bio</Label>
                          <p className="text-sm line-clamp-3">{form.getValues("bio") || "Not set"}</p>
                        </div>
                        <div className="space-y-1 col-span-2">
                          <Label className="text-xs text-muted-foreground uppercase">Experience</Label>
                          <Badge variant="outline" className="capitalize">{form.getValues("experienceLevel")}</Badge>
                        </div>
                        <div className="space-y-1 col-span-2">
                          <Label className="text-xs text-muted-foreground uppercase">Skills</Label>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {skills.map(s => <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>)}
                          </div>
                        </div>
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
            </motion.div>
          </AnimatePresence>
        </form>
      </Form>
    </div>
  );
}
