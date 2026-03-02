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
  projectActivityLog,
  projectDecisions,
  projectCheckIns,
  projectFiles,
  projectLinks,
  type GameLeaderboardEntry,
  type InsertGameLeaderboardEntry,
  type TacticsGame,
  type InsertTacticsGame,
  type TacticsPlayer,
  type InsertTacticsPlayer,
  type TacticsMove,
  type InsertTacticsMove,
  type TypingRace,
  type InsertTypingRace,
  type TypingRacePlayer,
  type InsertTypingRacePlayer,
  type SignalNoiseGame,
  type InsertSignalNoiseGame,
  gameLeaderboard,
  tacticsGames,
  tacticsPlayers,
  tacticsMoves,
  typingRaces,
  typingRacePlayers,
  signalNoiseGames,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, or, ilike, sql, and, gte, lte, asc, ne, inArray } from "drizzle-orm";

export interface IStorage {
  // User Profile
  getUserProfile(userId: string): Promise<UserProfile | undefined>;
  upsertUserProfile(data: InsertUserProfile): Promise<UserProfile>;
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
  
  // Donations
  createDonation(data: InsertDonation): Promise<Donation>;
  getProjectDonations(projectId: string): Promise<Donation[]>;
  
  // Matches
  getUserMatches(userId: string): Promise<(UserMatch & { matchedUser: User; matchedProfile?: UserProfile })[]>;
  upsertUserMatch(data: InsertUserMatch): Promise<UserMatch>;
  
  // Leaderboard
  getLeaderboard(sortBy: "views" | "donations", limit: number): Promise<(Project & { owner: User })[]>;
  
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
  awardBadge(userId: string, badgeId: string): Promise<UserBadge>;

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

  // Personas
  getProjectPersonas(projectId: string): Promise<ProjectPersona[]>;
  getPersona(id: string): Promise<ProjectPersona | undefined>;
  createPersona(data: InsertProjectPersona): Promise<ProjectPersona>;
  deletePersona(id: string): Promise<void>;

  // Milestones
  getProjectMilestones(projectId: string): Promise<ProjectMilestone[]>;
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
  updateUserStripeInfo(userId: string, data: { stripeCustomerId?: string; stripeSubscriptionId?: string; subscriptionTier?: string }): Promise<User>;

  // Game Leaderboard
  createLeaderboardEntry(data: InsertGameLeaderboardEntry): Promise<GameLeaderboardEntry>;
  getGameLeaderboard(gameType: string, limit?: number): Promise<(GameLeaderboardEntry & { user: User; profile?: UserProfile })[]>;

  // Tactics
  createTacticsGame(data: InsertTacticsGame): Promise<TacticsGame>;
  getTacticsGame(id: string): Promise<TacticsGame | undefined>;
  updateTacticsGame(id: string, data: Partial<TacticsGame>): Promise<TacticsGame>;
  getWaitingTacticsGames(): Promise<TacticsGame[]>;
  createTacticsPlayer(data: InsertTacticsPlayer): Promise<TacticsPlayer>;
  getTacticsPlayers(gameId: string): Promise<(TacticsPlayer & { user: User })[]>;
  updateTacticsPlayer(id: string, data: Partial<TacticsPlayer>): Promise<TacticsPlayer>;
  createTacticsMove(data: InsertTacticsMove): Promise<TacticsMove>;
  getTacticsMovesForRound(gameId: string, round: number): Promise<TacticsMove[]>;

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

  async completeOnboarding(userId: string): Promise<void> {
    await db
      .update(userProfiles)
      .set({ isOnboarded: true })
      .where(eq(userProfiles.userId, userId));
  }

  async getProjects(filters?: { category?: string; status?: string }): Promise<(Project & { owner: User; profile?: UserProfile })[]> {
    let query = db.select().from(projects);
    const conditions = [];

    if (filters?.category) {
      conditions.push(eq(projects.category, filters.category));
    }
    if (filters?.status) {
      conditions.push(eq(projects.status, filters.status as any));
    }
    
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

  async getLeaderboard(sortBy: "views" | "donations", limit: number): Promise<(Project & { owner: User })[]> {
    const orderCol = sortBy === "views" ? projects.views : projects.totalDonations;
    const result = await db
      .select()
      .from(projects)
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

  async awardBadge(userId: string, badgeId: string): Promise<UserBadge> {
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
    const limits: Record<string, number> = {
      free: 20,
      spark_pro: 100,
      spark_business: 250,
      spark_unlimited: Infinity,
    };
    return limits[tier] || 20;
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
    const tier = user.subscriptionTier || "free";
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
    if (sub.tier === "spark_unlimited") return true;
    return sub.creditsRemaining >= amount;
  }

  async deductCredits(userId: string, amount: number): Promise<boolean> {
    const canUse = await this.checkCredits(userId, amount);
    if (!canUse) return false;
    const sub = await this.getUserSubscription(userId);
    if (sub.tier === "spark_unlimited") return true;
    await db.update(users).set({ creditsUsed: sql`${users.creditsUsed} + ${amount}` }).where(eq(users.id, userId));
    return true;
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
    const entries = await db.select().from(gameLeaderboard).where(eq(gameLeaderboard.gameType, gameType)).orderBy(desc(gameLeaderboard.score)).limit(limit);
    return await Promise.all(entries.map(async (e) => {
      const [user] = await db.select().from(users).where(eq(users.id, e.userId));
      const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, e.userId));
      return { ...e, user, profile };
    }));
  }

  // --- Tactics ---
  async createTacticsGame(data: InsertTacticsGame): Promise<TacticsGame> {
    const [game] = await db.insert(tacticsGames).values(data).returning();
    return game;
  }

  async getTacticsGame(id: string): Promise<TacticsGame | undefined> {
    const [game] = await db.select().from(tacticsGames).where(eq(tacticsGames.id, id));
    return game;
  }

  async updateTacticsGame(id: string, data: Partial<TacticsGame>): Promise<TacticsGame> {
    const [game] = await db.update(tacticsGames).set(data).where(eq(tacticsGames.id, id)).returning();
    return game;
  }

  async getWaitingTacticsGames(): Promise<TacticsGame[]> {
    return db.select().from(tacticsGames).where(eq(tacticsGames.status, "waiting")).orderBy(desc(tacticsGames.createdAt));
  }

  async createTacticsPlayer(data: InsertTacticsPlayer): Promise<TacticsPlayer> {
    const [player] = await db.insert(tacticsPlayers).values(data).returning();
    return player;
  }

  async getTacticsPlayers(gameId: string): Promise<(TacticsPlayer & { user: User })[]> {
    const players = await db.select().from(tacticsPlayers).where(eq(tacticsPlayers.gameId, gameId));
    return await Promise.all(players.map(async (p) => {
      const [user] = await db.select().from(users).where(eq(users.id, p.userId));
      return { ...p, user };
    }));
  }

  async updateTacticsPlayer(id: string, data: Partial<TacticsPlayer>): Promise<TacticsPlayer> {
    const [player] = await db.update(tacticsPlayers).set(data).where(eq(tacticsPlayers.id, id)).returning();
    return player;
  }

  async createTacticsMove(data: InsertTacticsMove): Promise<TacticsMove> {
    const [move] = await db.insert(tacticsMoves).values(data).returning();
    return move;
  }

  async getTacticsMovesForRound(gameId: string, round: number): Promise<TacticsMove[]> {
    return db.select().from(tacticsMoves).where(and(eq(tacticsMoves.gameId, gameId), eq(tacticsMoves.round, round)));
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
}

export const storage = new DatabaseStorage();
