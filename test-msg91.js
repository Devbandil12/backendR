import fetch from 'node-fetch';

async function test() {
  const WA_SEND_URL = 'https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/';
  const AUTH_KEY = '558394Ah0ZeJix6a7619b3P1';
  const WA_INTEGRATED_NUMBER = '917828372762';

  const res = await fetch(WA_SEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authkey: AUTH_KEY },
    body: JSON.stringify({
      integrated_number: WA_INTEGRATED_NUMBER,
      content_type: 'template',
      payload: {
        messaging_product: 'whatsapp',
        type: 'template',
        template: {
          name: 'otp_verification',
          language: { code: 'en', policy: 'deterministic' },
          namespace: null,
          to_and_components: [
            {
              to: ['919999999999'], // test number
              components: {
                button_1: '123456',
              },
            },
          ],
        },
      },
    }),
  });

  const data = await res.json();
  console.log('Status:', res.status);
  console.log('Data:', data);
}

test();
