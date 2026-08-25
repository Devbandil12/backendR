import { db } from '../../db/client.js';
import { bannersTable, aboutUsTable } from '../../db/schema/index.js';
import { eq } from 'drizzle-orm';

export const getAllBanners = async () => {
  return await db.select().from(bannersTable);
};

export const insertBanner = async (data) => {
  const [newBanner] = await db.insert(bannersTable).values(data).returning();
  return newBanner;
};

export const deleteBanner = async (id) => {
  await db.delete(bannersTable).where(eq(bannersTable.id, id));
};

export const updateBanner = async (id, data) => {
  const [updated] = await db.update(bannersTable).set(data).where(eq(bannersTable.id, id)).returning();
  return updated;
};

export const getAboutUs = async () => {
  return await db.select().from(aboutUsTable).limit(1);
};

export const insertAboutUs = async (data) => {
  const [newItem] = await db.insert(aboutUsTable).values(data).returning();
  return newItem;
};

export const updateAboutUs = async (id, data) => {
  const [updatedItem] = await db.update(aboutUsTable).set(data).where(eq(aboutUsTable.id, id)).returning();
  return updatedItem;
};
