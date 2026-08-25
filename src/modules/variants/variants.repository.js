// src/modules/variants/variants.repository.js
import { db } from '../../db/client.js';
import { productVariantsTable, usersTable } from '../../db/schema/index.js';
import { eq } from 'drizzle-orm';

export async function findVariantById(variantId) {
  const [variant] = await db.select().from(productVariantsTable).where(eq(productVariantsTable.id, variantId));
  return variant || null;
}

export async function resolveUserByClerkId(clerkId) {
  if (!clerkId) return null;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  return user || null;
}

export async function updateVariant(variantId, data) {
  const [updated] = await db.update(productVariantsTable).set(data).where(eq(productVariantsTable.id, variantId)).returning();
  return updated;
}

export async function insertVariant(data) {
  const [newVariant] = await db.insert(productVariantsTable).values(data).returning();
  return newVariant;
}

// logActivity removed. Use new audit service.
