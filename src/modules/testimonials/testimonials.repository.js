import { db } from '../../db/client.js';
import { testimonials, usersTable } from '../../db/schema/index.js';
import { desc, eq } from 'drizzle-orm';

export const getAllTestimonials = async () => {
  return await db.select().from(testimonials).orderBy(desc(testimonials.createdAt));
};

export const getUserByClerkId = async (clerkId) => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  return user;
};

export const insertTestimonial = async (data) => {
  await db.insert(testimonials).values(data);
};
