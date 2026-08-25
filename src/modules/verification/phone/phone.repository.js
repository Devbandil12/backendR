import { db } from '../../../db/client.js';
import { usersTable, otpVerificationsTable, verifiedPhonesTable } from '../../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';

export const getUserByClerkId = async (clerkId) => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  return user;
};

export const checkVerifiedPhone = async (userId, phone) => {
  const [existing] = await db.select({ id: verifiedPhonesTable.id }).from(verifiedPhonesTable)
    .where(and(eq(verifiedPhonesTable.userId, userId), eq(verifiedPhonesTable.phone, phone))).limit(1);
  return existing;
};

export const insertOtpVerification = async (data) => {
  const [record] = await db.insert(otpVerificationsTable).values(data).returning();
  return record;
};

export const updateOtpVerificationChannel = async (id, channel) => {
  await db.update(otpVerificationsTable).set({ channel }).where(eq(otpVerificationsTable.id, id));
};

export const getOtpVerificationById = async (id) => {
  const [record] = await db.select().from(otpVerificationsTable).where(eq(otpVerificationsTable.id, id));
  return record;
};

export const incrementOtpAttempts = async (id, currentAttempts) => {
  await db.update(otpVerificationsTable).set({ attempts: currentAttempts + 1 }).where(eq(otpVerificationsTable.id, id));
};

export const markOtpVerified = async (id, verificationToken, tokenExpiresAt) => {
  await db.update(otpVerificationsTable).set({
    verified: true, verifiedAt: new Date(), verificationToken, expiresAt: tokenExpiresAt,
  }).where(eq(otpVerificationsTable.id, id));
};

export const upsertVerifiedPhone = async (userId, phone) => {
  await db.insert(verifiedPhonesTable).values({ userId, phone })
    .onConflictDoUpdate({ target: [verifiedPhonesTable.userId, verifiedPhonesTable.phone], set: { verifiedAt: new Date() } });
};

export const updateUserDefaultPhone = async (userId, phone, isAlreadyDefault) => {
  if (!isAlreadyDefault) {
    await db.update(usersTable).set({ phone, phoneVerified: true, phoneVerifiedAt: new Date() }).where(eq(usersTable.id, userId));
  } else {
    await db.update(usersTable).set({ phoneVerified: true, phoneVerifiedAt: new Date() }).where(eq(usersTable.id, userId));
  }
};

export const listVerifiedPhones = async (userId) => {
  return await db.select().from(verifiedPhonesTable).where(eq(verifiedPhonesTable.userId, userId));
};
