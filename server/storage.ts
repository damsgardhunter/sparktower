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
  projectFollows, userFollows,
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
  feedCommentReactions,
  pathArtifacts,
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
  projectFiles,
  projectLinks,
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
import { eq, desc, or, ilike, sql, and, gte, lte, asc, ne, inArray, isNull, notInArray } from "drizzle-orm";
import { ago } from "./sql-interval";
// One helper, used by every read path that can put one person in front of
// another. See server/blocks.ts for why it's a SQL fragment and not a set.
import { notBlockedSql } from "./block-sql";
import { feedCommentVisibleTo, feedPostVisibleTo, projectCommentVisibleTo, publiclyVisible } from "./visibility";
import { publicProject, type TeamOnlyProjectField } from "./project-visibility";
import { normalizeTier, MONTHLY_SMALL_ACTIONS } from "@shared/plans";
import { takeHold, settleMoney } from "./credit-reservations";

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
/** The most a project listing returns, whoever asks. See getProjects. */
export const PROJECT_LISTING_CAP = 200;

/**
 * Caps on the contest reads, which are both reachable with no account.
 *
 * Neither had one: the list walked every contest in the table and, per
 * contest, read every participant row in full just to count them; the
 * participants endpoint read every entrant and then two more queries each for
 * their account and profile. Both grow without limit as the site does, on the
 * cheapest request there is to send.
 */
export const CONTEST_LISTING_CAP = 100;
export const CONTEST_PARTICIPANT_CAP = 100;

export interface ProjectListingFilters {
  category?: string;
  status?: string;
  goal?: string;
  /** One builder's projects, for their profile. */
  ownerId?: string;
  /** "solo" is solo builds only; "team" is the ones that take collaborators. */
  shape?: "solo" | "team";
  /** A role the project says it needs, matched as a case-insensitive substring. */
  needs?: string;
  /** Free text over the title, one-liner, description, stack and roles. */
  q?: string;
  /** Owners still see their own private projects in listings. */
  includePrivateOwnedBy?: string;
  /** At most PROJECT_LISTING_CAP. */
  limit?: number;
}

/** A user's words as an ILIKE substring: their % and _ are literal, not wildcards. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export interface ProjectCommentWithAuthor extends ProjectComment {
  author: User;
  profile?: UserProfile;
  viewerReacted: boolean;
}

/** A comment on a post, with its author, its reactions, and its place in the thread. */
export interface FeedCommentWithDetails extends FeedComment {
  author: User;
  profile?: UserProfile;
  viewerReaction: string | null;
  reactionBreakdown: { reaction: string; count: number }[];
  /** Taken down: only its author still gets it, with this set. */
  hidden: boolean;
  /** Deleted by its author while it had replies: a placeholder that holds the thread together. */
  deleted: boolean;
}

/** A feed post with everything a card renders, resolved in one pass. */
export interface FeedPostWithDetails extends FeedPost {
  author: User;
  profile?: UserProfile;
  /** Null for posts not attached to a project. */
  project: { id: string; title: string; category: string; isPrivate: boolean; logoUrl: string | null } | null;
  /** The viewing user's own reaction, or null. */
  viewerReaction: string | null;
  reactionBreakdown: { reaction: string; count: number }[];
  /** The viewer is on the post's project, so can act on its feedback. */
  viewerIsTeam: boolean;
  /** Feedback this update said it acted on: who gave it. */
  credits: { commentId: string; authorId: string; name: string }[];
  /** The path step this post shares, when it shares one. */
  pathStep: { taskId: string; title: string } | null;
  /** The steps a weekly progress update shares. */
  pathWeek: { steps: { taskId: string; title: string }[] } | null;
  /** The published artifact this post announces, when it announces one. */
  artifact: { id: string; title: string; tags: string[]; public: boolean } | null;
}

export interface IStorage {
  // User Profile
  getUserProfile(userId: string): Promise<UserProfile | undefined>;
  upsertUserProfile(data: InsertUserProfile): Promise<UserProfile>;
  getProfilesLookingFor(viewerId?: string | null): Promise<(UserProfile & { user: User })[]>;
  completeOnboarding(userId: string): Promise<void>;
  
  // Projects
  getProjects(filters?: ProjectListingFilters): Promise<(Project & { owner: User; profile?: UserProfile })[]>;
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
  deleteWaitlistEntry(projectId: string, id: string): Promise<boolean>;

  // Interviews
  getProjectInterviews(projectId: string): Promise<ProjectInterview[]>;
  createProjectInterview(data: InsertProjectInterview): Promise<ProjectInterview>;
  updateProjectInterview(projectId: string, id: string, data: Partial<InsertProjectInterview>): Promise<ProjectInterview | undefined>;
  deleteProjectInterview(projectId: string, id: string): Promise<boolean>;

  // Experiments
  getProjectExperiments(projectId: string): Promise<ProjectExperiment[]>;
  createProjectExperiment(data: InsertProjectExperiment): Promise<ProjectExperiment>;
  updateProjectExperiment(projectId: string, id: string, data: Partial<InsertProjectExperiment>): Promise<ProjectExperiment | undefined>;
  deleteProjectExperiment(projectId: string, id: string): Promise<boolean>;

  // Pricing Tiers
  getProjectPricingTiers(projectId: string): Promise<PricingTier[]>;
  createPricingTier(data: InsertPricingTier): Promise<PricingTier>;
  updatePricingTier(projectId: string, id: string, data: Partial<InsertPricingTier>): Promise<PricingTier | undefined>;
  deletePricingTier(projectId: string, id: string): Promise<boolean>;

  // Analytics Events
  getProjectAnalyticsEvents(projectId: string): Promise<AnalyticsEvent[]>;
  createAnalyticsEvent(data: InsertAnalyticsEvent): Promise<AnalyticsEvent>;
  updateAnalyticsEvent(projectId: string, id: string, data: Partial<InsertAnalyticsEvent>): Promise<AnalyticsEvent | undefined>;
  deleteAnalyticsEvent(projectId: string, id: string): Promise<boolean>;

  // Legal Docs
  getProjectLegalDocs(projectId: string): Promise<LegalDoc[]>;
  createLegalDoc(data: InsertLegalDoc): Promise<LegalDoc>;
  updateLegalDoc(projectId: string, id: string, data: Partial<InsertLegalDoc>): Promise<LegalDoc | undefined>;
  deleteLegalDoc(projectId: string, id: string): Promise<boolean>;

  // Deploy Checklist
  getDeployChecklistItems(projectId: string): Promise<DeployChecklistItem[]>;
  createDeployChecklistItem(data: InsertDeployChecklistItem): Promise<DeployChecklistItem>;
  updateDeployChecklistItem(projectId: string, id: string, data: Partial<InsertDeployChecklistItem>): Promise<DeployChecklistItem | undefined>;
  deleteDeployChecklistItem(projectId: string, id: string): Promise<boolean>;

  // Support Tickets
  getProjectSupportTickets(projectId: string): Promise<SupportTicket[]>;
  createSupportTicket(data: InsertSupportTicket): Promise<SupportTicket>;
  updateSupportTicket(projectId: string, id: string, data: Partial<InsertSupportTicket>): Promise<SupportTicket | undefined>;
  deleteSupportTicket(projectId: string, id: string): Promise<boolean>;

  // Launch Tasks
  getProjectLaunchTasks(projectId: string): Promise<LaunchTask[]>;
  createLaunchTask(data: InsertLaunchTask): Promise<LaunchTask>;
  updateLaunchTask(projectId: string, id: string, data: Partial<InsertLaunchTask>): Promise<LaunchTask | undefined>;
  deleteLaunchTask(projectId: string, id: string): Promise<boolean>;

  // Nova Guide Messages
  getNovaGuideMessages(projectId: string): Promise<NovaGuideMessage[]>;
  addNovaGuideMessage(data: InsertNovaGuideMessage): Promise<NovaGuideMessage>;

  // Donations
  createDonation(data: InsertDonation): Promise<Donation>;
  getProjectDonations(projectId: string): Promise<Donation[]>;
  
  // Matches
  getUserMatches(userId: string): Promise<(UserMatch & { matchedUser: User; matchedProfile?: UserProfile })[]>;
  upsertUserMatch(data: InsertUserMatch): Promise<UserMatch>;
  getMatchBatchState(userId: string, staleHours: number): Promise<{ latestBatch: number; isStale: boolean; recentlyShown: string[] }>;
  /** Drops a stored match, both ways — used when the two of them connect and the match becomes noise. */
  deleteUserMatch(userId: string, matchedUserId: string): Promise<void>;
  
  // Leaderboard
  getLeaderboard(sortBy: "views" | "donations", limit: number, filter?: "solo" | "team" | "all", includePrivateOwnedBy?: string): Promise<(Project & { owner: User })[]>;
  
  // Media
  addProjectMedia(projectId: string, objectPath: string): Promise<Project>;
  removeProjectMedia(projectId: string, index: number): Promise<Project>;

  // User Search
  searchUsers(query: string, opts?: { limit?: number; offset?: number; viewerId?: string | null }): Promise<(User & { profile?: UserProfile })[]>;
  getUser(id: string): Promise<User | undefined>;

  /** The matching pool, cut in SQL by shared skills and interests. */
  matchCandidates(
    viewerId: string,
    seed: { skills?: string[] | null; interests?: string[] | null },
    limit?: number,
  ): Promise<(User & { profile?: UserProfile })[]>;
  /** Bulk reads matching needs per candidate; one query each instead of one per person. */
  getProjectsForUsers(userIds: string[]): Promise<Map<string, Project[]>>;
  getReputationsForUsers(userIds: string[]): Promise<Map<string, UserReputation>>;
  getAcceptedConnectionIds(userIds: string[]): Promise<Map<string, Set<string>>>;

  // Badges
  getBadges(): Promise<Badge[]>;
  getBadge(id: string): Promise<Badge | undefined>;
  createBadge(data: InsertBadge): Promise<Badge>;
  getUserBadges(userId: string): Promise<(UserBadge & { badge: Badge })[]>;
  /** Null when the badge id is unknown. */
  awardBadge(userId: string, badgeId: string): Promise<UserBadge | null>;

  // Contests
  getContests(filters?: { status?: string; limit?: number }): Promise<(Contest & { badge?: Badge; participantCount: number })[]>;
  getContest(id: string): Promise<(Contest & { badge?: Badge; participantCount: number }) | undefined>;
  createContest(data: InsertContest): Promise<Contest>;
  /** Null when the contest is full; `created` false when they had already joined. The cap is enforced by the insert, not by a read before it. */
  joinContest(contestId: string, userId: string, maxParticipants?: number | null): Promise<{ participant: ContestParticipant; created: boolean } | null>;
  getContestParticipants(contestId: string, limit?: number, offset?: number): Promise<(ContestParticipant & { user: User; profile?: UserProfile })[]>;
  submitToContest(contestId: string, userId: string, submissionUrl: string, submissionNote?: string): Promise<ContestParticipant>;
  isContestParticipant(contestId: string, userId: string): Promise<boolean>;

  // Connections
  getConnectionById(connectionId: string): Promise<Connection | undefined>;
  sendConnectionRequest(requesterId: string, receiverId: string, note?: string | null): Promise<Connection>;
  getConnectionsBetween(userId: string, otherIds: string[]): Promise<Connection[]>;
  acceptConnection(connectionId: string): Promise<Connection>;
  rejectConnection(connectionId: string): Promise<Connection>;
  removeConnection(connectionId: string): Promise<void>;
  getConnections(userId: string): Promise<(Connection & { user: User; profile?: UserProfile })[]>;
  getConnectionRequests(userId: string): Promise<(Connection & { user: User; profile?: UserProfile })[]>;
  getSentConnectionRequests(userId: string): Promise<(Connection & { user: User; profile?: UserProfile })[]>;
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
  createApplication(data: { projectId: string; userId: string; resumeUrl?: string; answers?: any; message?: string; role?: string | null }): Promise<ProjectApplication>;
  getProjectApplications(projectId: string): Promise<(ProjectApplication & { user: User; profile?: UserProfile })[]>;
  getUserApplications(userId: string): Promise<(ProjectApplication & { project: Omit<Project, TeamOnlyProjectField> })[]>;
  getApplication(id: string): Promise<ProjectApplication | undefined>;
  updateApplicationStatus(id: string, status: "accepted" | "rejected"): Promise<ProjectApplication>;

  // Project Follows
  followProject(userId: string, projectId: string): Promise<ProjectFollow>;
  unfollowProject(userId: string, projectId: string): Promise<void>;
  isFollowing(userId: string, projectId: string): Promise<boolean>;
  followUser(followerId: string, followeeId: string): Promise<void>;
  unfollowUser(followerId: string, followeeId: string): Promise<void>;
  isFollowingUser(followerId: string, followeeId: string): Promise<boolean>;
  getUserFollowerCount(userId: string): Promise<number>;
  getFollowingCount(userId: string): Promise<number>;
  getUserFollowedProjects(userId: string): Promise<(ProjectFollow & { project: Omit<Project, TeamOnlyProjectField> & { owner: User } })[]>;
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
  /** false when it wasn't theirs; "deleted" when the row went; "kept" when replies held it open (see the implementation). */
  deleteFeedPost(id: string, authorId: string): Promise<false | "deleted" | "kept">;
  setFeedReaction(postId: string, userId: string, reaction: string | null): Promise<{ reactionCount: number; viewerReaction: string | null }>;
  getFeedComments(postId: string, viewerId?: string): Promise<FeedCommentWithDetails[]>;
  setFeedCommentReaction(commentId: string, userId: string, reaction: string | null): Promise<{ reactionCount: number; viewerReaction: string | null }>;
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

  // Co-Founder Sprints
  createSprint(data: InsertCofounderSprint): Promise<CofounderSprint>;
  getSprint(id: string): Promise<CofounderSprint | undefined>;
  updateSprint(id: string, data: Partial<CofounderSprint>): Promise<CofounderSprint>;
  getSprintsByUser(userId: string): Promise<(CofounderSprint & { user1: User; user2: User })[]>;
  /**
   * Ends a sprint because somebody left. Returns the sprint and who the other
   * person was, or a reason it couldn't be left — the caller needs both to
   * answer the request and to tell the partner.
   */
  leaveSprint(sprintId: string, userId: string, reason?: string | null): Promise<
    | { ok: true; sprint: CofounderSprint; partnerId: string | null }
    | { ok: false; code: "not_found" | "not_a_member" | "already_over" }
  >;
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
  updateSprintTask(sprintId: string, id: string, data: Partial<SprintKanbanTask>): Promise<SprintKanbanTask | undefined>;
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
    /** Project update and milestone posts the user wrote on the feed about a project. */
    projectUpdates: number;
    followedProjects: number;
    donationsReceived: number;
    applicationsSubmitted: number;
    activityLogCount: number;
    contestWins: number;
  }>;
}

/**
 * Which comments a viewer sees.
 *
 * The rules themselves moved to server/visibility.ts, where every content
 * table's are written once: hidden is gone, a suspended or closed author's
 * writing is gone, and a shadow-hidden comment still reads as posted to the
 * person who wrote it. This stays as the name the rest of the file already
 * calls, because the interesting thing about it is no longer what it says —
 * it's that nothing here gets to say it.
 */
const commentVisibleTo = (viewerId?: string) => projectCommentVisibleTo(viewerId);

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

  /**
   * Profiles with an active "looking for" call.
   *
   * This is the one people-listing anyone can read signed out, and it filtered
   * nothing at all: a suspended account, a closed one and a simulation bot all
   * appeared on it, each with an open invitation to get in touch. A suspension
   * that leaves the account advertising for collaborators on a public page is
   * not a suspension. Same three conditions as `searchUsers`, for the same
   * reasons, and one join instead of a query per row.
   *
   * `viewerId` is optional because the page is public. When somebody is signed
   * in, their blocks apply here too.
   */
  async getProfilesLookingFor(viewerId?: string | null): Promise<(UserProfile & { user: User })[]> {
    const rows = await db
      .select({ profile: userProfiles, user: users })
      .from(userProfiles)
      .innerJoin(users, eq(users.id, userProfiles.userId))
      .where(and(
        sql`${userProfiles.lookingFor} IS NOT NULL AND ${userProfiles.lookingFor}->>'isActive' = 'true'`,
        isNull(users.suspendedAt),
        isNull(users.deletedAt),
        eq(users.isBot, false),
        viewerId ? notBlockedSql(viewerId, userProfiles.userId) : undefined,
      ))
      .limit(500);

    return rows.map((r) => ({ ...r.profile, user: r.user }));
  }

  async completeOnboarding(userId: string): Promise<void> {
    await db
      .update(userProfiles)
      .set({ isOnboarded: true })
      .where(eq(userProfiles.userId, userId));
  }

  /**
   * The public project listing, and Discover's project half.
   *
   * One query, not 1 + 2N. This used to read every project in the database
   * and then, per row, the owner and the owner's profile — two round trips a
   * project, unbounded, on an endpoint anyone can call signed out. It's now a
   * join, newest first, capped (`limit`, default and ceiling
   * PROJECT_LISTING_CAP): nothing on the site pages past the first couple of
   * hundred, and a listing that grows with the table is a denial-of-service
   * waiting for the table to grow.
   *
   * The filters that are plain column tests live here so the cap applies
   * after them — a cap before filtering would make a search for a rare stack
   * come back empty while matching projects sat on row 201. Free text is a
   * case-insensitive substring over the columns Discover always searched.
   */
  async getProjects(filters?: ProjectListingFilters): Promise<(Project & { owner: User; profile?: UserProfile })[]> {
    const conditions = [];
    if (filters?.category) conditions.push(eq(projects.category, filters.category));
    if (filters?.status) conditions.push(eq(projects.status, filters.status as any));
    if (filters?.goal) conditions.push(eq(projects.goal, filters.goal as any));
    if (filters?.ownerId) conditions.push(eq(projects.ownerId, filters.ownerId));
    // solo_mode is nullable: null has always meant "not solo".
    if (filters?.shape === "solo") conditions.push(eq(projects.soloMode, true));
    if (filters?.shape === "team") conditions.push(sql`coalesce(${projects.soloMode}, false) = false`);
    if (filters?.needs) {
      const pattern = likePattern(filters.needs);
      conditions.push(sql`exists (select 1 from unnest(${projects.rolesNeeded}) as r(role) where r.role ilike ${pattern})`);
    }
    if (filters?.q) {
      const pattern = likePattern(filters.q);
      conditions.push(or(
        ilike(projects.title, pattern),
        ilike(projects.oneLiner, pattern),
        ilike(projects.description, pattern),
        sql`array_to_string(${projects.techStack}, ' ') ilike ${pattern}`,
        sql`array_to_string(${projects.rolesNeeded}, ' ') ilike ${pattern}`,
      )!);
    }
    // Private projects are excluded from public listings, except for their owner.
    conditions.push(
      filters?.includePrivateOwnedBy
        ? or(eq(projects.isPrivate, false), eq(projects.ownerId, filters.includePrivateOwnedBy))!
        : eq(projects.isPrivate, false)
    );
    /*
     * And a project a reviewer took down, or one whose owner is suspended, is
     * not on any list — for its owner either.
     *
     * A takedown that left the project on Discover and the leaderboard would
     * be a takedown in name only, which is exactly the hole this closes: until
     * `projects.hiddenAt` existed the queue could mark a doxxing project
     * "actioned" and it stayed on every public surface. The suspension test is
     * the same argument one step up: suspending an account blocks its writes
     * and nothing else, so a spammer's projects went on being advertised by
     * the site that had just banned them.
     *
     * The takedown is not narrowed by `includePrivateOwnedBy`: a person is
     * allowed to see their own private project, and is not allowed to put a
     * removed one back in front of strangers. Their own workspace reads it by
     * id, which is a different path. The suspension is narrowed, because a
     * suspended person looking at their own profile should still find their
     * work — the suspension is about what they can do to other people, not
     * about hiding their own projects from them.
     */
    conditions.push(
      filters?.includePrivateOwnedBy
        ? or(publiclyVisible.project(), and(isNull(projects.hiddenAt), eq(projects.ownerId, filters.includePrivateOwnedBy)))!
        : publiclyVisible.project()
    );

    const limit = Math.max(1, Math.min(filters?.limit ?? PROJECT_LISTING_CAP, PROJECT_LISTING_CAP));
    const rows = await db
      .select({ project: projects, owner: users, profile: userProfiles })
      .from(projects)
      .innerJoin(users, eq(users.id, projects.ownerId))
      .leftJoin(userProfiles, eq(userProfiles.userId, projects.ownerId))
      .where(and(...conditions))
      // The id breaks ties, so two projects created in the same millisecond keep one order across calls.
      .orderBy(desc(projects.createdAt), desc(projects.id))
      .limit(limit);
    return rows.map((r) => ({ ...r.project, owner: r.owner, profile: r.profile ?? undefined }));
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
  async deleteWaitlistEntry(projectId: string, id: string): Promise<boolean> {
    const gone = await db.delete(projectWaitlistEntries).where(and(eq(projectWaitlistEntries.id, id), eq(projectWaitlistEntries.projectId, projectId))).returning({ id: projectWaitlistEntries.id });
    return gone.length > 0;
  }

  async getProjectInterviews(projectId: string): Promise<ProjectInterview[]> {
    return db.select().from(projectInterviews).where(eq(projectInterviews.projectId, projectId)).orderBy(desc(projectInterviews.createdAt));
  }
  async createProjectInterview(data: InsertProjectInterview): Promise<ProjectInterview> {
    const [entry] = await db.insert(projectInterviews).values(data).returning();
    return entry;
  }
  async updateProjectInterview(projectId: string, id: string, data: Partial<InsertProjectInterview>): Promise<ProjectInterview | undefined> {
    const [entry] = await db.update(projectInterviews).set(data).where(and(eq(projectInterviews.id, id), eq(projectInterviews.projectId, projectId))).returning();
    return entry;
  }
  async deleteProjectInterview(projectId: string, id: string): Promise<boolean> {
    const gone = await db.delete(projectInterviews).where(and(eq(projectInterviews.id, id), eq(projectInterviews.projectId, projectId))).returning({ id: projectInterviews.id });
    return gone.length > 0;
  }

  async getProjectExperiments(projectId: string): Promise<ProjectExperiment[]> {
    return db.select().from(projectExperiments).where(eq(projectExperiments.projectId, projectId)).orderBy(desc(projectExperiments.createdAt));
  }
  async createProjectExperiment(data: InsertProjectExperiment): Promise<ProjectExperiment> {
    const [entry] = await db.insert(projectExperiments).values(data).returning();
    return entry;
  }
  async updateProjectExperiment(projectId: string, id: string, data: Partial<InsertProjectExperiment>): Promise<ProjectExperiment | undefined> {
    const [entry] = await db.update(projectExperiments).set(data).where(and(eq(projectExperiments.id, id), eq(projectExperiments.projectId, projectId))).returning();
    return entry;
  }
  async deleteProjectExperiment(projectId: string, id: string): Promise<boolean> {
    const gone = await db.delete(projectExperiments).where(and(eq(projectExperiments.id, id), eq(projectExperiments.projectId, projectId))).returning({ id: projectExperiments.id });
    return gone.length > 0;
  }

  async getProjectPricingTiers(projectId: string): Promise<PricingTier[]> {
    return db.select().from(projectPricingTiers).where(eq(projectPricingTiers.projectId, projectId)).orderBy(asc(projectPricingTiers.sortOrder));
  }
  async createPricingTier(data: InsertPricingTier): Promise<PricingTier> {
    const [entry] = await db.insert(projectPricingTiers).values(data).returning();
    return entry;
  }
  async updatePricingTier(projectId: string, id: string, data: Partial<InsertPricingTier>): Promise<PricingTier | undefined> {
    const [entry] = await db.update(projectPricingTiers).set(data).where(and(eq(projectPricingTiers.id, id), eq(projectPricingTiers.projectId, projectId))).returning();
    return entry;
  }
  async deletePricingTier(projectId: string, id: string): Promise<boolean> {
    const gone = await db.delete(projectPricingTiers).where(and(eq(projectPricingTiers.id, id), eq(projectPricingTiers.projectId, projectId))).returning({ id: projectPricingTiers.id });
    return gone.length > 0;
  }

  async getProjectAnalyticsEvents(projectId: string): Promise<AnalyticsEvent[]> {
    return db.select().from(projectAnalyticsEvents).where(eq(projectAnalyticsEvents.projectId, projectId)).orderBy(desc(projectAnalyticsEvents.createdAt));
  }
  async createAnalyticsEvent(data: InsertAnalyticsEvent): Promise<AnalyticsEvent> {
    const [entry] = await db.insert(projectAnalyticsEvents).values(data).returning();
    return entry;
  }
  async updateAnalyticsEvent(projectId: string, id: string, data: Partial<InsertAnalyticsEvent>): Promise<AnalyticsEvent | undefined> {
    const [entry] = await db.update(projectAnalyticsEvents).set(data).where(and(eq(projectAnalyticsEvents.id, id), eq(projectAnalyticsEvents.projectId, projectId))).returning();
    return entry;
  }
  async deleteAnalyticsEvent(projectId: string, id: string): Promise<boolean> {
    const gone = await db.delete(projectAnalyticsEvents).where(and(eq(projectAnalyticsEvents.id, id), eq(projectAnalyticsEvents.projectId, projectId))).returning({ id: projectAnalyticsEvents.id });
    return gone.length > 0;
  }

  async getProjectLegalDocs(projectId: string): Promise<LegalDoc[]> {
    return db.select().from(projectLegalDocs).where(eq(projectLegalDocs.projectId, projectId)).orderBy(desc(projectLegalDocs.createdAt));
  }
  async createLegalDoc(data: InsertLegalDoc): Promise<LegalDoc> {
    const [entry] = await db.insert(projectLegalDocs).values(data).returning();
    return entry;
  }
  async updateLegalDoc(projectId: string, id: string, data: Partial<InsertLegalDoc>): Promise<LegalDoc | undefined> {
    const [entry] = await db.update(projectLegalDocs).set(data).where(and(eq(projectLegalDocs.id, id), eq(projectLegalDocs.projectId, projectId))).returning();
    return entry;
  }
  async deleteLegalDoc(projectId: string, id: string): Promise<boolean> {
    const gone = await db.delete(projectLegalDocs).where(and(eq(projectLegalDocs.id, id), eq(projectLegalDocs.projectId, projectId))).returning({ id: projectLegalDocs.id });
    return gone.length > 0;
  }

  async getDeployChecklistItems(projectId: string): Promise<DeployChecklistItem[]> {
    return db.select().from(projectDeployChecklistItems).where(eq(projectDeployChecklistItems.projectId, projectId)).orderBy(asc(projectDeployChecklistItems.sortOrder));
  }
  async createDeployChecklistItem(data: InsertDeployChecklistItem): Promise<DeployChecklistItem> {
    const [entry] = await db.insert(projectDeployChecklistItems).values(data).returning();
    return entry;
  }
  async updateDeployChecklistItem(projectId: string, id: string, data: Partial<InsertDeployChecklistItem>): Promise<DeployChecklistItem | undefined> {
    const [entry] = await db.update(projectDeployChecklistItems).set(data).where(and(eq(projectDeployChecklistItems.id, id), eq(projectDeployChecklistItems.projectId, projectId))).returning();
    return entry;
  }
  async deleteDeployChecklistItem(projectId: string, id: string): Promise<boolean> {
    const gone = await db.delete(projectDeployChecklistItems).where(and(eq(projectDeployChecklistItems.id, id), eq(projectDeployChecklistItems.projectId, projectId))).returning({ id: projectDeployChecklistItems.id });
    return gone.length > 0;
  }

  async getProjectSupportTickets(projectId: string): Promise<SupportTicket[]> {
    return db.select().from(projectSupportTickets).where(eq(projectSupportTickets.projectId, projectId)).orderBy(desc(projectSupportTickets.createdAt));
  }
  async createSupportTicket(data: InsertSupportTicket): Promise<SupportTicket> {
    const [entry] = await db.insert(projectSupportTickets).values(data).returning();
    return entry;
  }
  async updateSupportTicket(projectId: string, id: string, data: Partial<InsertSupportTicket>): Promise<SupportTicket | undefined> {
    const [entry] = await db.update(projectSupportTickets).set(data).where(and(eq(projectSupportTickets.id, id), eq(projectSupportTickets.projectId, projectId))).returning();
    return entry;
  }
  async deleteSupportTicket(projectId: string, id: string): Promise<boolean> {
    const gone = await db.delete(projectSupportTickets).where(and(eq(projectSupportTickets.id, id), eq(projectSupportTickets.projectId, projectId))).returning({ id: projectSupportTickets.id });
    return gone.length > 0;
  }

  async getProjectLaunchTasks(projectId: string): Promise<LaunchTask[]> {
    return db.select().from(projectLaunchTasks).where(eq(projectLaunchTasks.projectId, projectId)).orderBy(asc(projectLaunchTasks.createdAt));
  }
  async createLaunchTask(data: InsertLaunchTask): Promise<LaunchTask> {
    const [entry] = await db.insert(projectLaunchTasks).values(data).returning();
    return entry;
  }
  async updateLaunchTask(projectId: string, id: string, data: Partial<InsertLaunchTask>): Promise<LaunchTask | undefined> {
    const [entry] = await db.update(projectLaunchTasks).set(data).where(and(eq(projectLaunchTasks.id, id), eq(projectLaunchTasks.projectId, projectId))).returning();
    return entry;
  }
  async deleteLaunchTask(projectId: string, id: string): Promise<boolean> {
    const gone = await db.delete(projectLaunchTasks).where(and(eq(projectLaunchTasks.id, id), eq(projectLaunchTasks.projectId, projectId))).returning({ id: projectLaunchTasks.id });
    return gone.length > 0;
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

  /**
   * The stored matches, read back.
   *
   * Filtered on the way out, not just on the way in. A match row is a snapshot
   * of who was suggested when the batch ran, and the world moves underneath
   * it: the person can be suspended for harassment an hour later, can close
   * their account, or can be the person the viewer has since blocked. Every
   * one of those used to keep appearing on Discover — a suspended account, in
   * particular, kept being introduced to new people by the product that
   * suspended it. The generator excludes them too; this is the read path
   * saying so as well, because the rows outlive the run that made them.
   *
   * Also one query instead of two per match.
   */
  async getUserMatches(userId: string): Promise<(UserMatch & { matchedUser: User; matchedProfile?: UserProfile })[]> {
    const rows = await db
      .select({ match: userMatches, matchedUser: users, matchedProfile: userProfiles })
      .from(userMatches)
      .innerJoin(users, eq(users.id, userMatches.matchedUserId))
      .leftJoin(userProfiles, eq(userProfiles.userId, userMatches.matchedUserId))
      .where(and(
        eq(userMatches.userId, userId),
        isNull(users.suspendedAt),
        isNull(users.deletedAt),
        notBlockedSql(userId, userMatches.matchedUserId),
      ))
      .orderBy(desc(userMatches.score));

    return rows.map((r) => ({ ...r.match, matchedUser: r.matchedUser, matchedProfile: r.matchedProfile ?? undefined }));
  }

  /**
   * What the last runs showed, and whether it's time for new ones.
   *
   * `recentlyShown` is everyone from the two most recent batches: the people a
   * fresh run should hold back, so logging in twice in a week doesn't show the
   * same five faces. `isStale` is asked of the database's clock, not the
   * server's.
   */
  async getMatchBatchState(userId: string, staleHours: number): Promise<{ latestBatch: number; isStale: boolean; recentlyShown: string[] }> {
    const rows = await db
      .select({
        matchedUserId: userMatches.matchedUserId,
        batch: userMatches.batch,
        fresh: sql<boolean>`${userMatches.createdAt} > ${ago(staleHours, "hours")}`,
      })
      .from(userMatches)
      .where(eq(userMatches.userId, userId));

    if (rows.length === 0) return { latestBatch: 0, isStale: true, recentlyShown: [] };

    const latestBatch = Math.max(...rows.map((r) => r.batch));
    return {
      latestBatch,
      // Stale unless something from the newest batch was written recently.
      isStale: !rows.some((r) => r.batch === latestBatch && r.fresh),
      recentlyShown: rows.filter((r) => r.batch > latestBatch - 2).map((r) => r.matchedUserId),
    };
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

  async deleteUserMatch(userId: string, matchedUserId: string): Promise<void> {
    // Both directions: they were matched to you as well, and a connection
    // makes that row just as stale as yours.
    await db.delete(userMatches).where(or(
      and(eq(userMatches.userId, userId), eq(userMatches.matchedUserId, matchedUserId)),
      and(eq(userMatches.userId, matchedUserId), eq(userMatches.matchedUserId, userId)),
    ));
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
    /*
     * A project a reviewer took down is not ranked, and neither is one whose
     * owner is suspended. The leaderboard is the most prominent public listing
     * on the site — a removed project left on it is still being advertised,
     * which is the failure `projects.hiddenAt` exists to end. See the same pair
     * of conditions in `getProjects`.
     */
    conditions.push(publiclyVisible.project());

    // One join rather than a query per row: the owner is needed for every
    // entry, and reading them one at a time made the ranking cost a round
    // trip per rank on a page anyone can open signed out.
    const rows = await db
      .select({ project: projects, owner: users })
      .from(projects)
      .innerJoin(users, eq(users.id, projects.ownerId))
      .where(and(...conditions))
      .orderBy(desc(orderCol))
      .limit(limit);

    return rows.map((r) => ({ ...r.project, owner: r.owner }));
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

  /**
   * People by name, display name, username, headline, skill or interest —
   * what the search boxes promise. Never by email: a search that matches
   * emails tells a stranger whose address is whose. Suspended accounts aren't
   * found. An empty query lists everyone, newest first, a page at a time.
   *
   * `viewerId` is who is asking, and passing it is what keeps a block real.
   * Typing a name is the shortest route back to somebody you blocked — and,
   * the other way round, the shortest route for them back to you — so when the
   * viewer is known, anyone blocked in either direction is cut here, in SQL.
   * In SQL rather than after the fetch because this is paged: filtering a page
   * in memory returns a short page, and a caller that pages until it gets a
   * short one would stop early.
   *
   * It's optional because one caller genuinely has no viewer (the bot-pool
   * check in test/integration/sim-bots.test.ts wants the unfiltered truth).
   * Every caller with a signed-in person must pass it.
   */
  async searchUsers(query: string, opts: { limit?: number; offset?: number; viewerId?: string | null } = {}): Promise<(User & { profile?: UserProfile })[]> {
    const q = query.trim();
    const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? 500)), 500);
    const offset = Math.max(0, Math.floor(opts.offset ?? 0));
    const rows = await db
      .select({ user: users, profile: userProfiles })
      .from(users)
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
      .where(and(
        isNull(users.suspendedAt),
        /*
         * Bots are not people to find.
         *
         * They carry ordinary names so a simulation lobby reads like a room,
         * which is exactly why they must not turn up here: a name search, a
         * Discover card or a co-founder match offering "Ada Fournier" is the
         * product introducing somebody to an account nobody is behind. This is
         * the chokepoint — matching draws its whole candidate pool from here.
         */
        eq(users.isBot, false),
        /*
         * A closed account is not a person to find. Deletion anonymises the
         * row rather than removing it (other people's projects and messages
         * reference it), so without this the tombstone keeps turning up in
         * search results and in the match pool drawn from here.
         */
        isNull(users.deletedAt),
        opts.viewerId ? notBlockedSql(opts.viewerId, users.id) : undefined,
        q ? or(
          ilike(users.firstName, pattern),
          ilike(users.lastName, pattern),
          sql`coalesce(${users.firstName}, '') || ' ' || coalesce(${users.lastName}, '') ILIKE ${pattern}`,
          ilike(userProfiles.displayName, pattern),
          ilike(userProfiles.username, pattern),
          ilike(userProfiles.headline, pattern),
          sql`array_to_string(${userProfiles.skills}, ' ') ILIKE ${pattern}`,
          sql`array_to_string(${userProfiles.interests}, ' ') ILIKE ${pattern}`,
        ) : undefined,
      ))
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);
    return rows.map((r) => ({ ...r.user, profile: r.profile ?? undefined }));
  }

  /**
   * The pool matching scores against.
   *
   * Matching used to draw its candidates from `searchUsers("")`, which is
   * capped at 500 rows ordered by `created_at desc`. On a site with two
   * thousand members that cap is not a performance detail, it is the product:
   * everybody who joined before the newest five hundred is invisible to
   * matching *and* only ever gets shown the newest five hundred, so the
   * earliest members — the ones with the most to offer — are matchable by
   * nobody. Worse, it fails silently and gets worse as the site grows.
   *
   * So the cut is made in SQL on the thing matching actually cares about:
   * shared skills and interests, weighted skills-first, with join date only as
   * the tiebreaker. Somebody who joined on day one and writes Postgres now
   * outranks five hundred strangers who signed up yesterday. A viewer with an
   * empty profile still gets a pool (affinity is 0 for everyone and the order
   * falls back to recency), because an empty Discover teaches less than a
   * rough one.
   *
   * Bots, suspended accounts, un-onboarded profiles and the viewer are
   * excluded here rather than after the fetch, so the limit is spent entirely
   * on people who could actually be shown.
   */
  async matchCandidates(
    viewerId: string,
    seed: { skills?: string[] | null; interests?: string[] | null },
    limit = 400,
  ): Promise<(User & { profile?: UserProfile })[]> {
    const words = (xs?: string[] | null) =>
      [...new Set((xs ?? []).map((s) => String(s ?? "").trim().toLowerCase()).filter(Boolean))].slice(0, 40);
    const skills = words(seed.skills);
    const interests = words(seed.interests);

    /*
     * How many of `vals` this profile's array contains, case-insensitively.
     * `coalesce(col, '{}')` matters: `unnest(null)` yields no rows, which is
     * fine, but a null column reaching `cardinality` is not.
     */
    const shared = (col: any, vals: string[]) =>
      /*
       * `sql.param`, not a bare interpolation: drizzle spreads an interpolated
       * array into one placeholder per element, which turns `$1::text[]` into
       * a single word and Postgres answers "malformed array literal". Wrapped,
       * it goes over as one array parameter.
       */
      sql<number>`cardinality(ARRAY(
        SELECT lower(c) FROM unnest(coalesce(${col}, '{}'::text[])) AS c
        INTERSECT
        SELECT unnest(${sql.param(vals)}::text[])
      ))`;

    const affinity =
      skills.length || interests.length
        ? sql<number>`(${skills.length ? shared(userProfiles.skills, skills) : sql`0`}::int * 2
            + ${interests.length ? shared(userProfiles.interests, interests) : sql`0`}::int)`
        /*
         * `0::int`, not a bare `0`. A bare zero reaches `ORDER BY` as the
         * literal `0`, which Postgres reads as an ordinal — "ORDER BY position
         * 0 is not in select list", and the whole query fails. That is exactly
         * the branch a viewer with an empty profile takes, so match generation
         * threw for precisely the people who most needed a pool. A cast makes
         * it an expression, which sorts as the constant it is.
         */
        : sql<number>`0::int`;

    const capped = Math.min(Math.max(1, Math.floor(limit)), 1000);
    const rows = await db
      .select({ user: users, profile: userProfiles, affinity })
      .from(users)
      .innerJoin(userProfiles, eq(userProfiles.userId, users.id))
      .where(and(
        isNull(users.suspendedAt),
        isNull(users.deletedAt),
        eq(users.isBot, false),
        eq(userProfiles.isOnboarded, true),
        ne(users.id, viewerId),
        /*
         * Blocks are cut here as well as in `isMatchable`, and the repetition
         * is deliberate: this query spends a fixed budget of rows, and a
         * blocked account sitting near the top of the affinity order (a block
         * usually follows an interaction, and an interaction usually follows
         * shared skills) would otherwise eat a candidate slot on every run.
         */
        notBlockedSql(viewerId, users.id),
      ))
      .orderBy(desc(affinity), desc(users.createdAt))
      .limit(capped);

    return rows.map((r) => ({ ...r.user, profile: r.profile ?? undefined }));
  }

  /**
   * Projects for many people in two queries instead of two per person.
   *
   * Matching reads this for every candidate it scores. Done one at a time
   * that is a query per candidate per click; done here it is a query per
   * click. Same answer as `getUserProjects`, in bulk.
   */
  async getProjectsForUsers(userIds: string[]): Promise<Map<string, Project[]>> {
    const ids = [...new Set(userIds)].filter(Boolean);
    const out = new Map<string, Project[]>(ids.map((id) => [id, []]));
    if (ids.length === 0) return out;

    const owned = await db.select().from(projects).where(inArray(projects.ownerId, ids));
    for (const p of owned) out.get(p.ownerId)?.push(p);

    const memberships = await db.select().from(projectMembers).where(inArray(projectMembers.userId, ids));
    const extraIds = [...new Set(memberships.map((m) => m.projectId))];
    if (extraIds.length === 0) return out;

    const extra = await db.select().from(projects).where(inArray(projects.id, extraIds));
    const byId = new Map(extra.map((p) => [p.id, p]));
    for (const m of memberships) {
      const project = byId.get(m.projectId);
      const list = out.get(m.userId);
      if (project && list && !list.some((p) => p.id === project.id)) list.push(project);
    }
    return out;
  }

  /** Reputation rows for many people at once — see `getProjectsForUsers`. */
  async getReputationsForUsers(userIds: string[]): Promise<Map<string, UserReputation>> {
    const ids = [...new Set(userIds)].filter(Boolean);
    if (ids.length === 0) return new Map();
    const rows = await db.select().from(userReputationScores).where(inArray(userReputationScores.userId, ids));
    return new Map(rows.map((r) => [r.userId, r]));
  }

  /**
   * Who each of these people is connected to, in one query.
   *
   * `getMutualConnections` runs four queries and two profile fan-outs per
   * pair; matching needs the count for every candidate, which is where most
   * of the old per-candidate cost lived. Ids only — a mutual count never
   * needed the profiles it was loading.
   */
  async getAcceptedConnectionIds(userIds: string[]): Promise<Map<string, Set<string>>> {
    const ids = [...new Set(userIds)].filter(Boolean);
    const out = new Map<string, Set<string>>(ids.map((id) => [id, new Set<string>()]));
    if (ids.length === 0) return out;

    const rows = await db.select({
      requesterId: connections.requesterId,
      receiverId: connections.receiverId,
    }).from(connections).where(and(
      eq(connections.status, "accepted"),
      or(inArray(connections.requesterId, ids), inArray(connections.receiverId, ids)),
    ));

    for (const r of rows) {
      out.get(r.requesterId)?.add(r.receiverId);
      out.get(r.receiverId)?.add(r.requesterId);
    }
    return out;
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
   * Badges are a cosmetic side effect of hitting a milestone, and callers award them by hard-coded id. An unknown id used to
   * raise a foreign-key error that failed the whole request — losing the
   * request's real work over a decoration. Returns null instead.
   */
  async awardBadge(userId: string, badgeId: string): Promise<UserBadge | null> {
    const badge = await this.getBadge(badgeId);
    if (!badge) {
      console.warn(`Skipping unknown badge "${badgeId}".`);
      return null;
    }

    /*
     * Insert first, let the database decide.
     *
     * This used to select-then-insert, which is a check-then-act across two
     * round trips: two milestones landing in the same moment — and they do,
     * because one request can trip several — both read "not awarded" and both
     * insert, so a profile shows the same badge twice and the count is wrong
     * forever. `user_badges` now has a unique index on (user_id, badge_id)
     * (migration 0044), so the second insert is a no-op rather than a
     * duplicate row, and the existing award is read back for the caller.
     */
    const [inserted] = await db
      .insert(userBadges)
      .values({ userId, badgeId })
      .onConflictDoNothing({ target: [userBadges.userId, userBadges.badgeId] })
      .returning();
    if (inserted) return inserted;

    const [already] = await db
      .select()
      .from(userBadges)
      .where(and(eq(userBadges.userId, userId), eq(userBadges.badgeId, badgeId)));
    return already ?? null;
  }

  /**
   * The contest list, signed out included.
   *
   * It used to be three queries per contest — the badge, then *every
   * participant row* read in full only to call `.length` on the array — inside
   * an unbounded `Promise.all` over every contest in the table. On an endpoint
   * anyone can call with no account, that is a read amplifier: one request,
   * 2N round trips and the whole participant table in memory, where N is
   * whatever the table happens to hold.
   *
   * Now it is three queries in total, whatever N is: the contests (capped),
   * their badges by id, and one grouped `count(*)` for the entrants. The
   * counts and badges are joined in memory, which costs nothing next to a
   * round trip each.
   */
  async getContests(filters?: { status?: string; limit?: number }): Promise<(Contest & { badge?: Badge; participantCount: number })[]> {
    const limit = Math.max(1, Math.min(filters?.limit ?? CONTEST_LISTING_CAP, CONTEST_LISTING_CAP));
    const rows = await db.select().from(contests)
      .where(filters?.status ? eq(contests.status, filters.status as any) : undefined)
      .orderBy(desc(contests.promoted), desc(contests.createdAt))
      .limit(limit);
    if (!rows.length) return [];
    return this.withBadgesAndCounts(rows);
  }

  /** The badge and entrant count for a page of contests, in two queries rather than 2N. */
  private async withBadgesAndCounts(rows: Contest[]): Promise<(Contest & { badge?: Badge; participantCount: number })[]> {
    const ids = rows.map((c) => c.id);
    const badgeIds = Array.from(new Set(rows.map((c) => c.badgeId).filter((b): b is string => !!b)));

    const [counts, badgeRows] = await Promise.all([
      db.select({ contestId: contestParticipants.contestId, n: sql<number>`count(*)::int` })
        .from(contestParticipants)
        .where(inArray(contestParticipants.contestId, ids))
        .groupBy(contestParticipants.contestId),
      badgeIds.length ? db.select().from(badges).where(inArray(badges.id, badgeIds)) : Promise.resolve([] as Badge[]),
    ]);

    const countBy = new Map(counts.map((c) => [c.contestId, Number(c.n)]));
    const badgeBy = new Map(badgeRows.map((b) => [b.id, b]));
    return rows.map((c) => ({
      ...c,
      badge: c.badgeId ? badgeBy.get(c.badgeId) : undefined,
      participantCount: countBy.get(c.id) ?? 0,
    }));
  }

  async getContest(id: string): Promise<(Contest & { badge?: Badge; participantCount: number }) | undefined> {
    const [contest] = await db.select().from(contests).where(eq(contests.id, id));
    if (!contest) return undefined;
    // Counted, not listed: reading every entrant row to take its length was
    // the same unbounded read as the listing, one contest at a time.
    const [row] = await db.select({ n: sql<number>`count(*)::int` })
      .from(contestParticipants).where(eq(contestParticipants.contestId, id));
    const badge = contest.badgeId ? await this.getBadge(contest.badgeId) : undefined;
    return { ...contest, badge, participantCount: Number(row?.n ?? 0) };
  }

  async createContest(data: InsertContest): Promise<Contest> {
    const [contest] = await db.insert(contests).values(data).returning();
    return contest;
  }

  /**
   * Entering a contest, decided by the database rather than by a read the
   * caller did a moment ago.
   *
   * The route used to ask "already in?" and "is it full?" and then insert. Two
   * requests from one double-clicked button both got their answers before
   * either wrote, so the same person could be entered twice — two places in
   * the judging, an entrant count that was wrong, and a contest that could
   * slide past its own `maxParticipants` by however many requests were in
   * flight. Both questions are now settled inside the one statement:
   *
   *   - "already in?" by the unique index on (contest_id, user_id), with
   *     `onConflictDoNothing`, so the second insert is a no-op rather than a
   *     duplicate row;
   *   - "is it full?" by a `where` on the insert itself that re-counts the
   *     entrants as it writes, so the count can't go stale between the check
   *     and the write.
   *
   * Returns null when the contest is full, and otherwise the entry with
   * `created` saying whether this call is what put it there — so the route can
   * still answer "already joined" without having asked a question whose answer
   * could go stale before the write.
   */
  async joinContest(contestId: string, userId: string, maxParticipants?: number | null): Promise<{ participant: ContestParticipant; created: boolean } | null> {
    const room = maxParticipants == null
      ? sql`true`
      : sql`(select count(*) from ${contestParticipants} where ${contestParticipants.contestId} = ${contestId}) < ${maxParticipants}`;

    return db.transaction(async (tx) => {
      /*
       * One join at a time per contest, and no coordination at all between
       * different contests.
       *
       * The unique index alone settles "already in": the second insert
       * conflicts and does nothing, whoever wins. It cannot settle "is it
       * full", because a count is a read, and under Postgres's default
       * isolation every concurrent transaction counts the rows that existed
       * before any of them started. Five people racing for the last two places
       * each saw two free seats and each was written — the exact bug the cap
       * exists to prevent, just moved inside one statement. A lock keyed on the
       * contest makes those five queue up, so the fifth counts four.
       *
       * Advisory rather than a row lock: there is no row to lock (nobody has
       * joined yet, and the contest row itself is read by everything). It is
       * held for the transaction and released with it, so a crash cannot leave
       * a contest unjoinable.
       */
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`contest-join:${contestId}`}))`);

      /*
       * Written as one statement rather than through the query builder because
       * the cap has to be a condition *on the insert*, evaluated as the row is
       * written. Every value is a bound parameter; nothing here is built by
       * string concatenation (test/unit/sql-parameterized.test.ts).
       */
      const written = await tx.execute(sql`
        insert into ${contestParticipants} (contest_id, user_id)
        select ${contestId}, ${userId} where ${room}
        on conflict (contest_id, user_id) do nothing
        returning id`);
      const created = (Array.isArray(written) ? written.length : Number((written as any).rowCount ?? 0)) > 0;

      /*
       * Read the row back through the query builder rather than from
       * `returning`, so the caller gets camel-cased columns like every other
       * method here. It also separates the two ways nothing was written: a row
       * that is already there means they had joined before, and no row at all
       * means the insert found no room.
       */
      const [row] = await tx.select().from(contestParticipants)
        .where(and(eq(contestParticipants.contestId, contestId), eq(contestParticipants.userId, userId)));
      return row ? { participant: row, created } : null;
    });
  }

  /**
   * A contest's entrants, with who they are.
   *
   * Was a query per entrant for the account and another for their profile —
   * three round trips a row, unbounded, on an endpoint reachable signed out.
   * One left-joined query with a cap instead: the page shows a list of people,
   * and a list nobody scrolls to the end of should not be able to read the
   * whole users table.
   */
  async getContestParticipants(contestId: string, limit = CONTEST_PARTICIPANT_CAP, offset = 0): Promise<(ContestParticipant & { user: User; profile?: UserProfile })[]> {
    const rows = await db
      .select({ participant: contestParticipants, user: users, profile: userProfiles })
      .from(contestParticipants)
      .innerJoin(users, eq(users.id, contestParticipants.userId))
      .leftJoin(userProfiles, eq(userProfiles.userId, contestParticipants.userId))
      .where(eq(contestParticipants.contestId, contestId))
      // The id breaks ties so paging can't repeat or skip a row.
      .orderBy(asc(contestParticipants.joinedAt), asc(contestParticipants.id))
      .limit(Math.max(1, Math.min(limit, CONTEST_PARTICIPANT_CAP)))
      .offset(Math.max(0, offset));
    return rows.map((r) => ({ ...r.participant, user: r.user, profile: r.profile ?? undefined }));
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

  /**
   * The month's free allowance of small Nova actions — the same number for
   * everyone, because nothing about it is sold. The tier argument is kept so
   * the call sites read unchanged while old subscriptions wind down.
   */
  private getCreditLimit(_tier?: string): number {
    return MONTHLY_SMALL_ACTIONS;
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
      return { tier: "free", creditsUsed: 0, creditsLimit: MONTHLY_SMALL_ACTIONS, creditsRemaining: MONTHLY_SMALL_ACTIONS, stripeCustomerId: null, stripeSubscriptionId: null };
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

  /** Whether the month's allowance still has room. A day pass is checked separately (server/wallet.ts). */
  async checkCredits(userId: string, amount: number): Promise<boolean> {
    const sub = await this.getUserSubscription(userId);
    return sub.creditsRemaining >= amount;
  }

  /**
   * What a route calls once the answer is in hand: "that worked, keep what you
   * took". It almost never charges anything any more.
   *
   * requireCredits takes the money — a dollar price, or one action off the
   * month's allowance — *before* the model runs, and holds it
   * (server/credit-reservations.ts), because a check alone let twenty
   * simultaneous requests all pass against the same balance and all reach the
   * model. So by the time a route gets here the charge already happened, and
   * this is the settlement that stops it being given back:
   *
   *   - an open money hold means a priced outcome was delivered: the dollars
   *     stay spent, and the `amount` argument (still a legacy credit number at
   *     most call sites) is ignored, because it was never the price;
   *   - an open allowance hold means the same for the one small action;
   *   - no hold at all is the optional-extra path (reserveOptionalAi), which
   *     deliberately checks without taking. That one charges: one action.
   */
  async deductCredits(userId: string, amount: number): Promise<boolean> {
    if (settleMoney(userId)) return true;
    if (takeHold(userId)) return true;
    if (amount <= 0) return true;
    return this.chargeCredits(userId, 1);
  }

  /** The conditional charge itself, with no hold to settle against. requireCredits takes its hold with this. */
  async chargeCredits(userId: string, amount: number): Promise<boolean> {
    await this.resetCreditsIfNeeded(userId);
    const user = await this.getUser(userId);
    if (!user) return false;
    const cap = this.getCreditLimit();
    const [row] = await db.update(users)
      .set({ creditsUsed: sql`${users.creditsUsed} + ${amount}` })
      .where(and(eq(users.id, userId), sql`${users.creditsUsed} + ${amount} <= ${cap}`))
      .returning({ used: users.creditsUsed });
    return !!row;
  }

  async countPrivateProjects(userId: string): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(projects)
      .where(and(
        eq(projects.ownerId, userId),
        eq(projects.isPrivate, true),
        /*
         * A company's Run project is private because it holds the business's
         * cash and check-ins, not because its owner chose privacy from their
         * plan — so it doesn't spend the person's own private-project allowance.
         */
        sql`not exists (select 1 from companies c where c.project_id = ${projects.id})`,
      ));
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
              commentVisibleTo(viewerId)
            )
          : and(eq(projectComments.projectId, projectId), commentVisibleTo(viewerId))
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
      // Counts only what everyone can see; a hidden comment, or one by a
      // suspended account, isn't part of the conversation. A badge that counts
      // comments nobody can open is a promise of content that isn't there.
      .where(and(eq(projectComments.projectId, projectId), publiclyVisible.projectComment()))
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

  /** The project a comment belongs to, so a caller can check the viewer may see it. */
  async projectOfComment(commentId: string): Promise<string | null> {
    const [row] = await db.select({ projectId: projectComments.projectId }).from(projectComments).where(eq(projectComments.id, commentId));
    return row?.projectId ?? null;
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
    /** Only posts newer than this instant (epoch ms) — compared inside the database. */
    sinceMs?: number;
    /** Only posts by builders, or on projects, this user follows. */
    followedBy?: string;
  }): Promise<FeedPostWithDetails[]> {
    /*
     * The public policy, not a local copy of half of it: taken down is gone,
     * and so is everything by an account that has been suspended or closed.
     * No author exception here even for one's own post — a list is what other
     * people see, and a hidden post reappearing on the feed because its author
     * happens to be the viewer is the failure this is written to prevent. The
     * author's own view of it is `getFeedPost`, one post at a time.
     */
    const conditions = [publiclyVisible.feedPost(), isNull(feedPosts.deletedAt)];
    if (options.authorId) conditions.push(eq(feedPosts.authorId, options.authorId));
    if (options.projectId) conditions.push(eq(feedPosts.projectId, options.projectId));
    if (options.postType) conditions.push(eq(feedPosts.postType, options.postType as any));
    /*
     * Inside the database, never in JavaScript. `created_at` is stamped by the
     * database's clock as wall time in its own timezone, and read back into JS
     * as if it were UTC — so on a server that isn't on UTC, every post looks
     * hours older than it is, and "new since you looked" finds nothing.
     * Postgres converting both sides itself is right in any timezone.
     */
    if (options.sinceMs !== undefined) conditions.push(sql`${feedPosts.createdAt} > to_timestamp(${options.sinceMs / 1000})`);
    /*
     * The Following feed: posts by builders you follow, or on projects you
     * follow. Subqueries rather than a list handed in, so a follow is in the
     * feed the moment it's written. Visibility still applies below — following
     * a builder doesn't show you their private projects.
     */
    if (options.followedBy) {
      conditions.push(or(
        sql`${feedPosts.authorId} in (select followee_id from user_follows where follower_id = ${options.followedBy})`,
        sql`${feedPosts.projectId} in (select project_id from project_follows where user_id = ${options.followedBy})`,
      )!);
    }
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
    /*
     * Taken down: not there, except to its author — who also still sees their
     * own posts while suspended, since a suspension is about what they can do
     * to other people, not about hiding their words from themselves. Asked of
     * the database rather than by reading the row and deciding afterwards, so
     * this page and the feed list are answering the same question.
     */
    const [post] = await db.select().from(feedPosts).where(and(eq(feedPosts.id, id), feedPostVisibleTo(viewerId)));
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

    const viewerIsTeam = !!(viewerId && project && (project.ownerId === viewerId
      || (await db.select({ id: projectMembers.id }).from(projectMembers).where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, viewerId)))).length > 0));
    const creditRows = await db
      .select({ commentId: feedComments.id, authorId: feedComments.authorId, firstName: users.firstName, lastName: users.lastName, email: users.email, displayName: userProfiles.displayName })
      .from(feedComments)
      .innerJoin(users, eq(users.id, feedComments.authorId))
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
      .where(eq(feedComments.closedByPostId, post.id));

    const [stepTask] = post.entityType === "path_step" && post.entityId
      ? await db.select({ id: projectKanbanTasks.id, title: projectKanbanTasks.title }).from(projectKanbanTasks).where(eq(projectKanbanTasks.id, post.entityId))
      : [];

    const [artifactRow] = post.entityType === "path_artifact" && post.entityId
      ? await db.select({ id: pathArtifacts.id, title: pathArtifacts.title, tags: pathArtifacts.tags, visibility: pathArtifacts.visibility }).from(pathArtifacts).where(eq(pathArtifacts.id, post.entityId))
      : [];
    const weekSteps = post.entityType === "path_week"
      ? await db.select({ id: projectKanbanTasks.id, title: projectKanbanTasks.title }).from(projectKanbanTasks)
        .where(sql`${`posted:${post.id}`} = ANY(${projectKanbanTasks.tags})`)
      : [];

    return {
      ...post,
      author,
      profile,
      pathStep: stepTask ? { taskId: stepTask.id, title: stepTask.title } : null,
      pathWeek: post.entityType === "path_week" ? { steps: weekSteps.map((t) => ({ taskId: t.id, title: t.title })) } : null,
      artifact: artifactRow ? { id: artifactRow.id, title: artifactRow.title, tags: artifactRow.tags, public: artifactRow.visibility === "public" } : null,
      project: project ? { id: project.id, title: project.title, category: project.category, isPrivate: project.isPrivate, logoUrl: project.logoUrl } : null,
      viewerReaction,
      reactionBreakdown: breakdownRows.map((r) => ({ reaction: r.reaction, count: r.count })),
      viewerIsTeam,
      credits: creditRows.map((r) => ({
        commentId: r.commentId, authorId: r.authorId,
        name: r.displayName || [r.firstName, r.lastName].filter(Boolean).join(" ") || r.email || "Someone",
      })),
    };
  }

  /**
   * Deletes the author's post.
   *
   * With nobody else in it, the row goes and the database takes its reactions
   * with it. Once other people have replied, deleting the row would delete
   * their words too (feed_comments cascades), so the post's own content goes
   * and the row stays as a headstone — the same thing a comment with replies
   * under it does.
   */
  async deleteFeedPost(id: string, authorId: string): Promise<false | "deleted" | "kept"> {
    const [fromSomeoneElse] = await db.select({ id: feedComments.id }).from(feedComments)
      .where(and(eq(feedComments.postId, id), ne(feedComments.authorId, authorId), isNull(feedComments.deletedAt)))
      .limit(1);
    if (fromSomeoneElse) {
      const cleared = await db.update(feedPosts)
        .set({ deletedAt: new Date(), content: "", mediaUrls: [], mentions: [], asks: [] })
        .where(and(eq(feedPosts.id, id), eq(feedPosts.authorId, authorId), isNull(feedPosts.deletedAt)))
        .returning();
      return cleared.length > 0 ? "kept" : false;
    }
    const deleted = await db
      .delete(feedPosts)
      .where(and(eq(feedPosts.id, id), eq(feedPosts.authorId, authorId)))
      .returning();
    return deleted.length > 0 ? "deleted" : false;
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

  /**
   * A post's comments, oldest first, flat — each carries `parentCommentId`, and
   * the client builds the tree. A comment taken down is gone for everyone but
   * its author; one its author deleted under replies stays as an empty
   * placeholder so the replies keep their place.
   */
  async getFeedComments(postId: string, viewerId?: string): Promise<FeedCommentWithDetails[]> {
    const visible = await db
      .select()
      .from(feedComments)
      /*
       * Filtered in the database, not afterwards in JavaScript. The old
       * version read every comment on the post and then dropped the hidden
       * ones in a `.filter` — which worked, and which also meant the only
       * thing standing between a taken-down comment and the response was one
       * line of application code that a refactor could quietly lose. It also
       * had no test for the author's account at all, so a suspended spammer's
       * replies stayed under every post they had ever commented on.
       */
      .where(and(eq(feedComments.postId, postId), feedCommentVisibleTo(viewerId)))
      .orderBy(asc(feedComments.createdAt));
    const ids = visible.map((c) => c.id);

    const breakdown = ids.length
      ? await db.select({ commentId: feedCommentReactions.commentId, reaction: feedCommentReactions.reaction, count: sql<number>`count(*)::int` })
        .from(feedCommentReactions).where(inArray(feedCommentReactions.commentId, ids))
        .groupBy(feedCommentReactions.commentId, feedCommentReactions.reaction)
      : [];
    const mine = ids.length && viewerId
      ? await db.select({ commentId: feedCommentReactions.commentId, reaction: feedCommentReactions.reaction })
        .from(feedCommentReactions).where(and(inArray(feedCommentReactions.commentId, ids), eq(feedCommentReactions.userId, viewerId)))
      : [];

    return Promise.all(visible.map(async (c) => {
      const [author] = await db.select().from(users).where(eq(users.id, c.authorId));
      const profile = await this.getUserProfile(c.authorId);
      const deleted = !!c.deletedAt;
      return {
        ...c,
        content: deleted ? "" : c.content,
        mentions: deleted ? [] : c.mentions,
        author, profile,
        viewerReaction: mine.find((m) => m.commentId === c.id)?.reaction ?? null,
        reactionBreakdown: breakdown.filter((b) => b.commentId === c.id).map((b) => ({ reaction: b.reaction, count: b.count })),
        hidden: !!c.hiddenAt,
        deleted,
      };
    }));
  }

  /** Same toggle as a post's reaction, on one comment. */
  async setFeedCommentReaction(commentId: string, userId: string, reaction: string | null) {
    if (reaction === null) {
      await db.delete(feedCommentReactions).where(and(eq(feedCommentReactions.commentId, commentId), eq(feedCommentReactions.userId, userId)));
    } else {
      await db.insert(feedCommentReactions).values({ commentId, userId, reaction: reaction as any })
        .onConflictDoUpdate({ target: [feedCommentReactions.commentId, feedCommentReactions.userId], set: { reaction: reaction as any } });
    }
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(feedCommentReactions).where(eq(feedCommentReactions.commentId, commentId));
    await db.update(feedComments).set({ reactionCount: count }).where(eq(feedComments.id, commentId));
    return { reactionCount: count, viewerReaction: reaction };
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
    // With replies under it, the text goes and the row stays, so the thread doesn't lose its middle.
    const [reply] = await db.select({ id: feedComments.id }).from(feedComments).where(eq(feedComments.parentCommentId, id)).limit(1);
    if (reply) {
      const cleared = await db.update(feedComments)
        .set({ deletedAt: new Date(), content: "", mentions: [] })
        .where(and(eq(feedComments.id, id), eq(feedComments.authorId, authorId), isNull(feedComments.deletedAt)))
        .returning();
      return cleared.length > 0;
    }
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
  /**
   * Asks to connect, once per pair, whatever the timing.
   *
   * This used to be a check-then-insert with nothing underneath it: read the
   * pair, and if nothing came back, insert. Two ways through that gap, both
   * reachable by accident:
   *
   *   - a double-submitted button (the second request arrives before the first
   *     commits, so both read "nothing" and both insert);
   *   - A and B pressing "connect" on each other inside the same second, which
   *     reads as two different pairs to a check that looks up one direction at
   *     a time and inserts two rows for the same two people.
   *
   * From then on the pair had two rows, `getConnectionStatus` returned
   * whichever the planner happened to hand back first, and messaging between
   * the two 403'd on some requests and worked on others — a bug that looks
   * like the network and can't be reproduced by the person reporting it.
   *
   * The fix is the unique index on the unordered pair (migration 0042) plus
   * `onConflictDoNothing`: the database decides, not a read. A losing insert
   * returns no row, which is not an error — it means somebody got there first,
   * so we read back what won and return that. The caller sees the same shape
   * either way and the pair still has exactly one connection.
   */
  async sendConnectionRequest(requesterId: string, receiverId: string, note?: string | null): Promise<Connection & { alreadySent?: boolean }> {
    const [conn] = await db.insert(connections)
      .values({ requesterId, receiverId, status: "pending", note: note ?? null })
      .onConflictDoNothing()
      .returning();
    if (conn) return conn;

    // Lost the race, or there was already a connection. Either way the pair's
    // one row is the answer — and if it's ours and still pending, the person
    // pressing the button twice should see their own request, not an error.
    const existing = await this.getConnectionStatus(requesterId, receiverId);
    if (!existing) throw new Error("Connection already exists");
    // Flagged, because pressing the button twice is one request as far as the
    // funnel is concerned: the caller records the action only for a new one.
    if (existing.requesterId === requesterId && existing.status === "pending") return { ...existing, alreadySent: true };
    throw new Error("Connection already exists");
  }

  /** Every connection between one person and a list of others, in either direction. One query for a grid of cards. */
  async getConnectionsBetween(userId: string, otherIds: string[]): Promise<Connection[]> {
    if (!otherIds.length) return [];
    return db.select().from(connections).where(or(
      and(eq(connections.requesterId, userId), inArray(connections.receiverId, otherIds)),
      and(eq(connections.receiverId, userId), inArray(connections.requesterId, otherIds)),
    ));
  }

  async getConnectionById(connectionId: string): Promise<Connection | undefined> {
    const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId));
    return conn;
  }

  async acceptConnection(connectionId: string): Promise<Connection> {
    const [conn] = await db.update(connections).set({ status: "accepted" }).where(and(eq(connections.id, connectionId), eq(connections.status, "pending"))).returning();
    return conn;
  }

  /**
   * Declines a request — by deleting it, not by marking it.
   *
   * A `rejected` row used to be permanent and invisible, and the combination
   * was the worst of both. `sendConnectionRequest` refused while *any* row
   * existed in either direction, so one mis-tapped decline sealed the pair
   * forever: the person who asked saw "Requested", greyed out, for the rest of
   * time and was never told why, and the person who declined saw no button at
   * all because the connection already "existed". Neither of them could undo
   * it, and nothing in the product said what had happened.
   *
   * Nobody needs the row. It isn't shown anywhere, it isn't moderation
   * evidence (a report is), and keeping it costs the pair every future chance
   * to meet. Deleting it puts them back where they started: the decliner hears
   * nothing more, and the other person may ask again — which is what "declined"
   * means everywhere else and what the rate limit on `connect` is for.
   *
   * Returns the row as it was, with `rejected` on it, so the caller can answer
   * the client in the shape it expects.
   */
  async rejectConnection(connectionId: string): Promise<Connection> {
    const [conn] = await db.delete(connections)
      .where(and(eq(connections.id, connectionId), eq(connections.status, "pending")))
      .returning();
    return conn ? { ...conn, status: "rejected" as const } : conn;
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

  /** Requests you've sent that are still waiting, with who they went to — the latest 200. */
  async getSentConnectionRequests(userId: string): Promise<(Connection & { user: User; profile?: UserProfile })[]> {
    const conns = await db.select().from(connections).where(
      and(eq(connections.requesterId, userId), eq(connections.status, "pending"))
    ).orderBy(desc(connections.createdAt)).limit(200);

    return await Promise.all(conns.map(async (conn) => {
      const [user] = await db.select().from(users).where(eq(users.id, conn.receiverId));
      const profile = await this.getUserProfile(conn.receiverId);
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

  /**
   * Where two people stand, answered the same way every time.
   *
   * This is the function messaging authorises against, so "whichever row the
   * planner returned first" was not a tidiness problem: with two rows for one
   * pair (see `sendConnectionRequest`) an unordered `select` could hand back
   * the accepted row on one request and the pending one on the next, and the
   * same conversation would 403 intermittently.
   *
   * The unique index means there is normally one row now. The order is kept
   * anyway, for the rows written before it existed and for the general
   * principle that an authorisation check must not depend on the plan:
   * accepted beats pending beats rejected, oldest first as the tiebreak. It
   * resolves the way a person would — if these two are connected, they are
   * connected, whatever else is lying around.
   */
  async getConnectionStatus(userId1: string, userId2: string): Promise<Connection | undefined> {
    const [conn] = await db.select().from(connections).where(
      or(
        and(eq(connections.requesterId, userId1), eq(connections.receiverId, userId2)),
        and(eq(connections.requesterId, userId2), eq(connections.receiverId, userId1))
      )
    ).orderBy(
      sql`case ${connections.status} when 'accepted' then 0 when 'pending' then 1 else 2 end`,
      asc(connections.createdAt),
      asc(connections.id),
    ).limit(1);
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

  /**
   * The inbox: one row per person, newest first.
   *
   * Two things were wrong with the list this replaces, and they compounded.
   *
   * It never looked at `connections`, while both message routes require an
   * accepted one. So the list happily showed threads that answered 403 the
   * moment they were opened — and after a connection was removed (or a block
   * was made) the thread stayed put with an unread badge that could never be
   * cleared, because clearing it meant opening it and opening it was refused.
   * A permanent "1" on the tab bar, with nothing behind it. The join is now
   * part of the query, and a thread whose connection has gone is left out
   * rather than left there lying. The messages aren't deleted — reconnecting
   * brings the history back — they simply stop being offered as something the
   * person can open. `getUnreadCount` filters identically, so the badge and
   * the list can never disagree.
   *
   * And it read *every message the person had ever exchanged*, in full, to
   * work out who the last one was from: a text-column table scan on every
   * visit to the messages tab, growing forever, before N more queries for the
   * names. It's one query now — `distinct on` for each partner's latest
   * message, a grouped count for the unread, and the names joined in.
   */
  async getConversationList(userId: string): Promise<{ userId: string; user: User; profile?: UserProfile; lastMessage: DirectMessage; unreadCount: number }[]> {
    const rows = await db.execute<any>(sql`
      WITH partners AS (
        SELECT DISTINCT ON (other_id) other_id, msg_id
        FROM (
          SELECT CASE WHEN dm.sender_id = ${userId} THEN dm.receiver_id ELSE dm.sender_id END AS other_id,
                 dm.id AS msg_id, dm.created_at
          FROM direct_messages dm
          WHERE dm.sender_id = ${userId} OR dm.receiver_id = ${userId}
        ) x
        ORDER BY other_id, created_at DESC, msg_id DESC
      ),
      unread AS (
        SELECT sender_id AS other_id, count(*)::int AS n
        FROM direct_messages
        WHERE receiver_id = ${userId} AND read = false
        GROUP BY sender_id
      )
      SELECT p.other_id,
             m.id AS m_id, m.sender_id AS m_sender, m.receiver_id AS m_receiver,
             m.content AS m_content, m.read AS m_read, m.created_at AS m_created,
             coalesce(u.n, 0) AS unread_count
      FROM partners p
      JOIN direct_messages m ON m.id = p.msg_id
      JOIN users usr ON usr.id = p.other_id
      LEFT JOIN unread u ON u.other_id = p.other_id
      WHERE usr.suspended_at IS NULL
        AND usr.deleted_at IS NULL
        /* The join the old list was missing: an accepted connection is what
           the message routes authorise against, so it is what decides whether
           a thread is openable and therefore whether it belongs in the list. */
        AND EXISTS (
          SELECT 1 FROM connections c
          WHERE c.status = 'accepted'
            AND ((c.requester_id = ${userId} AND c.receiver_id = p.other_id)
              OR (c.receiver_id = ${userId} AND c.requester_id = p.other_id))
        )
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks b
          WHERE (b.blocker_id = ${userId} AND b.blocked_id = p.other_id)
             OR (b.blocked_id = ${userId} AND b.blocker_id = p.other_id)
        )
      ORDER BY m.created_at DESC
      LIMIT 200
    `);

    const partners = (rows.rows ?? []) as any[];
    if (!partners.length) return [];

    // Names and avatars in two bulk reads rather than two per conversation.
    const ids = partners.map((r) => r.other_id as string);
    const [people, profiles] = await Promise.all([
      db.select().from(users).where(inArray(users.id, ids)),
      db.select().from(userProfiles).where(inArray(userProfiles.userId, ids)),
    ]);
    const byId = new Map(people.map((u) => [u.id, u]));
    const profileById = new Map(profiles.map((p) => [p.userId, p]));

    return partners.flatMap((r) => {
      const user = byId.get(r.other_id as string);
      if (!user) return [];
      return [{
        userId: r.other_id as string,
        user,
        profile: profileById.get(r.other_id as string),
        lastMessage: {
          id: r.m_id, senderId: r.m_sender, receiverId: r.m_receiver,
          content: r.m_content, read: r.m_read,
          createdAt: r.m_created instanceof Date ? r.m_created : new Date(r.m_created),
        } as DirectMessage,
        unreadCount: Number(r.unread_count ?? 0),
      }];
    });
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

  /**
   * The number on the messages tab.
   *
   * Counted over exactly the threads `getConversationList` will show, for one
   * reason: a badge that counts something the person cannot open is a badge
   * they cannot clear. Unread messages from a connection that has since been
   * removed, from somebody they've blocked, or from a suspended account used
   * to sit in this total forever — the tab said "2", the list showed nothing
   * to open, and no amount of reading made it go away.
   */
  async getUnreadCount(userId: string): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)::int` })
      .from(directMessages)
      .innerJoin(users, eq(users.id, directMessages.senderId))
      .where(and(
        eq(directMessages.receiverId, userId),
        eq(directMessages.read, false),
        isNull(users.suspendedAt),
        isNull(users.deletedAt),
        sql`exists (
          select 1 from ${connections} c
          where c.status = 'accepted'
            and ((c.requester_id = ${userId} and c.receiver_id = ${directMessages.senderId})
              or (c.receiver_id = ${userId} and c.requester_id = ${directMessages.senderId}))
        )`,
        notBlockedSql(userId, directMessages.senderId),
      ));
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
  async createApplication(data: { projectId: string; userId: string; resumeUrl?: string; answers?: any; message?: string; role?: string | null }): Promise<ProjectApplication> {
    const [app] = await db.insert(projectApplications).values({
      projectId: data.projectId,
      userId: data.userId,
      status: "pending",
      resumeUrl: data.resumeUrl || null,
      answers: data.answers || [],
      message: data.message || null,
      role: data.role || null,
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

  /** An applicant's own applications, each with the project as the public sees it — they aren't on its team yet. */
  async getUserApplications(userId: string): Promise<(ProjectApplication & { project: Omit<Project, TeamOnlyProjectField> })[]> {
    const rows = await db.select({ app: projectApplications, project: projects }).from(projectApplications)
      .innerJoin(projects, eq(projects.id, projectApplications.projectId))
      .where(eq(projectApplications.userId, userId)).orderBy(desc(projectApplications.createdAt));
    return rows.map((r) => ({ ...r.app, project: publicProject(r.project) }));
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

  /** Idempotent: following someone twice is following them once. */
  async followUser(followerId: string, followeeId: string): Promise<void> {
    await db.insert(userFollows).values({ followerId, followeeId }).onConflictDoNothing();
  }

  async unfollowUser(followerId: string, followeeId: string): Promise<void> {
    await db.delete(userFollows).where(and(eq(userFollows.followerId, followerId), eq(userFollows.followeeId, followeeId)));
  }

  async isFollowingUser(followerId: string, followeeId: string): Promise<boolean> {
    const [f] = await db.select().from(userFollows).where(and(eq(userFollows.followerId, followerId), eq(userFollows.followeeId, followeeId)));
    return !!f;
  }

  async getUserFollowerCount(userId: string): Promise<number> {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(userFollows).where(eq(userFollows.followeeId, userId));
    return Number(row?.n ?? 0);
  }

  /** Builders and projects together — what the Following feed's empty state needs to tell "follows nobody" from "quiet". */
  async getFollowingCount(userId: string): Promise<number> {
    const [builders] = await db.select({ n: sql<number>`count(*)::int` }).from(userFollows).where(eq(userFollows.followerId, userId));
    const [projectsFollowed] = await db.select({ n: sql<number>`count(*)::int` }).from(projectFollows).where(eq(projectFollows.userId, userId));
    return Number(builders?.n ?? 0) + Number(projectsFollowed?.n ?? 0);
  }

  /**
   * What someone follows, for their Following list.
   *
   * Following used to see through privacy: the follow route took any id, and
   * this handed back the whole project row for each follow — so following a
   * private project's id (or following a project before it went private) read
   * its brief, its notes to Nova and the rest. A private project now appears
   * only to someone on its team, and everyone gets the public projection;
   * the full row is what the project's own routes serve its team.
   */
  async getUserFollowedProjects(userId: string): Promise<(ProjectFollow & { project: Omit<Project, TeamOnlyProjectField> & { owner: User } })[]> {
    const rows = await db
      .select({ follow: projectFollows, project: projects, owner: users, memberId: projectMembers.id })
      .from(projectFollows)
      .innerJoin(projects, eq(projects.id, projectFollows.projectId))
      .innerJoin(users, eq(users.id, projects.ownerId))
      .leftJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId)))
      .where(and(
        eq(projectFollows.userId, userId),
        or(eq(projects.isPrivate, false), eq(projects.ownerId, userId), sql`${projectMembers.id} is not null`),
      ))
      .orderBy(desc(projectFollows.createdAt));
    // A duplicated member row would repeat a follow; one per follow.
    const seen = new Set<string>();
    return rows.filter((r) => !seen.has(r.follow.id) && !!seen.add(r.follow.id))
      .map((r) => ({ ...r.follow, project: { ...publicProject(r.project), owner: r.owner } }));
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
    }
    
    /*
     * Posting progress about a project is what weekly check-ins used to count
     * toward: the user's own project update and milestone posts, still visible.
     * The system's posts are left out — they echo milestones already counted.
     */
    const [{ projectUpdates }] = await db
      .select({ projectUpdates: sql<number>`count(*)::int` })
      .from(feedPosts)
      .where(and(
        eq(feedPosts.authorId, userId),
        eq(feedPosts.isSystemGenerated, false),
        sql`${feedPosts.projectId} is not null`,
        inArray(feedPosts.postType, ["project_update", "milestone"]),
        // Reputation is earned in public: a post nobody can read isn't credit.
        publiclyVisible.feedPost(),
        isNull(feedPosts.deletedAt),
      ));

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
      projectUpdates,
      followedProjects: follows.length,
      donationsReceived,
      applicationsSubmitted: applications.length,
      activityLogCount,
      contestWins,
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

  /**
   * Leaving a sprint.
   *
   * Two people committed hours to this, so leaving ends it rather than
   * removing the person: the row stays, the status becomes `abandoned`, and
   * who left is recorded. The partner opens it and sees what happened instead
   * of finding a sprint that silently stopped moving — or, worse, one that
   * vanished.
   *
   * Conditional on the current status inside the UPDATE rather than checked
   * and then written: both partners pressing Leave at the same moment would
   * otherwise both pass the check, and the second write would overwrite the
   * first one's record of who left.
   */
  async leaveSprint(sprintId: string, userId: string, reason?: string | null): Promise<
    | { ok: true; sprint: CofounderSprint; partnerId: string | null }
    | { ok: false; code: "not_found" | "not_a_member" | "already_over" }
  > {
    const [sprint] = await db.select().from(cofounderSprints).where(eq(cofounderSprints.id, sprintId));
    if (!sprint) return { ok: false, code: "not_found" };
    if (sprint.user1Id !== userId && sprint.user2Id !== userId) return { ok: false, code: "not_a_member" };
    if (sprint.status === "completed" || sprint.status === "abandoned") return { ok: false, code: "already_over" };

    const [updated] = await db.update(cofounderSprints)
      .set({
        status: "abandoned",
        abandonedAt: new Date(),
        abandonedById: userId,
        abandonReason: reason?.trim()?.slice(0, 500) || null,
      })
      .where(and(
        eq(cofounderSprints.id, sprintId),
        // Whoever gets here first is the one recorded as having left.
        notInArray(cofounderSprints.status, ["completed", "abandoned"]),
      ))
      .returning();
    if (!updated) return { ok: false, code: "already_over" };

    /*
     * A practice sprint has Nova as the partner and stores the same person in
     * both columns, so there is nobody to tell.
     */
    const partnerId = updated.isPractice
      ? null
      : (updated.user1Id === userId ? updated.user2Id : updated.user1Id);
    return { ok: true, sprint: updated, partnerId: partnerId === userId ? null : partnerId };
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

  async updateSprintTask(sprintId: string, id: string, data: Partial<SprintKanbanTask>): Promise<SprintKanbanTask | undefined> {
    const [task] = await db.update(sprintKanbanTasks).set(data).where(and(eq(sprintKanbanTasks.id, id), eq(sprintKanbanTasks.sprintId, sprintId))).returning();
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
      /*
       * Written here rather than left to the column's `DEFAULT now()`.
       *
       * `created_at` is a `timestamp` without a zone, and Postgres casts
       * `now()` into one using the *session's* zone — so on a server running
       * in, say, US Central it lands five hours behind every value Drizzle
       * writes, which are UTC. Nothing noticed while the column was only
       * displayed and compared against its own kind; the moment anything
       * measures how long somebody has been queueing, every brand-new entry
       * looks hours old.
       *
       * Re-joining resets it, which is what it should mean: you are starting
       * to wait again, and `tryMatchInQueue` orders by this for fairness.
       */
      createdAt: new Date(),
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
