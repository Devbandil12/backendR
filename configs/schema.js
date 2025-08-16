import { pgTable, serial, text, integer, uuid, varchar, PgSerial, timestamp, unique, boolean, index, jsonb, } from 'drizzle-orm/pg-core';


const generateNumericId = () => {
  const timestamp = Date.now(); // milliseconds since epoch
  return `DA${timestamp}`;
};




export const usersTable = pgTable('users', {
  id: uuid("id").defaultRandom().primaryKey(),
clerkId: text("clerk_id").notNull().unique(), 
  name: text('name').notNull(),
  phone: text('phone').default(null),
  email: text('email').notNull(),
  role: text('role').default('user'),
  cartlength: integer("cart_length").default(0),

});
export const querytable = pgTable("query", {
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  message: text("message").notNull(),
  createdAt: text('created_at').notNull()
})


export const productsTable = pgTable('products', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  composition: varchar('composition', { length: 255 }).notNull(),
  description: varchar('description', { length: 255 }).notNull(),
  fragrance: varchar('fragrance', { length: 255 }).notNull(),
  fragranceNotes: varchar('fragranceNotes', { length: 255 }).notNull(),

  quantity: integer('quantity').notNull().default(1),
  discount: integer('discount').notNull(),
  oprice: integer('oprice').notNull(),
  size: integer('size').notNull(),
  imageurl: varchar('imageurl', { length: 500 }).notNull(),
  galleryImages: jsonb("gallery_images").notNull().default([]),
});

export const addToCartTable = pgTable('add_to_cart', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => usersTable.id),
  productId: uuid('product_id').notNull(),
  quantity: integer('quantity').notNull().default(1),
  addedAt: text('added_at').default('now()'),
});


export const wishlistTable = pgTable("wishlist_table", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull(),
})

export const ordersTable = pgTable('orders', {
  id: text('id').primaryKey().$defaultFn(() => generateNumericId()),
  userId: uuid('user_id').notNull().references(() => usersTable.id),
  razorpay_order_id: text('razorpay_order_id'),    // ← new!
  totalAmount: integer('total_amount').notNull(),
  status: text('status').default('order placed'),
  progressStep: text('progressStep').default('0'),
  paymentMode: text('payment_mode').notNull(),
  transactionId: text('transaction_id').default("null"),
  paymentStatus: text("payment_status").default("pending"),
  phone: text("phone").notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').default('now()'),
  refund_id: text('refund_id'),                // Razorpay refund ID
  refund_amount: integer('refund_amount'),         // in paise
  refund_status: text('refund_status'),            // created, processed, failed, etc.
  refund_speed: text('refund_speed'),             // normal, instant, etc.
  refund_initiated_at: timestamp('refund_initiated_at'),
  refund_completed_at: timestamp('refund_completed_at'),
  couponCode: varchar('coupon_code', { length: 50 }),
  discountAmount: integer('discount_amount'),   // in rupees
});

export const addressTable = pgTable('address', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => usersTable.id),
  street: text('street').notNull(),
  city: text('city').notNull(),
  state: text('state').notNull(),
  postalCode: text('postal_code').notNull(),
  country: text('country').notNull(),
  createdAt: text('created_at').default('now()'),
  updatedAt: text('updated_at').default('now()'),
});
export const UserAddressTable = pgTable('user_address', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => usersTable.id),

  name: text('name').notNull(),
  phone: text('phone').notNull(),
  altPhone: text('alt_phone').default(null),

  address: text('address').notNull(),
  city: text('city').notNull(),
  state: text('state').notNull(),
  postalCode: text('postal_code').notNull(),
  country: text('country').notNull().default('India'),
  landmark: text('landmark').default(null),

  deliveryInstructions: text('delivery_instructions').default(null),
  addressType: text('address_type').default(null),
  label: text('label').default(null),

  latitude: text('latitude').default(null),
  longitude: text('longitude').default(null),
  geoAccuracy: text('geo_accuracy').default(null),

  isDefault: boolean('is_default').default(false),
  isVerified: boolean('is_verified').default(false),
  isDeleted: boolean('is_deleted').default(false),

  createdAt: text('created_at').default('now()'),
  updatedAt: text('updated_at').default('now()'),
});

export const orderItemsTable = pgTable('order_items', {
  id: text('id').primaryKey().$defaultFn(() => generateNumericId()),
  orderId: text('order_id').notNull().references(() => ordersTable.id),
  productName: varchar('product_name', { length: 255 }).notNull(),
  img: varchar('img', { length: 500 }).notNull(),
  productId: uuid('product_id').notNull(),
  quantity: integer('quantity').notNull().default(1),
  price: integer('price').notNull(), // Price per unit at purchase time
  totalPrice: integer('total_price').notNull(), // quantity * price
  size: integer('size').notNull().default(0),
});


export const couponsTable = pgTable('coupons', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 50 }).notNull().unique(), // e.g. SAVE100, FIRSTORDER
  discountType: varchar('discount_type', { length: 10 }).notNull(), // "flat" or "percent"
  discountValue: integer('discount_value').notNull(), // ₹ value for flat, % value for percent
  description: text('description'),
  minOrderValue: integer('min_order_value').default(0), // min ₹ total (optional)
  minItemCount: integer('min_item_count').default(0), // min quantity of products (optional)
  validFrom: timestamp('valid_from'), // Optional start date
  validUntil: timestamp('valid_until'), // Optional expiry date
  firstOrderOnly: boolean('is_first_order_only').default(false),
  maxUsagePerUser: integer('max_usage_per_user').default(1),  // 1 = once per user; can customize per coupon

});

export const testimonials = pgTable("testimonials", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  title: text("title"),
  text: text("text").notNull(),
  rating: integer("rating").notNull(),
  avatar: text("avatar"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});




export const reviewsTable = pgTable('product_reviews', {
  id: uuid('id').defaultRandom().primaryKey(),

  productId: uuid('product_id')
    .notNull()
    .references(() => productsTable.id, { onDelete: 'cascade' }),

  userId: uuid('user_id').notNull().references(() => usersTable.id), 
  name: text('name').notNull(),

  rating: integer('rating').notNull(), // 1–5

  comment: text('comment').notNull(),

  photoUrls: text('photo_urls').array(), // ✅ supports multiple images

  isVerifiedBuyer: boolean('is_verified_buyer').default(false),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),

  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),


}, (table) => ({
  productIdIdx: index('idx_reviews_product_id').on(table.productId),
  ratingIdx: index('idx_reviews_rating').on(table.rating),
  createdAtIdx: index('idx_reviews_created_at').on(table.createdAt),
})

);
