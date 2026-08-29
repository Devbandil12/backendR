import { db } from '../../../db/client.js';
import { otpVerificationsTable, verifiedPhonesTable } from '../../../db/schema/index.js';
import { eq, and, desc, sql } from 'drizzle-orm';

export const getLatestOtpRecord = async (userId, phone, purpose) => {
  const [record] = await db.select()
    .from(otpVerificationsTable)
    .where(
      and(
        eq(otpVerificationsTable.userId, userId),
        eq(otpVerificationsTable.phone, phone),
        eq(otpVerificationsTable.purpose, purpose)
      )
    )
    .orderBy(desc(otpVerificationsTable.createdAt))
    .limit(1);
  return record;
};

export const createOtpRecord = async (userId, phone, otpHash, purpose, expiresAt) => {
  const [record] = await db.insert(otpVerificationsTable).values({
    userId,
    phone,
    otpHash,
    purpose,
    expiresAt,
    resendCount: 0,
    attempts: 0,
    maxAttempts: 5,
    verified: false,
    tokenConsumed: false
  }).returning();
  return record;
};

export const updateOtpRecordCount = async (id, newHash, expiresAt) => {
  const [record] = await db.update(otpVerificationsTable)
    .set({
      otpHash: newHash,
      expiresAt: expiresAt,
      resendCount: sql`${otpVerificationsTable.resendCount} + 1`
    })
    .where(
      and(
        eq(otpVerificationsTable.id, id),
        sql`${otpVerificationsTable.resendCount} < 2`
      )
    )
    .returning();
  return record;
};

export const incrementOtpAttempts = async (id) => {
  const [record] = await db.update(otpVerificationsTable)
    .set({
      attempts: sql`${otpVerificationsTable.attempts} + 1`
    })
    .where(eq(otpVerificationsTable.id, id))
    .returning();
  return record;
};

export const markOtpVerified = async (id, verificationToken) => {
  const [record] = await db.update(otpVerificationsTable)
    .set({
      verified: true,
      verifiedAt: new Date(),
      verificationToken
    })
    .where(eq(otpVerificationsTable.id, id))
    .returning();
  return record;
};

export const consumeVerificationToken = async (token) => {
  const [record] = await db.update(otpVerificationsTable)
    .set({ tokenConsumed: true })
    .where(
      and(
        eq(otpVerificationsTable.verificationToken, token),
        eq(otpVerificationsTable.tokenConsumed, false)
      )
    )
    .returning();
  return record;
};

export const upsertVerifiedPhone = async (userId, phone) => {
  const [record] = await db.insert(verifiedPhonesTable).values({
    userId,
    phone,
    verifiedAt: new Date()
  }).onConflictDoUpdate({
    target: [verifiedPhonesTable.userId, verifiedPhonesTable.phone],
    set: { verifiedAt: new Date() }
  }).returning();
  return record;
};

export const getVerifiedPhones = async (userId) => {
  return await db.select()
    .from(verifiedPhonesTable)
    .where(eq(verifiedPhonesTable.userId, userId))
    .orderBy(desc(verifiedPhonesTable.verifiedAt));
};

export const getVerifiedPhone = async (userId, phone) => {
  const [record] = await db.select()
    .from(verifiedPhonesTable)
    .where(
      and(
        eq(verifiedPhonesTable.userId, userId),
        eq(verifiedPhonesTable.phone, phone)
      )
    )
    .limit(1);
  return record;
};
