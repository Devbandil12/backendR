import * as AiService from './ai.service.js';
import * as SupportService from '../support/support.service.js';

export const customerChat = async (req, res) => {
  const { history } = req.body;
  const customerId = req.user?.id;

  if (!history || !Array.isArray(history)) {
    return res.status(400).json({ error: 'Valid chat history array is required.' });
  }

  // Set up SSE headers for streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders(); // flush headers immediately

  const onChunk = (chunk) => {
    res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
  };

  try {
    await AiService.customerChatStream(history, customerId, onChunk);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error("Error in customerChat controller:", error);
    res.write(`data: ${JSON.stringify({ text: 'Sorry, I encountered an error.' })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
};

export const summarizeTicket = async (req, res) => {
  const { ticketId } = req.params;
  
  try {
    const ticket = await SupportService.getTicketById(ticketId);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

    const messagesRes = await SupportService.getTicketMessages(ticketId, { limit: 100, includeInternal: false });
    const messages = messagesRes?.messages || [];
    const reversedMessages = [...messages].reverse(); // Oldest first

    // Format transcript
    const transcript = [
      `SUBJECT: ${ticket.subject}`,
      ...reversedMessages.map(m => `${m.senderRole === 'user' ? 'CUSTOMER' : 'AGENT'}: ${m.message}`)
    ].join('\n\n');

    const summary = await AiService.summarizeTicket(transcript);
    res.json({ summary });
  } catch (error) {
    console.error("Error summarizing ticket:", error);
    res.status(500).json({ error: 'Failed to generate summary.' });
  }
};

export const generateDraft = async (req, res) => {
  const { ticketId } = req.params;
  
  try {
    const ticket = await SupportService.getTicketById(ticketId);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

    const messagesRes = await SupportService.getTicketMessages(ticketId, { limit: 100, includeInternal: false });
    const messages = messagesRes?.messages || [];
    const reversedMessages = [...messages].reverse(); // Oldest first

    const transcript = [
      `SUBJECT: ${ticket.subject}`,
      ...reversedMessages.map(m => `${m.senderRole === 'user' ? 'CUSTOMER' : 'AGENT'}: ${m.message}`)
    ].join('\n\n');

    // Optionally fetch order info if ticket is linked to an order (future enhancement)
    const orderContext = ticket.relatedOrderId ? `Related Order ID: ${ticket.relatedOrderId}` : "No related order attached to this ticket.";

    const draft = await AiService.generateDraftReply(transcript, orderContext);
    res.json({ draft });
  } catch (error) {
    console.error("Error generating draft:", error);
    res.status(500).json({ error: 'Failed to generate draft.' });
  }
};
