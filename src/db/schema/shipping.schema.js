// src/db/schema/shipping.schema.js
import {
  pgTable,
  varchar,
  boolean,
  integer,
} from 'drizzle-orm/pg-core';

export const pincodeServiceabilityTable = pgTable('pincode_serviceability', {
  pincode: varchar('pincode', { length: 6 }).primaryKey(),
  city: varchar('city', { length: 100 }).notNull(),
  state: varchar('state', { length: 100 }).notNull(),
  isServiceable: boolean('is_serviceable').default(false),
  codAvailable: boolean('cod_available').default(false),
  onlinePaymentAvailable: boolean('online_payment_available').default(true),
  deliveryCharge: integer('delivery_charge').default(50),
});

export const shippingRulesTable = pgTable('shipping_rules', {
  id: integer('id').primaryKey().default(1),
  freeShippingThreshold: integer('free_shipping_threshold').default(999),
  flatShippingRate: integer('flat_shipping_rate').default(50),
});
