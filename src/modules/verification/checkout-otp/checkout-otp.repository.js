import { db } from '../../../db/client.js';
import { usersTable, UserAddressTable, otpVerificationsTable, verifiedPhonesTable } from '../../../db/schema/index.js';
import { eq } from 'drizzle-orm';

export const getUserByClerkId = async (clerkId) => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  return user;
};

export const getAddressById = async (addressId) => {
  const [address] = await db.select().from(UserAddressTable).where(eq(UserAddressTable.id, addressId));
  return address;
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
    verified: true,
    verifiedAt: new Date(),
    verificationToken,
    expiresAt: tokenExpiresAt,
  }).where(eq(otpVerificationsTable.id, id));
};

export const upsertVerifiedPhone = async (userId, phone) => {
  await db.insert(verifiedPhonesTable)
    .values({ userId, phone })
    .onConflictDoUpdate({
      target: [verifiedPhonesTable.userId, verifiedPhonesTable.phone],
      set: { verifiedAt: new Date() },
    });
};
