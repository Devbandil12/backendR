import nodemailer from 'nodemailer';
import * as ContactRepository from './contact.repository.js';

const transporter = nodemailer.createTransport({ 
  service: 'gmail', 
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } 
});

const generateTicketId = () => `SUP-${Date.now()}`;

export async function getAllTickets() {
  return await ContactRepository.getAllTickets();
}

export async function getUserTickets(clerkId, targetEmail) {
  const requester = await ContactRepository.getUserByClerkId(clerkId);
  if (!requester) throw Object.assign(new Error('Unauthorized'), { status: 401 });
  
  if (requester.email !== targetEmail && requester.role !== 'admin') {
    throw Object.assign(new Error('Forbidden: You can only view your own tickets.'), { status: 403 });
  }
  
  const targetUser = await ContactRepository.getUserByEmail(targetEmail);
  return await ContactRepository.getTicketsByUserOrEmail(targetUser ? targetUser.id : null, targetEmail);
}

export async function createTicket({ email, phone, name, subject, message }) {
  const newTicket = await ContactRepository.insertTicket({ 
    id: generateTicketId(), 
    userId: null, 
    guestEmail: email, 
    guestPhone: phone, 
    subject: subject || 'New Support Query', 
    status: 'open' 
  });
  
  await ContactRepository.insertTicketMessage({ 
    ticketId: newTicket.id, 
    senderRole: 'user', 
    message 
  });
  
  try {
    await transporter.sendMail({ 
      from: `"Devid Aura Support" <${process.env.EMAIL_USER}>`, 
      to: email, 
      subject: `Ticket Received: ${newTicket.id}`, 
      text: `Hi ${name || 'there'},\n\nWe received your message regarding "${subject}".\nTicket ID: ${newTicket.id}\n\nWe will get back to you shortly.\n\n- Team Devid Aura` 
    });
    await transporter.sendMail({ 
      from: `"Devid Aura System" <${process.env.EMAIL_USER}>`, 
      to: process.env.EMAIL_USER, 
      subject: `New Ticket (${newTicket.id}) from ${name}`, 
      text: `Subject: ${subject}\nFrom: ${email}\n\nMessage:\n${message}` 
    });
  } catch (err) { 
    console.error('⚠️ Failed to send creation emails:', err.message); 
  }
  
  return newTicket;
}

export async function replyToTicket(clerkId, ticketId, message) {
  const actor = await ContactRepository.getUserByClerkId(clerkId);
  if (!actor) throw Object.assign(new Error('Unauthorized'), { status: 401 });
  
  const ticket = await ContactRepository.getTicketById(ticketId);
  if (!ticket) throw Object.assign(new Error('Ticket not found'), { status: 404 });
  if (ticket.status?.toLowerCase() === 'closed') {
    throw Object.assign(new Error('This ticket is permanently closed.'), { status: 400 });
  }
  
  let senderRole = 'user';
  if (actor.role === 'admin') { 
    senderRole = 'admin'; 
  } else {
    const isOwner = (ticket.userId === actor.id) || (ticket.guestEmail === actor.email);
    if (!isOwner) throw Object.assign(new Error('Forbidden: Not your ticket'), { status: 403 });
  }
  
  const newMessage = await ContactRepository.insertTicketMessage({ 
    ticketId, senderRole, message 
  });
  
  await ContactRepository.updateTicket(ticketId, { updatedAt: new Date() });
  
  try {
    const isUserReplying = senderRole === 'user';
    const targetEmail = isUserReplying ? process.env.EMAIL_USER : ticket.guestEmail;
    if (targetEmail) {
      await transporter.sendMail({ 
        from: `"Devid Aura Support" <${process.env.EMAIL_USER}>`, 
        to: targetEmail, 
        subject: isUserReplying ? `New Reply on Ticket ${ticketId}` : `Update on your Support Ticket ${ticketId}`, 
        text: isUserReplying ? `User has replied to ticket ${ticketId}:\n\n"${message}"` : `Support has replied:\n\n"${message}"` 
      });
    }
  } catch (emailErr) { 
    console.error('⚠️ Failed to send reply notification:', emailErr.message); 
  }
  
  return newMessage;
}

export async function updateTicketStatus(ticketId, status) {
  const updatedTicket = await ContactRepository.updateTicket(ticketId, { status, updatedAt: new Date() });
  if (!updatedTicket) throw Object.assign(new Error('Ticket not found'), { status: 404 });
  return updatedTicket;
}
