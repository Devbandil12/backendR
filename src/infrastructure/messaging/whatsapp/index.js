// src/infrastructure/messaging/whatsapp/index.js
// WhatsApp OTP / messaging via external API.
// Core logic migrated from infrastructure/messaging/whatsapp/index.js — re-export from there
// until fully extracted.

export { sendWhatsAppOtp, generateOtp, hashOtp, dispatchOtp, maskPhone } from '../../../modules/verification/checkout-otp/whatsapp-otp.service.js';
