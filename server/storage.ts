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
  type Donation,
  type InsertDonation,
  type UserMatch,
  type InsertUserMatch,
  users,
  userProfiles,
  projects,
  projectMembers,
  projectChatMessages,
  donations,
  userMatches
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, or, ilike, sql, and } from "drizzle-orm";

export interface IStorage {
  // User Profile
  getUserProfile(userId: string): Promise<UserProfile | undefined>;
  upsertUserProfile(data: InsertUserProfile): Promise<UserProfile>;
  completeOnboarding(userId: string): Promise<void>;
  
  // Projects
  getProjects(filters?: { category?: string; status?: string; techStack?: string[] }): Promise<(Project & { owner: User; profile?: UserProfile })[]>;
  getProject(id: string): Promise<Project | undefined>;
  createProject(data: InsertProject): Promise<Project>;
  updateProject(id: string, data: Partial<InsertProject>): Promise<Project>;
  incrementProjectViews(id: string): Promise<void>;
  getProjectMembers(projectId: string): Promise<(ProjectMember & { user: User; profile?: UserProfile })[]>;
  
  // Project Chat
  getProjectChatMessages(projectId: string): Promise<ProjectChatMessage[]>;
  addProjectChatMessage(projectId: string, role: "user" | "assistant", content: string): Promise<ProjectChatMessage>;
  
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

  async getProjects(filters?: { category?: string; status?: string; techStack?: string[] }): Promise<(Project & { owner: User; profile?: UserProfile })[]> {
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
      
    let filtered = result;
    if (filters?.techStack && filters.techStack.length > 0) {
      filtered = result.filter(p => 
        p.techStack?.some(tech => filters.techStack?.includes(tech))
      );
    }
    
    return await Promise.all(
      filtered.map(async (project) => {
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
}

export const storage = new DatabaseStorage();
