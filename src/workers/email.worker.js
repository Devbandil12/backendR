// src/workers/email.worker.js
// Consumer side of the email queue — moved from infrastructure/queues/email.queue.js.
// Import sendOrderConfirmationEmail and sendAdminOrderAlert from the notifications module
// once it is migrated; for now we use the legacy path.

import { queueClient } from '../infrastructure/queues/queue.client.js';
import { QUEUE_NAME } from '../infrastructure/queues/email.queue.js';
import { sendOrderConfirmationEmail, sendAdminOrderAlert } from '../modules/notifications/notifications.service.js';

export const startEmailWorker = () => {
  console.log(`🚜 Email Worker Started on '${QUEUE_NAME}' (Listening actively)...`);
  processNextJob();
};

const processNextJob = async () => {
  try {
    const result = await queueClient.brpop(QUEUE_NAME, 100);

    if (result) {
      const jobData = JSON.parse(result[1]);
      const { userEmail, orderDetails, orderItems, paymentDetails } = jobData;

      console.log(`📨 Processing Order #${orderDetails?.id || 'Unknown'}`);

      const results = await Promise.allSettled([
        sendOrderConfirmationEmail(userEmail, orderDetails, orderItems, paymentDetails),
        sendAdminOrderAlert(orderDetails, orderItems),
      ]);

      results.forEach((res, index) => {
        if (res.status === 'rejected') console.error(`❌ Task ${index + 1} Failed:`, res.reason);
        else console.log(`✅ Task ${index + 1} Sent!`);
      });
    }
  } catch (error) {
    if (error.message && !error.message.includes('Connection is closed')) {
      console.error('⚠️ Worker Error:', error.message);
    }
  } finally {
    if (queueClient.status === 'ready') {
      setTimeout(processNextJob, 0);
    } else {
      setTimeout(processNextJob, 2000);
    }
  }
};
