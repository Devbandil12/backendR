// services/emailQueue.js
import Redis from "ioredis";
import { redis as publisher, getRedisConfig } from '../configs/redis.js';
import { sendOrderConfirmationEmail, sendAdminOrderAlert } from '../routes/notifications.js';

// ✅ SMART QUEUE NAME: 
// Uses your .env variable if it exists (for local testing), 
// otherwise defaults to 'email_queue' (for Production).
const QUEUE_NAME = process.env.QUEUE_NAME || 'email_queue'; 

const config = getRedisConfig();
const workerClient = new Redis(config.url, {
    ...config.options,
    maxRetriesPerRequest: null 
});

workerClient.on("connect", () => console.log("👷 Email Worker: Connected to Redis"));
workerClient.on("ready", () => console.log(`👷 Email Worker: Listening on '${QUEUE_NAME}'`));
workerClient.on("error", (err) => console.error("❌ Email Worker Connection Error:", err.message));

export const startEmailWorker = () => {
  console.log(`🚀 Starting Email Worker on queue: ${QUEUE_NAME}...`);
  processNextJob();
};

const processNextJob = async () => {
  try {
    // Listen on the dynamic queue name
    const result = await workerClient.brpop(QUEUE_NAME, 0);
    
    if (result) {
      const jobData = JSON.parse(result[1]);
      console.log(`📨 Picking up email job for Order #${jobData.orderDetails?.id || 'Unknown'}`);
      
      const { userEmail, orderDetails, orderItems, paymentDetails } = jobData;

      const results = await Promise.allSettled([
          sendOrderConfirmationEmail(userEmail, orderDetails, orderItems, paymentDetails),
          sendAdminOrderAlert(orderDetails, orderItems)
      ]);

      results.forEach((res, index) => {
        if (res.status === 'rejected') {
            console.error(`❌ Email Task ${index + 1} Failed:`, res.reason);
        } else {
            console.log(`✅ Email Task ${index + 1} Sent!`);
        }
      });
    }
  } catch (error) {
    console.error("⚠️ Worker Loop Error:", error);
    await new Promise(res => setTimeout(res, 5000));
  }

  setImmediate(processNextJob);
};

export const addToEmailQueue = async (data) => {
  try {
    // Push to the dynamic queue name
    await publisher.lpush(QUEUE_NAME, JSON.stringify(data));
    console.log(`✅ Email job added to ${QUEUE_NAME}`);
  } catch (error) {
    console.error("❌ Failed to queue email:", error);
  }
};