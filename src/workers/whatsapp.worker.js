// src/workers/whatsapp.worker.js
// WhatsApp message worker stub.

import { queueClient } from '../infrastructure/queues/queue.client.js';
import { QUEUE_NAME } from '../infrastructure/queues/whatsapp.queue.js';

export const startWhatsappWorker = () => {
  console.log(`🚜 WhatsApp Worker Started on '${QUEUE_NAME}'...`);
  processNextJob();
};

const processNextJob = async () => {
  try {
    const result = await queueClient.brpop(QUEUE_NAME, 5);
    if (result) {
      const job = JSON.parse(result[1]);
      console.log('📱 WhatsApp job received:', job);
      // TODO: send WhatsApp message
    }
  } catch (err) {
    if (err.message && !err.message.includes('Connection is closed')) {
      console.error('⚠️ WhatsApp Worker Error:', err.message);
    }
  } finally {
    setTimeout(processNextJob, queueClient.status === 'ready' ? 0 : 2000);
  }
};
