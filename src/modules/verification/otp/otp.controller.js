import * as OtpService from './otp.service.js';
import * as usersService from '../../users/users.service.js';

export const requestOtp = async (req, res) => {
  try {
    const { phone, purpose } = req.body;
    const clerkId = req.auth.userId;

    if (!phone || !purpose) {
      return res.status(400).json({ success: false, msg: 'Phone and purpose are required.' });
    }

    const user = await usersService.getUserByClerkId(clerkId);
    if (!user) {
      return res.status(404).json({ success: false, msg: 'User not found in internal database.' });
    }

    const result = await OtpService.requestOtp(user.id, phone, purpose);
    return res.json(result);
  } catch (err) {
    if (err.code === 'ALREADY_VERIFIED') {
      return res.status(400).json({ success: false, msg: err.msg, code: err.code });
    }
    if (err.code === 'MAX_RETRIES_EXCEEDED') {
      return res.status(429).json({ success: false, msg: err.msg, code: err.code });
    }
    console.error('requestOtp error:', err);
    return res.status(500).json({ success: false, msg: err.message || 'Failed to send OTP.' });
  }
};

export const verifyOtp = async (req, res) => {
  try {
    const { phone, purpose, code } = req.body;
    const clerkId = req.auth.userId;

    if (!phone || !purpose || !code) {
      return res.status(400).json({ success: false, msg: 'Phone, purpose, and code are required.' });
    }

    const user = await usersService.getUserByClerkId(clerkId);
    if (!user) {
      return res.status(404).json({ success: false, msg: 'User not found in internal database.' });
    }

    const result = await OtpService.verifyOtp(user.id, phone, purpose, code);
    return res.json(result);
  } catch (err) {
    if (err.code) {
      return res.status(400).json({ success: false, msg: err.msg, code: err.code });
    }
    console.error('verifyOtp error:', err);
    return res.status(500).json({ success: false, msg: err.message || 'Failed to verify OTP.' });
  }
};

export const listVerifiedPhones = async (req, res) => {
  try {
    const clerkId = req.auth.userId;
    const user = await usersService.getUserByClerkId(clerkId);
    if (!user) {
      return res.status(404).json({ success: false, msg: 'User not found in internal database.' });
    }

    const result = await OtpService.listVerifiedPhones(user.id);
    return res.json(result);
  } catch (err) {
    console.error('listVerifiedPhones error:', err);
    return res.status(500).json({ success: false, msg: err.message || 'Failed to list verified phones.' });
  }
};
