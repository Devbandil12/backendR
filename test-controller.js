import { assignRole } from './src/modules/rbac/rbac.controller.js';

async function run() {
  const req = {
    body: {
      targetClerkId: 'user_2vicf3JNPuJaeKj2qA8LgA9FBbR',
      roleId: 'ef755457-6885-44e3-b55d-f721ff2c5c09'
    },
    auth: {
      userId: 'user_2vicf3JNPuJaeKj2qA8LgA9FBbR'
    },
    adminRole: 'SUPER_ADMIN'
  };
  
  const res = {
    status: (code) => ({
      json: (data) => console.log('Response Status:', code, 'Data:', data)
    }),
    json: (data) => console.log('Response OK:', data)
  };
  
  await assignRole(req, res);
  process.exit(0);
}

run();
