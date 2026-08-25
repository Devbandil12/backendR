// src/db/schema/orders.schema.js
import {
  pgTable,
  text,
  uuid,
  integer,
  timestamp,
  varchar,
  jsonb,
  index
} from 'drizzle-orm/pg-core';
import { usersTable, UserAddressTable } from './users.schema.js';
import { productVariantsTable } from './variants.schema.js';
import { productsTable } from './products.schema.js';
import { couponsTable } from './coupons.schema.js';

const generateNumericId = () => `DA${Date.now()}`;

export const ordersTable = pgTable('orders', {
  id: text('id').primaryKey().$defaultFn(() => generateNumericId()),
  userId: uuid('user_id').notNull().references(() => usersTable.id),
  userAddressId: uuid('user_address_id').notNull().references(() => UserAddressTable.id),
  razorpay_order_id: text('razorpay_order_id'),
  totalAmount: integer('total_amount').notNull(),
  status: text('status').default('order placed'),
  progressStep: integer('progressStep').default(0),
  paymentMode: text('payment_mode').notNull(),
  transactionId: text('transaction_id').default('null'),
  paymentStatus: text('payment_status').default('pending'),
  fulfillmentStatus: text('fulfillment_status').default('PROCESSING'),
  returnStatus: text('return_status').default('NONE'),
  phone: text('phone').notNull(),
  paymentContactPhone: text('payment_contact_phone'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  walletAmountUsed: integer('wallet_amount_used').default(0),
  invoiceNumber: varchar('invoice_number', { length: 50 }).unique(),
  couponId: integer('coupon_id').references(() => couponsTable.id),
  discountAmount: integer('discount_amount').default(0),
  offerDiscount: integer('offer_discount').default(0),
  offerCodes: jsonb('offer_codes'),
  courierName: text('courier_name'),
  trackingId: text('tracking_id'),
  trackingUrl: text('tracking_url'),
  expectedDeliveryDate: timestamp('expected_delivery_date', { withTimezone: true, mode: 'string' }),
  shiprocketOrderId: text('shiprocket_order_id'),
  shiprocketShipmentId: text('shiprocket_shipment_id'),
  shiprocketAwb: text('shiprocket_awb'),
  version: integer('version').default(1).notNull(), // For Optimistic Concurrency
}, (table) => {
  return {
    userIdIdx: index('orders_user_id_idx').on(table.userId),
    createdAtIdx: index('orders_created_at_idx').on(table.createdAt),
    statusIdx: index('orders_status_idx').on(table.status),
    paymentStatusIdx: index('orders_payment_status_idx').on(table.paymentStatus),
    fulfillmentStatusIdx: index('orders_fulfillment_status_idx').on(table.fulfillmentStatus),
    trackingIdIdx: index('orders_tracking_id_idx').on(table.trackingId),
    shiprocketAwbIdx: index('orders_shiprocket_awb_idx').on(table.shiprocketAwb),
    invoiceNumberIdx: index('orders_invoice_number_idx').on(table.invoiceNumber),
  };
});

export const orderItemsTable = pgTable('order_items', {
  id: text('id').primaryKey().$defaultFn(() => generateNumericId()),
  orderId: text('order_id').notNull().references(() => ordersTable.id, { onDelete: 'cascade' }),
  productName: varchar('product_name', { length: 255 }).notNull(),
  img: varchar('img', { length: 500 }).notNull(),
  variantId: uuid('variant_id').notNull().references(() => productVariantsTable.id),
  productId: uuid('product_id').notNull().references(() => productsTable.id),
  quantity: integer('quantity').notNull().default(1),
  price: integer('price').notNull(),
  totalPrice: integer('total_price').notNull(),
  size: integer('size').notNull().default(0),
});

export const orderTimeline = pgTable('order_timeline', {
  id: uuid('id').defaultRandom().primaryKey().notNull(),
  orderId: text('order_id').notNull().references(() => ordersTable.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 50 }).notNull(),
  title: text('title').notNull(),
  description: text('description'),
  timestamp: timestamp('timestamp', { withTimezone: true, mode: 'string' }).defaultNow(),
});
