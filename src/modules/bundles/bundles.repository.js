// src/modules/bundles/bundles.repository.js
import { db } from '../../db/client.js';
import { productBundlesTable, productVariantsTable, usersTable } from '../../db/schema/index.js';
import { eq } from 'drizzle-orm';

export async function findBundleContents(bundleVariantId) {
  return db.query.productBundlesTable.findMany({ 
    where: eq(productBundlesTable.bundleVariantId, bundleVariantId), 
    with: { content: true } 
  });
}

export async function resolveUserByClerkId(clerkId) {
  if (!clerkId) return null;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  return user || null;
}

export async function getVariant(variantId) {
  const [variant] = await db.select().from(productVariantsTable).where(eq(productVariantsTable.id, variantId));
  return variant || null;
}

export async function insertBundleEntry(data) {
  const [entry] = await db.insert(productBundlesTable).values(data).returning();
  return entry;
}

export async function deleteBundleEntry(bundleEntryId) {
  const entryToDelete = await db.query.productBundlesTable.findFirst({ 
    where: eq(productBundlesTable.id, bundleEntryId), 
    with: { bundle: true, content: true } 
  });
  if (!entryToDelete) return null;
  
  await db.delete(productBundlesTable).where(eq(productBundlesTable.id, bundleEntryId));
  return entryToDelete;
}

// logActivity removed
