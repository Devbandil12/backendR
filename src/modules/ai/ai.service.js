import { GoogleGenAI } from '@google/genai';
import { AI_TOOLS, searchKnowledgeBase, getOrderDetails, escalateToHuman } from './ai.tools.js';

// Initialize the Gemini client
const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
const MODEL_NAME = 'gemini-3.6-flash';

// System prompt for the Customer AI
const CUSTOMER_SYSTEM_PROMPT = `
You are the Devid Aura AI Support Agent. Devid Aura is a premium luxury perfume brand.
Your tone should be elegant, helpful, and empathetic.
Use the tools provided to look up policies or customer order details.
If the customer is angry, asks for a human, or if you cannot resolve the issue with the provided tools, use the 'escalate_to_human' tool immediately.
Never invent policies or fake tracking numbers. Always rely on the tools.
`;

// System prompt for the Admin AI Copilot
const ADMIN_SYSTEM_PROMPT = `
You are the Devid Aura Admin AI Copilot. You assist human support agents in managing tickets.
Your goal is to be concise, highly analytical, and save the agent time.
You have access to the entire store's knowledge base and customer data.
`;

/**
 * Handles the customer-facing chat interaction, yielding chunks for streaming.
 * Uses function calling to retrieve live data.
 */
export async function customerChatStream(history, customerId, onChunk) {
  try {
    const formattedHistory = history.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));

    const chatSession = ai.chats.create({
      model: MODEL_NAME,
      config: {
        systemInstruction: CUSTOMER_SYSTEM_PROMPT,
        tools: [
          { functionDeclarations: [AI_TOOLS.SEARCH_KNOWLEDGE_BASE, AI_TOOLS.GET_ORDER_DETAILS, AI_TOOLS.ESCALATE_TO_HUMAN] }
        ]
      }
    });

    // Send the pre-existing history to establish context
    // Actually, in the @google/genai SDK, chat history is passed during create()
    // Let's manually manage history to ensure we can handle tool calls properly in a stream.
    // We will just send the latest message with the history.

    // A more robust way with the latest SDK:
    const chat = ai.chats.create({
        model: MODEL_NAME,
        history: formattedHistory.slice(0, -1),
        config: {
            systemInstruction: CUSTOMER_SYSTEM_PROMPT,
            tools: [{ functionDeclarations: [AI_TOOLS.SEARCH_KNOWLEDGE_BASE, AI_TOOLS.GET_ORDER_DETAILS, AI_TOOLS.ESCALATE_TO_HUMAN] }],
            temperature: 0.4
        }
    });

    const lastMessage = formattedHistory[formattedHistory.length - 1].parts[0].text;
    
    // We can't easily stream and handle tools in a single pass without a complex loop, 
    // but the SDK handles intermediate tool calls if we use the automatic tool execution, 
    // OR we do it manually. Let's do it manually for fine-grained control and security.
    
    let response = await chat.sendMessage({
      message: lastMessage
    });

    // Check if the model decided to call a tool
    while (response.functionCalls && response.functionCalls.length > 0) {
      const functionCall = response.functionCalls[0];
      const { name, args } = functionCall;
      
      let toolResult = "";
      console.log(`[AI Core] Customer tool call invoked: ${name}`, args);

      if (name === 'search_knowledge_base') {
        toolResult = await searchKnowledgeBase(args.query);
      } else if (name === 'get_order_details') {
        toolResult = await getOrderDetails(args.orderId, customerId);
      } else if (name === 'escalate_to_human') {
        // Compile full history for escalation
        const fullTranscript = history.map(h => `${h.role.toUpperCase()}: ${h.content}`).join('\n');
        toolResult = await escalateToHuman(args.category, args.summary, args.priority, customerId, fullTranscript);
      }

      // Send the tool response back to the model
      response = await chat.sendMessage({
        message: [{
            functionResponse: {
                name: name,
                response: { result: toolResult }
            }
        }]
      });
    }

    // Now we have the final text response.
    // To simulate streaming (since we had to wait for tools), we can chunk the final text 
    // and yield it, or use sendMessageStream if there were no tools. 
    // For simplicity and robustness, we yield the final text in chunks.
    const finalContent = response.text || "I'm sorry, I couldn't process that.";
    const chunks = finalContent.split(' ');
    
    for (let i = 0; i < chunks.length; i++) {
        onChunk(chunks[i] + (i < chunks.length - 1 ? ' ' : ''));
        // slight delay to simulate natural typing
        await new Promise(r => setTimeout(r, 20));
    }

  } catch (error) {
    console.error("Error in Customer AI Chat:", error);
    onChunk("I'm sorry, I am currently experiencing technical difficulties. Please try again later.");
  }
}

/**
 * Admin Copilot: Summarize Ticket
 */
export async function summarizeTicket(ticketHistory) {
  const prompt = `
  Analyze the following support ticket history.
  Provide:
  1. A concise 2-sentence summary of the core issue.
  2. The customer's current sentiment (Positive, Neutral, Frustrated, Angry).
  3. Escalation Risk (Low, Medium, High) with a 1-sentence justification.

  Ticket History:
  ${ticketHistory}
  `;

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: prompt,
    config: { systemInstruction: ADMIN_SYSTEM_PROMPT, temperature: 0.2 }
  });

  return response.text;
}

/**
 * Admin Copilot: Generate Draft Reply
 */
export async function generateDraftReply(ticketHistory, orderContext = "") {
  const prompt = `
  Draft a response to the customer for the following support ticket.
  Adopt the elegant, empathetic persona of Devid Aura.
  Address their most recent message directly.
  Provide actionable next steps if applicable.
  Do NOT include placeholder variables like [Your Name] unless absolutely necessary.
  
  Order Context (if any):
  ${orderContext}

  Ticket History:
  ${ticketHistory}
  `;

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: prompt,
    config: { systemInstruction: ADMIN_SYSTEM_PROMPT, temperature: 0.5 }
  });

  return response.text;
}
