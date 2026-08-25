import { db } from '../../db/client.js';
import { knowledgeArticlesTable } from '../../db/schema/index.js';
import { sql, eq, and, desc } from 'drizzle-orm';
import * as OrdersService from '../orders/orders.service.js';
import * as OrdersRepository from '../orders/orders.repository.js';
import * as SupportService from '../support/support.service.js';

export const AI_TOOLS = {
  SEARCH_KNOWLEDGE_BASE: {
    name: 'search_knowledge_base',
    description: 'Searches the store policies, FAQs, and guidelines. Use this for ANY question about returns, refunds, shipping, payments, etc.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'The search term (e.g., "return policy", "how to cancel")',
        },
      },
      required: ['query'],
    },
  },
  GET_ORDER_DETAILS: {
    name: 'get_order_details',
    description: 'Retrieves complete details of an order, including items, shipping status, and timeline.',
    parameters: {
      type: 'OBJECT',
      properties: {
        orderId: {
          type: 'STRING',
          description: 'The unique Order ID to look up',
        },
      },
      required: ['orderId'],
    },
  },
  ESCALATE_TO_HUMAN: {
    name: 'escalate_to_human',
    description: 'Escalates the conversation to a human support agent when you cannot resolve the issue or the customer is angry/requests a human.',
    parameters: {
      type: 'OBJECT',
      properties: {
        category: {
          type: 'STRING',
          description: 'The inferred category of the issue (e.g., RETURNS, DAMAGED_ITEM, LATE_DELIVERY)',
        },
        summary: {
          type: 'STRING',
          description: 'A brief summary of what the customer is experiencing and what they need help with.',
        },
        priority: {
          type: 'STRING',
          description: 'LOW, MEDIUM, or HIGH based on the severity of the issue.',
        }
      },
      required: ['category', 'summary', 'priority'],
    },
  }
};

/**
 * Searches the knowledge base using basic ILIKE for now (Postgres full-text can be added later if needed)
 */
export async function searchKnowledgeBase(query) {
  try {
    const articles = await db
      .select({
        title: knowledgeArticlesTable.title,
        content: knowledgeArticlesTable.content,
        category: knowledgeArticlesTable.category
      })
      .from(knowledgeArticlesTable)
      .where(
        and(
          eq(knowledgeArticlesTable.status, 'PUBLISHED'),
          sql`${knowledgeArticlesTable.title} ILIKE ${'%' + query + '%'} OR ${knowledgeArticlesTable.content} ILIKE ${'%' + query + '%'}`
        )
      )
      .orderBy(desc(knowledgeArticlesTable.priority))
      .limit(3);

    if (articles.length === 0) {
      return "No matching policies found.";
    }

    return articles.map(a => `[${a.category}] ${a.title}:\n${a.content}`).join('\n\n---\n\n');
  } catch (error) {
    console.error("Error searching knowledge base:", error);
    return "Error retrieving knowledge base.";
  }
}

/**
 * Fetches order details. Enforces ownership if customerId is provided.
 */
export async function getOrderDetails(orderId, customerId = null) {
  try {
    const order = await OrdersRepository.getOrderByIdWithDetails(orderId);
    if (!order) {
      return `Order ${orderId} not found.`;
    }
    
    // Authorization check for Customer AI
    if (customerId && order.userId !== customerId) {
      return `Access Denied: Order ${orderId} does not belong to the current user.`;
    }

    // Format for LLM consumption
    return JSON.stringify({
      id: order.id,
      status: order.status,
      totalAmount: order.totalAmount,
      createdAt: order.createdAt,
      paymentMode: order.paymentMode,
      paymentStatus: order.paymentStatus,
      items: order.orderItems.map(item => ({
        productName: item.product?.name,
        quantity: item.quantity,
        price: item.price
      })),
      timeline: order.timeline.slice(0, 3) // Latest 3 events
    });
  } catch (error) {
    console.error("Error fetching order details:", error);
    return "Error fetching order details.";
  }
}

/**
 * Escalate to human by creating a ticket
 */
export async function escalateToHuman(category, summary, priority, customerId, chatHistory) {
  try {
    if (!customerId) {
       return "Cannot escalate without a registered user session.";
    }

    // Create the ticket
    const ticket = await SupportService.createTicket({
      userId: customerId,
      subject: `AI Escalation: ${category}`,
      category: category,
      priority: priority,
      source: 'AI_AGENT',
      message: chatHistory // The full chat transcript will be the first message
    }, customerId);

    // Add an internal note with the AI summary
    await SupportService.addInternalNote(customerId, ticket.id, `AI Summary:\n${summary}`);

    return `Successfully escalated. A human agent will review ticket #${ticket.id} shortly.`;
  } catch (error) {
    console.error("Error escalating to human:", error);
    return "Failed to escalate to human agent due to a system error.";
  }
}
