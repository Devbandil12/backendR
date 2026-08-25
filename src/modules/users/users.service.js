import * as UsersRepository from './users.repository.js';
import { invalidateMultiple } from '../../infrastructure/cache/cache.invalidate.js';
import { makeAllUsersKey, makeFindByClerkIdKey, makeUserAddressesKey, makeUserOrdersKey } from '../../infrastructure/cache/cache.keys.js';
import { resolveEffectivePermissions } from '../../middleware/rbac.js';
import { audit } from '../../infrastructure/audit/audit.service.js';
import { AUDIT_EVENTS } from '../../infrastructure/audit/audit.events.js';
import { ACTOR_TYPES } from '../../infrastructure/audit/audit.constants.js';

const checkIsAdmin = async (clerkId) => {
  const adminData = await resolveEffectivePermissions(clerkId);
  return !!(adminData && adminData.permissions.includes('users.manage'));
};

// getAdminLogs removed - use new Audit Logs API

export async function getAllUsers(page = 1, limit = 20, search = '') {
  return await UsersRepository.getAllUsers(page, limit, search);
}

export async function getUserByClerkId(clerkId) {
  const user = await UsersRepository.getUserByClerkId(clerkId);
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  return { ...user, profileImage: user.profileImage || null, dob: user.dob || null, gender: user.gender || null };
}

export async function createUser(clerkId, name, email) {
  const existingUser = await UsersRepository.getUserByClerkIdOrEmail(clerkId, email);
  if (existingUser) return existingUser;

  const newUser = await UsersRepository.insertUser({ name, email, clerkId });
  await audit.log({ 
    actorUserId: newUser.id, 
    actorType: ACTOR_TYPES.USER, 
    action: 'USER_CREATED',
    resourceType: 'USER',
    resourceId: newUser.id,
    resourceData: newUser,
    description: 'Account successfully created' 
  });
  await invalidateMultiple([{ key: makeAllUsersKey() }, { key: makeFindByClerkIdKey(clerkId) }]);
  return newUser;
}

export async function updateUser(requesterClerkId, targetId, updates) {
  const requester = await UsersRepository.getUserByClerkId(requesterClerkId);
  if (!requester) throw Object.assign(new Error('Unauthorized'), { status: 401 });

  const userToUpdate = await UsersRepository.getUserById(targetId);
  if (!userToUpdate) throw Object.assign(new Error('User not found'), { status: 404 });

  const isAdmin = await checkIsAdmin(requesterClerkId);
  const isSelf = requester.id === userToUpdate.id;
  if (!isAdmin && !isSelf) throw Object.assign(new Error('Forbidden: You can only edit your own profile.'), { status: 403 });

  const cleanUpdates = {};
  if (updates.name !== undefined) cleanUpdates.name = updates.name;
  if (updates.profileImage !== undefined) cleanUpdates.profileImage = updates.profileImage;
  if (updates.dob !== undefined) cleanUpdates.dob = updates.dob ? new Date(updates.dob) : null;
  if (updates.gender !== undefined) cleanUpdates.gender = updates.gender;
  if (updates.notify_order_updates !== undefined) cleanUpdates.notify_order_updates = updates.notify_order_updates;
  if (updates.notify_promos !== undefined) cleanUpdates.notify_promos = updates.notify_promos;
  if (updates.notify_pincode !== undefined) cleanUpdates.notify_pincode = updates.notify_pincode;
  if (updates.pushSubscription !== undefined) cleanUpdates.pushSubscription = updates.pushSubscription;

  if (updates.phone !== undefined) {
    const phoneRegex = /^[6-9]\d{9}$/;
    if (updates.phone !== null && updates.phone !== "" && !phoneRegex.test(String(updates.phone).trim())) {
      throw Object.assign(new Error('Invalid phone number.'), { status: 400 });
    }
    cleanUpdates.phone = updates.phone ? String(updates.phone).trim() : null;
  }

  if (isAdmin) {
    if (updates.walletBalance !== undefined) cleanUpdates.walletBalance = updates.walletBalance;
    if (updates.referralCode !== undefined) cleanUpdates.referralCode = updates.referralCode;
  }

  if (Object.keys(cleanUpdates).length === 0) throw Object.assign(new Error('No valid fields to update.'), { status: 400 });

  const updatedUser = await UsersRepository.updateUser(targetId, cleanUpdates);

  const changes = [];
  if (cleanUpdates.name && cleanUpdates.name !== userToUpdate.name) changes.push(`Name: ${userToUpdate.name} → ${cleanUpdates.name}`);
  if (cleanUpdates.phone && cleanUpdates.phone !== userToUpdate.phone) changes.push(`Phone: ${userToUpdate.phone || 'None'} → ${cleanUpdates.phone}`);

  if (changes.length > 0) {
    await audit.log({
      actorUserId: requester.id,
      actorType: isAdmin && !isSelf ? ACTOR_TYPES.ADMIN : ACTOR_TYPES.USER,
      action: 'USER_UPDATED',
      resourceType: 'USER',
      resourceId: targetId,
      resourceData: userToUpdate,
      changes,
      description: `Updated ${userToUpdate.email}: ${changes.join(', ')}`
    });
  }

  await invalidateMultiple([{ key: makeAllUsersKey() }, { key: makeFindByClerkIdKey(userToUpdate.clerkId) }]);
  return updatedUser;
}

export async function deleteUser(requesterClerkId, targetId) {
  const requester = await UsersRepository.getUserByClerkId(requesterClerkId);
  const userToDelete = await UsersRepository.getUserById(targetId);
  
  if (!userToDelete) throw Object.assign(new Error('User not found'), { status: 404 });

  const isAdmin = await checkIsAdmin(requesterClerkId);
  const isSelf = requester?.id === userToDelete.id;
  if (!isAdmin && !isSelf) throw Object.assign(new Error('Forbidden'), { status: 403 });

  await UsersRepository.deleteUser(targetId);
  await invalidateMultiple([{ key: makeAllUsersKey() }, { key: makeFindByClerkIdKey(userToDelete.clerkId) }]);
}

// getUserLogs removed - users can view logs via Audit API if authorized

export async function getUserAddresses(requesterClerkId, targetId) {
  const requester = await UsersRepository.getUserByClerkId(requesterClerkId);
  const isAdmin = await checkIsAdmin(requesterClerkId);
  if (requester.id !== targetId && !isAdmin) throw Object.assign(new Error('Forbidden'), { status: 403 });

  return await UsersRepository.getUserAddresses(targetId);
}

export async function getUserOrders(requesterClerkId, targetId) {
  if (!targetId) {
    targetId = requesterClerkId;
    requesterClerkId = null;
  }
  if (requesterClerkId) {
    const requester = await UsersRepository.getUserByClerkId(requesterClerkId);
    const isAdmin = await checkIsAdmin(requesterClerkId);
    if (requester?.id !== targetId && !isAdmin) throw Object.assign(new Error('Forbidden'), { status: 403 });
  }

  const orderQuery = await UsersRepository.getUserOrders(targetId);
  if (!orderQuery.length) return [];

  const orderIds = orderQuery.map(o => o.orderId);
  const [productQuery, refundQuery] = await Promise.all([
    UsersRepository.getOrderItems(orderIds),
    UsersRepository.getOrderRefunds(orderIds),
  ]);

  const refundsByOrder = new Map();
  refundQuery.forEach(r => {
    if (!refundsByOrder.has(r.orderId)) refundsByOrder.set(r.orderId, []);
    refundsByOrder.get(r.orderId).push(r);
  });

  const map = new Map();
  orderQuery.forEach(o => {
    const orderRefunds = refundsByOrder.get(o.orderId) || [];
    const primaryRefund = orderRefunds[0] || null;

    map.set(o.orderId, {
      ...o,
      id: o.orderId,
      refunds: orderRefunds,
      refund: primaryRefund ? {
        id: primaryRefund.id,
        amount: primaryRefund.amount,
        status: primaryRefund.refundStatus,
        speedProcessed: primaryRefund.refundSpeed,
        created_at: primaryRefund.createdAt ? new Date(primaryRefund.createdAt).getTime() / 1000 : null,
        processed_at: primaryRefund.completedAt ? Math.floor(new Date(primaryRefund.completedAt).getTime() / 1000) : (primaryRefund.refundStatus === "processed" ? Math.floor(Date.now() / 1000) : null),
      } : null,
      items: [],
    });
  });

  productQuery.forEach(p => {
    const entry = map.get(p.orderId);
    if (entry) entry.items.push(p);
  });

  return Array.from(map.values());
}
