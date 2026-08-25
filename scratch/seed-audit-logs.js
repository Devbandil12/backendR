import { audit } from '../src/infrastructure/audit/audit.service.js';
import { ACTOR_TYPES } from '../src/infrastructure/audit/audit.constants.js';

const run = async () => {
  console.log("Seeding comprehensive test audit logs...");
  const actorId = "system_seeder_002";
  
  // 1. SITE CONTROL
  await audit.log({
    actorUserId: actorId,
    actorType: ACTOR_TYPES.ADMIN,
    action: 'SITE_MODE_CHANGED',
    resourceType: 'SITE_CONTROL',
    resourceId: 'site_settings_1',
    description: 'Site mode changed from LIVE to MAINTENANCE for scheduled upgrades',
    resourceData: { id: 'site_settings_1', mode: 'MAINTENANCE', schedule: '2026-08-24 02:00 to 04:00' },
    changes: ['Mode: LIVE → MAINTENANCE', 'Schedule: Added']
  });

  // 2. REWARDS
  await audit.log({
    actorUserId: actorId,
    actorType: ACTOR_TYPES.ADMIN,
    action: 'REWARD_POINTS_ADJUSTED',
    resourceType: 'REWARD',
    resourceId: 'rew_890123',
    description: 'Manually added 500 reward points to user for service recovery',
    resourceData: { id: 'rew_890123', name: 'Points Adjustment', title: '500 Points Added', userId: 'usr_777888' },
    metadata: { previousBalance: 1200, newBalance: 1700, reason: 'Customer complaint resolution' }
  });

  // 3. CUSTOMER (USER) - More Detailed
  await audit.log({
    actorUserId: actorId,
    actorType: ACTOR_TYPES.ADMIN,
    action: 'CUSTOMER_PROFILE_UPDATED',
    resourceType: 'USER',
    resourceId: 'usr_777888',
    description: 'Updated shipping address and contact preference for Aisha Gupta',
    resourceData: { id: 'usr_777888', name: 'Aisha Gupta', email: 'aisha.gupta@example.com' },
    changes: ['Shipping Address: 123 Old St → 456 New Ave', 'Phone: Added']
  });

  // 4. CART
  await audit.log({
    actorUserId: 'usr_777888',
    actorType: ACTOR_TYPES.USER,
    action: 'CART_ITEM_ADDED',
    resourceType: 'CART',
    resourceId: 'cart_556677',
    description: 'User added Sapphire Mist — 50ml to their shopping cart',
    resourceData: { id: 'cart_556677', name: 'Aisha\'s Cart' },
    metadata: { addedItem: 'Sapphire Mist — 50ml', quantity: 2, price: 3500 }
  });

  // 5. WISHLIST
  await audit.log({
    actorUserId: 'usr_777888',
    actorType: ACTOR_TYPES.USER,
    action: 'WISHLIST_ITEM_ADDED',
    resourceType: 'WISHLIST',
    resourceId: 'wish_998877',
    description: 'User added Velvet Night — 100ml to their wishlist',
    resourceData: { id: 'wish_998877', title: 'My Favorites' },
    metadata: { variantId: 'var_555222' }
  });

  // 6. SUPPORT TICKET
  await audit.log({
    actorUserId: actorId,
    actorType: ACTOR_TYPES.ADMIN,
    action: 'TICKET_STATUS_UPDATED',
    resourceType: 'SUPPORT_TICKET',
    resourceId: 'tk_102030',
    description: 'Changed support ticket status to RESOLVED',
    resourceData: { id: 'tk_102030', ticketNumber: 'TK-2026-0899', subject: 'Damaged in transit' },
    changes: ['Status: IN_PROGRESS → RESOLVED']
  });

  // 7. SITE CONTENT
  await audit.log({
    actorUserId: actorId,
    actorType: ACTOR_TYPES.ADMIN,
    action: 'CONTENT_BANNER_UPDATED',
    resourceType: 'SITE_CONTENT',
    resourceId: 'hero_banner_1',
    description: 'Updated homepage hero banner image and call-to-action text',
    resourceData: { id: 'hero_banner_1', name: 'Homepage Hero Banner' },
    changes: ['ImageURL: Updated', 'CTA Text: "Shop Now" → "Explore the Collection"']
  });

  // 8. REFUND
  await audit.log({
    actorUserId: actorId,
    actorType: ACTOR_TYPES.ADMIN,
    action: 'REFUND_PROCESSED',
    resourceType: 'REFUND',
    resourceId: 'ref_334455',
    description: 'Processed full refund for cancelled order',
    resourceData: { id: 'ref_334455', refundId: 'RF-8899', orderId: 'ORD-5566' },
    metadata: { amount: 8900, currency: 'INR', gateway: 'Razorpay' }
  });

  console.log("Detailed seeding complete! Check your Admin UI Audit Logs.");
  process.exit(0);
};

run().catch(console.error);
