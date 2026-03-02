import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Loader2, Plus, Trash2, CheckSquare, Square, FileText,
  DollarSign, BarChart3, Shield, Rocket, Headphones, Beaker,
  MessageSquare, Users, Star, Clock, AlertTriangle, CheckCircle2,
  X, Edit, Eye, Search,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function useCrudQuery<T>(projectId: string, endpoint: string) {
  return useQuery<T[]>({
    queryKey: ["/api/projects", projectId, endpoint],
  });
}

function useCrudMutations(projectId: string, endpoint: string) {
  const { toast } = useToast();
  const key = ["/api/projects", projectId, endpoint];

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/${endpoint}`, data);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    onError: () => toast({ title: "Failed to create", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await apiRequest("PATCH", `/api/projects/${projectId}/${endpoint}/${id}`, data);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    onError: () => toast({ title: "Failed to update", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/projects/${projectId}/${endpoint}/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  return { createMutation, updateMutation, deleteMutation };
}

const STATUS_COLORS: Record<string, string> = {
  planned: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  running: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  completed: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  draft: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  review: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  final: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  open: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  "in-progress": "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  resolved: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  closed: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  implemented: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  verified: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
};

export function ResearchTab({ projectId }: { projectId: string }) {
  const [activeSection, setActiveSection] = useState<"interviews" | "experiments">("interviews");
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="space-y-4" data-testid="research-tab">
      <div className="flex items-center gap-2 mb-4">
        <Button variant={activeSection === "interviews" ? "default" : "outline"} size="sm" onClick={() => setActiveSection("interviews")} data-testid="btn-interviews-section">
          <Users className="h-4 w-4 mr-1" /> Interviews
        </Button>
        <Button variant={activeSection === "experiments" ? "default" : "outline"} size="sm" onClick={() => setActiveSection("experiments")} data-testid="btn-experiments-section">
          <Beaker className="h-4 w-4 mr-1" /> Experiments
        </Button>
      </div>
      {activeSection === "interviews" ? (
        <InterviewsSection projectId={projectId} />
      ) : (
        <ExperimentsSection projectId={projectId} />
      )}
    </div>
  );
}

function InterviewsSection({ projectId }: { projectId: string }) {
  const { data: interviews, isLoading } = useCrudQuery<any>(projectId, "interviews");
  const { createMutation, updateMutation, deleteMutation } = useCrudMutations(projectId, "interviews");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ intervieweeName: "", intervieweeRole: "", notes: "", keyInsights: "", sentiment: "neutral", status: "planned" });

  const handleCreate = () => {
    createMutation.mutate(form, { onSuccess: () => { setDialogOpen(false); setForm({ intervieweeName: "", intervieweeRole: "", notes: "", keyInsights: "", sentiment: "neutral", status: "planned" }); } });
  };

  const sentimentIcon = (s: string) => s === "positive" ? "text-green-500" : s === "negative" ? "text-red-500" : "text-gray-500";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Customer Interviews</h3>
        <Button size="sm" onClick={() => setDialogOpen(true)} data-testid="btn-add-interview"><Plus className="h-4 w-4 mr-1" /> Add Interview</Button>
      </div>
      {isLoading ? <Loader2 className="h-6 w-6 animate-spin mx-auto" /> : !interviews?.length ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground"><Users className="h-10 w-10 mx-auto mb-2 opacity-30" /><p>No interviews yet. Start talking to customers!</p></CardContent></Card>
      ) : (
        <div className="space-y-3">
          {interviews.map((iv: any) => (
            <Card key={iv.id} data-testid={`interview-${iv.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium">{iv.intervieweeName}</span>
                      {iv.intervieweeRole && <Badge variant="secondary" className="text-xs">{iv.intervieweeRole}</Badge>}
                      <Badge className={`text-xs ${STATUS_COLORS[iv.status] || ""}`}>{iv.status}</Badge>
                    </div>
                    {iv.notes && <p className="text-sm text-muted-foreground mt-1">{iv.notes}</p>}
                    {iv.keyInsights && <p className="text-sm mt-2 font-medium text-primary">{iv.keyInsights}</p>}
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => updateMutation.mutate({ id: iv.id, data: { status: iv.status === "planned" ? "completed" : "planned" } })}>
                      {iv.status === "completed" ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Clock className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteMutation.mutate(iv.id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Interview</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={form.intervieweeName} onChange={e => setForm({ ...form, intervieweeName: e.target.value })} data-testid="input-interviewee-name" /></div>
            <div><Label>Role</Label><Input value={form.intervieweeRole} onChange={e => setForm({ ...form, intervieweeRole: e.target.value })} data-testid="input-interviewee-role" /></div>
            <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} data-testid="input-interview-notes" /></div>
            <div><Label>Key Insights</Label><Textarea value={form.keyInsights} onChange={e => setForm({ ...form, keyInsights: e.target.value })} data-testid="input-interview-insights" /></div>
            <div><Label>Sentiment</Label>
              <Select value={form.sentiment} onValueChange={v => setForm({ ...form, sentiment: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="positive">Positive</SelectItem><SelectItem value="neutral">Neutral</SelectItem><SelectItem value="negative">Negative</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter><Button onClick={handleCreate} disabled={!form.intervieweeName || createMutation.isPending} data-testid="btn-save-interview">{createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ExperimentsSection({ projectId }: { projectId: string }) {
  const { data: experiments, isLoading } = useCrudQuery<any>(projectId, "experiments");
  const { createMutation, updateMutation, deleteMutation } = useCrudMutations(projectId, "experiments");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ hypothesis: "", method: "", metrics: "" });

  const handleCreate = () => {
    createMutation.mutate(form, { onSuccess: () => { setDialogOpen(false); setForm({ hypothesis: "", method: "", metrics: "" }); } });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Experiments</h3>
        <Button size="sm" onClick={() => setDialogOpen(true)} data-testid="btn-add-experiment"><Plus className="h-4 w-4 mr-1" /> Add Experiment</Button>
      </div>
      {isLoading ? <Loader2 className="h-6 w-6 animate-spin mx-auto" /> : !experiments?.length ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground"><Beaker className="h-10 w-10 mx-auto mb-2 opacity-30" /><p>No experiments yet. Test your assumptions!</p></CardContent></Card>
      ) : (
        <div className="space-y-3">
          {experiments.map((exp: any) => (
            <Card key={exp.id} data-testid={`experiment-${exp.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium">{exp.hypothesis}</span>
                      <Badge className={`text-xs ${STATUS_COLORS[exp.status] || ""}`}>{exp.status}</Badge>
                    </div>
                    {exp.method && <p className="text-sm text-muted-foreground">Method: {exp.method}</p>}
                    {exp.result && <p className="text-sm mt-1">Result: {exp.result}</p>}
                    {exp.learnings && <p className="text-sm mt-1 text-primary">Learnings: {exp.learnings}</p>}
                  </div>
                  <div className="flex gap-1">
                    <Select value={exp.status} onValueChange={v => updateMutation.mutate({ id: exp.id, data: { status: v } })}>
                      <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="planned">Planned</SelectItem><SelectItem value="running">Running</SelectItem><SelectItem value="completed">Done</SelectItem></SelectContent>
                    </Select>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteMutation.mutate(exp.id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Experiment</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Hypothesis</Label><Textarea value={form.hypothesis} onChange={e => setForm({ ...form, hypothesis: e.target.value })} placeholder="We believe that..." data-testid="input-hypothesis" /></div>
            <div><Label>Method</Label><Input value={form.method} onChange={e => setForm({ ...form, method: e.target.value })} placeholder="How will you test?" data-testid="input-method" /></div>
            <div><Label>Success Metrics</Label><Input value={form.metrics} onChange={e => setForm({ ...form, metrics: e.target.value })} placeholder="What defines success?" data-testid="input-metrics" /></div>
          </div>
          <DialogFooter><Button onClick={handleCreate} disabled={!form.hypothesis || createMutation.isPending} data-testid="btn-save-experiment">{createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function StrategyTab({ projectId }: { projectId: string }) {
  const [activeSection, setActiveSection] = useState<"pricing" | "legal">("pricing");

  return (
    <div className="space-y-4" data-testid="strategy-tab">
      <div className="flex items-center gap-2 mb-4">
        <Button variant={activeSection === "pricing" ? "default" : "outline"} size="sm" onClick={() => setActiveSection("pricing")} data-testid="btn-pricing-section">
          <DollarSign className="h-4 w-4 mr-1" /> Pricing
        </Button>
        <Button variant={activeSection === "legal" ? "default" : "outline"} size="sm" onClick={() => setActiveSection("legal")} data-testid="btn-legal-section">
          <Shield className="h-4 w-4 mr-1" /> Legal
        </Button>
      </div>
      {activeSection === "pricing" ? <PricingSection projectId={projectId} /> : <LegalSection projectId={projectId} />}
    </div>
  );
}

function PricingSection({ projectId }: { projectId: string }) {
  const { data: tiers, isLoading } = useCrudQuery<any>(projectId, "pricing");
  const { createMutation, updateMutation, deleteMutation } = useCrudMutations(projectId, "pricing");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ name: "", price: 0, billingPeriod: "monthly", features: [] as string[], isFeatured: false });
  const [featureInput, setFeatureInput] = useState("");

  const handleCreate = () => {
    createMutation.mutate({ ...form, features: form.features }, {
      onSuccess: () => { setDialogOpen(false); setForm({ name: "", price: 0, billingPeriod: "monthly", features: [], isFeatured: false }); }
    });
  };

  const addFeature = () => {
    if (featureInput.trim()) {
      setForm({ ...form, features: [...form.features, featureInput.trim()] });
      setFeatureInput("");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Pricing Tiers</h3>
        <Button size="sm" onClick={() => setDialogOpen(true)} data-testid="btn-add-pricing"><Plus className="h-4 w-4 mr-1" /> Add Tier</Button>
      </div>
      {isLoading ? <Loader2 className="h-6 w-6 animate-spin mx-auto" /> : !tiers?.length ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground"><DollarSign className="h-10 w-10 mx-auto mb-2 opacity-30" /><p>No pricing tiers yet. Define your plans!</p></CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {tiers.map((tier: any) => (
            <Card key={tier.id} className={tier.isFeatured ? "border-primary border-2" : ""} data-testid={`pricing-tier-${tier.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{tier.name}</CardTitle>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteMutation.mutate(tier.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
                {tier.isFeatured && <Badge className="w-fit">Popular</Badge>}
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold mb-1">${(tier.price / 100).toFixed(2)}<span className="text-sm font-normal text-muted-foreground">/{tier.billingPeriod}</span></div>
                {Array.isArray(tier.features) && tier.features.length > 0 && (
                  <ul className="space-y-1 mt-3">
                    {(tier.features as string[]).map((f, i) => (
                      <li key={i} className="text-sm flex items-center gap-2"><CheckCircle2 className="h-3 w-3 text-green-500" />{f}</li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Pricing Tier</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Plan Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Pro" data-testid="input-tier-name" /></div>
            <div><Label>Price (cents)</Label><Input type="number" value={form.price} onChange={e => setForm({ ...form, price: parseInt(e.target.value) || 0 })} data-testid="input-tier-price" /></div>
            <div><Label>Billing Period</Label>
              <Select value={form.billingPeriod} onValueChange={v => setForm({ ...form, billingPeriod: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="yearly">Yearly</SelectItem><SelectItem value="one-time">One-time</SelectItem></SelectContent>
              </Select>
            </div>
            <div>
              <Label>Features</Label>
              <div className="flex gap-2">
                <Input value={featureInput} onChange={e => setFeatureInput(e.target.value)} placeholder="Add a feature..." onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addFeature())} data-testid="input-tier-feature" />
                <Button type="button" size="sm" onClick={addFeature}>Add</Button>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {form.features.map((f, i) => (
                  <Badge key={i} variant="secondary" className="text-xs cursor-pointer" onClick={() => setForm({ ...form, features: form.features.filter((_, j) => j !== i) })}>{f} <X className="h-3 w-3 ml-1" /></Badge>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={form.isFeatured} onChange={e => setForm({ ...form, isFeatured: e.target.checked })} />
              <Label>Mark as featured/popular</Label>
            </div>
          </div>
          <DialogFooter><Button onClick={handleCreate} disabled={!form.name || createMutation.isPending} data-testid="btn-save-tier">{createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const LEGAL_TEMPLATES: Record<string, { title: string; content: string }> = {
  "ip-ownership": {
    title: "IP Ownership Agreement",
    content: `INTELLECTUAL PROPERTY OWNERSHIP AGREEMENT

1. DEFINITIONS
"Work Product" means all inventions, designs, code, documentation, and creative works produced during the project.

2. OWNERSHIP
All Work Product created by team members in connection with this project shall be owned by [PROJECT OWNER/COMPANY].

3. ASSIGNMENT
Each team member agrees to assign and hereby assigns all rights, title, and interest in any Work Product to the project owner.

4. PRIOR INVENTIONS
Team members retain ownership of any pre-existing intellectual property not created for this project.

5. CONFIDENTIALITY
All proprietary information shared during the project shall remain confidential.

Signed: _______________  Date: _______________`,
  },
  tos: {
    title: "Terms of Service",
    content: `TERMS OF SERVICE

Last updated: [DATE]

1. ACCEPTANCE OF TERMS
By accessing or using [PROJECT NAME], you agree to be bound by these Terms.

2. DESCRIPTION OF SERVICE
[PROJECT NAME] provides [BRIEF DESCRIPTION].

3. USER ACCOUNTS
You must provide accurate information when creating an account.

4. ACCEPTABLE USE
You agree not to misuse the service or help anyone else do so.

5. INTELLECTUAL PROPERTY
The service and its content are protected by copyright and other laws.

6. LIMITATION OF LIABILITY
THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND.

7. GOVERNING LAW
These Terms shall be governed by the laws of [JURISDICTION].

8. CHANGES TO TERMS
We may modify these Terms at any time with notice.`,
  },
  privacy: {
    title: "Privacy Policy",
    content: `PRIVACY POLICY

Last updated: [DATE]

1. INFORMATION WE COLLECT
- Account information (name, email)
- Usage data
- Device information

2. HOW WE USE INFORMATION
- To provide and improve the service
- To communicate with you
- To ensure security

3. DATA SHARING
We do not sell your personal information. We may share data with:
- Service providers who help operate our platform
- As required by law

4. DATA RETENTION
We retain your data as long as your account is active.

5. YOUR RIGHTS
You may request access, correction, or deletion of your data.

6. SECURITY
We implement reasonable security measures to protect your data.

7. CONTACT
For privacy inquiries: [EMAIL]`,
  },
};

function LegalSection({ projectId }: { projectId: string }) {
  const { data: docs, isLoading } = useCrudQuery<any>(projectId, "legal-docs");
  const { createMutation, updateMutation, deleteMutation } = useCrudMutations(projectId, "legal-docs");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewDoc, setViewDoc] = useState<any>(null);
  const [form, setForm] = useState({ docType: "tos", title: "", content: "" });

  const handleCreate = () => {
    createMutation.mutate(form, { onSuccess: () => { setDialogOpen(false); setForm({ docType: "tos", title: "", content: "" }); } });
  };

  const useTemplate = (type: string) => {
    const tpl = LEGAL_TEMPLATES[type];
    if (tpl) setForm({ docType: type, title: tpl.title, content: tpl.content });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Legal Documents</h3>
        <Button size="sm" onClick={() => setDialogOpen(true)} data-testid="btn-add-legal"><Plus className="h-4 w-4 mr-1" /> Add Document</Button>
      </div>
      {isLoading ? <Loader2 className="h-6 w-6 animate-spin mx-auto" /> : !docs?.length ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground"><Shield className="h-10 w-10 mx-auto mb-2 opacity-30" /><p>No legal documents yet. Use templates to get started!</p></CardContent></Card>
      ) : (
        <div className="space-y-3">
          {docs.map((doc: any) => (
            <Card key={doc.id} data-testid={`legal-doc-${doc.id}`}>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <span className="font-medium">{doc.title}</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="secondary" className="text-xs">{doc.docType}</Badge>
                      <Badge className={`text-xs ${STATUS_COLORS[doc.status] || ""}`}>{doc.status}</Badge>
                    </div>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setViewDoc(doc)}><Eye className="h-4 w-4" /></Button>
                  <Select value={doc.status} onValueChange={v => updateMutation.mutate({ id: doc.id, data: { status: v } })}>
                    <SelectTrigger className="h-7 w-20 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="draft">Draft</SelectItem><SelectItem value="review">Review</SelectItem><SelectItem value="final">Final</SelectItem></SelectContent>
                  </Select>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteMutation.mutate(doc.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Legal Document</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Quick Templates</Label>
              <div className="flex gap-2 mt-1">
                <Button variant="outline" size="sm" onClick={() => useTemplate("ip-ownership")}>IP Ownership</Button>
                <Button variant="outline" size="sm" onClick={() => useTemplate("tos")}>Terms of Service</Button>
                <Button variant="outline" size="sm" onClick={() => useTemplate("privacy")}>Privacy Policy</Button>
              </div>
            </div>
            <div><Label>Type</Label>
              <Select value={form.docType} onValueChange={v => setForm({ ...form, docType: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="ip-ownership">IP Ownership</SelectItem><SelectItem value="tos">Terms of Service</SelectItem><SelectItem value="privacy">Privacy Policy</SelectItem><SelectItem value="nda">NDA</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent>
              </Select>
            </div>
            <div><Label>Title</Label><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} data-testid="input-legal-title" /></div>
            <div><Label>Content</Label><Textarea rows={12} value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} className="font-mono text-xs" data-testid="input-legal-content" /></div>
          </div>
          <DialogFooter><Button onClick={handleCreate} disabled={!form.title || createMutation.isPending} data-testid="btn-save-legal">{createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!viewDoc} onOpenChange={() => setViewDoc(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{viewDoc?.title}</DialogTitle></DialogHeader>
          <pre className="whitespace-pre-wrap text-sm font-mono bg-muted p-4 rounded">{viewDoc?.content}</pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function LaunchTab({ projectId, project }: { projectId: string; project: any }) {
  const [activeSection, setActiveSection] = useState<"landing" | "checklist" | "plan">("landing");

  return (
    <div className="space-y-4" data-testid="launch-tab">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Button variant={activeSection === "landing" ? "default" : "outline"} size="sm" onClick={() => setActiveSection("landing")} data-testid="btn-landing-section">
          <Eye className="h-4 w-4 mr-1" /> Landing & Waitlist
        </Button>
        <Button variant={activeSection === "checklist" ? "default" : "outline"} size="sm" onClick={() => setActiveSection("checklist")} data-testid="btn-checklist-section">
          <CheckSquare className="h-4 w-4 mr-1" /> Deploy Checklist
        </Button>
        <Button variant={activeSection === "plan" ? "default" : "outline"} size="sm" onClick={() => setActiveSection("plan")} data-testid="btn-plan-section">
          <Rocket className="h-4 w-4 mr-1" /> Launch Plan
        </Button>
      </div>
      {activeSection === "landing" ? <LandingWaitlistSection projectId={projectId} project={project} /> :
       activeSection === "checklist" ? <DeployChecklistSection projectId={projectId} /> :
       <LaunchPlanSection projectId={projectId} />}
    </div>
  );
}

function LandingWaitlistSection({ projectId, project }: { projectId: string; project: any }) {
  const { data: entries, isLoading } = useCrudQuery<any>(projectId, "waitlist");
  const { createMutation, deleteMutation } = useCrudMutations(projectId, "waitlist");
  const [emailInput, setEmailInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const { toast } = useToast();

  const updateProject = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/projects/${projectId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      toast({ title: "Landing page config saved" });
    },
  });

  const [config, setConfig] = useState<any>(project?.landingPageConfig || { headline: "", subheadline: "", ctaText: "Join Waitlist", features: [] });

  const handleSaveConfig = () => {
    updateProject.mutate({ landingPageConfig: config });
  };

  const addWaitlistEntry = () => {
    if (!emailInput.trim()) return;
    createMutation.mutate({ email: emailInput.trim(), name: nameInput.trim() || undefined, source: "manual" }, {
      onSuccess: () => { setEmailInput(""); setNameInput(""); }
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-3">Landing Page Config</h3>
        <Card>
          <CardContent className="p-4 space-y-3">
            <div><Label>Headline</Label><Input value={config.headline} onChange={e => setConfig({ ...config, headline: e.target.value })} placeholder="Your compelling headline" data-testid="input-landing-headline" /></div>
            <div><Label>Subheadline</Label><Input value={config.subheadline} onChange={e => setConfig({ ...config, subheadline: e.target.value })} placeholder="Brief value proposition" data-testid="input-landing-subheadline" /></div>
            <div><Label>CTA Button Text</Label><Input value={config.ctaText} onChange={e => setConfig({ ...config, ctaText: e.target.value })} data-testid="input-landing-cta" /></div>
            <Button size="sm" onClick={handleSaveConfig} disabled={updateProject.isPending} data-testid="btn-save-landing">
              {updateProject.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} Save Config
            </Button>
          </CardContent>
        </Card>
      </div>
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">Waitlist ({entries?.length || 0})</h3>
        </div>
        <Card>
          <CardContent className="p-4">
            <div className="flex gap-2 mb-4">
              <Input value={emailInput} onChange={e => setEmailInput(e.target.value)} placeholder="Email" className="flex-1" data-testid="input-waitlist-email" />
              <Input value={nameInput} onChange={e => setNameInput(e.target.value)} placeholder="Name (optional)" className="w-40" data-testid="input-waitlist-name" />
              <Button size="sm" onClick={addWaitlistEntry} disabled={!emailInput.trim() || createMutation.isPending} data-testid="btn-add-waitlist">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {isLoading ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : !entries?.length ? (
              <p className="text-sm text-muted-foreground text-center py-4">No waitlist signups yet</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {entries.map((e: any) => (
                  <div key={e.id} className="flex items-center justify-between py-1 px-2 rounded hover:bg-muted" data-testid={`waitlist-entry-${e.id}`}>
                    <div className="text-sm"><span className="font-medium">{e.email}</span>{e.name && <span className="text-muted-foreground ml-2">({e.name})</span>}</div>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => deleteMutation.mutate(e.id)}><X className="h-3 w-3" /></Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const DEFAULT_CHECKLIST = [
  { item: "SSL/TLS certificate configured", category: "security" },
  { item: "Environment variables set for production", category: "infrastructure" },
  { item: "Database migrations applied", category: "infrastructure" },
  { item: "Error monitoring configured (e.g. Sentry)", category: "monitoring" },
  { item: "Uptime monitoring set up", category: "monitoring" },
  { item: "Performance testing completed", category: "performance" },
  { item: "Security audit / dependency scan", category: "security" },
  { item: "Backup strategy in place", category: "infrastructure" },
  { item: "CI/CD pipeline configured", category: "infrastructure" },
  { item: "Analytics tracking verified", category: "monitoring" },
  { item: "Load testing completed", category: "performance" },
  { item: "API rate limiting configured", category: "security" },
];

function DeployChecklistSection({ projectId }: { projectId: string }) {
  const { data: items, isLoading } = useCrudQuery<any>(projectId, "deploy-checklist");
  const { createMutation, updateMutation, deleteMutation } = useCrudMutations(projectId, "deploy-checklist");
  const [newItem, setNewItem] = useState("");
  const [newCategory, setNewCategory] = useState("other");

  const seedDefaults = () => {
    DEFAULT_CHECKLIST.forEach((c, i) => {
      createMutation.mutate({ ...c, sortOrder: i });
    });
  };

  const completed = items?.filter((i: any) => i.isCompleted).length || 0;
  const total = items?.length || 0;
  const pct = total ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Deployment Checklist</h3>
          {total > 0 && <p className="text-sm text-muted-foreground">{completed}/{total} completed ({pct}%)</p>}
        </div>
        {(!items || items.length === 0) && (
          <Button size="sm" variant="outline" onClick={seedDefaults} data-testid="btn-seed-checklist">Use Default Checklist</Button>
        )}
      </div>
      {total > 0 && (
        <div className="w-full bg-muted rounded-full h-2">
          <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
      {isLoading ? <Loader2 className="h-6 w-6 animate-spin mx-auto" /> : (
        <div className="space-y-2">
          {items?.map((item: any) => (
            <div key={item.id} className="flex items-center gap-3 py-2 px-3 rounded hover:bg-muted" data-testid={`checklist-item-${item.id}`}>
              <button onClick={() => updateMutation.mutate({ id: item.id, data: { isCompleted: !item.isCompleted } })}>
                {item.isCompleted ? <CheckSquare className="h-5 w-5 text-green-500" /> : <Square className="h-5 w-5 text-muted-foreground" />}
              </button>
              <span className={`flex-1 text-sm ${item.isCompleted ? "line-through text-muted-foreground" : ""}`}>{item.item}</span>
              <Badge variant="secondary" className="text-xs">{item.category}</Badge>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => deleteMutation.mutate(item.id)}><X className="h-3 w-3" /></Button>
            </div>
          ))}
          <div className="flex gap-2 pt-2">
            <Input value={newItem} onChange={e => setNewItem(e.target.value)} placeholder="Add checklist item..." className="flex-1" onKeyDown={e => {
              if (e.key === "Enter" && newItem.trim()) { createMutation.mutate({ item: newItem.trim(), category: newCategory, sortOrder: total }); setNewItem(""); }
            }} data-testid="input-checklist-item" />
            <Select value={newCategory} onValueChange={setNewCategory}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="infrastructure">Infrastructure</SelectItem>
                <SelectItem value="security">Security</SelectItem>
                <SelectItem value="performance">Performance</SelectItem>
                <SelectItem value="monitoring">Monitoring</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}

const LAUNCH_CHANNELS = ["product-hunt", "twitter", "linkedin", "email", "blog", "press", "reddit", "youtube", "podcast", "other"];

function LaunchPlanSection({ projectId }: { projectId: string }) {
  const { data: tasks, isLoading } = useCrudQuery<any>(projectId, "launch-tasks");
  const { createMutation, updateMutation, deleteMutation } = useCrudMutations(projectId, "launch-tasks");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ channel: "twitter", task: "", notes: "" });

  const handleCreate = () => {
    createMutation.mutate(form, { onSuccess: () => { setDialogOpen(false); setForm({ channel: "twitter", task: "", notes: "" }); } });
  };

  const grouped = tasks?.reduce((acc: any, t: any) => {
    if (!acc[t.channel]) acc[t.channel] = [];
    acc[t.channel].push(t);
    return acc;
  }, {} as Record<string, any[]>) || {};

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Launch Plan & Distribution</h3>
        <Button size="sm" onClick={() => setDialogOpen(true)} data-testid="btn-add-launch-task"><Plus className="h-4 w-4 mr-1" /> Add Task</Button>
      </div>
      {isLoading ? <Loader2 className="h-6 w-6 animate-spin mx-auto" /> : !tasks?.length ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground"><Rocket className="h-10 w-10 mx-auto mb-2 opacity-30" /><p>No launch tasks yet. Plan your distribution!</p></CardContent></Card>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([channel, channelTasks]) => (
            <Card key={channel}>
              <CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wider">{channel}</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {(channelTasks as any[]).map((t: any) => (
                  <div key={t.id} className="flex items-center justify-between py-1" data-testid={`launch-task-${t.id}`}>
                    <div className="flex-1">
                      <span className="text-sm">{t.task}</span>
                      {t.notes && <p className="text-xs text-muted-foreground">{t.notes}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Select value={t.status} onValueChange={v => updateMutation.mutate({ id: t.id, data: { status: v } })}>
                        <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="planned">Planned</SelectItem><SelectItem value="in-progress">In Progress</SelectItem><SelectItem value="completed">Done</SelectItem></SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => deleteMutation.mutate(t.id)}><X className="h-3 w-3" /></Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Launch Task</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Channel</Label>
              <Select value={form.channel} onValueChange={v => setForm({ ...form, channel: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{LAUNCH_CHANNELS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Task</Label><Input value={form.task} onChange={e => setForm({ ...form, task: e.target.value })} placeholder="What needs to be done?" data-testid="input-launch-task" /></div>
            <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} data-testid="input-launch-notes" /></div>
          </div>
          <DialogFooter><Button onClick={handleCreate} disabled={!form.task || createMutation.isPending} data-testid="btn-save-launch-task">{createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function AnalyticsTab({ projectId }: { projectId: string }) {
  const { data: events, isLoading } = useCrudQuery<any>(projectId, "analytics-events");
  const { createMutation, updateMutation, deleteMutation } = useCrudMutations(projectId, "analytics-events");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ eventName: "", category: "activation", description: "" });

  const handleCreate = () => {
    createMutation.mutate(form, { onSuccess: () => { setDialogOpen(false); setForm({ eventName: "", category: "activation", description: "" }); } });
  };

  const categories = ["activation", "retention", "revenue", "referral"];
  const grouped = events?.reduce((acc: any, e: any) => {
    const cat = e.category || "activation";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(e);
    return acc;
  }, {} as Record<string, any[]>) || {};

  const catColors: Record<string, string> = {
    activation: "border-l-blue-500",
    retention: "border-l-green-500",
    revenue: "border-l-yellow-500",
    referral: "border-l-purple-500",
  };

  return (
    <div className="space-y-4" data-testid="analytics-tab">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Analytics Events</h3>
        <Button size="sm" onClick={() => setDialogOpen(true)} data-testid="btn-add-event"><Plus className="h-4 w-4 mr-1" /> Add Event</Button>
      </div>
      <p className="text-sm text-muted-foreground">Track activation, retention, revenue, and referral events for your product.</p>
      {isLoading ? <Loader2 className="h-6 w-6 animate-spin mx-auto" /> : !events?.length ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground"><BarChart3 className="h-10 w-10 mx-auto mb-2 opacity-30" /><p>No analytics events defined yet.</p></CardContent></Card>
      ) : (
        <div className="space-y-4">
          {categories.filter(c => grouped[c]?.length).map(cat => (
            <div key={cat}>
              <h4 className="text-sm font-medium uppercase tracking-wider mb-2 capitalize">{cat}</h4>
              <div className="space-y-2">
                {grouped[cat].map((ev: any) => (
                  <Card key={ev.id} className={`border-l-4 ${catColors[cat] || ""}`} data-testid={`analytics-event-${ev.id}`}>
                    <CardContent className="p-3 flex items-center justify-between">
                      <div className="flex-1">
                        <span className="font-medium text-sm">{ev.eventName}</span>
                        {ev.description && <p className="text-xs text-muted-foreground">{ev.description}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <Select value={ev.trackingStatus} onValueChange={v => updateMutation.mutate({ id: ev.id, data: { trackingStatus: v } })}>
                          <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="planned">Planned</SelectItem><SelectItem value="implemented">Implemented</SelectItem><SelectItem value="verified">Verified</SelectItem></SelectContent>
                        </Select>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => deleteMutation.mutate(ev.id)}><X className="h-3 w-3" /></Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Analytics Event</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Event Name</Label><Input value={form.eventName} onChange={e => setForm({ ...form, eventName: e.target.value })} placeholder="e.g. user_signed_up" data-testid="input-event-name" /></div>
            <div><Label>Category</Label>
              <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{categories.map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="What does this event track?" data-testid="input-event-desc" /></div>
          </div>
          <DialogFooter><Button onClick={handleCreate} disabled={!form.eventName || createMutation.isPending} data-testid="btn-save-event">{createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function SupportTab({ projectId }: { projectId: string }) {
  const { data: tickets, isLoading } = useCrudQuery<any>(projectId, "support-tickets");
  const { createMutation, updateMutation, deleteMutation } = useCrudMutations(projectId, "support-tickets");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewTicket, setViewTicket] = useState<any>(null);
  const [form, setForm] = useState({ subject: "", description: "", submitterEmail: "", submitterName: "", priority: "medium" });

  const handleCreate = () => {
    createMutation.mutate(form, { onSuccess: () => { setDialogOpen(false); setForm({ subject: "", description: "", submitterEmail: "", submitterName: "", priority: "medium" }); } });
  };

  const priorityColors: Record<string, string> = {
    low: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
    high: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  };

  const openCount = tickets?.filter((t: any) => t.status === "open" || t.status === "in-progress").length || 0;

  return (
    <div className="space-y-4" data-testid="support-tab">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Support Tickets</h3>
          {openCount > 0 && <p className="text-sm text-muted-foreground">{openCount} open</p>}
        </div>
        <Button size="sm" onClick={() => setDialogOpen(true)} data-testid="btn-add-ticket"><Plus className="h-4 w-4 mr-1" /> New Ticket</Button>
      </div>
      {isLoading ? <Loader2 className="h-6 w-6 animate-spin mx-auto" /> : !tickets?.length ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground"><Headphones className="h-10 w-10 mx-auto mb-2 opacity-30" /><p>No support tickets yet.</p></CardContent></Card>
      ) : (
        <div className="space-y-2">
          {tickets.map((t: any) => (
            <Card key={t.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setViewTicket(t)} data-testid={`support-ticket-${t.id}`}>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{t.subject}</span>
                    <Badge className={`text-xs ${priorityColors[t.priority] || ""}`}>{t.priority}</Badge>
                    <Badge className={`text-xs ${STATUS_COLORS[t.status] || ""}`}>{t.status}</Badge>
                  </div>
                  {t.submitterEmail && <p className="text-xs text-muted-foreground mt-0.5">{t.submitterName ? `${t.submitterName} (${t.submitterEmail})` : t.submitterEmail}</p>}
                </div>
                <span className="text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleDateString()}</span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Support Ticket</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Subject</Label><Input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} data-testid="input-ticket-subject" /></div>
            <div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} data-testid="input-ticket-desc" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Submitter Email</Label><Input value={form.submitterEmail} onChange={e => setForm({ ...form, submitterEmail: e.target.value })} data-testid="input-ticket-email" /></div>
              <div><Label>Submitter Name</Label><Input value={form.submitterName} onChange={e => setForm({ ...form, submitterName: e.target.value })} data-testid="input-ticket-name" /></div>
            </div>
            <div><Label>Priority</Label>
              <Select value={form.priority} onValueChange={v => setForm({ ...form, priority: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter><Button onClick={handleCreate} disabled={!form.subject || createMutation.isPending} data-testid="btn-save-ticket">{createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!viewTicket} onOpenChange={() => setViewTicket(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{viewTicket?.subject}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge className={`text-xs ${priorityColors[viewTicket?.priority] || ""}`}>{viewTicket?.priority}</Badge>
              <Select value={viewTicket?.status || "open"} onValueChange={v => { updateMutation.mutate({ id: viewTicket.id, data: { status: v } }); setViewTicket({ ...viewTicket, status: v }); }}>
                <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="open">Open</SelectItem><SelectItem value="in-progress">In Progress</SelectItem><SelectItem value="resolved">Resolved</SelectItem><SelectItem value="closed">Closed</SelectItem></SelectContent>
              </Select>
            </div>
            {viewTicket?.submitterEmail && <p className="text-sm text-muted-foreground">From: {viewTicket.submitterName} ({viewTicket.submitterEmail})</p>}
            <p className="text-sm whitespace-pre-wrap">{viewTicket?.description}</p>
            <Button variant="destructive" size="sm" onClick={() => { deleteMutation.mutate(viewTicket.id); setViewTicket(null); }}>Delete Ticket</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
