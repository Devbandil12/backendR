import cron from 'node-cron';
import { db } from '../configs/index.js';
import { addToCartTable } from '../configs/schema.js';
import { executeRecoveryForUsers } from '../routes/notifications.js';

export const initCronJobs = () => {
    console.log("⏰ Initializing Cron Jobs...");

    // Schedule: Runs at 10:00 AM on the 1st and 15th of every month
    // Syntax: 'Minute Hour DayOfMonth Month DayOfWeek'
    cron.schedule('0 10 1,15 * *', async () => {
        console.log("🔔 [AUTO] Running Bi-Weekly Abandoned Cart Recovery...");

        try {
            // 1. Find all distinct users who have items in the cart
            const usersWithCarts = await db
                .selectDistinct({ id: addToCartTable.userId })
                .from(addToCartTable);

            const userIds = usersWithCarts.map(u => u.id);

            if (userIds.length > 0) {
                console.log(`🎯 Found ${userIds.length} users with abandoned carts. Sending notifications...`);
                // 2. Call the shared logic
                await executeRecoveryForUsers(userIds);
                console.log("✅ [AUTO] Recovery Batch Complete.");
            } else {
                console.log("ℹ️ No abandoned carts found today.");
            }

        } catch (error) {
            console.error("❌ [AUTO] Cron Job Failed:", error);
        }
    });
};