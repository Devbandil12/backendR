// src/workers/invoice.worker.js
// Invoice PDF generation worker stub.

import { queueClient } from '../infrastructure/queues/queue.client.js';
import { QUEUE_NAME } from '../infrastructure/queues/invoice.queue.js';

export const startInvoiceWorker = () => {
  console.log(`🚜 Invoice Worker Started on '${QUEUE_NAME}'...`);
  processNextJob();
};

const processNextJob = async () => {
  try {
    const result = await queueClient.brpop(QUEUE_NAME, 5);
    if (result) {
      const job = JSON.parse(result[1]);
      console.log('📄 Invoice job received:', job);
      // TODO: generate and send invoice PDF
    }
  } catch (err) {
    if (err.message && !err.message.includes('Connection is closed')) {
      console.error('⚠️ Invoice Worker Error:', err.message);
    }
  } finally {
    setTimeout(processNextJob, queueClient.status === 'ready' ? 0 : 2000);
  }
};
