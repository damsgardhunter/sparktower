import { db } from "../../db";
import { projectChatMessages as messages } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

export interface IChatStorage {
  getMessagesByProject(projectId: string): Promise<(typeof messages.$inferSelect)[]>;
  createMessage(projectId: string, role: "user" | "assistant", content: string): Promise<typeof messages.$inferSelect>;
}

export const chatStorage: IChatStorage = {
  async getMessagesByProject(projectId: string) {
    return db.select().from(messages).where(eq(messages.projectId, projectId)).orderBy(messages.createdAt);
  },

  async createMessage(projectId: string, role: "user" | "assistant", content: string) {
    const [message] = await db.insert(messages).values({ projectId, role, content }).returning();
    return message;
  },
};

