// services/emailQueue.js
import Redis from "ioredis";
import { redis as publisher, getRedisConfig } from '../configs/redis.js';
import { sendOrderConfirmationEmail, sendAdminOrderAlert } from '../routes/notifications.js';

// ✅ Change name to 'email_queue_v2' to ensure a clean start and avoid old keys
const QUEUE_NAME = process.env.QUEUE_NAME || 'email_queue_v2'; 

const config = getRedisConfig();

// Worker connection (Polling doesn't strictly need maxRetries: null, but it's safe to keep)
const workerClient = new Redis(config.url, {
    ...config.options,
    maxRetriesPerRequest: null 
});

workerClient.on("connect", () => console.log("👷 Email Worker: Connected to Redis"));
workerClient.on("error", (err) => console.error("❌ Email Worker Connection Error:", err.message));

export const startEmailWorker = () => {
  console.log(`🚜 Email Poller Started on '${QUEUE_NAME}' (Checking every 2s)...`);
  
  // 🔄 THE FIX: Polling Loop
  // Check for new emails every 2000ms (2 seconds) instead of keeping a blocked connection
  setInterval(processNextJob, 2000);
};

const processNextJob = async () => {
  try {
    // ⚡ 'rpop' is Non-Blocking. It asks "Do you have mail?" and returns immediately.
    // This prevents Render/AWS from thinking the connection is "idle" and cutting it.
    const result = await workerClient.rpop(QUEUE_NAME);
    
    if (result) {
      console.log("📬 FOUND A JOB! Processing...");
      const jobData = JSON.parse(result);
      
      const { userEmail, orderDetails, orderItems, paymentDetails } = jobData;

      console.log(`📨 Processing Order #${orderDetails?.id || 'Unknown'}`);

      // Run email tasks
      const results = await Promise.allSettled([
          sendOrderConfirmationEmail(userEmail, orderDetails, orderItems, paymentDetails),
          sendAdminOrderAlert(orderDetails, orderItems)
      ]);

      // Log success/failure
      results.forEach((res, index) => {
        if (res.status === 'rejected') {
            console.error(`❌ Task ${index + 1} Failed:`, res.reason);
        } else {
            console.log(`✅ Task ${index + 1} Sent!`);
        }
      });
    }
  } catch (error) {
    console.error("⚠️ Worker Error:", error.message);
  }
};

export const addToEmailQueue = async (data) => {
  try {
    // Push to the new queue name
    await publisher.lpush(QUEUE_NAME, JSON.stringify(data));
    console.log(`✅ Email job added to ${QUEUE_NAME}`);
  } catch (error) {
    console.error("❌ Failed to queue email:", error);
  }
};