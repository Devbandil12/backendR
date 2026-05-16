// services/emailQueue.js
import Redis from "ioredis";
import { redis as publisher, getRedisConfig } from '../configs/redis.js';
import { sendOrderConfirmationEmail, sendAdminOrderAlert } from '../routes/notifications.js';

const QUEUE_NAME = process.env.QUEUE_NAME || 'email_queue_v2'; 

const config = getRedisConfig();

const workerClient = new Redis(config.url, {
    ...config.options,
    maxRetriesPerRequest: null 
});

// 🛠️ 1. Fix the Logging Spam
workerClient.once("connect", () => console.log("👷 Email Worker: Connected to Redis"));
workerClient.on("reconnecting", () => console.warn("🔄 Email Worker: Reconnecting to Redis... (Network drop detected)"));
workerClient.on("error", (err) => console.error("❌ Email Worker Error:", err.message));

// 🛠️ 2. Upgrade to a Recursive Blocking Pop (brpop)
export const startEmailWorker = () => {
  console.log(`🚜 Email Worker Started on '${QUEUE_NAME}' (Listening actively)...`);
  processNextJob(); // Start the loop
};

const processNextJob = async () => {
  try {
    // ⚡ 'brpop' (Blocking Pop) tells Redis: "Hold this connection open for 5 seconds. 
    // If a job arrives, give it to me instantly. If not, release and I'll ask again."
    // This keeps the TCP connection actively alive, preventing the server from dropping it!
    const result = await workerClient.brpop(QUEUE_NAME, 5);
    
    if (result) {
      console.log("📬 FOUND A JOB! Processing...");
      // result is an array: [queueName, value]
      const jobString = result[1]; 
      const jobData = JSON.parse(jobString);
      
      const { userEmail, orderDetails, orderItems, paymentDetails } = jobData;

      console.log(`📨 Processing Order #${orderDetails?.id || 'Unknown'}`);

      const results = await Promise.allSettled([
          sendOrderConfirmationEmail(userEmail, orderDetails, orderItems, paymentDetails),
          sendAdminOrderAlert(orderDetails, orderItems)
      ]);

      results.forEach((res, index) => {
        if (res.status === 'rejected') {
            console.error(`❌ Task ${index + 1} Failed:`, res.reason);
        } else {
            console.log(`✅ Task ${index + 1} Sent!`);
        }
      });
    }
  } catch (error) {
    // Ignore harmless timeout errors from the blocking pop
    if (error.message && !error.message.includes("Connection is closed")) {
      console.error("⚠️ Worker Error:", error.message);
    }
  } finally {
    // 🔄 Loop back around to listen again immediately
    // We use setTimeout with 0ms to prevent Node.js Call Stack overflow
    if (workerClient.status === "ready") {
      setTimeout(processNextJob, 0);
    } else {
      // If disconnected, wait 2 seconds before trying to loop again
      setTimeout(processNextJob, 2000);
    }
  }
};

export const addToEmailQueue = async (data) => {
  try {
    await publisher.lpush(QUEUE_NAME, JSON.stringify(data));
    console.log(`✅ Email job added to ${QUEUE_NAME}`);
  } catch (error) {
    console.error("❌ Failed to queue email:", error);
  }
};