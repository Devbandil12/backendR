import * as PhoneService from './phone.service.js';
import * as PhoneRepository from './phone.repository.js';
import { logger } from '../../../observability/logger.js';

const PHONE_REGEX = /^[6-9]\d{9}$/;

async function resolveUser(req, res) {
  const user = await PhoneRepository.getUserByClerkId(req.auth.userId);
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

    const { phone } = req.body;
    if (!phone || !PHONE_REGEX.test(String(phone).trim())) {
      return res.status(400).json({ success: false, msg: 'A valid 10-digit mobile number is required.' });
    }
    const cleanPhone = String(phone).trim();

    try {
        const result = await PhoneService.sendOtp(user, cleanPhone);
        return res.json({ success: true, ...result });
    } catch (err) {
        if (err.status) {
            return res.status(err.status).json({ success: false, msg: err.msg });
        }
        throw err;
    }
  } catch (err) {
    logger.error('[phoneVerification] /send error', { err: err.message });
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
        const result = await PhoneService.verifyOtp(user, otpRequestId, code);
        return res.json({ success: true, ...result });
    } catch (err) {
        if (err.status) {
            return res.status(err.status).json({ success: false, code: err.code, msg: err.msg });
        }
        throw err;
    }
  } catch (err) {
    logger.error('[phoneVerification] /verify error', { err: err.message });
    return res.status(500).json({ success: false, msg: 'Something went wrong. Please try again.' });
  }
};

export const listVerifiedPhones = async (req, res) => {
  try {
    const user = await resolveUser(req, res);
    if (!user) return;
    
    const phones = await PhoneService.listVerifiedPhones(user.id);
    return res.json({ success: true, phones, defaultPhone: user.phone });
  } catch (err) {
    logger.error('[phoneVerification] /list error', { err: err.message });
    return res.status(500).json({ success: false, msg: 'Something went wrong.' });
  }
};
