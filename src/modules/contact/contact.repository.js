import { db } from '../../db/client.js';
import { ticketsTable, ticketMessagesTable, usersTable } from '../../db/schema/index.js';
import { eq, desc, asc, or } from 'drizzle-orm';

export const getAllTickets = async () => {
  return await db.query.ticketsTable.findMany({ 
    with: { messages: { orderBy: [asc(ticketMessagesTable.createdAt)] }, user: true }, 
    orderBy: [desc(ticketsTable.updatedAt)] 
  });
};

export const getUserByClerkId = async (clerkId) => {
  const [user] = await db.select({ id: usersTable.id, email: usersTable.email }).from(usersTable).where(eq(usersTable.clerkId, clerkId));
  return user;
};

export const getUserByEmail = async (email) => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  return user;
};

export const getTicketsByUserOrEmail = async (userId, email) => {
  let searchCondition;
  if (userId) { 
    searchCondition = or(eq(ticketsTable.userId, userId), eq(ticketsTable.guestEmail, email)); 
  } else { 
    searchCondition = eq(ticketsTable.guestEmail, email); 
  }
  
  return await db.query.ticketsTable.findMany({ 
    where: searchCondition, 
    with: { messages: { orderBy: [asc(ticketMessagesTable.createdAt)] } }, 
    orderBy: [desc(ticketsTable.createdAt)] 
  });
};

export const insertTicket = async (data) => {
  const [newTicket] = await db.insert(ticketsTable).values(data).returning();
  return newTicket;
};

export const insertTicketMessage = async (data) => {
  const [newMessage] = await db.insert(ticketMessagesTable).values(data).returning();
  return newMessage;
};

export const getTicketById = async (ticketId) => {
  const [ticket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticketId));
  return ticket;
};

export const updateTicket = async (ticketId, data) => {
  const [updatedTicket] = await db.update(ticketsTable).set(data).where(eq(ticketsTable.id, ticketId)).returning();
  return updatedTicket;
};
