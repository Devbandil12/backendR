import { test, mock } from 'node:test';
import assert from 'node:assert';
import * as OtpService from '../otp.service.js';
import * as OtpRepository from '../otp.repository.js';

test('OTP Service Tests', async (t) => {
  const userId = 'user_123';
  const phone = '9999999999';
  const normalizedPhone = '919999999999';
  const purpose = 'CHECKOUT';

  // Mock fetch to prevent actual MSG91 calls
  global.fetch = mock.fn(async () => ({
    ok: true,
    json: async () => ({ status: 'success' })
  }));

  await t.test('requestOtp - fails if phone already verified', async () => {
    mock.method(OtpRepository, 'getVerifiedPhone', async () => true);
    await assert.rejects(
      OtpService.requestOtp(userId, phone, purpose),
      { code: 'ALREADY_VERIFIED' }
    );
    OtpRepository.getVerifiedPhone.mock.restore();
  });

  await t.test('requestOtp - limits to 3 requests per challenge', async () => {
    mock.method(OtpRepository, 'getVerifiedPhone', async () => false);
    mock.method(OtpRepository, 'getLatestOtpRecord', async () => ({
      id: 'otp_123',
      verified: false,
      expiresAt: new Date(Date.now() + 100000).toISOString()
    }));
    
    // Simulate updating count failed (which means limit reached)
    mock.method(OtpRepository, 'updateOtpRecordCount', async () => null);

    await assert.rejects(
      OtpService.requestOtp(userId, phone, purpose),
      { code: 'MAX_RETRIES_EXCEEDED' }
    );

    OtpRepository.getVerifiedPhone.mock.restore();
    OtpRepository.getLatestOtpRecord.mock.restore();
    OtpRepository.updateOtpRecordCount.mock.restore();
  });

  await t.test('verifyOtp - rejects if expired', async () => {
    mock.method(OtpRepository, 'getVerifiedPhone', async () => false);
    mock.method(OtpRepository, 'getLatestOtpRecord', async () => ({
      id: 'otp_123',
      verified: false,
      attempts: 0,
      maxAttempts: 5,
      expiresAt: new Date(Date.now() - 10000).toISOString() // expired
    }));

    await assert.rejects(
      OtpService.verifyOtp(userId, phone, purpose, '123456'),
      { code: 'OTP_EXPIRED' }
    );

    OtpRepository.getVerifiedPhone.mock.restore();
    OtpRepository.getLatestOtpRecord.mock.restore();
  });

  await t.test('verifyOtp - rejects too many wrong attempts', async () => {
    mock.method(OtpRepository, 'getVerifiedPhone', async () => false);
    mock.method(OtpRepository, 'getLatestOtpRecord', async () => ({
      id: 'otp_123',
      verified: false,
      attempts: 5,
      maxAttempts: 5,
      expiresAt: new Date(Date.now() + 10000).toISOString()
    }));

    await assert.rejects(
      OtpService.verifyOtp(userId, phone, purpose, '123456'),
      { code: 'MAX_ATTEMPTS_EXCEEDED' }
    );

    OtpRepository.getVerifiedPhone.mock.restore();
    OtpRepository.getLatestOtpRecord.mock.restore();
  });
});
