// src/modules/bundles/bundles.service.js
import * as bundlesRepo from './bundles.repository.js';
import { invalidateMultiple } from '../../infrastructure/cache/cache.invalidate.js';
import { makeAllProductsKey, makeProductKey } from '../../infrastructure/cache/cache.keys.js';
import { audit } from '../../infrastructure/audit/audit.service.js';
import { ACTOR_TYPES } from '../../infrastructure/audit/audit.constants.js';

export async function getBundleContents(bundleVariantId) {
  const contents = await bundlesRepo.findBundleContents(bundleVariantId);
  if (!contents || contents.length === 0) {
    throw Object.assign(new Error('Bundle not found or is empty.'), { status: 404 });
  }
  return contents;
}

export async function addBundleItem(clerkId, bundleVariantId, contentVariantId, quantity) {
  const adminUser = await bundlesRepo.resolveUserByClerkId(clerkId);
  if (!adminUser) throw Object.assign(new Error('Unauthorized'), { status: 401 });

  const [bundleVariant, contentVariant] = await Promise.all([
    bundlesRepo.getVariant(bundleVariantId),
    bundlesRepo.getVariant(contentVariantId),
  ]);

  const newBundleEntry = await bundlesRepo.insertBundleEntry({ 
    bundleVariantId, 
    contentVariantId, 
    quantity 
  });

  await audit.log({
    actorUserId: adminUser.id,
    actorType: ACTOR_TYPES.ADMIN,
    action: 'BUNDLE_ADD_ITEM',
    resourceType: 'VARIANT',
    resourceId: bundleVariantId,
    resourceData: bundleVariant,
    description: `Added ${quantity}x ${contentVariant?.name || 'Item'} to bundle ${bundleVariant?.name || 'Bundle'}`,
    metadata: { contentVariantId, quantity, bundleName: bundleVariant?.name, contentName: contentVariant?.name }
  });

  if (bundleVariant) {
    await invalidateMultiple([{ key: makeAllProductsKey(), prefix: true }, { key: makeProductKey(bundleVariant.productId), prefix: true }]);
  }
  return newBundleEntry;
}

export async function removeBundleItem(clerkId, bundleEntryId) {
  const adminUser = await bundlesRepo.resolveUserByClerkId(clerkId);
  if (!adminUser) throw Object.assign(new Error('Unauthorized'), { status: 401 });

  const deletedEntry = await bundlesRepo.deleteBundleEntry(bundleEntryId);
  if (!deletedEntry) {
    throw Object.assign(new Error('Bundle entry not found.'), { status: 404 });
  }

  await audit.log({
    actorUserId: adminUser.id,
    actorType: ACTOR_TYPES.ADMIN,
    action: 'BUNDLE_REMOVE_ITEM',
    resourceType: 'VARIANT',
    resourceId: deletedEntry.bundleVariantId,
    resourceData: deletedEntry.bundle,
    description: `Removed ${deletedEntry.quantity}x ${deletedEntry.content?.name} from bundle ${deletedEntry.bundle?.name}`,
    metadata: { bundleEntryId, contentVariantId: deletedEntry.contentVariantId }
  });

  if (deletedEntry.bundle) {
    await invalidateMultiple([{ key: makeAllProductsKey(), prefix: true }, { key: makeProductKey(deletedEntry.bundle.productId), prefix: true }]);
  }
  return deletedEntry;
}
