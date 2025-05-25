import { pgTable, serial, text, integer, uuid, varchar, PgSerial, timestamp, unique } from 'drizzle-orm/pg-core';


const generateNumericId = () => {
  const timestamp = Date.now(); // milliseconds since epoch
  return `DA${timestamp}`;
};




export const usersTable = pgTable('users', {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text('name').notNull(),
  phone: text('phone').default(null),
  email: text('email').notNull(),
  role: text('role').default('user'),
  cartlength:integer("cart_length").default(0),

});
export const querytable=pgTable("query",{
  name: text("name").notNull(),
   email: text("email").notNull(),
    phone: text("phone").notNull(),
     message:text("message").notNull(),
     createdAt:  text('created_at').notNull()
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
  id: text('id').primaryKey().$defaultFn(()=>generateNumericId()),
  userId: uuid('user_id').notNull().references(() => usersTable.id),
  totalAmount: integer('total_amount').notNull(),
  status: text('status').default('order placed'),
  progressStep:text('progressStep').default('0'),
  paymentMode:text('payment_mode').notNull(),
  transactionId:text('transaction_id').default("null"),
  paymentStatus: text("payment_status").default("pending"), 
  phone: text("phone").notNull(),
  createdAt:  text('created_at').notNull(),
  updatedAt:  text('updated_at').default('now()'),
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
  phone:text("phone").notNull(),
  city: text('city').notNull(),
  state: text('state').notNull(),
  postalCode: text('postal_code').notNull(),
  country: text('country').notNull(),
  address:text("address").notNull().default(""),


});

export const orderItemsTable = pgTable('order_items', {
  id: text('id').primaryKey().$defaultFn(()=>generateNumericId()),
  orderId: text('order_id').notNull().references(() => ordersTable.id),
  productId: uuid('product_id').notNull(),
  quantity: integer('quantity').notNull().default(1),
  price: integer('price').notNull(), // Price per unit at purchase time
  totalPrice: integer('total_price').notNull(), // quantity * price
});




