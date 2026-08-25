import { db } from './src/db/client.js';
import { RBACService } from './src/modules/rbac/rbac.service.js';
import { usersTable, rolesTable } from './src/db/schema/index.js';
import { eq } from 'drizzle-orm';

async function test() {
  try {
    const users = await db.select().from(usersTable).limit(2);
    if (users.length < 2) {
      console.log('Not enough users in DB to test.');
      process.exit(1);
    }
    
    const roles = await db.select().from(rolesTable).limit(1);
    if (roles.length === 0) {
      console.log('No roles in DB.');
      process.exit(1);
    }
    
    const targetClerkId = users[0].clerkId;
    const assignedByClerkId = users[0].clerkId; // use same user for assigner just to test logic
    const roleId = roles[0].id;
    
    console.log(`Assigning role ${roleId} to user ${targetClerkId} by ${assignedByClerkId}`);
    
    await RBACService.assignRole(targetClerkId, roleId, assignedByClerkId);
    console.log('Success!');
  } catch (error) {
    console.error('FAILED:', error.stack);
  } finally {
    process.exit(0);
  }
}

test();
