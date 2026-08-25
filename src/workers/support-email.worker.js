import { Worker } from 'bullmq';
import { getRedisConfig } from '../config/redis.js';
import Redis from 'ioredis';
import nodemailer from 'nodemailer';

const config = getRedisConfig();

const connection = new Redis(config.url, {
  ...config.options,
  maxRetriesPerRequest: null,
});

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export const supportEmailWorker = new Worker(
  'support-email-queue',
  async (job) => {
    const { type, payload } = job.data;
    console.log(`[Worker] Processing support email job: ${job.id} (${type})`);

    if (type === 'TICKET_CREATED') {
      const { ticket, name, email, subject, message } = payload;
      
      // Customer Email
      await transporter.sendMail({
        from: `"Devid Aura Support" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: `Ticket Received: ${ticket.ticketNumber}`,
        text: `Hi ${name || 'there'},\n\nWe received your message regarding "${subject}".\nTicket Number: ${ticket.ticketNumber}\n\nWe will get back to you shortly.\n\n- Team Devid Aura`,
      });

      // Admin Email
      await transporter.sendMail({
        from: `"Devid Aura System" <${process.env.EMAIL_USER}>`,
        to: process.env.EMAIL_USER,
        subject: `New Ticket (${ticket.ticketNumber}) from ${name || email}`,
        text: `Subject: ${subject}\nFrom: ${email}\nPriority: ${ticket.priority}\nCategory: ${ticket.category || 'uncategorized'}\n\nMessage:\n${message}`,
      });
    } else if (type === 'TICKET_REPLY') {
      const { ticket, messageText, senderRole } = payload;
      const isUserReplying = senderRole === 'user';
      const targetEmail = isUserReplying ? process.env.EMAIL_USER : ticket.guestEmail;
      
      if (targetEmail) {
        await transporter.sendMail({
          from: `"Devid Aura Support" <${process.env.EMAIL_USER}>`,
          to: targetEmail,
          subject: isUserReplying
            ? `New Reply on Ticket ${ticket.ticketNumber}`
            : `Update on your Support Ticket ${ticket.ticketNumber}`,
          text: isUserReplying
            ? `User has replied to ticket ${ticket.ticketNumber}:\n\n"${messageText}"`
            : `Support has replied:\n\n"${messageText}"`,
        });
      }
    } else if (type === 'SLA_BREACHED') {
      const { ticket, breachType } = payload;
      await transporter.sendMail({
        from: `"Devid Aura SLA System" <${process.env.EMAIL_USER}>`,
        to: process.env.EMAIL_USER,
        subject: `🚨 SLA BREACH: ${ticket.ticketNumber}`,
        text: `The ticket ${ticket.ticketNumber} has breached its ${breachType} SLA target!\n\nSubject: ${ticket.subject}\nPriority: ${ticket.priority}\nStatus: ${ticket.status}\nCustomer: ${ticket.guestEmail || 'Registered User'}\n\nPlease assign an agent and resolve immediately.\n\n- Devid Aura SLA Engine`,
      });
    }

    return true;
  },
  { connection }
);

supportEmailWorker.on('completed', (job) => {
  console.log(`✅ [Worker] Support email job ${job.id} completed successfully`);
});

supportEmailWorker.on('failed', (job, err) => {
  console.error(`❌ [Worker] Support email job ${job.id} failed:`, err.message);
});
