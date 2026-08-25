// src/modules/contact/contact.controller.js
import * as contactService from './contact.service.js';

export const getAllTickets = async (req, res) => {
  try {
    res.json(await contactService.getAllTickets());
  } catch (error) {
    console.error('❌ Error fetching tickets:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

export const getUserTickets = async (req, res) => {
  try {
    const tickets = await contactService.getUserTickets(req.auth.userId, req.params.email);
    res.json(tickets);
  } catch (error) {
    console.error('❌ Error fetching user tickets:', error);
    res.status(error.status || 500).json({ error: error.message || 'Server error' });
  }
};

export const createTicket = async (req, res) => {
  const { email, message } = req.body;
  if (!email || !message) return res.status(400).json({ error: 'Email and message are required' });
  
  try {
    const newTicket = await contactService.createTicket(req.body);
    res.status(201).json(newTicket);
  } catch (error) {
    console.error('❌ Error creating ticket:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

export const replyToTicket = async (req, res) => {
  try {
    const newMessage = await contactService.replyToTicket(req.auth.userId, req.params.ticketId, req.body.message);
    res.status(201).json(newMessage);
  } catch (error) {
    console.error('❌ Error replying:', error);
    res.status(error.status || 500).json({ error: error.message || 'Server error' });
  }
};

export const updateTicketStatus = async (req, res) => {
  if (!req.body.status) return res.status(400).json({ error: 'Status is required' });
  
  try {
    const updatedTicket = await contactService.updateTicketStatus(req.params.ticketId, req.body.status);
    res.json(updatedTicket);
  } catch (error) {
    console.error('❌ Error updating status:', error);
    res.status(error.status || 500).json({ error: error.message || 'Server error' });
  }
};
