// src/infrastructure/messaging/email/index.js
// Email sending via Resend / Nodemailer.
// Core email logic currently lives in routes/notifications.js —
// migrate sendOrderConfirmationEmail, sendAdminOrderAlert here over time.

export const sendEmail = async ({ to, subject, html }) => {
  // TODO: migrate from routes/notifications.js
  throw new Error('Email sender not yet migrated — use routes/notifications.js directly for now.');
};
