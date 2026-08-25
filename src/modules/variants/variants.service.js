// src/modules/variants/variants.service.js
import * as variantsRepo from './variants.repository.js';
import { invalidateMultiple } from '../../infrastructure/cache/cache.invalidate.js';
import { makeAllProductsKey, makeProductKey } from '../../infrastructure/cache/cache.keys.js';
import { audit } from '../../infrastructure/audit/audit.service.js';
import { ACTOR_TYPES } from '../../infrastructure/audit/audit.constants.js';
import { getProductByIdRaw } from '../catalog/catalog.repository.js';

export async function updateVariant(clerkId, variantId, variantData) {
  const adminUser = await variantsRepo.resolveUserByClerkId(clerkId);
  if (!adminUser) throw Object.assign(new Error('Unauthorized'), { status: 401 });

  const currentVariant = await variantsRepo.findVariantById(variantId);
  if (!currentVariant) throw Object.assign(new Error('Variant not found.'), { status: 404 });

  const updatedVariant = await variantsRepo.updateVariant(variantId, variantData);

  const changes = [];
  if (variantData.oprice && variantData.oprice !== currentVariant.oprice) changes.push(`Price: ₹${currentVariant.oprice} → ₹${variantData.oprice}`);
  if (variantData.stock !== undefined && variantData.stock !== currentVariant.stock) changes.push(`Stock: ${currentVariant.stock} → ${variantData.stock}`);
  if (variantData.name && variantData.name !== currentVariant.name) changes.push(`Name: ${currentVariant.name} → ${variantData.name}`);
  if (variantData.weight && variantData.weight !== currentVariant.weight) changes.push(`Weight: ${currentVariant.weight}kg → ${variantData.weight}kg`);

  if (changes.length > 0) {
    const product = await getProductByIdRaw(updatedVariant.productId);
    updatedVariant.productName = product?.name;

    await audit.log({
      actorUserId: adminUser.id,
      actorType: ACTOR_TYPES.ADMIN,
      action: 'VARIANT_UPDATED',
      resourceType: 'VARIANT',
      resourceId: updatedVariant.id,
      changes,
      description: `Updated variant ${product?.name ? product.name + ' — ' : ''}${updatedVariant.name}: ${changes.join(', ')}`,
      resourceData: updatedVariant,
      metadata: { productId: updatedVariant.productId }
    });
  }

  await invalidateMultiple([{ key: makeAllProductsKey(), prefix: true }, { key: makeProductKey(updatedVariant.productId), prefix: true }]);
  return updatedVariant;
}

export async function createVariant(clerkId, variantData) {
  const adminUser = await variantsRepo.resolveUserByClerkId(clerkId);
  if (!adminUser) throw Object.assign(new Error('Unauthorized'), { status: 401 });

  const newVariant = await variantsRepo.insertVariant({
    productId: variantData.productId,
    name: variantData.name,
    size: variantData.size,
    oprice: variantData.oprice,
    discount: variantData.discount,
    costPrice: variantData.costPrice,
    stock: variantData.stock,
    sku: variantData.sku,
    weight: variantData.weight || 0.5,
    length: variantData.length || 10,
    breadth: variantData.breadth || 10,
    height: variantData.height || 10
  });

  const product = await getProductByIdRaw(newVariant.productId);
  newVariant.productName = product?.name;

  await audit.log({
    actorUserId: adminUser.id,
    actorType: ACTOR_TYPES.ADMIN,
    action: 'VARIANT_CREATED',
    resourceType: 'VARIANT',
    resourceId: newVariant.id,
    description: `Created variant: ${product?.name ? product.name + ' — ' : ''}${newVariant.name}`,
    resourceData: newVariant,
    metadata: { productId: variantData.productId }
  });

  await invalidateMultiple([{ key: makeAllProductsKey(), prefix: true }, { key: makeProductKey(newVariant.productId), prefix: true }]);
  return newVariant;
}

export async function archiveVariant(clerkId, variantId) {
  const adminUser = await variantsRepo.resolveUserByClerkId(clerkId);
  if (!adminUser) throw Object.assign(new Error('Unauthorized'), { status: 401 });

  const archivedVariant = await variantsRepo.updateVariant(variantId, { isArchived: true });
  if (!archivedVariant) throw Object.assign(new Error('Variant not found.'), { status: 404 });

  const product = await getProductByIdRaw(archivedVariant.productId);
  archivedVariant.productName = product?.name;

  await audit.log({
    actorUserId: adminUser.id,
    actorType: ACTOR_TYPES.ADMIN,
    action: 'VARIANT_ARCHIVED',
    resourceType: 'VARIANT',
    resourceId: variantId,
    description: `Archived variant: ${product?.name ? product.name + ' — ' : ''}${archivedVariant.name}`,
    resourceData: archivedVariant,
    metadata: { productId: archivedVariant.productId }
  });

  await invalidateMultiple([{ key: makeAllProductsKey(), prefix: true }, { key: makeProductKey(archivedVariant.productId), prefix: true }]);
  return archivedVariant;
}

export async function unarchiveVariant(clerkId, variantId) {
  const adminUser = await variantsRepo.resolveUserByClerkId(clerkId);
  if (!adminUser) throw Object.assign(new Error('Unauthorized'), { status: 401 });

  const unarchivedVariant = await variantsRepo.updateVariant(variantId, { isArchived: false });
  if (!unarchivedVariant) throw Object.assign(new Error('Variant not found.'), { status: 404 });

  const product = await getProductByIdRaw(unarchivedVariant.productId);
  unarchivedVariant.productName = product?.name;

  await audit.log({
    actorUserId: adminUser.id,
    actorType: ACTOR_TYPES.ADMIN,
    action: 'VARIANT_UNARCHIVE',
    resourceType: 'VARIANT',
    resourceId: variantId,
    description: `Unarchived variant: ${product?.name ? product.name + ' — ' : ''}${unarchivedVariant.name}`,
    resourceData: unarchivedVariant,
    metadata: { productId: unarchivedVariant.productId }
  });

  await invalidateMultiple([{ key: makeAllProductsKey(), prefix: true }, { key: makeProductKey(unarchivedVariant.productId), prefix: true }]);
  return unarchivedVariant;
}
