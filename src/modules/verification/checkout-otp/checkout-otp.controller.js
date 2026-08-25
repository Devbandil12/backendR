import * as CheckoutOtpService from './checkout-otp.service.js';
import * as CheckoutOtpRepository from './checkout-otp.repository.js';
import { logger } from '../../../observability/logger.js';

async function resolveUser(req, res) {
  const user = await CheckoutOtpRepository.getUserByClerkId(req.auth.userId);
  if (!user) {
    res.status(401).json({ success: false, msg: 'Authentication failed. Please log in.' });
    return null;
  }
  return user;
}

export const sendOtp = async (req, res) => {
  try {
    const user = await resolveUser(req, res);
    if (!user) return;

    const { userAddressId, cartTotal } = req.body;
    if (!userAddressId || cartTotal === undefined) {
      return res.status(400).json({ success: false, msg: 'userAddressId and cartTotal are required.' });
    }

    try {
        const result = await CheckoutOtpService.sendOtp(user, userAddressId, cartTotal);
        return res.json({ success: true, ...result });
    } catch (err) {
        if (err.status) {
            return res.status(err.status).json({ success: false, msg: err.msg });
        }
        throw err;
    }

  } catch (err) {
    logger.error('[checkoutOtp] /send error', { err: err.message });
    return res.status(500).json({ success: false, msg: 'Something went wrong. Please try again.' });
  }
};

export const verifyOtp = async (req, res) => {
  try {
    const user = await resolveUser(req, res);
    if (!user) return;

    const { otpRequestId, code } = req.body;
    if (!otpRequestId || !code) {
      return res.status(400).json({ success: false, msg: 'otpRequestId and code are required.' });
    }

    try {
        const result = await CheckoutOtpService.verifyOtp(user, otpRequestId, code);
        return res.json({ success: true, ...result });
    } catch (err) {
        if (err.status) {
            return res.status(err.status).json({ success: false, code: err.code, msg: err.msg });
        }
        throw err;
    }

  } catch (err) {
    logger.error('[checkoutOtp] /verify error', { err: err.message });
    return res.status(500).json({ success: false, msg: 'Something went wrong. Please try again.' });
  }
};
