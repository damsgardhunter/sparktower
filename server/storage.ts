import { 
  type User, 
  type UserProfile, 
  type InsertUserProfile,
  type Project,
  type InsertProject,
  type ProjectMember,
  type InsertProjectMember,
  type ProjectChatMessage,
  type InsertProjectChatMessage,
  type ProjectLiveChatMessage,
  type InsertProjectLiveChatMessage,
  type Donation,
  type InsertDonation,
  type UserMatch,
  type InsertUserMatch,
  type Badge,
  type InsertBadge,
  type UserBadge,
  type InsertUserBadge,
  type Contest,
  type InsertContest,
  type ContestParticipant,
  type InsertContestParticipant,
  type Connection,
  type DirectMessage,
  type ProjectApplication,
  type ProjectFollow,
  type ProjectKanbanTask,
  type InsertProjectKanbanTask,
  type ProjectPersona,
  type InsertProjectPersona,
  type ProjectMilestone,
  type InsertProjectMilestone,
  type ProjectActivityLog,
  type InsertProjectActivityLog,
  type ProjectDecision,
  type InsertProjectDecision,
  type ProjectCheckIn,
  type InsertProjectCheckIn,
  type ProjectFile,
  type InsertProjectFile,
  type ProjectLink,
  type InsertProjectLink,
  users,
  userProfiles,
  projects,
  projectMembers,
  projectChatMessages,
  projectLiveChatMessages,
  donations,
  userMatches,
  badges,
  userBadges,
  contests,
  contestParticipants,
  connections,
  directMessages,
  projectApplications,
  projectFollows,
  projectKanbanTasks,
  projectPersonas,
  projectMilestones,
  projectRoadmaps,
  roadmapPhases,
  projectHealthChecks,
  healthFindingFeedback,
  projectTaskCompletions,
  projectDocuments,
  projectCodeAudits,
  projectStoryboards,
  projectComments,
  projectCommentReactions,
  type ProjectComment,
  type InsertProjectComment,
  feedPosts,
  feedReactions,
  feedComments,
  type FeedPost,
  type InsertFeedPost,
  type FeedComment,
  type InsertFeedComment,
  investorArtifacts,
  mockInterviews,
  mockInterviewTurns,
  type InvestorArtifact,
  type InsertInvestorArtifact,
  type MockInterview,
  type InsertMockInterview,
  type MockInterviewTurn,
  type InsertMockInterviewTurn,
  type ProjectStoryboard,
  type InsertProjectStoryboard,
  type ProjectRoadmap,
  type InsertProjectRoadmap,
  type RoadmapPhase,
  type InsertRoadmapPhase,
  type ProjectHealthCheck,
  type InsertProjectHealthCheck,
  type ProjectTaskCompletion,
  type ProjectDocument,
  type InsertProjectDocument,
  type ProjectCodeAudit,
  type InsertProjectCodeAudit,
  type InsertProjectTaskCompletion,
  type HealthFindingFeedback,
  type InsertHealthFindingFeedback,
  projectActivityLog,
  projectDecisions,
  projectCheckIns,
  projectFiles,
  projectLinks,
  type GameLeaderboardEntry,
  type InsertGameLeaderboardEntry,
  type TypingRace,
  type InsertTypingRace,
  type TypingRacePlayer,
  type InsertTypingRacePlayer,
  type SignalNoiseGame,
  type InsertSignalNoiseGame,
  type WaitlistEntry,
  type InsertWaitlistEntry,
  type ProjectInterview,
  type InsertProjectInterview,
  type ProjectExperiment,
  type InsertProjectExperiment,
  type PricingTier,
  type InsertPricingTier,
  type AnalyticsEvent,
  type InsertAnalyticsEvent,
  type LegalDoc,
  type InsertLegalDoc,
  type DeployChecklistItem,
  type InsertDeployChecklistItem,
  type SupportTicket,
  type InsertSupportTicket,
  type LaunchTask,
  type InsertLaunchTask,
  type NovaGuideMessage,
  type InsertNovaGuideMessage,
  type UserReputation,
  type InsertUserReputation,
  type CofounderSprint,
  type InsertCofounderSprint,
  type SprintResponse,
  type SprintDeliverable,
  type SprintRating,
  type SprintDecision,
  type SprintMessage,
  type SprintKanbanTask,
  type SprintBehavioralMetrics,
  type SprintCompatibilityReport,
  novaGuideMessages,
  userReputationScores,
  cofounderSprints,
  sprintResponses,
  sprintDeliverables,
  sprintRatings,
  sprintDecisions,
  sprintMessages,
  sprintKanbanTasks,
  sprintBehavioralMetrics,
  sprintCompatibilityReports,
  sprintMatchmakingQueue,
  type SprintMatchmakingQueueEntry,
  gameLeaderboard,
  typingRaces,
  typingRacePlayers,
  signalNoiseGames,
  projectWaitlistEntries,
  projectInterviews,
  projectExperiments,
  projectPricingTiers,
  projectAnalyticsEvents,
  projectLegalDocs,
  projectDeployChecklistItems,
  projectSupportTickets,
  projectLaunchTasks,
  userTaskStats,
  type UserTaskStats,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, or, ilike, sql, and, gte, lte, asc, ne, inArray, isNull } from "drizzle-orm";
import { getEntitlements, normalizeTier, FAIR_USE_MONTHLY_CAP } from "@shared/plans";

/**
 * Was a finished task finished by its due date?
 *
 * Prefers `completedAt`. Tasks finished before that column existed fall back
 * to the old comparison against now, which is wrong the moment the due date
 * passes but is the best that data supports.
 */
export function isTaskOnTime(task: { status: string; dueDate: Date | null; completedAt?: Date | null }): boolean {
  if (task.status !== "done" || !task.dueDate) return false;
  const finished = task.completedAt ? new Date(task.completedAt) : new Date();
  return finished <= new Date(task.dueDate);
}

/** A project comment with its author, ready to render. */
export interface ProjectCommentWithAuthor extends ProjectComment {
  author: User;
  profile?: UserProfile;
  viewerReacted: boolean;
}

/** A feed post with everything a card renders, resolved in one pass. */
export interface FeedPostWithDetails extends FeedPost {
  author: User;
  profile?: UserProfile;
  /** Null for posts not attached to a project. */
  project: { id: string; title: string; isPrivate: boolean } | null;
  /** The viewing user's own reaction, or null. */
  viewerReaction: string | null;
  reactionBreakdown: { reaction: string; count: number }[];
}

export interface IStorage {
  // User Profile
  getUserProfile(userId: string): Promise<UserProfile | undefined>;
  upsertUserProfile(data: InsertUserProfile): Promise<UserProfile>;
  getProfilesLookingFor(): Promise<(UserProfile & { user: User })[]>;
  completeOnboarding(userId: string): Promise<void>;
  
  // Projects
  getProjects(filters?: { category?: string; status?: string }): Promise<(Project & { owner: User; profile?: UserProfile })[]>;
  getProject(id: string): Promise<Project | undefined>;
  createProject(data: InsertProject): Promise<Project>;
  updateProject(id: string, data: Partial<InsertProject>): Promise<Project>;
  incrementProjectViews(id: string): Promise<void>;
  getProjectMembers(projectId: string): Promise<(ProjectMember & { user: User; profile?: UserProfile })[]>;
  
  // Project Chat (AI - Nova)
  getProjectChatMessages(projectId: string): Promise<ProjectChatMessage[]>;
  addProjectChatMessage(projectId: string, role: "user" | "assistant", content: string): Promise<ProjectChatMessage>;

  // Project Live Chat (Team)
  getProjectLiveChatMessages(projectId: string, limit?: number): Promise<(ProjectLiveChatMessage & { user: User })[]>;
  createProjectLiveChatMessage(data: InsertProjectLiveChatMessage): Promise<ProjectLiveChatMessage>;

  // Waitlist
  getWaitlistEntries(projectId: string): Promise<WaitlistEntry[]>;
  createWaitlistEntry(data: InsertWaitlistEntry): Promise<WaitlistEntry>;
  deleteWaitlistEntry(id: string): Promise<void>;

  // Interviews
  getProjectInterviews(projectId: string): Promise<ProjectInterview[]>;
  createProjectInterview(data: InsertProjectInterview): Promise<ProjectInterview>;
  updateProjectInterview(id: string, data: Partial<InsertProjectInterview>): Promise<ProjectInterview>;
  deleteProjectInterview(id: string): Promise<void>;

  // Experiments
  getProjectExperiments(projectId: string): Promise<ProjectExperiment[]>;
  createProjectExperiment(data: InsertProjectExperiment): Promise<ProjectExperiment>;
  updateProjectExperiment(id: string, data: Partial<InsertProjectExperiment>): Promise<ProjectExperiment>;
  deleteProjectExperiment(id: string): Promise<void>;

  // Pricing Tiers
  getProjectPricingTiers(projectId: string): Promise<PricingTier[]>;
  createPricingTier(data: InsertPricingTier): Promise<PricingTier>;
  updatePricingTier(id: string, data: Partial<InsertPricingTier>): Promise<PricingTier>;
  deletePricingTier(id: string): Promise<void>;

  // Analytics Events
  getProjectAnalyticsEvents(projectId: string): Promise<AnalyticsEvent[]>;
  createAnalyticsEvent(data: InsertAnalyticsEvent): Promise<AnalyticsEvent>;
  updateAnalyticsEvent(id: string, data: Partial<InsertAnalyticsEvent>): Promise<AnalyticsEvent>;
  deleteAnalyticsEvent(id: string): Promise<void>;

  // Legal Docs
  getProjectLegalDocs(projectId: string): Promise<LegalDoc[]>;
  createLegalDoc(data: InsertLegalDoc): Promise<LegalDoc>;
  updateLegalDoc(id: string, data: Partial<InsertLegalDoc>): Promise<LegalDoc>;
  deleteLegalDoc(id: string): Promise<void>;

  // Deploy Checklist
  getDeployChecklistItems(projectId: string): Promise<DeployChecklistItem[]>;
  createDeployChecklistItem(data: InsertDeployChecklistItem): Promise<DeployChecklistItem>;
  updateDeployChecklistItem(id: string, data: Partial<InsertDeployChecklistItem>): Promise<DeployChecklistItem>;
  deleteDeployChecklistItem(id: string): Promise<void>;

  // Support Tickets
  getProjectSupportTickets(projectId: string): Promise<SupportTicket[]>;
  createSupportTicket(data: InsertSupportTicket): Promise<SupportTicket>;
  updateSupportTicket(id: string, data: Partial<InsertSupportTicket>): Promise<SupportTicket>;
  deleteSupportTicket(id: string): Promise<void>;

  // Launch Tasks
  getProjectLaunchTasks(projectId: string): Promise<LaunchTask[]>;
  createLaunchTask(data: InsertLaunchTask): Promise<LaunchTask>;
  updateLaunchTask(id: string, data: Partial<InsertLaunchTask>): Promise<LaunchTask>;
  deleteLaunchTask(id: string): Promise<void>;

  // Nova Guide Messages
  getNovaGuideMessages(projectId: string): Promise<NovaGuideMessage[]>;
  addNovaGuideMessage(data: InsertNovaGuideMessage): Promise<NovaGuideMessage>;

  // Donations
  createDonation(data: InsertDonation): Promise<Donation>;
  getProjectDonations(projectId: string): Promise<Donation[]>;
  
  // Matches
  getUserMatches(userId: string): Promise<(UserMatch & { matchedUser: User; matchedProfile?: UserProfile })[]>;
  upsertUserMatch(data: InsertUserMatch): Promise<UserMatch>;
  
  // Leaderboard
  getLeaderboard(sortBy: "views" | "donations", limit: number, filter?: "solo" | "team" | "all", includePrivateOwnedBy?: string): Promise<(Project & { owner: User })[]>;
  
  // Media
  addProjectMedia(projectId: string, objectPath: string): Promise<Project>;
  removeProjectMedia(projectId: string, index: number): Promise<Project>;

  // User Search
  searchUsers(query: string): Promise<(User & { profile?: UserProfile })[]>;
  getUser(id: string): Promise<User | undefined>;

  // Badges
  getBadges(): Promise<Badge[]>;
  getBadge(id: string): Promise<Badge | undefined>;
  createBadge(data: InsertBadge): Promise<Badge>;
  getUserBadges(userId: string): Promise<(UserBadge & { badge: Badge })[]>;
  /** Null when the badge id is unknown. */
  awardBadge(userId: string, badgeId: string): Promise<UserBadge | null>;

  // Contests
  getContests(filters?: { status?: string }): Promise<(Contest & { badge?: Badge; participantCount: number })[]>;
  getContest(id: string): Promise<(Contest & { badge?: Badge; participantCount: number }) | undefined>;
  createContest(data: InsertContest): Promise<Contest>;
  joinContest(contestId: string, userId: string): Promise<ContestParticipant>;
  getContestParticipants(contestId: string): Promise<(ContestParticipant & { user: User; profile?: UserProfile })[]>;
  submitToContest(contestId: string, userId: string, submissionUrl: string, submissionNote?: string): Promise<ContestParticipant>;
  isContestParticipant(contestId: string, userId: string): Promise<boolean>;

  // Connections
  getConnectionById(connectionId: string): Promise<Connection | undefined>;
  sendConnectionRequest(requesterId: string, receiverId: string): Promise<Connection>;
  acceptConnection(connectionId: string): Promise<Connection>;
  rejectConnection(connectionId: string): Promise<Connection>;
  removeConnection(connectionId: string): Promise<void>;
  getConnections(userId: string): Promise<(Connection & { user: User; profile?: UserProfile })[]>;
  getConnectionRequests(userId: string): Promise<(Connection & { user: User; profile?: UserProfile })[]>;
  getConnectionStatus(userId1: string, userId2: string): Promise<Connection | undefined>;
  getMutualConnections(userId1: string, userId2: string): Promise<string[]>;

  // Direct Messages
  sendDirectMessage(senderId: string, receiverId: string, content: string): Promise<DirectMessage>;
  getDirectMessages(userId1: string, userId2: string, limit?: number, before?: string): Promise<DirectMessage[]>;
  getConversationList(userId: string): Promise<{ userId: string; user: User; profile?: UserProfile; lastMessage: DirectMessage; unreadCount: number }[]>;
  markMessagesRead(userId: string, otherUserId: string): Promise<void>;
  getUnreadCount(userId: string): Promise<number>;

  // Donation queries
  getDonationsByDonor(donorId: string): Promise<(Donation & { project: Project })[]>;
  getUserDonationEarnings(userId: string): Promise<{ total: number; donations: Donation[] }>;
  getUserProjects(userId: string): Promise<Project[]>;

  // Project Applications
  createApplication(data: { projectId: string; userId: string; resumeUrl?: string; answers?: any; message?: string }): Promise<ProjectApplication>;
  getProjectApplications(projectId: string): Promise<(ProjectApplication & { user: User; profile?: UserProfile })[]>;
  getUserApplications(userId: string): Promise<(ProjectApplication & { project: Project })[]>;
  getApplication(id: string): Promise<ProjectApplication | undefined>;
  updateApplicationStatus(id: string, status: "accepted" | "rejected"): Promise<ProjectApplication>;

  // Project Follows
  followProject(userId: string, projectId: string): Promise<ProjectFollow>;
  unfollowProject(userId: string, projectId: string): Promise<void>;
  isFollowing(userId: string, projectId: string): Promise<boolean>;
  getUserFollowedProjects(userId: string): Promise<(ProjectFollow & { project: Project & { owner: User } })[]>;
  getProjectFollowerCount(projectId: string): Promise<number>;

  // Kanban Tasks
  getProjectKanbanTasks(projectId: string): Promise<(ProjectKanbanTask & { assignee?: User & { profile?: UserProfile } })[]>;
  getKanbanTask(id: string): Promise<ProjectKanbanTask | undefined>;
  createKanbanTask(data: InsertProjectKanbanTask): Promise<ProjectKanbanTask>;
  updateKanbanTask(id: string, data: Partial<InsertProjectKanbanTask>): Promise<ProjectKanbanTask>;
  deleteKanbanTask(id: string): Promise<void>;
  clearProjectKanbanTasks(projectId: string, onlyStatus?: string): Promise<number>;
  getUserTaskStats(userId: string): Promise<UserTaskStats | undefined>;
  bankUserTaskStats(userId: string, totals: { completed: number; onTime: number; lastCompletedAt?: Date | null }): Promise<UserTaskStats>;
  countUserCompletedTasks(userId: string): Promise<{ completed: number; onTime: number; lastCompletedAt: Date | null }>;
  bankExecutionCredit(userId: string): Promise<void>;
  incrementUserTaskCompletion(userId: string, onTime: boolean): Promise<void>;
  // Nova codebase audits
  createCodeAudit(data: InsertProjectCodeAudit): Promise<ProjectCodeAudit>;
  getCodeAudit(id: string): Promise<ProjectCodeAudit | undefined>;
  getCodeAudits(projectId: string, limit?: number): Promise<ProjectCodeAudit[]>;
  /** The most recent audit, which is what every Nova surface reasons from. */
  getLatestCodeAudit(projectId: string): Promise<ProjectCodeAudit | undefined>;
  updateCodeAudit(id: string, data: Partial<InsertProjectCodeAudit>): Promise<ProjectCodeAudit>;
  deleteCodeAudit(id: string): Promise<void>;

  // Nova-built documents
  createDocument(data: InsertProjectDocument): Promise<ProjectDocument>;
  getDocument(id: string): Promise<ProjectDocument | undefined>;
  getProjectDocuments(projectId: string): Promise<ProjectDocument[]>;
  updateDocument(id: string, data: Partial<InsertProjectDocument>): Promise<ProjectDocument>;
  deleteDocument(id: string): Promise<void>;

  /** Project-level completion history, which outlives the kanban rows. */
  recordTaskCompletion(data: InsertProjectTaskCompletion): Promise<void>;
  getProjectTaskCompletions(projectId: string, limit?: number): Promise<ProjectTaskCompletion[]>;
  getProjectCompletionStats(projectId: string): Promise<{ completed: number; onTime: number; lastCompletedAt: Date | null }>;

  // Personas
  getProjectPersonas(projectId: string): Promise<ProjectPersona[]>;
  getPersona(id: string): Promise<ProjectPersona | undefined>;
  createPersona(data: InsertProjectPersona): Promise<ProjectPersona>;
  deletePersona(id: string): Promise<void>;

  // Milestones
  getProjectMilestones(projectId: string): Promise<ProjectMilestone[]>;
  getMilestone(id: string): Promise<ProjectMilestone | undefined>;
  createMilestone(data: InsertProjectMilestone): Promise<ProjectMilestone>;
  updateMilestone(id: string, data: Partial<InsertProjectMilestone>): Promise<ProjectMilestone>;
  deleteMilestone(id: string): Promise<void>;

  // Activity Log
  logActivity(data: InsertProjectActivityLog): Promise<ProjectActivityLog>;
  getProjectActivity(projectId: string, limit?: number): Promise<(ProjectActivityLog & { user?: User })[]>;

  // Decisions
  getProjectDecisions(projectId: string): Promise<(ProjectDecision & { user: User })[]>;
  createDecision(data: InsertProjectDecision): Promise<ProjectDecision>;
  updateDecision(id: string, data: Partial<InsertProjectDecision>): Promise<ProjectDecision>;
  deleteDecision(id: string): Promise<void>;

  // Check-ins
  getProjectCheckIns(projectId: string): Promise<(ProjectCheckIn & { user: User; profile?: UserProfile })[]>;
  createCheckIn(data: InsertProjectCheckIn): Promise<ProjectCheckIn>;

  // Files
  getProjectFiles(projectId: string): Promise<(ProjectFile & { uploader: User })[]>;
  createProjectFile(data: InsertProjectFile): Promise<ProjectFile>;
  updateProjectFile(id: string, data: Partial<InsertProjectFile>): Promise<ProjectFile>;
  deleteProjectFile(id: string): Promise<void>;

  // Links
  getProjectLinks(projectId: string): Promise<ProjectLink[]>;
  createProjectLink(data: InsertProjectLink): Promise<ProjectLink>;
  deleteProjectLink(id: string): Promise<void>;

  // Project Members (enhanced)
  updateProjectMember(projectId: string, userId: string, data: { timezone?: string; availability?: string; hoursPerWeek?: number; skills?: string[] }): Promise<ProjectMember>;

  // Subscription & Credits
  getUserSubscription(userId: string): Promise<{ tier: string; creditsUsed: number; creditsLimit: number; creditsRemaining: number; stripeCustomerId: string | null; stripeSubscriptionId: string | null }>;
  checkCredits(userId: string, amount: number): Promise<boolean>;
  deductCredits(userId: string, amount: number): Promise<boolean>;
  resetCreditsIfNeeded(userId: string): Promise<void>;
  countPrivateProjects(userId: string): Promise<number>;

  // Roadmaps (Builder tier and above)
  getProjectRoadmap(projectId: string): Promise<(ProjectRoadmap & { phases: RoadmapPhase[] }) | undefined>;
  createRoadmap(data: InsertProjectRoadmap, phases: Omit<InsertRoadmapPhase, "roadmapId">[]): Promise<ProjectRoadmap & { phases: RoadmapPhase[] }>;
  replaceRoadmapPhases(roadmapId: string, phases: Omit<InsertRoadmapPhase, "roadmapId">[]): Promise<RoadmapPhase[]>;
  updateRoadmap(id: string, data: Partial<ProjectRoadmap>): Promise<ProjectRoadmap>;
  updateRoadmapPhase(id: string, data: Partial<RoadmapPhase>): Promise<RoadmapPhase>;
  /** A single phase plus the project it belongs to, for authorization. */
  getRoadmapPhase(id: string): Promise<(RoadmapPhase & { projectId: string }) | undefined>;
  deleteRoadmap(id: string): Promise<void>;

  // Health checks (Pro tier)
  createHealthCheck(data: InsertProjectHealthCheck): Promise<ProjectHealthCheck>;
  getHealthChecks(projectId: string, limit?: number): Promise<ProjectHealthCheck[]>;
  createHealthFindingFeedback(data: InsertHealthFindingFeedback): Promise<HealthFindingFeedback>;
  getHealthFindingFeedback(projectId: string): Promise<HealthFindingFeedback[]>;
  deleteHealthFindingFeedback(id: string, userId: string): Promise<boolean>;

  getProjectFollowers(projectId: string): Promise<{ userId: string; user: User; profile?: UserProfile }[]>;

  // Project discussion (milestone / roadmap / project comments)
  createProjectComment(data: InsertProjectComment): Promise<ProjectComment>;
  getProjectComments(projectId: string, target?: { targetType: string; targetId: string }, viewerId?: string): Promise<ProjectCommentWithAuthor[]>;
  getProjectCommentCounts(projectId: string): Promise<Record<string, number>>;
  deleteProjectComment(id: string, userId: string): Promise<boolean>;
  toggleCommentReaction(commentId: string, userId: string): Promise<{ reactionCount: number; reacted: boolean }>;

  // Founder feed
  createFeedPost(data: InsertFeedPost): Promise<FeedPost>;
  getFeedPosts(options: { viewerId?: string; limit: number; before?: string; authorId?: string; projectId?: string; postType?: string }): Promise<FeedPostWithDetails[]>;
  getFeedPost(id: string, viewerId?: string): Promise<FeedPostWithDetails | undefined>;
  deleteFeedPost(id: string, authorId: string): Promise<boolean>;
  setFeedReaction(postId: string, userId: string, reaction: string | null): Promise<{ reactionCount: number; viewerReaction: string | null }>;
  getFeedComments(postId: string): Promise<(FeedComment & { author: User; profile?: UserProfile })[]>;
  createFeedComment(data: InsertFeedComment): Promise<FeedComment>;
  deleteFeedComment(id: string, authorId: string): Promise<boolean>;

  // Investor readiness suite
  createInvestorArtifact(data: InsertInvestorArtifact): Promise<InvestorArtifact>;
  getInvestorArtifacts(projectId: string, kind?: string): Promise<InvestorArtifact[]>;
  createMockInterview(data: InsertMockInterview): Promise<MockInterview>;
  getMockInterview(id: string): Promise<(MockInterview & { turns: MockInterviewTurn[] }) | undefined>;
  getMockInterviews(projectId: string, userId: string): Promise<MockInterview[]>;
  updateMockInterview(id: string, data: Partial<MockInterview>): Promise<MockInterview>;
  createInterviewTurn(data: InsertMockInterviewTurn): Promise<MockInterviewTurn>;
  updateInterviewTurn(id: string, data: Partial<MockInterviewTurn>): Promise<MockInterviewTurn>;

  // Storyboards — private to the generating user, never in the media gallery
  createStoryboard(data: InsertProjectStoryboard): Promise<ProjectStoryboard>;
  getStoryboardsForUser(projectId: string, userId: string): Promise<ProjectStoryboard[]>;
  /** Returns undefined unless the storyboard belongs to `userId`. */
  getStoryboardForUser(id: string, userId: string): Promise<ProjectStoryboard | undefined>;
  deleteStoryboard(id: string, userId: string): Promise<boolean>;
  updateUserStripeInfo(userId: string, data: { stripeCustomerId?: string; stripeSubscriptionId?: string; subscriptionTier?: string }): Promise<User>;

  // Game Leaderboard
  createLeaderboardEntry(data: InsertGameLeaderboardEntry): Promise<GameLeaderboardEntry>;
  getGameLeaderboard(gameType: string, limit?: number): Promise<(GameLeaderboardEntry & { user: User; profile?: UserProfile })[]>;


  // Typing
  createTypingRace(data: InsertTypingRace): Promise<TypingRace>;
  getTypingRace(id: string): Promise<TypingRace | undefined>;
  updateTypingRace(id: string, data: Partial<TypingRace>): Promise<TypingRace>;
  getWaitingTypingRaces(): Promise<TypingRace[]>;
  createTypingRacePlayer(data: InsertTypingRacePlayer): Promise<TypingRacePlayer>;
  getTypingRacePlayers(raceId: string): Promise<(TypingRacePlayer & { user: User; profile?: UserProfile })[]>;
  updateTypingRacePlayer(id: string, data: Partial<TypingRacePlayer>): Promise<TypingRacePlayer>;

  // Signal/Noise
  createSignalNoiseGame(data: InsertSignalNoiseGame): Promise<SignalNoiseGame>;
  getSignalNoiseGame(id: string): Promise<SignalNoiseGame | undefined>;
  updateSignalNoiseGame(id: string, data: Partial<SignalNoiseGame>): Promise<SignalNoiseGame>;
  getUserSignalNoiseHistory(userId: string, limit?: number): Promise<SignalNoiseGame[]>;

  // Co-Founder Sprints
  createSprint(data: InsertCofounderSprint): Promise<CofounderSprint>;
  getSprint(id: string): Promise<CofounderSprint | undefined>;
  updateSprint(id: string, data: Partial<CofounderSprint>): Promise<CofounderSprint>;
  getSprintsByUser(userId: string): Promise<(CofounderSprint & { user1: User; user2: User })[]>;
  addSprintResponse(data: { sprintId: string; userId: string; questionKey: string; answer: string; isNova?: boolean }): Promise<SprintResponse>;
  getSprintResponses(sprintId: string, userId?: string): Promise<SprintResponse[]>;
  addSprintDeliverable(data: { sprintId: string; type: string; content: any; userId?: string }): Promise<SprintDeliverable>;
  getSprintDeliverables(sprintId: string): Promise<SprintDeliverable[]>;
  addSprintRating(data: { sprintId: string; raterId: string; rateeId: string; communicationClarity: number; reliability: number; wouldBuildLongTerm: boolean; stressLevel: number }): Promise<SprintRating>;
  getSprintRatings(sprintId: string): Promise<SprintRating[]>;
  addSprintDecision(data: { sprintId: string; userId: string; decision: string; reason: string }): Promise<SprintDecision>;
  getSprintDecisions(sprintId: string): Promise<SprintDecision[]>;
  sendSprintMessage(data: { sprintId: string; userId: string; content: string; isNova?: boolean }): Promise<SprintMessage>;
  getSprintMessages(sprintId: string): Promise<(SprintMessage & { user: User })[]>;
  getSprintTasks(sprintId: string): Promise<SprintKanbanTask[]>;
  createSprintTask(data: { sprintId: string; title: string; description?: string; order?: number; assigneeId?: string }): Promise<SprintKanbanTask>;
  updateSprintTask(id: string, data: Partial<SprintKanbanTask>): Promise<SprintKanbanTask>;
  upsertSprintBehavioralMetrics(data: { sprintId: string; userId: string } & Partial<SprintBehavioralMetrics>): Promise<SprintBehavioralMetrics>;
  getSprintBehavioralMetrics(sprintId: string): Promise<SprintBehavioralMetrics[]>;
  saveCompatibilityReport(data: { sprintId: string; overallScore: number; strengths: any; risks: any; recommendation: string }): Promise<SprintCompatibilityReport>;
  getCompatibilityReport(sprintId: string): Promise<SprintCompatibilityReport | undefined>;
  joinMatchmakingQueue(data: { userId: string; duration: "24h" | "72h"; productStyle?: string | null }): Promise<SprintMatchmakingQueueEntry>;
  /** Atomically pairs the caller with a compatible waiting partner. */
  tryMatchInQueue(userId: string): Promise<{ sprint: CofounderSprint; partnerId: string } | null>;
  touchQueueEntry(userId: string): Promise<boolean>;
  sweepStaleQueueEntries(): Promise<number>;
  removeFromMatchmakingQueue(userId: string): Promise<void>;
  getQueueEntry(userId: string): Promise<SprintMatchmakingQueueEntry | undefined>;
  getQueueStats(userId: string, duration?: "24h" | "72h"): Promise<{ waiting: number; position: number | null }>;

  // Reputation
  getUserReputation(userId: string): Promise<UserReputation | undefined>;
  upsertUserReputation(data: InsertUserReputation): Promise<UserReputation>;
  getReputationLeaderboard(limit: number, filter?: "solo" | "team" | "all"): Promise<(UserReputation & { user: User; profile?: UserProfile })[]>;
  getReputationStats(userId: string): Promise<{
    ownedProjects: Project[];
    memberProjects: ProjectMember[];
    milestones: { total: number; completed: number };
    tasks: { total: number; done: number; onTime: number };
    checkIns: number;
    followedProjects: number;
    donationsReceived: number;
    applicationsSubmitted: number;
    activityLogCount: number;
    contestWins: number;
    bestGameScores: { gameType: string; score: number }[];
  }>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserProfile(userId: string): Promise<UserProfile | undefined> {
    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId));
    return profile;
  }

  async upsertUserProfile(data: InsertUserProfile): Promise<UserProfile> {
    const [profile] = await db
      .insert(userProfiles)
      .values(data)
      .onConflictDoUpdate({
        target: userProfiles.userId,
        set: data,
      })
      .returning();
    return profile;
  }

  /** Profiles with an active "looking for" call, newest first. */
  async getProfilesLookingFor(): Promise<(UserProfile & { user: User })[]> {
    const rows = await db
      .select()
      .from(userProfiles)
      .where(sql`${userProfiles.lookingFor} IS NOT NULL AND ${userProfiles.lookingFor}->>'isActive' = 'true'`);

    return Promise.all(rows.map(async (profile) => {
      const [user] = await db.select().from(users).where(eq(users.id, profile.userId));
      return { ...profile, user };
    }));
  }

  async completeOnboarding(userId: string): Promise<void> {
    await db
      .update(userProfiles)
      .set({ isOnboarded: true })
      .where(eq(userProfiles.userId, userId));
  }

  async getProjects(filters?: { category?: string; status?: string; includePrivateOwnedBy?: string }): Promise<(Project & { owner: User; profile?: UserProfile })[]> {
    let query = db.select().from(projects);
    const conditions = [];

    if (filters?.category) {
      conditions.push(eq(projects.category, filters.category));
    }
    if (filters?.status) {
      conditions.push(eq(projects.status, filters.status as any));
    }
    // Private projects are excluded from public listings, except for their owner.
    conditions.push(
      filters?.includePrivateOwnedBy
        ? or(eq(projects.isPrivate, false), eq(projects.ownerId, filters.includePrivateOwnedBy))!
        : eq(projects.isPrivate, false)
    );

    const result = await (conditions.length > 0 
      ? query.where(and(...conditions)) 
      : query).orderBy(desc(projects.createdAt));
    
    return await Promise.all(
      result.map(async (project) => {
        const [owner] = await db.select().from(users).where(eq(users.id, project.ownerId));
        const profile = await this.getUserProfile(project.ownerId);
        return { ...project, owner, profile };
      })
    );
  }

  async getProject(id: string): Promise<Project | undefined> {
    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    return project;
  }

  async createProject(data: InsertProject): Promise<Project> {
    const [project] = await db.insert(projects).values(data).returning();
    // The owner is on the team. Without this row every member count reads one
    // short — the Team Members card renders empty, and health checks and
    // readiness scores see "0 of 3 seats filled" on a project that has a founder.
    await db.insert(projectMembers).values({
      projectId: project.id,
      userId: project.ownerId,
      role: "Owner",
    }).onConflictDoNothing();
    return project;
  }

  async updateProject(id: string, data: Partial<InsertProject>): Promise<Project> {
    const [project] = await db
      .update(projects)
      .set(data)
      .where(eq(projects.id, id))
      .returning();
    return project;
  }

  async incrementProjectViews(id: string): Promise<void> {
    await db
      .update(projects)
      .set({ views: sql`${projects.views} + 1` })
      .where(eq(projects.id, id));
  }

  async getProjectMembers(projectId: string): Promise<(ProjectMember & { user: User; profile?: UserProfile })[]> {
    const members = await db
      .select()
      .from(projectMembers)
      .where(eq(projectMembers.projectId, projectId));

    return await Promise.all(
      members.map(async (member) => {
        const [user] = await db.select().from(users).where(eq(users.id, member.userId));
        const profile = await this.getUserProfile(member.userId);
        return { ...member, user, profile };
      })
    );
  }

  async getProjectChatMessages(projectId: string): Promise<ProjectChatMessage[]> {
    return await db
      .select()
      .from(projectChatMessages)
      .where(eq(projectChatMessages.projectId, projectId))
      .orderBy(projectChatMessages.createdAt);
  }

  async addProjectChatMessage(projectId: string, role: "user" | "assistant", content: string): Promise<ProjectChatMessage> {
    const [message] = await db
      .insert(projectChatMessages)
      .values({ projectId, role, content })
      .returning();
    return message;
  }

  async getProjectLiveChatMessages(projectId: string, limit = 100): Promise<(ProjectLiveChatMessage & { user: User })[]> {
    const results = await db
      .select()
      .from(projectLiveChatMessages)
      .innerJoin(users, eq(projectLiveChatMessages.userId, users.id))
      .where(eq(projectLiveChatMessages.projectId, projectId))
      .orderBy(desc(projectLiveChatMessages.createdAt))
      .limit(limit);
    return results.map(r => ({ ...r.project_live_chat_messages, user: r.users })).reverse();
  }

  async createProjectLiveChatMessage(data: InsertProjectLiveChatMessage): Promise<ProjectLiveChatMessage> {
    const [message] = await db
      .insert(projectLiveChatMessages)
      .values(data)
      .returning();
    return message;
  }

  async getWaitlistEntries(projectId: string): Promise<WaitlistEntry[]> {
    return db.select().from(projectWaitlistEntries).where(eq(projectWaitlistEntries.projectId, projectId)).orderBy(desc(projectWaitlistEntries.createdAt));
  }
  async createWaitlistEntry(data: InsertWaitlistEntry): Promise<WaitlistEntry> {
    const [entry] = await db.insert(projectWaitlistEntries).values(data).returning();
    return entry;
  }
  async deleteWaitlistEntry(id: string): Promise<void> {
    await db.delete(projectWaitlistEntries).where(eq(projectWaitlistEntries.id, id));
  }

  async getProjectInterviews(projectId: string): Promise<ProjectInterview[]> {
    return db.select().from(projectInterviews).where(eq(projectInterviews.projectId, projectId)).orderBy(desc(projectInterviews.createdAt));
  }
  async createProjectInterview(data: InsertProjectInterview): Promise<ProjectInterview> {
    const [entry] = await db.insert(projectInterviews).values(data).returning();
    return entry;
  }
  async updateProjectInterview(id: string, data: Partial<InsertProjectInterview>): Promise<ProjectInterview> {
    const [entry] = await db.update(projectInterviews).set(data).where(eq(projectInterviews.id, id)).returning();
    return entry;
  }
  async deleteProjectInterview(id: string): Promise<void> {
    await db.delete(projectInterviews).where(eq(projectInterviews.id, id));
  }

  async getProjectExperiments(projectId: string): Promise<ProjectExperiment[]> {
    return db.select().from(projectExperiments).where(eq(projectExperiments.projectId, projectId)).orderBy(desc(projectExperiments.createdAt));
  }
  async createProjectExperiment(data: InsertProjectExperiment): Promise<ProjectExperiment> {
    const [entry] = await db.insert(projectExperiments).values(data).returning();
    return entry;
  }
  async updateProjectExperiment(id: string, data: Partial<InsertProjectExperiment>): Promise<ProjectExperiment> {
    const [entry] = await db.update(projectExperiments).set(data).where(eq(projectExperiments.id, id)).returning();
    return entry;
  }
  async deleteProjectExperiment(id: string): Promise<void> {
    await db.delete(projectExperiments).where(eq(projectExperiments.id, id));
  }

  async getProjectPricingTiers(projectId: string): Promise<PricingTier[]> {
    return db.select().from(projectPricingTiers).where(eq(projectPricingTiers.projectId, projectId)).orderBy(asc(projectPricingTiers.sortOrder));
  }
  async createPricingTier(data: InsertPricingTier): Promise<PricingTier> {
    const [entry] = await db.insert(projectPricingTiers).values(data).returning();
    return entry;
  }
  async updatePricingTier(id: string, data: Partial<InsertPricingTier>): Promise<PricingTier> {
    const [entry] = await db.update(projectPricingTiers).set(data).where(eq(projectPricingTiers.id, id)).returning();
    return entry;
  }
  async deletePricingTier(id: string): Promise<void> {
    await db.delete(projectPricingTiers).where(eq(projectPricingTiers.id, id));
  }

  async getProjectAnalyticsEvents(projectId: string): Promise<AnalyticsEvent[]> {
    return db.select().from(projectAnalyticsEvents).where(eq(projectAnalyticsEvents.projectId, projectId)).orderBy(desc(projectAnalyticsEvents.createdAt));
  }
  async createAnalyticsEvent(data: InsertAnalyticsEvent): Promise<AnalyticsEvent> {
    const [entry] = await db.insert(projectAnalyticsEvents).values(data).returning();
    return entry;
  }
  async updateAnalyticsEvent(id: string, data: Partial<InsertAnalyticsEvent>): Promise<AnalyticsEvent> {
    const [entry] = await db.update(projectAnalyticsEvents).set(data).where(eq(projectAnalyticsEvents.id, id)).returning();
    return entry;
  }
  async deleteAnalyticsEvent(id: string): Promise<void> {
    await db.delete(projectAnalyticsEvents).where(eq(projectAnalyticsEvents.id, id));
  }

  async getProjectLegalDocs(projectId: string): Promise<LegalDoc[]> {
    return db.select().from(projectLegalDocs).where(eq(projectLegalDocs.projectId, projectId)).orderBy(desc(projectLegalDocs.createdAt));
  }
  async createLegalDoc(data: InsertLegalDoc): Promise<LegalDoc> {
    const [entry] = await db.insert(projectLegalDocs).values(data).returning();
    return entry;
  }
  async updateLegalDoc(id: string, data: Partial<InsertLegalDoc>): Promise<LegalDoc> {
    const [entry] = await db.update(projectLegalDocs).set(data).where(eq(projectLegalDocs.id, id)).returning();
    return entry;
  }
  async deleteLegalDoc(id: string): Promise<void> {
    await db.delete(projectLegalDocs).where(eq(projectLegalDocs.id, id));
  }

  async getDeployChecklistItems(projectId: string): Promise<DeployChecklistItem[]> {
    return db.select().from(projectDeployChecklistItems).where(eq(projectDeployChecklistItems.projectId, projectId)).orderBy(asc(projectDeployChecklistItems.sortOrder));
  }
  async createDeployChecklistItem(data: InsertDeployChecklistItem): Promise<DeployChecklistItem> {
    const [entry] = await db.insert(projectDeployChecklistItems).values(data).returning();
    return entry;
  }
  async updateDeployChecklistItem(id: string, data: Partial<InsertDeployChecklistItem>): Promise<DeployChecklistItem> {
    const [entry] = await db.update(projectDeployChecklistItems).set(data).where(eq(projectDeployChecklistItems.id, id)).returning();
    return entry;
  }
  async deleteDeployChecklistItem(id: string): Promise<void> {
    await db.delete(projectDeployChecklistItems).where(eq(projectDeployChecklistItems.id, id));
  }

  async getProjectSupportTickets(projectId: string): Promise<SupportTicket[]> {
    return db.select().from(projectSupportTickets).where(eq(projectSupportTickets.projectId, projectId)).orderBy(desc(projectSupportTickets.createdAt));
  }
  async createSupportTicket(data: InsertSupportTicket): Promise<SupportTicket> {
    const [entry] = await db.insert(projectSupportTickets).values(data).returning();
    return entry;
  }
  async updateSupportTicket(id: string, data: Partial<InsertSupportTicket>): Promise<SupportTicket> {
    const [entry] = await db.update(projectSupportTickets).set(data).where(eq(projectSupportTickets.id, id)).returning();
    return entry;
  }
  async deleteSupportTicket(id: string): Promise<void> {
    await db.delete(projectSupportTickets).where(eq(projectSupportTickets.id, id));
  }

  async getProjectLaunchTasks(projectId: string): Promise<LaunchTask[]> {
    return db.select().from(projectLaunchTasks).where(eq(projectLaunchTasks.projectId, projectId)).orderBy(asc(projectLaunchTasks.createdAt));
  }
  async createLaunchTask(data: InsertLaunchTask): Promise<LaunchTask> {
    const [entry] = await db.insert(projectLaunchTasks).values(data).returning();
    return entry;
  }
  async updateLaunchTask(id: string, data: Partial<InsertLaunchTask>): Promise<LaunchTask> {
    const [entry] = await db.update(projectLaunchTasks).set(data).where(eq(projectLaunchTasks.id, id)).returning();
    return entry;
  }
  async deleteLaunchTask(id: string): Promise<void> {
    await db.delete(projectLaunchTasks).where(eq(projectLaunchTasks.id, id));
  }

  async getNovaGuideMessages(projectId: string): Promise<NovaGuideMessage[]> {
    return db.select().from(novaGuideMessages).where(eq(novaGuideMessages.projectId, projectId)).orderBy(asc(novaGuideMessages.createdAt));
  }

  async addNovaGuideMessage(data: InsertNovaGuideMessage): Promise<NovaGuideMessage> {
    const [msg] = await db.insert(novaGuideMessages).values(data).returning();
    return msg;
  }

  async createDonation(data: InsertDonation): Promise<Donation> {
    return await db.transaction(async (tx) => {
      const [donation] = await tx.insert(donations).values(data).returning();
      await tx
        .update(projects)
        .set({ totalDonations: sql`${projects.totalDonations} + ${data.amount}` })
        .where(eq(projects.id, data.projectId));
      return donation;
    });
  }

  async getProjectDonations(projectId: string): Promise<Donation[]> {
    return await db
      .select()
      .from(donations)
      .where(eq(donations.projectId, projectId))
      .orderBy(desc(donations.createdAt));
  }

  async getUserMatches(userId: string): Promise<(UserMatch & { matchedUser: User; matchedProfile?: UserProfile })[]> {
    const matches = await db
      .select()
      .from(userMatches)
      .where(eq(userMatches.userId, userId))
      .orderBy(desc(userMatches.score));

    return await Promise.all(
      matches.map(async (match) => {
        const [matchedUser] = await db.select().from(users).where(eq(users.id, match.matchedUserId));
        const [matchedProfile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, match.matchedUserId));
        return { ...match, matchedUser, matchedProfile };
      })
    );
  }

  async upsertUserMatch(data: InsertUserMatch): Promise<UserMatch> {
    const [match] = await db
      .insert(userMatches)
      .values(data)
      .onConflictDoUpdate({
        target: [userMatches.userId, userMatches.matchedUserId],
        set: data,
      })
      .returning();
    return match;
  }

  async getLeaderboard(sortBy: "views" | "donations", limit: number, filter?: "solo" | "team" | "all", includePrivateOwnedBy?: string): Promise<(Project & { owner: User })[]> {
    const orderCol = sortBy === "views" ? projects.views : projects.totalDonations;
    const conditions = [];
    if (filter === "solo") conditions.push(eq(projects.soloMode, true));
    else if (filter === "team") conditions.push(or(eq(projects.soloMode, false), isNull(projects.soloMode))!);

    // Private projects are ranked only for their own owner — otherwise their
    // titles, owners, and view counts would be public on the leaderboard.
    conditions.push(
      includePrivateOwnedBy
        ? or(eq(projects.isPrivate, false), eq(projects.ownerId, includePrivateOwnedBy))!
        : eq(projects.isPrivate, false)
    );

    const result = await db
      .select()
      .from(projects)
      .where(and(...conditions))
      .orderBy(desc(orderCol))
      .limit(limit);

    return await Promise.all(
      result.map(async (project) => {
        const [owner] = await db.select().from(users).where(eq(users.id, project.ownerId));
        return { ...project, owner };
      })
    );
  }

  async addProjectMedia(projectId: string, objectPath: string): Promise<Project> {
    const project = await this.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const currentUrls = project.mediaUrls || [];
    const [updated] = await db
      .update(projects)
      .set({ mediaUrls: [...currentUrls, objectPath] })
      .where(eq(projects.id, projectId))
      .returning();
    return updated;
  }

  async removeProjectMedia(projectId: string, index: number): Promise<Project> {
    const project = await this.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const currentUrls = project.mediaUrls || [];
    if (index < 0 || index >= currentUrls.length) throw new Error("Invalid index");
    const newUrls = currentUrls.filter((_, i) => i !== index);
    const [updated] = await db
      .update(projects)
      .set({ mediaUrls: newUrls })
      .where(eq(projects.id, projectId))
      .returning();
    return updated;
  }

  async searchUsers(query: string): Promise<(User & { profile?: UserProfile })[]> {
    const matchingUsers = await db
      .select()
      .from(users)
      .where(
        or(
          ilike(users.firstName, `%${query}%`),
          ilike(users.lastName, `%${query}%`),
          ilike(users.email, `%${query}%`)
        )
      );

    const results = await Promise.all(
      matchingUsers.map(async (user) => {
        const profile = await this.getUserProfile(user.id);
        return { ...user, profile };
      })
    );

    return results;
  }

  async getBadges(): Promise<Badge[]> {
    return await db.select().from(badges);
  }

  async getBadge(id: string): Promise<Badge | undefined> {
    const [badge] = await db.select().from(badges).where(eq(badges.id, id));
    return badge;
  }

  async createBadge(data: InsertBadge): Promise<Badge> {
    const [badge] = await db.insert(badges).values(data).returning();
    return badge;
  }

  async getUserBadges(userId: string): Promise<(UserBadge & { badge: Badge })[]> {
    const ubs = await db.select().from(userBadges).where(eq(userBadges.userId, userId)).orderBy(desc(userBadges.awardedAt));
    const results = await Promise.all(
      ubs.map(async (ub) => {
        const [badge] = await db.select().from(badges).where(eq(badges.id, ub.badgeId));
        if (!badge) return null;
        return { ...ub, badge };
      })
    );
    return results.filter((r): r is NonNullable<typeof r> => r !== null);
  }

  /**
   * Awards a badge, or does nothing if the badge doesn't exist or the user
   * already has it.
   *
   * Badges are a cosmetic side effect of finishing a game or hitting a
   * milestone, and callers award them by hard-coded id. An unknown id used to
   * raise a foreign-key error that failed the whole request — losing the
   * player's score over a decoration. Returns null instead.
   */
  async awardBadge(userId: string, badgeId: string): Promise<UserBadge | null> {
    const badge = await this.getBadge(badgeId);
    if (!badge) {
      console.warn(`Skipping unknown badge "${badgeId}".`);
      return null;
    }

    const [already] = await db
      .select()
      .from(userBadges)
      .where(and(eq(userBadges.userId, userId), eq(userBadges.badgeId, badgeId)));
    if (already) return already;

    const [ub] = await db.insert(userBadges).values({ userId, badgeId }).returning();
    return ub;
  }

  async getContests(filters?: { status?: string }): Promise<(Contest & { badge?: Badge; participantCount: number })[]> {
    let query = db.select().from(contests);
    if (filters?.status) {
      query = query.where(eq(contests.status, filters.status as any)) as any;
    }
    const result = await (query as any).orderBy(desc(contests.promoted), desc(contests.createdAt));

    return await Promise.all(
      result.map(async (contest: Contest) => {
        const badge = contest.badgeId ? await this.getBadge(contest.badgeId) : undefined;
        const participants = await db.select().from(contestParticipants).where(eq(contestParticipants.contestId, contest.id));
        return { ...contest, badge, participantCount: participants.length };
      })
    );
  }

  async getContest(id: string): Promise<(Contest & { badge?: Badge; participantCount: number }) | undefined> {
    const [contest] = await db.select().from(contests).where(eq(contests.id, id));
    if (!contest) return undefined;
    const badge = contest.badgeId ? await this.getBadge(contest.badgeId) : undefined;
    const participants = await db.select().from(contestParticipants).where(eq(contestParticipants.contestId, id));
    return { ...contest, badge, participantCount: participants.length };
  }

  async createContest(data: InsertContest): Promise<Contest> {
    const [contest] = await db.insert(contests).values(data).returning();
    return contest;
  }

  async joinContest(contestId: string, userId: string): Promise<ContestParticipant> {
    const [participant] = await db.insert(contestParticipants).values({ contestId, userId }).returning();
    return participant;
  }

  async getContestParticipants(contestId: string): Promise<(ContestParticipant & { user: User; profile?: UserProfile })[]> {
    const parts = await db.select().from(contestParticipants).where(eq(contestParticipants.contestId, contestId));
    return await Promise.all(
      parts.map(async (p) => {
        const [user] = await db.select().from(users).where(eq(users.id, p.userId));
        const profile = await this.getUserProfile(p.userId);
        return { ...p, user, profile };
      })
    );
  }

  async submitToContest(contestId: string, userId: string, submissionUrl: string, submissionNote?: string): Promise<ContestParticipant> {
    const [updated] = await db
      .update(contestParticipants)
      .set({ submissionUrl, submissionNote })
      .where(and(eq(contestParticipants.contestId, contestId), eq(contestParticipants.userId, userId)))
      .returning();
    return updated;
  }

  async isContestParticipant(contestId: string, userId: string): Promise<boolean> {
    const [p] = await db.select().from(contestParticipants).where(and(eq(contestParticipants.contestId, contestId), eq(contestParticipants.userId, userId)));
    return !!p;
  }

  private getCreditLimit(tier: string): number {
    return getEntitlements(tier).credits;
  }

  async resetCreditsIfNeeded(userId: string): Promise<void> {
    const user = await this.getUser(userId);
    if (!user) return;

    const now = new Date();
    const resetAt = user.creditsResetAt;

    if (!resetAt || now.getMonth() !== resetAt.getMonth() || now.getFullYear() !== resetAt.getFullYear()) {
      await db.update(users).set({ creditsUsed: 0, creditsResetAt: now }).where(eq(users.id, userId));
    }
  }

  async getUserSubscription(userId: string) {
    await this.resetCreditsIfNeeded(userId);
    const user = await this.getUser(userId);
    if (!user) {
      return { tier: "free", creditsUsed: 0, creditsLimit: 20, creditsRemaining: 20, stripeCustomerId: null, stripeSubscriptionId: null };
    }
    // Legacy spark_* tiers are mapped forward so existing subscribers keep access.
    const tier = normalizeTier(user.subscriptionTier);
    const creditsLimit = this.getCreditLimit(tier);
    const creditsUsed = user.creditsUsed || 0;
    const creditsRemaining = creditsLimit === Infinity ? Infinity : Math.max(0, creditsLimit - creditsUsed);
    return {
      tier,
      creditsUsed,
      creditsLimit,
      creditsRemaining,
      stripeCustomerId: user.stripeCustomerId,
      stripeSubscriptionId: user.stripeSubscriptionId,
    };
  }

  async checkCredits(userId: string, amount: number): Promise<boolean> {
    const sub = await this.getUserSubscription(userId);
    // Unlimited tiers are still bounded by the fair-use ceiling.
    if (sub.creditsLimit === Infinity) {
      return sub.creditsUsed + amount <= FAIR_USE_MONTHLY_CAP;
    }
    return sub.creditsRemaining >= amount;
  }

  async deductCredits(userId: string, amount: number): Promise<boolean> {
    const canUse = await this.checkCredits(userId, amount);
    if (!canUse) return false;
    // Unlimited tiers increment too — usage has to be tracked for the
    // fair-use cap to mean anything, it just never blocks below the ceiling.
    await db.update(users).set({ creditsUsed: sql`${users.creditsUsed} + ${amount}` }).where(eq(users.id, userId));
    return true;
  }

  async countPrivateProjects(userId: string): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(projects)
      .where(and(eq(projects.ownerId, userId), eq(projects.isPrivate, true)));
    return row?.count || 0;
  }

  // --- Roadmaps ---
  async getProjectRoadmap(projectId: string) {
    const [roadmap] = await db
      .select()
      .from(projectRoadmaps)
      .where(and(eq(projectRoadmaps.projectId, projectId), eq(projectRoadmaps.status, "active")))
      .orderBy(desc(projectRoadmaps.createdAt))
      .limit(1);
    if (!roadmap) return undefined;
    const phases = await db
      .select()
      .from(roadmapPhases)
      .where(eq(roadmapPhases.roadmapId, roadmap.id))
      .orderBy(roadmapPhases.order);
    return { ...roadmap, phases };
  }

  async createRoadmap(data: InsertProjectRoadmap, phases: Omit<InsertRoadmapPhase, "roadmapId">[]) {
    // Only one active roadmap per project; supersede any earlier one.
    await db
      .update(projectRoadmaps)
      .set({ status: "archived" })
      .where(and(eq(projectRoadmaps.projectId, data.projectId), eq(projectRoadmaps.status, "active")));

    const [roadmap] = await db.insert(projectRoadmaps).values(data).returning();
    const inserted = phases.length
      ? await db
          .insert(roadmapPhases)
          .values(phases.map((p, i) => ({ ...p, roadmapId: roadmap.id, order: p.order ?? i })))
          .returning()
      : [];
    return { ...roadmap, phases: inserted };
  }

  async replaceRoadmapPhases(roadmapId: string, phases: Omit<InsertRoadmapPhase, "roadmapId">[]) {
    await db.delete(roadmapPhases).where(eq(roadmapPhases.roadmapId, roadmapId));
    if (!phases.length) return [];
    return db
      .insert(roadmapPhases)
      .values(phases.map((p, i) => ({ ...p, roadmapId, order: p.order ?? i })))
      .returning();
  }

  async updateRoadmap(id: string, data: Partial<ProjectRoadmap>): Promise<ProjectRoadmap> {
    const [updated] = await db
      .update(projectRoadmaps)
      .set({ ...data, lastUpdatedAt: new Date() })
      .where(eq(projectRoadmaps.id, id))
      .returning();
    return updated;
  }

  async updateRoadmapPhase(id: string, data: Partial<RoadmapPhase>): Promise<RoadmapPhase> {
    const [updated] = await db.update(roadmapPhases).set(data).where(eq(roadmapPhases.id, id)).returning();
    return updated;
  }

  async getRoadmapPhase(id: string): Promise<(RoadmapPhase & { projectId: string }) | undefined> {
    const [row] = await db
      .select({ phase: roadmapPhases, projectId: projectRoadmaps.projectId })
      .from(roadmapPhases)
      .innerJoin(projectRoadmaps, eq(roadmapPhases.roadmapId, projectRoadmaps.id))
      .where(eq(roadmapPhases.id, id));
    return row ? { ...row.phase, projectId: row.projectId } : undefined;
  }

  async deleteRoadmap(id: string): Promise<void> {
    await db.delete(roadmapPhases).where(eq(roadmapPhases.roadmapId, id));
    await db.delete(projectRoadmaps).where(eq(projectRoadmaps.id, id));
  }

  // --- Health checks ---
  async createHealthCheck(data: InsertProjectHealthCheck): Promise<ProjectHealthCheck> {
    const [check] = await db.insert(projectHealthChecks).values(data).returning();
    return check;
  }

  async getHealthChecks(projectId: string, limit = 10): Promise<ProjectHealthCheck[]> {
    return db
      .select()
      .from(projectHealthChecks)
      .where(eq(projectHealthChecks.projectId, projectId))
      .orderBy(desc(projectHealthChecks.createdAt))
      .limit(limit);
  }

  async createHealthFindingFeedback(data: InsertHealthFindingFeedback): Promise<HealthFindingFeedback> {
    const [row] = await db.insert(healthFindingFeedback).values(data).returning();
    return row;
  }

  async getHealthFindingFeedback(projectId: string): Promise<HealthFindingFeedback[]> {
    return db
      .select()
      .from(healthFindingFeedback)
      .where(eq(healthFindingFeedback.projectId, projectId))
      .orderBy(desc(healthFindingFeedback.createdAt));
  }

  /** Only the author can retract their own pushback. */
  async deleteHealthFindingFeedback(id: string, userId: string): Promise<boolean> {
    const deleted = await db
      .delete(healthFindingFeedback)
      .where(and(eq(healthFindingFeedback.id, id), eq(healthFindingFeedback.userId, userId)))
      .returning();
    return deleted.length > 0;
  }

  async getProjectFollowers(projectId: string) {
    const follows = await db
      .select()
      .from(projectFollows)
      .where(eq(projectFollows.projectId, projectId))
      .orderBy(desc(projectFollows.createdAt));

    return Promise.all(follows.map(async (f) => {
      const [user] = await db.select().from(users).where(eq(users.id, f.userId));
      const profile = await this.getUserProfile(f.userId);
      return { userId: f.userId, user, profile };
    }));
  }

  // --- Project discussion ---
  async createProjectComment(data: InsertProjectComment): Promise<ProjectComment> {
    const [comment] = await db.insert(projectComments).values(data).returning();
    return comment;
  }

  async getProjectComments(
    projectId: string,
    target?: { targetType: string; targetId: string },
    viewerId?: string
  ): Promise<ProjectCommentWithAuthor[]> {
    const rows = await db
      .select()
      .from(projectComments)
      .where(
        target
          ? and(
              eq(projectComments.projectId, projectId),
              eq(projectComments.targetType, target.targetType as any),
              eq(projectComments.targetId, target.targetId),
              isNull(projectComments.hiddenAt)
            )
          : and(eq(projectComments.projectId, projectId), isNull(projectComments.hiddenAt))
      )
      .orderBy(asc(projectComments.createdAt));

    return Promise.all(rows.map(async (c) => {
      const [author] = await db.select().from(users).where(eq(users.id, c.authorId));
      const profile = await this.getUserProfile(c.authorId);
      let viewerReacted = false;
      if (viewerId) {
        const [r] = await db
          .select()
          .from(projectCommentReactions)
          .where(and(eq(projectCommentReactions.commentId, c.id), eq(projectCommentReactions.userId, viewerId)));
        viewerReacted = !!r;
      }
      return { ...c, author, profile, viewerReacted };
    }));
  }

  /** Comment counts keyed by "<targetType>:<targetId>", for badge counts. */
  async getProjectCommentCounts(projectId: string): Promise<Record<string, number>> {
    const rows = await db
      .select({
        targetType: projectComments.targetType,
        targetId: projectComments.targetId,
        count: sql<number>`count(*)::int`,
      })
      .from(projectComments)
      .where(eq(projectComments.projectId, projectId))
      .groupBy(projectComments.targetType, projectComments.targetId);

    return Object.fromEntries(rows.map((r) => [`${r.targetType}:${r.targetId}`, r.count]));
  }

  /** Author can always delete; a project owner can moderate their own page. */
  async deleteProjectComment(id: string, userId: string): Promise<boolean> {
    const [comment] = await db.select().from(projectComments).where(eq(projectComments.id, id));
    if (!comment) return false;

    const project = await this.getProject(comment.projectId);
    const allowed = comment.authorId === userId || project?.ownerId === userId;
    if (!allowed) return false;

    await db.delete(projectComments).where(eq(projectComments.id, id));
    return true;
  }

  async toggleCommentReaction(commentId: string, userId: string) {
    const [existing] = await db
      .select()
      .from(projectCommentReactions)
      .where(and(eq(projectCommentReactions.commentId, commentId), eq(projectCommentReactions.userId, userId)));

    if (existing) {
      await db.delete(projectCommentReactions).where(eq(projectCommentReactions.id, existing.id));
    } else {
      await db.insert(projectCommentReactions).values({ commentId, userId }).onConflictDoNothing();
    }

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(projectCommentReactions)
      .where(eq(projectCommentReactions.commentId, commentId));

    await db.update(projectComments).set({ reactionCount: count }).where(eq(projectComments.id, commentId));
    return { reactionCount: count, reacted: !existing };
  }

  // --- Founder feed ---
  async createFeedPost(data: InsertFeedPost): Promise<FeedPost> {
    const [post] = await db.insert(feedPosts).values(data).returning();
    return post;
  }

  /**
   * Feed page, newest first, with everything a card needs in one pass.
   *
   * Posts about a private project are hidden from everyone but that project's
   * members — otherwise a "milestone" post would leak the existence and
   * progress of work its owner marked private.
   */
  async getFeedPosts(options: {
    viewerId?: string; limit: number; before?: string;
    authorId?: string; projectId?: string; postType?: string;
  }): Promise<FeedPostWithDetails[]> {
    const conditions = [isNull(feedPosts.hiddenAt)];
    if (options.authorId) conditions.push(eq(feedPosts.authorId, options.authorId));
    if (options.projectId) conditions.push(eq(feedPosts.projectId, options.projectId));
    if (options.postType) conditions.push(eq(feedPosts.postType, options.postType as any));
    // Keyset pagination on createdAt — stable as new posts arrive.
    if (options.before) conditions.push(lte(feedPosts.createdAt, new Date(options.before)));

    const rows = await db
      .select()
      .from(feedPosts)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(feedPosts.createdAt))
      // Over-fetch so private-project filtering can't leave a short page.
      .limit(options.limit * 2);

    const visible: typeof rows = [];
    for (const post of rows) {
      if (!post.projectId) { visible.push(post); continue; }
      const [project] = await db.select().from(projects).where(eq(projects.id, post.projectId));
      if (!project) continue;
      if (!project.isPrivate) { visible.push(post); continue; }
      if (!options.viewerId) continue;
      const isMember =
        project.ownerId === options.viewerId ||
        (await db.select().from(projectMembers).where(and(
          eq(projectMembers.projectId, project.id),
          eq(projectMembers.userId, options.viewerId)
        ))).length > 0;
      if (isMember) visible.push(post);
      if (visible.length >= options.limit) break;
    }

    return Promise.all(visible.slice(0, options.limit).map((p) => this.hydrateFeedPost(p, options.viewerId)));
  }

  async getFeedPost(id: string, viewerId?: string): Promise<FeedPostWithDetails | undefined> {
    const [post] = await db.select().from(feedPosts).where(eq(feedPosts.id, id));
    // Taken down: not there, except to its author.
    if (post?.hiddenAt && post.authorId !== viewerId) return undefined;
    if (!post) return undefined;
    return this.hydrateFeedPost(post, viewerId);
  }

  /** Attaches author, project, and the viewer's own reaction. */
  private async hydrateFeedPost(post: FeedPost, viewerId?: string): Promise<FeedPostWithDetails> {
    const [author] = await db.select().from(users).where(eq(users.id, post.authorId));
    const profile = await this.getUserProfile(post.authorId);
    const project = post.projectId
      ? (await db.select().from(projects).where(eq(projects.id, post.projectId)))[0]
      : undefined;

    let viewerReaction: string | null = null;
    if (viewerId) {
      const [reaction] = await db
        .select()
        .from(feedReactions)
        .where(and(eq(feedReactions.postId, post.id), eq(feedReactions.userId, viewerId)));
      viewerReaction = reaction?.reaction ?? null;
    }

    // Reaction mix drives the little emoji cluster on the card.
    const breakdownRows = await db
      .select({ reaction: feedReactions.reaction, count: sql<number>`count(*)::int` })
      .from(feedReactions)
      .where(eq(feedReactions.postId, post.id))
      .groupBy(feedReactions.reaction);

    return {
      ...post,
      author,
      profile,
      project: project ? { id: project.id, title: project.title, isPrivate: project.isPrivate } : null,
      viewerReaction,
      reactionBreakdown: breakdownRows.map((r) => ({ reaction: r.reaction, count: r.count })),
    };
  }

  async deleteFeedPost(id: string, authorId: string): Promise<boolean> {
    const deleted = await db
      .delete(feedPosts)
      .where(and(eq(feedPosts.id, id), eq(feedPosts.authorId, authorId)))
      .returning();
    return deleted.length > 0;
  }

  /**
   * Sets, changes, or clears the viewer's reaction and returns the new total.
   * Passing the same reaction again clears it, which is what makes the button
   * behave like a toggle.
   */
  async setFeedReaction(postId: string, userId: string, reaction: string | null) {
    if (reaction === null) {
      await db.delete(feedReactions).where(and(eq(feedReactions.postId, postId), eq(feedReactions.userId, userId)));
    } else {
      await db
        .insert(feedReactions)
        .values({ postId, userId, reaction: reaction as any })
        .onConflictDoUpdate({
          target: [feedReactions.postId, feedReactions.userId],
          set: { reaction: reaction as any },
        });
    }

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(feedReactions)
      .where(eq(feedReactions.postId, postId));

    await db.update(feedPosts).set({ reactionCount: count }).where(eq(feedPosts.id, postId));
    return { reactionCount: count, viewerReaction: reaction };
  }

  async getFeedComments(postId: string) {
    const rows = await db
      .select()
      .from(feedComments)
      .where(eq(feedComments.postId, postId))
      .orderBy(asc(feedComments.createdAt));

    return Promise.all(rows.map(async (c) => {
      const [author] = await db.select().from(users).where(eq(users.id, c.authorId));
      const profile = await this.getUserProfile(c.authorId);
      return { ...c, author, profile };
    }));
  }

  async createFeedComment(data: InsertFeedComment): Promise<FeedComment> {
    const [comment] = await db.insert(feedComments).values(data).returning();
    await db
      .update(feedPosts)
      .set({ commentCount: sql`${feedPosts.commentCount} + 1` })
      .where(eq(feedPosts.id, data.postId));
    return comment;
  }

  async deleteFeedComment(id: string, authorId: string): Promise<boolean> {
    const deleted = await db
      .delete(feedComments)
      .where(and(eq(feedComments.id, id), eq(feedComments.authorId, authorId)))
      .returning();
    if (deleted.length > 0) {
      await db
        .update(feedPosts)
        // Guard against drifting below zero if a counter ever gets out of sync.
        .set({ commentCount: sql`greatest(0, ${feedPosts.commentCount} - 1)` })
        .where(eq(feedPosts.id, deleted[0].postId));
    }
    return deleted.length > 0;
  }

  // --- Investor readiness suite ---
  async createInvestorArtifact(data: InsertInvestorArtifact): Promise<InvestorArtifact> {
    const [artifact] = await db.insert(investorArtifacts).values(data).returning();
    return artifact;
  }

  async getInvestorArtifacts(projectId: string, kind?: string): Promise<InvestorArtifact[]> {
    return db
      .select()
      .from(investorArtifacts)
      .where(
        kind
          ? and(eq(investorArtifacts.projectId, projectId), eq(investorArtifacts.kind, kind as any))
          : eq(investorArtifacts.projectId, projectId)
      )
      .orderBy(desc(investorArtifacts.createdAt));
  }

  async createMockInterview(data: InsertMockInterview): Promise<MockInterview> {
    const [interview] = await db.insert(mockInterviews).values(data).returning();
    return interview;
  }

  async getMockInterview(id: string) {
    const [interview] = await db.select().from(mockInterviews).where(eq(mockInterviews.id, id));
    if (!interview) return undefined;
    const turns = await db
      .select()
      .from(mockInterviewTurns)
      .where(eq(mockInterviewTurns.interviewId, id))
      .orderBy(asc(mockInterviewTurns.order));
    return { ...interview, turns };
  }

  async getMockInterviews(projectId: string, userId: string): Promise<MockInterview[]> {
    return db
      .select()
      .from(mockInterviews)
      .where(and(eq(mockInterviews.projectId, projectId), eq(mockInterviews.userId, userId)))
      .orderBy(desc(mockInterviews.createdAt));
  }

  async updateMockInterview(id: string, data: Partial<MockInterview>): Promise<MockInterview> {
    const [updated] = await db.update(mockInterviews).set(data).where(eq(mockInterviews.id, id)).returning();
    return updated;
  }

  async createInterviewTurn(data: InsertMockInterviewTurn): Promise<MockInterviewTurn> {
    const [turn] = await db.insert(mockInterviewTurns).values(data).returning();
    return turn;
  }

  async updateInterviewTurn(id: string, data: Partial<MockInterviewTurn>): Promise<MockInterviewTurn> {
    const [updated] = await db.update(mockInterviewTurns).set(data).where(eq(mockInterviewTurns.id, id)).returning();
    return updated;
  }

  // --- Storyboards ---
  async createStoryboard(data: InsertProjectStoryboard): Promise<ProjectStoryboard> {
    const [storyboard] = await db.insert(projectStoryboards).values(data).returning();
    return storyboard;
  }

  async getStoryboardsForUser(projectId: string, userId: string): Promise<ProjectStoryboard[]> {
    return db
      .select()
      .from(projectStoryboards)
      .where(and(eq(projectStoryboards.projectId, projectId), eq(projectStoryboards.userId, userId)))
      .orderBy(desc(projectStoryboards.createdAt));
  }

  async getStoryboardForUser(id: string, userId: string): Promise<ProjectStoryboard | undefined> {
    // Scoping the query by userId is the authorization check — a storyboard
    // belonging to someone else is indistinguishable from one that
    // doesn't exist.
    const [storyboard] = await db
      .select()
      .from(projectStoryboards)
      .where(and(eq(projectStoryboards.id, id), eq(projectStoryboards.userId, userId)));
    return storyboard;
  }

  async deleteStoryboard(id: string, userId: string): Promise<boolean> {
    const deleted = await db
      .delete(projectStoryboards)
      .where(and(eq(projectStoryboards.id, id), eq(projectStoryboards.userId, userId)))
      .returning();
    return deleted.length > 0;
  }

  // --- Connections ---
  async sendConnectionRequest(requesterId: string, receiverId: string): Promise<Connection> {
    const existing = await this.getConnectionStatus(requesterId, receiverId);
    if (existing) throw new Error("Connection already exists");
    const [conn] = await db.insert(connections).values({ requesterId, receiverId, status: "pending" }).returning();
    return conn;
  }

  async getConnectionById(connectionId: string): Promise<Connection | undefined> {
    const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId));
    return conn;
  }

  async acceptConnection(connectionId: string): Promise<Connection> {
    const [conn] = await db.update(connections).set({ status: "accepted" }).where(and(eq(connections.id, connectionId), eq(connections.status, "pending"))).returning();
    return conn;
  }

  async rejectConnection(connectionId: string): Promise<Connection> {
    const [conn] = await db.update(connections).set({ status: "rejected" }).where(and(eq(connections.id, connectionId), eq(connections.status, "pending"))).returning();
    return conn;
  }

  async removeConnection(connectionId: string): Promise<void> {
    await db.delete(connections).where(eq(connections.id, connectionId));
  }

  async getConnections(userId: string): Promise<(Connection & { user: User; profile?: UserProfile })[]> {
    const conns = await db.select().from(connections).where(
      and(
        or(eq(connections.requesterId, userId), eq(connections.receiverId, userId)),
        eq(connections.status, "accepted")
      )
    ).orderBy(desc(connections.createdAt));

    return await Promise.all(conns.map(async (conn) => {
      const otherId = conn.requesterId === userId ? conn.receiverId : conn.requesterId;
      const [user] = await db.select().from(users).where(eq(users.id, otherId));
      const profile = await this.getUserProfile(otherId);
      return { ...conn, user, profile };
    }));
  }

  async getConnectionRequests(userId: string): Promise<(Connection & { user: User; profile?: UserProfile })[]> {
    const conns = await db.select().from(connections).where(
      and(eq(connections.receiverId, userId), eq(connections.status, "pending"))
    ).orderBy(desc(connections.createdAt));

    return await Promise.all(conns.map(async (conn) => {
      const [user] = await db.select().from(users).where(eq(users.id, conn.requesterId));
      const profile = await this.getUserProfile(conn.requesterId);
      return { ...conn, user, profile };
    }));
  }

  async getConnectionStatus(userId1: string, userId2: string): Promise<Connection | undefined> {
    const [conn] = await db.select().from(connections).where(
      or(
        and(eq(connections.requesterId, userId1), eq(connections.receiverId, userId2)),
        and(eq(connections.requesterId, userId2), eq(connections.receiverId, userId1))
      )
    );
    return conn;
  }

  async getMutualConnections(userId1: string, userId2: string): Promise<string[]> {
    const conns1 = await this.getConnections(userId1);
    const conns2 = await this.getConnections(userId2);
    const set1 = new Set(conns1.map(c => c.user.id));
    const set2 = new Set(conns2.map(c => c.user.id));
    return [...set1].filter(id => set2.has(id));
  }

  // --- Direct Messages ---
  async sendDirectMessage(senderId: string, receiverId: string, content: string): Promise<DirectMessage> {
    const [msg] = await db.insert(directMessages).values({ senderId, receiverId, content, read: false }).returning();
    return msg;
  }

  async getDirectMessages(userId1: string, userId2: string, limit = 50, before?: string): Promise<DirectMessage[]> {
    let conditions = [
      or(
        and(eq(directMessages.senderId, userId1), eq(directMessages.receiverId, userId2)),
        and(eq(directMessages.senderId, userId2), eq(directMessages.receiverId, userId1))
      )
    ];
    const msgs = await db.select().from(directMessages)
      .where(and(...conditions))
      .orderBy(desc(directMessages.createdAt))
      .limit(limit);
    return msgs.reverse();
  }

  async getConversationList(userId: string): Promise<{ userId: string; user: User; profile?: UserProfile; lastMessage: DirectMessage; unreadCount: number }[]> {
    const allMsgs = await db.select().from(directMessages).where(
      or(eq(directMessages.senderId, userId), eq(directMessages.receiverId, userId))
    ).orderBy(desc(directMessages.createdAt));

    const conversationMap = new Map<string, { lastMessage: DirectMessage; unreadCount: number }>();
    for (const msg of allMsgs) {
      const otherId = msg.senderId === userId ? msg.receiverId : msg.senderId;
      if (!conversationMap.has(otherId)) {
        conversationMap.set(otherId, { lastMessage: msg, unreadCount: 0 });
      }
      if (msg.receiverId === userId && !msg.read) {
        const conv = conversationMap.get(otherId)!;
        conv.unreadCount++;
      }
    }

    const results = await Promise.all(
      Array.from(conversationMap.entries()).map(async ([otherId, data]) => {
        const [user] = await db.select().from(users).where(eq(users.id, otherId));
        const profile = await this.getUserProfile(otherId);
        return { userId: otherId, user, profile, ...data };
      })
    );

    return results.sort((a, b) => b.lastMessage.createdAt.getTime() - a.lastMessage.createdAt.getTime());
  }

  async markMessagesRead(userId: string, otherUserId: string): Promise<void> {
    await db.update(directMessages)
      .set({ read: true })
      .where(
        and(
          eq(directMessages.senderId, otherUserId),
          eq(directMessages.receiverId, userId),
          eq(directMessages.read, false)
        )
      );
  }

  async getUnreadCount(userId: string): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` })
      .from(directMessages)
      .where(and(eq(directMessages.receiverId, userId), eq(directMessages.read, false)));
    return Number(result[0]?.count || 0);
  }

  // --- Donation queries ---
  async getDonationsByDonor(donorId: string): Promise<(Donation & { project: Project })[]> {
    const dons = await db.select().from(donations).where(eq(donations.donorId, donorId)).orderBy(desc(donations.createdAt));
    return await Promise.all(dons.map(async (d) => {
      const [project] = await db.select().from(projects).where(eq(projects.id, d.projectId));
      return { ...d, project };
    }));
  }

  async getUserDonationEarnings(userId: string): Promise<{ total: number; donations: Donation[] }> {
    const userProjects = await db.select().from(projects).where(eq(projects.ownerId, userId));
    if (userProjects.length === 0) return { total: 0, donations: [] };
    const projectIds = userProjects.map(p => p.id);
    const dons = await db.select().from(donations).where(inArray(donations.projectId, projectIds)).orderBy(desc(donations.createdAt));
    const total = dons.reduce((sum, d) => sum + d.amount, 0);
    return { total, donations: dons };
  }

  async getUserProjects(userId: string): Promise<Project[]> {
    const owned = await db.select().from(projects).where(eq(projects.ownerId, userId)).orderBy(desc(projects.createdAt));
    const memberOf = await db.select().from(projectMembers).where(eq(projectMembers.userId, userId));
    const memberProjectIds = memberOf.map(m => m.projectId).filter(id => !owned.some(p => p.id === id));
    let memberProjects: Project[] = [];
    if (memberProjectIds.length > 0) {
      memberProjects = await db.select().from(projects).where(inArray(projects.id, memberProjectIds));
    }
    return [...owned, ...memberProjects];
  }

  async updateUserStripeInfo(userId: string, data: { stripeCustomerId?: string; stripeSubscriptionId?: string; subscriptionTier?: string }): Promise<User> {
    const [user] = await db.update(users).set(data).where(eq(users.id, userId)).returning();
    return user;
  }

  // --- Project Applications ---
  async createApplication(data: { projectId: string; userId: string; resumeUrl?: string; answers?: any; message?: string }): Promise<ProjectApplication> {
    const [app] = await db.insert(projectApplications).values({
      projectId: data.projectId,
      userId: data.userId,
      status: "pending",
      resumeUrl: data.resumeUrl || null,
      answers: data.answers || [],
      message: data.message || null,
    }).returning();
    return app;
  }

  async getProjectApplications(projectId: string): Promise<(ProjectApplication & { user: User; profile?: UserProfile })[]> {
    const apps = await db.select().from(projectApplications).where(eq(projectApplications.projectId, projectId)).orderBy(desc(projectApplications.createdAt));
    return await Promise.all(apps.map(async (app) => {
      const [user] = await db.select().from(users).where(eq(users.id, app.userId));
      const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, app.userId));
      return { ...app, user, profile };
    }));
  }

  async getUserApplications(userId: string): Promise<(ProjectApplication & { project: Project })[]> {
    const apps = await db.select().from(projectApplications).where(eq(projectApplications.userId, userId)).orderBy(desc(projectApplications.createdAt));
    return await Promise.all(apps.map(async (app) => {
      const [project] = await db.select().from(projects).where(eq(projects.id, app.projectId));
      return { ...app, project };
    }));
  }

  async getApplication(id: string): Promise<ProjectApplication | undefined> {
    const [app] = await db.select().from(projectApplications).where(eq(projectApplications.id, id));
    return app;
  }

  async updateApplicationStatus(id: string, status: "accepted" | "rejected"): Promise<ProjectApplication> {
    const [app] = await db.update(projectApplications).set({ status }).where(eq(projectApplications.id, id)).returning();
    return app;
  }

  // --- Project Follows ---
  async followProject(userId: string, projectId: string): Promise<ProjectFollow> {
    const [follow] = await db.insert(projectFollows).values({ userId, projectId }).returning();
    return follow;
  }

  async unfollowProject(userId: string, projectId: string): Promise<void> {
    await db.delete(projectFollows).where(and(eq(projectFollows.userId, userId), eq(projectFollows.projectId, projectId)));
  }

  async isFollowing(userId: string, projectId: string): Promise<boolean> {
    const [f] = await db.select().from(projectFollows).where(and(eq(projectFollows.userId, userId), eq(projectFollows.projectId, projectId)));
    return !!f;
  }

  async getUserFollowedProjects(userId: string): Promise<(ProjectFollow & { project: Project & { owner: User } })[]> {
    const follows = await db.select().from(projectFollows).where(eq(projectFollows.userId, userId)).orderBy(desc(projectFollows.createdAt));
    return await Promise.all(follows.map(async (f) => {
      const [project] = await db.select().from(projects).where(eq(projects.id, f.projectId));
      const [owner] = await db.select().from(users).where(eq(users.id, project.ownerId));
      return { ...f, project: { ...project, owner } };
    }));
  }

  async getProjectFollowerCount(projectId: string): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` }).from(projectFollows).where(eq(projectFollows.projectId, projectId));
    return Number(result[0]?.count || 0);
  }

  // --- Kanban Tasks ---
  async getProjectKanbanTasks(projectId: string): Promise<(ProjectKanbanTask & { assignee?: User & { profile?: UserProfile } })[]> {
    const tasks = await db.select().from(projectKanbanTasks).where(eq(projectKanbanTasks.projectId, projectId)).orderBy(asc(projectKanbanTasks.order), asc(projectKanbanTasks.createdAt));
    return await Promise.all(tasks.map(async (task) => {
      if (!task.assigneeId) return { ...task, assignee: undefined };
      const [assigneeUser] = await db.select().from(users).where(eq(users.id, task.assigneeId));
      const [assigneeProfile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, task.assigneeId));
      return { ...task, assignee: assigneeUser ? { ...assigneeUser, profile: assigneeProfile } : undefined };
    }));
  }

  async getKanbanTask(id: string): Promise<ProjectKanbanTask | undefined> {
    const [task] = await db.select().from(projectKanbanTasks).where(eq(projectKanbanTasks.id, id));
    return task;
  }

  async createKanbanTask(data: InsertProjectKanbanTask): Promise<ProjectKanbanTask> {
    const [task] = await db.insert(projectKanbanTasks).values(data).returning();
    return task;
  }

  async updateKanbanTask(id: string, data: Partial<InsertProjectKanbanTask>): Promise<ProjectKanbanTask> {
    const [task] = await db.update(projectKanbanTasks).set(data).where(eq(projectKanbanTasks.id, id)).returning();
    return task;
  }

  async deleteKanbanTask(id: string): Promise<void> {
    await db.delete(projectKanbanTasks).where(eq(projectKanbanTasks.id, id));
  }

  async clearProjectKanbanTasks(projectId: string, onlyStatus?: string): Promise<number> {
    const where = onlyStatus
      ? and(eq(projectKanbanTasks.projectId, projectId), eq(projectKanbanTasks.status, onlyStatus as any))
      : eq(projectKanbanTasks.projectId, projectId);
    const removed = await db.delete(projectKanbanTasks).where(where).returning({ id: projectKanbanTasks.id });
    return removed.length;
  }

  // --- Durable execution counters ---

  async getUserTaskStats(userId: string): Promise<UserTaskStats | undefined> {
    const [row] = await db.select().from(userTaskStats).where(eq(userTaskStats.userId, userId));
    return row;
  }

  /**
   * Ratchets the banked counters up to at least the given totals.
   *
   * Only ever increases, so it's safe to call repeatedly and safe to call
   * before a delete: the banked figure keeps the execution credit that the
   * rows themselves were evidencing. Also backfills users whose completions
   * predate these counters, since it takes the max against live totals.
   */
  async bankUserTaskStats(
    userId: string,
    totals: { completed: number; onTime: number; lastCompletedAt?: Date | null },
  ): Promise<UserTaskStats> {
    const existing = await this.getUserTaskStats(userId);
    const completed = Math.max(existing?.tasksCompleted ?? 0, totals.completed);
    const onTime = Math.max(existing?.tasksCompletedOnTime ?? 0, totals.onTime);
    const lastCompletedAt = totals.lastCompletedAt ?? existing?.lastCompletedAt ?? null;

    if (!existing) {
      const [row] = await db.insert(userTaskStats)
        .values({ userId, tasksCompleted: completed, tasksCompletedOnTime: onTime, lastCompletedAt })
        .returning();
      return row;
    }
    const [row] = await db.update(userTaskStats)
      .set({ tasksCompleted: completed, tasksCompletedOnTime: onTime, lastCompletedAt, updatedAt: new Date() })
      .where(eq(userTaskStats.userId, userId))
      .returning();
    return row;
  }

  /**
   * Live done/on-time totals across every project the user owns or belongs to.
   * Mirrors the attribution rule in getReputationStats: a task counts if it's
   * assigned to them, or sits in a project they own.
   */
  async countUserCompletedTasks(userId: string): Promise<{ completed: number; onTime: number; lastCompletedAt: Date | null }> {
    const owned = await db.select().from(projects).where(eq(projects.ownerId, userId));
    const memberOf = await db.select().from(projectMembers).where(eq(projectMembers.userId, userId));
    const ownedIds = new Set(owned.map((p) => p.id));
    const projectIds = [...new Set([...ownedIds, ...memberOf.map((m) => m.projectId)])];

    let completed = 0, onTime = 0;
    let lastCompletedAt: Date | null = null;

    for (const pid of projectIds) {
      const rows = await db.select().from(projectKanbanTasks).where(eq(projectKanbanTasks.projectId, pid));
      for (const t of rows) {
        if (t.status !== "done") continue;
        if (t.assigneeId !== userId && !ownedIds.has(pid)) continue;
        completed++;
        if (isTaskOnTime(t)) onTime++;
        const at = t.completedAt ? new Date(t.completedAt) : null;
        if (at && (!lastCompletedAt || at > lastCompletedAt)) lastCompletedAt = at;
      }
    }
    return { completed, onTime, lastCompletedAt };
  }

  // --- Nova codebase audits ---
  async createCodeAudit(data: InsertProjectCodeAudit): Promise<ProjectCodeAudit> {
    const [row] = await db.insert(projectCodeAudits).values(data).returning();
    return row;
  }

  async getCodeAudit(id: string): Promise<ProjectCodeAudit | undefined> {
    const [row] = await db.select().from(projectCodeAudits).where(eq(projectCodeAudits.id, id));
    return row;
  }

  async getCodeAudits(projectId: string, limit = 20): Promise<ProjectCodeAudit[]> {
    return db
      .select()
      .from(projectCodeAudits)
      .where(eq(projectCodeAudits.projectId, projectId))
      .orderBy(desc(projectCodeAudits.createdAt))
      .limit(limit);
  }

  async getLatestCodeAudit(projectId: string): Promise<ProjectCodeAudit | undefined> {
    const [row] = await db
      .select()
      .from(projectCodeAudits)
      .where(eq(projectCodeAudits.projectId, projectId))
      .orderBy(desc(projectCodeAudits.createdAt))
      .limit(1);
    return row;
  }

  async updateCodeAudit(id: string, data: Partial<InsertProjectCodeAudit>): Promise<ProjectCodeAudit> {
    const [row] = await db.update(projectCodeAudits).set(data).where(eq(projectCodeAudits.id, id)).returning();
    return row;
  }

  async deleteCodeAudit(id: string): Promise<void> {
    await db.delete(projectCodeAudits).where(eq(projectCodeAudits.id, id));
  }

  // --- Nova-built documents ---
  async createDocument(data: InsertProjectDocument): Promise<ProjectDocument> {
    const [row] = await db.insert(projectDocuments).values(data).returning();
    return row;
  }

  async getDocument(id: string): Promise<ProjectDocument | undefined> {
    const [row] = await db.select().from(projectDocuments).where(eq(projectDocuments.id, id));
    return row;
  }

  async getProjectDocuments(projectId: string): Promise<ProjectDocument[]> {
    return db
      .select()
      .from(projectDocuments)
      .where(eq(projectDocuments.projectId, projectId))
      .orderBy(desc(projectDocuments.updatedAt));
  }

  async updateDocument(id: string, data: Partial<InsertProjectDocument>): Promise<ProjectDocument> {
    const [row] = await db
      .update(projectDocuments)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(projectDocuments.id, id))
      .returning();
    return row;
  }

  async deleteDocument(id: string): Promise<void> {
    await db.delete(projectDocuments).where(eq(projectDocuments.id, id));
  }

  /**
   * Archives one completion against the project.
   *
   * Idempotent on taskId, so moving a card out of done and back can't inflate
   * the history — the first completion is the one that counts.
   */
  async recordTaskCompletion(data: InsertProjectTaskCompletion): Promise<void> {
    await db.insert(projectTaskCompletions).values(data).onConflictDoNothing({
      target: projectTaskCompletions.taskId,
    });
  }

  /**
   * Everything this project has ever finished, newest first.
   *
   * Backfills on read: any card currently sitting in done that predates the
   * archive gets a row now, so history isn't blank for projects that were
   * already running. Cards cleared before the archive existed are
   * unrecoverable here — the user-level banked total is what covers those.
   */
  async getProjectTaskCompletions(projectId: string, limit = 50): Promise<ProjectTaskCompletion[]> {
    const liveDone = (await db
      .select()
      .from(projectKanbanTasks)
      .where(and(eq(projectKanbanTasks.projectId, projectId), eq(projectKanbanTasks.status, "done"))));

    for (const t of liveDone) {
      await this.recordTaskCompletion({
        projectId,
        taskId: t.id,
        completedById: t.completedById ?? null,
        title: t.title,
        priority: t.priority,
        onTime: isTaskOnTime(t),
        completedAt: t.completedAt ?? new Date(),
      }).catch(() => { /* a backfill race is harmless — the unique index wins */ });
    }

    return db
      .select()
      .from(projectTaskCompletions)
      .where(eq(projectTaskCompletions.projectId, projectId))
      .orderBy(desc(projectTaskCompletions.completedAt))
      .limit(limit);
  }

  /** Lifetime completion totals for a project, independent of the live board. */
  async getProjectCompletionStats(projectId: string): Promise<{
    completed: number; onTime: number; lastCompletedAt: Date | null;
  }> {
    // Read through the archive so the backfill runs before we count.
    const rows = await this.getProjectTaskCompletions(projectId, 1000);
    return {
      completed: rows.length,
      onTime: rows.filter((r) => r.onTime).length,
      lastCompletedAt: rows[0]?.completedAt ?? null,
    };
  }

  /** Banks a user's current live totals. Call before deleting any task. */
  async bankExecutionCredit(userId: string): Promise<void> {
    const live = await this.countUserCompletedTasks(userId);
    await this.bankUserTaskStats(userId, live);
  }

  /**
   * Records one fresh task completion.
   *
   * This has to add rather than take a maximum against the live board: after a
   * builder clears finished tasks, the live count restarts from zero, so a
   * maximum would silently swallow every completion that followed the clear.
   * Called only on the first transition into "done" (guarded by the task's
   * previous `completedAt`), so re-completing the same task can't inflate it.
   */
  async incrementUserTaskCompletion(userId: string, onTime: boolean): Promise<void> {
    const existing = await this.getUserTaskStats(userId);
    if (!existing) {
      // Seed from the live board first so completions predating these
      // counters aren't lost, then count this one on top.
      const live = await this.countUserCompletedTasks(userId);
      await db.insert(userTaskStats).values({
        userId,
        tasksCompleted: live.completed,
        tasksCompletedOnTime: live.onTime,
        lastCompletedAt: new Date(),
      });
      return;
    }
    await db.update(userTaskStats)
      .set({
        tasksCompleted: existing.tasksCompleted + 1,
        tasksCompletedOnTime: existing.tasksCompletedOnTime + (onTime ? 1 : 0),
        lastCompletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(userTaskStats.userId, userId));
  }

  // --- Personas ---
  async getProjectPersonas(projectId: string): Promise<ProjectPersona[]> {
    return await db.select().from(projectPersonas).where(eq(projectPersonas.projectId, projectId)).orderBy(desc(projectPersonas.createdAt));
  }

  async getPersona(id: string): Promise<ProjectPersona | undefined> {
    const [persona] = await db.select().from(projectPersonas).where(eq(projectPersonas.id, id));
    return persona;
  }

  async createPersona(data: InsertProjectPersona): Promise<ProjectPersona> {
    const [persona] = await db.insert(projectPersonas).values(data).returning();
    return persona;
  }

  async deletePersona(id: string): Promise<void> {
    await db.delete(projectPersonas).where(eq(projectPersonas.id, id));
  }

  // --- Milestones ---
  async getProjectMilestones(projectId: string): Promise<ProjectMilestone[]> {
    return await db.select().from(projectMilestones).where(eq(projectMilestones.projectId, projectId)).orderBy(asc(projectMilestones.order), asc(projectMilestones.createdAt));
  }

  async createMilestone(data: InsertProjectMilestone): Promise<ProjectMilestone> {
    const [milestone] = await db.insert(projectMilestones).values(data).returning();
    return milestone;
  }

  async getMilestone(id: string): Promise<ProjectMilestone | undefined> {
    const [milestone] = await db.select().from(projectMilestones).where(eq(projectMilestones.id, id));
    return milestone;
  }

  async updateMilestone(id: string, data: Partial<InsertProjectMilestone>): Promise<ProjectMilestone> {
    const [milestone] = await db.update(projectMilestones).set(data).where(eq(projectMilestones.id, id)).returning();
    return milestone;
  }

  async deleteMilestone(id: string): Promise<void> {
    await db.delete(projectMilestones).where(eq(projectMilestones.id, id));
  }

  // --- Activity Log ---
  async logActivity(data: InsertProjectActivityLog): Promise<ProjectActivityLog> {
    const [entry] = await db.insert(projectActivityLog).values(data).returning();
    return entry;
  }

  async getProjectActivity(projectId: string, limit: number = 50): Promise<(ProjectActivityLog & { user?: User })[]> {
    const entries = await db.select().from(projectActivityLog).where(eq(projectActivityLog.projectId, projectId)).orderBy(desc(projectActivityLog.createdAt)).limit(limit);
    return await Promise.all(entries.map(async (entry) => {
      if (!entry.userId) return { ...entry, user: undefined };
      const [user] = await db.select().from(users).where(eq(users.id, entry.userId));
      return { ...entry, user };
    }));
  }

  // --- Decisions ---
  async getProjectDecisions(projectId: string): Promise<(ProjectDecision & { user: User })[]> {
    const decisions = await db.select().from(projectDecisions).where(eq(projectDecisions.projectId, projectId)).orderBy(desc(projectDecisions.createdAt));
    return await Promise.all(decisions.map(async (d) => {
      const [user] = await db.select().from(users).where(eq(users.id, d.userId));
      return { ...d, user };
    }));
  }

  async createDecision(data: InsertProjectDecision): Promise<ProjectDecision> {
    const [decision] = await db.insert(projectDecisions).values(data).returning();
    return decision;
  }

  async updateDecision(id: string, data: Partial<InsertProjectDecision>): Promise<ProjectDecision> {
    const [decision] = await db.update(projectDecisions).set(data).where(eq(projectDecisions.id, id)).returning();
    return decision;
  }

  async deleteDecision(id: string): Promise<void> {
    await db.delete(projectDecisions).where(eq(projectDecisions.id, id));
  }

  // --- Check-ins ---
  async getProjectCheckIns(projectId: string): Promise<(ProjectCheckIn & { user: User; profile?: UserProfile })[]> {
    const checkIns = await db.select().from(projectCheckIns).where(eq(projectCheckIns.projectId, projectId)).orderBy(desc(projectCheckIns.createdAt));
    return await Promise.all(checkIns.map(async (ci) => {
      const [user] = await db.select().from(users).where(eq(users.id, ci.userId));
      const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, ci.userId));
      return { ...ci, user, profile };
    }));
  }

  async createCheckIn(data: InsertProjectCheckIn): Promise<ProjectCheckIn> {
    const [checkIn] = await db.insert(projectCheckIns).values(data).returning();
    return checkIn;
  }

  // --- Files ---
  async getProjectFiles(projectId: string): Promise<(ProjectFile & { uploader: User })[]> {
    const files = await db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId)).orderBy(desc(projectFiles.createdAt));
    return await Promise.all(files.map(async (f) => {
      const [uploader] = await db.select().from(users).where(eq(users.id, f.uploaderId));
      return { ...f, uploader };
    }));
  }

  async createProjectFile(data: InsertProjectFile): Promise<ProjectFile> {
    const [file] = await db.insert(projectFiles).values(data).returning();
    return file;
  }

  async updateProjectFile(id: string, data: Partial<InsertProjectFile>): Promise<ProjectFile> {
    const [row] = await db.update(projectFiles).set(data).where(eq(projectFiles.id, id)).returning();
    return row;
  }

  async deleteProjectFile(id: string): Promise<void> {
    await db.delete(projectFiles).where(eq(projectFiles.id, id));
  }

  // --- Links ---
  async getProjectLinks(projectId: string): Promise<ProjectLink[]> {
    return await db.select().from(projectLinks).where(eq(projectLinks.projectId, projectId)).orderBy(desc(projectLinks.createdAt));
  }

  async createProjectLink(data: InsertProjectLink): Promise<ProjectLink> {
    const [link] = await db.insert(projectLinks).values(data).returning();
    return link;
  }

  async deleteProjectLink(id: string): Promise<void> {
    await db.delete(projectLinks).where(eq(projectLinks.id, id));
  }

  // --- Project Members (enhanced) ---
  async updateProjectMember(projectId: string, userId: string, data: { timezone?: string; availability?: string; hoursPerWeek?: number; skills?: string[] }): Promise<ProjectMember> {
    const [member] = await db.update(projectMembers).set(data).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId))).returning();
    return member;
  }

  // === GAME METHODS ===

  async createLeaderboardEntry(data: InsertGameLeaderboardEntry): Promise<GameLeaderboardEntry> {
    const [entry] = await db.insert(gameLeaderboard).values(data).returning();
    return entry;
  }

  async getGameLeaderboard(gameType: string, limit: number = 50): Promise<(GameLeaderboardEntry & { user: User; profile?: UserProfile })[]> {
    const entries = await db.select().from(gameLeaderboard).where(eq(gameLeaderboard.gameType, gameType as typeof gameLeaderboard.$inferSelect.gameType)).orderBy(desc(gameLeaderboard.score)).limit(limit);
    return await Promise.all(entries.map(async (e) => {
      const [user] = await db.select().from(users).where(eq(users.id, e.userId));
      const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, e.userId));
      return { ...e, user, profile };
    }));
  }

  // --- Typing ---
  async createTypingRace(data: InsertTypingRace): Promise<TypingRace> {
    const [race] = await db.insert(typingRaces).values(data).returning();
    return race;
  }

  async getTypingRace(id: string): Promise<TypingRace | undefined> {
    const [race] = await db.select().from(typingRaces).where(eq(typingRaces.id, id));
    return race;
  }

  async updateTypingRace(id: string, data: Partial<TypingRace>): Promise<TypingRace> {
    const [race] = await db.update(typingRaces).set(data).where(eq(typingRaces.id, id)).returning();
    return race;
  }

  async getWaitingTypingRaces(): Promise<TypingRace[]> {
    return db.select().from(typingRaces).where(eq(typingRaces.status, "waiting")).orderBy(desc(typingRaces.createdAt));
  }

  async createTypingRacePlayer(data: InsertTypingRacePlayer): Promise<TypingRacePlayer> {
    const [player] = await db.insert(typingRacePlayers).values(data).returning();
    return player;
  }

  async getTypingRacePlayers(raceId: string): Promise<(TypingRacePlayer & { user: User; profile?: UserProfile })[]> {
    const players = await db.select().from(typingRacePlayers).where(eq(typingRacePlayers.raceId, raceId));
    return await Promise.all(players.map(async (p) => {
      const [user] = await db.select().from(users).where(eq(users.id, p.userId));
      const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, p.userId));
      return { ...p, user, profile };
    }));
  }

  async updateTypingRacePlayer(id: string, data: Partial<TypingRacePlayer>): Promise<TypingRacePlayer> {
    const [player] = await db.update(typingRacePlayers).set(data).where(eq(typingRacePlayers.id, id)).returning();
    return player;
  }

  // --- Signal/Noise ---
  async createSignalNoiseGame(data: InsertSignalNoiseGame): Promise<SignalNoiseGame> {
    const [game] = await db.insert(signalNoiseGames).values(data).returning();
    return game;
  }

  async getSignalNoiseGame(id: string): Promise<SignalNoiseGame | undefined> {
    const [game] = await db.select().from(signalNoiseGames).where(eq(signalNoiseGames.id, id));
    return game;
  }

  async updateSignalNoiseGame(id: string, data: Partial<SignalNoiseGame>): Promise<SignalNoiseGame> {
    const [game] = await db.update(signalNoiseGames).set(data).where(eq(signalNoiseGames.id, id)).returning();
    return game;
  }

  async getUserSignalNoiseHistory(userId: string, limit: number = 20): Promise<SignalNoiseGame[]> {
    return db.select().from(signalNoiseGames).where(eq(signalNoiseGames.userId, userId)).orderBy(desc(signalNoiseGames.createdAt)).limit(limit);
  }

  async getUserReputation(userId: string): Promise<UserReputation | undefined> {
    const [rep] = await db.select().from(userReputationScores).where(eq(userReputationScores.userId, userId));
    return rep;
  }

  async upsertUserReputation(data: InsertUserReputation): Promise<UserReputation> {
    const [rep] = await db
      .insert(userReputationScores)
      .values({ ...data, lastCalculatedAt: new Date() })
      .onConflictDoUpdate({
        target: userReputationScores.userId,
        set: { ...data, lastCalculatedAt: new Date() },
      })
      .returning();
    return rep;
  }

  async getReputationLeaderboard(limit: number, filter?: "solo" | "team" | "all"): Promise<(UserReputation & { user: User; profile?: UserProfile })[]> {
    const reps = await db.select().from(userReputationScores).orderBy(desc(userReputationScores.builderIndex)).limit(limit * 2);
    
    const results: (UserReputation & { user: User; profile?: UserProfile })[] = [];
    for (const rep of reps) {
      const [user] = await db.select().from(users).where(eq(users.id, rep.userId));
      if (!user) continue;
      
      if (filter === "solo" || filter === "team") {
        const userProjects = await db.select().from(projects).where(eq(projects.ownerId, rep.userId));
        const hasSolo = userProjects.some(p => p.soloMode === true);
        const hasTeam = userProjects.some(p => p.soloMode !== true);
        if (filter === "solo" && !hasSolo) continue;
        if (filter === "team" && !hasTeam) continue;
      }
      
      const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, rep.userId));
      results.push({ ...rep, user, profile: profile || undefined });
      if (results.length >= limit) break;
    }
    return results;
  }

  async getReputationStats(userId: string) {
    const ownedProjects = await db.select().from(projects).where(eq(projects.ownerId, userId));
    const memberRecords = await db.select().from(projectMembers).where(eq(projectMembers.userId, userId));
    
    const allProjectIds = [
      ...ownedProjects.map(p => p.id),
      ...memberRecords.map(m => m.projectId),
    ];
    
    let totalMilestones = 0, completedMilestones = 0;
    let totalTasks = 0, doneTasks = 0, onTimeTasks = 0;
    let checkInCount = 0;
    
    for (const pid of [...new Set(allProjectIds)]) {
      const milestones = await db.select().from(projectMilestones).where(eq(projectMilestones.projectId, pid));
      totalMilestones += milestones.length;
      completedMilestones += milestones.filter(m => m.status === "completed").length;
      
      const tasks = await db.select().from(projectKanbanTasks).where(eq(projectKanbanTasks.projectId, pid));
      const userTasks = tasks.filter(t => t.assigneeId === userId || ownedProjects.some(p => p.id === pid));
      totalTasks += userTasks.length;
      doneTasks += userTasks.filter(t => t.status === "done").length;
      // Judged against when the task was actually finished, not against now.
      onTimeTasks += userTasks.filter(t => isTaskOnTime(t)).length;
      
      const checkIns = await db.select().from(projectCheckIns).where(and(eq(projectCheckIns.projectId, pid), eq(projectCheckIns.userId, userId)));
      checkInCount += checkIns.length;
    }
    
    const follows = await db.select().from(projectFollows).where(eq(projectFollows.userId, userId));
    
    let donationsReceived = 0;
    for (const p of ownedProjects) {
      donationsReceived += p.totalDonations || 0;
    }
    
    const applications = await db.select().from(projectApplications).where(eq(projectApplications.userId, userId));
    
    let activityLogCount = 0;
    for (const pid of [...new Set(allProjectIds)]) {
      const logs = await db.select().from(projectActivityLog).where(and(eq(projectActivityLog.projectId, pid), eq(projectActivityLog.userId, userId)));
      activityLogCount += logs.length;
    }
    
    const allContestParticipants = await db.select().from(contestParticipants).where(eq(contestParticipants.userId, userId));
    let contestWins = 0;
    for (const cp of allContestParticipants) {
      const allInContest = await db.select().from(contestParticipants).where(eq(contestParticipants.contestId, cp.contestId));
      const sorted = allInContest.filter(p => p.score !== null).sort((a, b) => (b.score || 0) - (a.score || 0));
      if (sorted.length > 0 && sorted[0].userId === userId) contestWins++;
    }
    
    const gameScores = await db.select().from(gameLeaderboard).where(eq(gameLeaderboard.userId, userId));
    const bestByType = new Map<string, number>();
    for (const gs of gameScores) {
      const current = bestByType.get(gs.gameType) || 0;
      if (gs.score > current) bestByType.set(gs.gameType, gs.score);
    }
    const bestGameScores = Array.from(bestByType.entries()).map(([gameType, score]) => ({ gameType, score }));
    
    /*
     * Execution credit is the greater of what's on the board now and what was
     * banked before tasks were deleted, so tidying a board never costs score.
     * `total` is lifted alongside `done` so the done/total ratios used by the
     * execution and contribution scores can't exceed 1.
     */
    const banked = await this.getUserTaskStats(userId);
    const effectiveDone = Math.max(doneTasks, banked?.tasksCompleted ?? 0);
    const effectiveOnTime = Math.min(
      effectiveDone,
      Math.max(onTimeTasks, banked?.tasksCompletedOnTime ?? 0),
    );
    const effectiveTotal = Math.max(totalTasks, effectiveDone);

    return {
      ownedProjects,
      memberProjects: memberRecords,
      milestones: { total: totalMilestones, completed: completedMilestones },
      tasks: { total: effectiveTotal, done: effectiveDone, onTime: effectiveOnTime },
      checkIns: checkInCount,
      followedProjects: follows.length,
      donationsReceived,
      applicationsSubmitted: applications.length,
      activityLogCount,
      contestWins,
      bestGameScores,
    };
  }
  // Co-Founder Sprint Storage
  async createSprint(data: InsertCofounderSprint): Promise<CofounderSprint> {
    const [sprint] = await db.insert(cofounderSprints).values(data).returning();
    return sprint;
  }

  async getSprint(id: string): Promise<CofounderSprint | undefined> {
    const [sprint] = await db.select().from(cofounderSprints).where(eq(cofounderSprints.id, id));
    return sprint;
  }

  async updateSprint(id: string, data: Partial<CofounderSprint>): Promise<CofounderSprint> {
    const [updated] = await db.update(cofounderSprints).set(data).where(eq(cofounderSprints.id, id)).returning();
    return updated;
  }

  async getSprintsByUser(userId: string): Promise<(CofounderSprint & { user1: User; user2: User })[]> {
    const sprints = await db.select().from(cofounderSprints)
      .where(or(eq(cofounderSprints.user1Id, userId), eq(cofounderSprints.user2Id, userId)))
      .orderBy(desc(cofounderSprints.createdAt));
    return Promise.all(sprints.map(async (s) => {
      const [u1] = await db.select().from(users).where(eq(users.id, s.user1Id));
      const [u2] = await db.select().from(users).where(eq(users.id, s.user2Id));
      return { ...s, user1: u1, user2: u2 };
    }));
  }

  async addSprintResponse(data: { sprintId: string; userId: string; questionKey: string; answer: string; isNova?: boolean }): Promise<SprintResponse> {
    // In a practice sprint both the human and Nova share userId, so isNova is
    // part of the identity of a response — without it Nova's answer would
    // overwrite the builder's answer to the same question.
    const existing = await db.select().from(sprintResponses)
      .where(and(
        eq(sprintResponses.sprintId, data.sprintId),
        eq(sprintResponses.userId, data.userId),
        eq(sprintResponses.questionKey, data.questionKey),
        eq(sprintResponses.isNova, data.isNova === true),
      ));
    if (existing.length > 0) {
      const [updated] = await db.update(sprintResponses).set({ answer: data.answer }).where(eq(sprintResponses.id, existing[0].id)).returning();
      return updated;
    }
    const [resp] = await db.insert(sprintResponses).values(data).returning();
    return resp;
  }

  async getSprintResponses(sprintId: string, userId?: string): Promise<SprintResponse[]> {
    const conditions = [eq(sprintResponses.sprintId, sprintId)];
    if (userId) conditions.push(eq(sprintResponses.userId, userId));
    return db.select().from(sprintResponses).where(and(...conditions)).orderBy(asc(sprintResponses.createdAt));
  }

  async addSprintDeliverable(data: { sprintId: string; type: string; content: any; userId?: string }): Promise<SprintDeliverable> {
    const existing = await db.select().from(sprintDeliverables)
      .where(and(eq(sprintDeliverables.sprintId, data.sprintId), eq(sprintDeliverables.type, data.type)));
    if (existing.length > 0) {
      const [updated] = await db.update(sprintDeliverables).set({ content: data.content, userId: data.userId || null }).where(eq(sprintDeliverables.id, existing[0].id)).returning();
      return updated;
    }
    const [del] = await db.insert(sprintDeliverables).values(data).returning();
    return del;
  }

  async getSprintDeliverables(sprintId: string): Promise<SprintDeliverable[]> {
    return db.select().from(sprintDeliverables).where(eq(sprintDeliverables.sprintId, sprintId));
  }

  async addSprintRating(data: { sprintId: string; raterId: string; rateeId: string; communicationClarity: number; reliability: number; wouldBuildLongTerm: boolean; stressLevel: number }): Promise<SprintRating> {
    const [rating] = await db.insert(sprintRatings).values(data).returning();
    return rating;
  }

  async getSprintRatings(sprintId: string): Promise<SprintRating[]> {
    return db.select().from(sprintRatings).where(eq(sprintRatings.sprintId, sprintId));
  }

  async addSprintDecision(data: { sprintId: string; userId: string; decision: string; reason: string }): Promise<SprintDecision> {
    const [dec] = await db.insert(sprintDecisions).values(data as typeof sprintDecisions.$inferInsert).returning();
    return dec;
  }

  async getSprintDecisions(sprintId: string): Promise<SprintDecision[]> {
    return db.select().from(sprintDecisions).where(eq(sprintDecisions.sprintId, sprintId));
  }

  async sendSprintMessage(data: { sprintId: string; userId: string; content: string; isNova?: boolean }): Promise<SprintMessage> {
    const [msg] = await db.insert(sprintMessages).values(data).returning();
    return msg;
  }

  async getSprintMessages(sprintId: string): Promise<(SprintMessage & { user: User })[]> {
    const msgs = await db.select().from(sprintMessages).where(eq(sprintMessages.sprintId, sprintId)).orderBy(asc(sprintMessages.createdAt));
    return Promise.all(msgs.map(async (m) => {
      const [user] = await db.select().from(users).where(eq(users.id, m.userId));
      return { ...m, user };
    }));
  }

  async getSprintTasks(sprintId: string): Promise<SprintKanbanTask[]> {
    return db.select().from(sprintKanbanTasks).where(eq(sprintKanbanTasks.sprintId, sprintId)).orderBy(asc(sprintKanbanTasks.order));
  }

  async createSprintTask(data: { sprintId: string; title: string; description?: string; order?: number; assigneeId?: string }): Promise<SprintKanbanTask> {
    const [task] = await db.insert(sprintKanbanTasks).values(data).returning();
    return task;
  }

  async updateSprintTask(id: string, data: Partial<SprintKanbanTask>): Promise<SprintKanbanTask> {
    const [task] = await db.update(sprintKanbanTasks).set(data).where(eq(sprintKanbanTasks.id, id)).returning();
    return task;
  }

  async upsertSprintBehavioralMetrics(data: { sprintId: string; userId: string } & Partial<SprintBehavioralMetrics>): Promise<SprintBehavioralMetrics> {
    const existing = await db.select().from(sprintBehavioralMetrics)
      .where(and(eq(sprintBehavioralMetrics.sprintId, data.sprintId), eq(sprintBehavioralMetrics.userId, data.userId)));
    if (existing.length > 0) {
      const { sprintId, userId, ...updates } = data;
      const [updated] = await db.update(sprintBehavioralMetrics).set({ ...updates, updatedAt: new Date() }).where(eq(sprintBehavioralMetrics.id, existing[0].id)).returning();
      return updated;
    }
    const [metrics] = await db.insert(sprintBehavioralMetrics).values(data).returning();
    return metrics;
  }

  async getSprintBehavioralMetrics(sprintId: string): Promise<SprintBehavioralMetrics[]> {
    return db.select().from(sprintBehavioralMetrics).where(eq(sprintBehavioralMetrics.sprintId, sprintId));
  }

  async saveCompatibilityReport(data: { sprintId: string; overallScore: number; strengths: any; risks: any; recommendation: string }): Promise<SprintCompatibilityReport> {
    const existing = await db.select().from(sprintCompatibilityReports).where(eq(sprintCompatibilityReports.sprintId, data.sprintId));
    if (existing.length > 0) {
      const [updated] = await db.update(sprintCompatibilityReports).set(data).where(eq(sprintCompatibilityReports.id, existing[0].id)).returning();
      return updated;
    }
    const [report] = await db.insert(sprintCompatibilityReports).values(data).returning();
    return report;
  }

  async getCompatibilityReport(sprintId: string): Promise<SprintCompatibilityReport | undefined> {
    const [report] = await db.select().from(sprintCompatibilityReports).where(eq(sprintCompatibilityReports.sprintId, sprintId));
    return report;
  }

  // ---------------------------------------------------------------------
  // Sprint matchmaking queue
  // ---------------------------------------------------------------------

  /** A queue row is abandoned if its heartbeat stops for this long. */
  private static readonly QUEUE_STALE_SECONDS = 90;

  /** Removes rows whose owner stopped polling, so nobody matches a dead tab. */
  async sweepStaleQueueEntries(): Promise<number> {
    const deleted = await db
      .delete(sprintMatchmakingQueue)
      .where(
        and(
          eq(sprintMatchmakingQueue.status, "waiting"),
          lte(
            sprintMatchmakingQueue.lastSeenAt,
            new Date(Date.now() - DatabaseStorage.QUEUE_STALE_SECONDS * 1000)
          )
        )
      )
      .returning();
    return deleted.length;
  }

  async joinMatchmakingQueue(data: { userId: string; duration: "24h" | "72h"; productStyle?: string | null; projectId?: string | null }): Promise<SprintMatchmakingQueueEntry> {
    const values = {
      userId: data.userId,
      duration: data.duration,
      productStyle: (data.productStyle || null) as any,
      projectId: data.projectId || null,
      status: "waiting" as const,
      matchedSprintId: null,
      lastSeenAt: new Date(),
    };
    // userId is unique, so re-joining updates the existing row (and clears any
    // stale "matched" state from a previous run).
    const [entry] = await db
      .insert(sprintMatchmakingQueue)
      .values(values)
      .onConflictDoUpdate({ target: sprintMatchmakingQueue.userId, set: values })
      .returning();
    return entry;
  }

  /** Keeps a waiting row alive. Returns false if the row is gone. */
  async touchQueueEntry(userId: string): Promise<boolean> {
    const updated = await db
      .update(sprintMatchmakingQueue)
      .set({ lastSeenAt: new Date() })
      .where(eq(sprintMatchmakingQueue.userId, userId))
      .returning();
    return updated.length > 0;
  }

  /**
   * Atomically pairs the caller with a compatible waiting partner.
   *
   * Everything happens in one transaction using `FOR UPDATE SKIP LOCKED`, so
   * two users polling at the same moment can't both claim each other and
   * create duplicate sprints — the loser of the lock race simply finds no
   * candidate and keeps waiting.
   *
   * Partners must want the same duration. A 24h builder paired into a 72h
   * sprint would silently get a commitment they never agreed to.
   */
  async tryMatchInQueue(userId: string): Promise<{ sprint: CofounderSprint; partnerId: string } | null> {
    return db.transaction(async (tx) => {
      const [me] = await tx
        .select()
        .from(sprintMatchmakingQueue)
        .where(eq(sprintMatchmakingQueue.userId, userId))
        .for("update");
      if (!me || me.status !== "waiting") return null;

      const staleCutoff = new Date(Date.now() - DatabaseStorage.QUEUE_STALE_SECONDS * 1000);

      // Longest-waiting compatible partner first, so the queue is fair.
      const candidates = await tx
        .select()
        .from(sprintMatchmakingQueue)
        .where(
          and(
            ne(sprintMatchmakingQueue.userId, userId),
            eq(sprintMatchmakingQueue.status, "waiting"),
            eq(sprintMatchmakingQueue.duration, me.duration),
            gte(sprintMatchmakingQueue.lastSeenAt, staleCutoff)
          )
        )
        .orderBy(asc(sprintMatchmakingQueue.createdAt))
        .limit(1)
        .for("update", { skipLocked: true });

      const partner = candidates[0];
      if (!partner) return null;

      // If either builder brought a project, the sprint works on it. The
      // longer-waiting builder's project wins if both did.
      const sourceProjectId = partner.projectId || me.projectId || null;
      let productName: string | null = null;
      let productDescription: string | null = null;
      if (sourceProjectId) {
        const [proj] = await tx.select().from(projects).where(eq(projects.id, sourceProjectId));
        if (proj) {
          productName = proj.title;
          productDescription = proj.oneLiner || proj.description;
        }
      }

      const [sprint] = await tx
        .insert(cofounderSprints)
        .values({
          user1Id: partner.userId, // the longer-waiting builder is user1
          user2Id: userId,
          duration: me.duration,
          status: "setup",
          // Prefer a style both asked for; otherwise fall back to either.
          productStyle: (partner.productStyle === me.productStyle
            ? me.productStyle
            : me.productStyle || partner.productStyle) as any,
          sourceProjectId,
          productName,
          productDescription,
        })
        .returning();

      // Flip both rows to matched so each side's next poll learns the sprint id.
      await tx
        .update(sprintMatchmakingQueue)
        .set({ status: "matched", matchedSprintId: sprint.id })
        .where(inArray(sprintMatchmakingQueue.userId, [userId, partner.userId]));

      return { sprint, partnerId: partner.userId };
    });
  }

  async removeFromMatchmakingQueue(userId: string): Promise<void> {
    await db.delete(sprintMatchmakingQueue).where(eq(sprintMatchmakingQueue.userId, userId));
  }

  async getQueueEntry(userId: string): Promise<SprintMatchmakingQueueEntry | undefined> {
    const [entry] = await db
      .select()
      .from(sprintMatchmakingQueue)
      .where(eq(sprintMatchmakingQueue.userId, userId));
    return entry;
  }

  /** Waiting builders per duration, plus the caller's 1-based place in line. */
  async getQueueStats(userId: string, duration?: "24h" | "72h"): Promise<{ waiting: number; position: number | null }> {
    const staleCutoff = new Date(Date.now() - DatabaseStorage.QUEUE_STALE_SECONDS * 1000);
    const live = and(
      eq(sprintMatchmakingQueue.status, "waiting"),
      gte(sprintMatchmakingQueue.lastSeenAt, staleCutoff)
    );

    const rows = await db
      .select({ userId: sprintMatchmakingQueue.userId, createdAt: sprintMatchmakingQueue.createdAt })
      .from(sprintMatchmakingQueue)
      .where(duration ? and(live, eq(sprintMatchmakingQueue.duration, duration)) : live)
      .orderBy(asc(sprintMatchmakingQueue.createdAt));

    const index = rows.findIndex((r) => r.userId === userId);
    return { waiting: rows.length, position: index === -1 ? null : index + 1 };
  }
}

export const storage = new DatabaseStorage();
