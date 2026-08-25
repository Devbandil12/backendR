const fs = require('fs');

// Cart schema
let cart = fs.readFileSync('src/db/schema/cart.schema.js', 'utf8');
cart = cart.replace(/addedAt:\s*timestamp\('added_at',\s*\{\s*withTimezone:\s*true\s*\}\)\.defaultNow\(\),\n\}\);/g, 
            `addedAt: timestamp('added_at', { withTimezone: true }).defaultNow(),\n}, (table) => ({\n  userIdIdx: index('idx_cart_user_id').on(table.userId)\n}));`);
fs.writeFileSync('src/db/schema/cart.schema.js', cart);

// Orders schema
let orders = fs.readFileSync('src/db/schema/orders.schema.js', 'utf8');
orders = orders.replace(/couponsUsed:\s*jsonb\('coupons_used'\),\n\}\);/g, 
            `couponsUsed: jsonb('coupons_used'),\n}, (table) => ({\n  userIdIdx: index('orders_user_id_idx').on(table.userId),\n  statusIdx: index('orders_status_idx').on(table.status)\n}));`);
fs.writeFileSync('src/db/schema/orders.schema.js', orders);

console.log('Indexes added successfully.');
