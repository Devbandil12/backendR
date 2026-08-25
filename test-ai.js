import 'dotenv/config';
import { generateDraftReply } from './src/modules/ai/ai.service.js';

async function run() {
  try {
    const draft = await generateDraftReply("CUSTOMER: My order didn't arrive.", "Order 12345");
    console.log("Draft:", draft);
  } catch (err) {
    console.error("Error:", err);
  }
}
run();
