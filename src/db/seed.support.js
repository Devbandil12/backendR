// src/db/seed.support.js
// Seeder for Enterprise Support Teams and Tags

import { db } from './client.js';
import { supportTeamsTable, supportTagsTable } from './schema/index.js';
import { sql } from 'drizzle-orm';

const TEAMS = [
  { name: 'Customer Support', description: 'General inquiries and user account support', color: '#10B981' },
  { name: 'Payments & Billings', description: 'Failed payments, refunds, coupon questions', color: '#EF4444' },
  { name: 'Logistics & Delivery', description: 'Shipping updates, address updates, damaged products', color: '#3B82F6' },
  { name: 'Order Management', description: 'Order cancellations, returns, modification requests', color: '#F59E0B' },
  { name: 'Technical Support', description: 'Website errors, login bugs, profile issues', color: '#8B5CF6' }
];

const TAGS = [
  { name: 'urgent', color: '#EF4444', description: 'High-priority customer issues' },
  { name: 'refund_requested', color: '#EF4444', description: 'Customer requested a refund' },
  { name: 'damaged_item', color: '#F59E0B', description: 'Product arrived damaged' },
  { name: 'delivery_delay', color: '#3B82F6', description: 'Courier delayed tracking' },
  { name: 'payment_issue', color: '#EF4444', description: 'Razorpay or gateway failure' },
  { name: 'guest_user', color: '#6B7280', description: 'Non-authenticated guest query' },
  { name: 'resolved', color: '#10B981', description: 'Marked resolved by agent' },
  { name: 'duplicate_ticket', color: '#6B7280', description: 'Closed as duplicate' },
  { name: 'vip', color: '#8B5CF6', description: 'High-value customer or influencer query' }
];

async function seed() {
  console.log('🌱 Seeding support teams...');
  for (const team of TEAMS) {
    try {
      await db.insert(supportTeamsTable).values(team).onConflictDoNothing();
      console.log(`✅ Team: ${team.name} seeded`);
    } catch (e) {
      console.error(`❌ Failed to seed team ${team.name}:`, e.message);
    }
  }

  console.log('🌱 Seeding support tags...');
  for (const tag of TAGS) {
    try {
      await db.insert(supportTagsTable).values(tag).onConflictDoNothing();
      console.log(`✅ Tag: #${tag.name} seeded`);
    } catch (e) {
      console.error(`❌ Failed to seed tag #${tag.name}:`, e.message);
    }
  }

  console.log('🎉 Seeding completed successfully!');
  process.exit(0);
}

seed().catch(err => {
  console.error('🚨 Seeding failed:', err);
  process.exit(1);
});
