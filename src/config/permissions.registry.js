export const PERMISSION_GROUPS = {
  DASHBOARD: 'Dashboard',
  ANALYTICS: 'Analytics',
  MARKET_INTEL: 'Market Intelligence',
  AUDIT_LOGS: 'Audit Logs',
  COMMERCE: 'Commerce',
  CUSTOMERS: 'Customers',
  CONTENT: 'Content',
  PROMOTIONS: 'Promotions',
  SUPPORT: 'Support',
  ADMINISTRATION: 'Administration'
};

export const PERMISSION_REGISTRY = [
  // Dashboard
  { key: 'dashboard.view', name: 'View Dashboard', group: PERMISSION_GROUPS.DASHBOARD, description: 'View the main overview dashboard' },

  // Analytics
  { key: 'analytics.view', name: 'View Analytics', group: PERMISSION_GROUPS.ANALYTICS, description: 'View detailed analytics data' },

  // Market Intel
  { key: 'marketIntel.view', name: 'View Market Intelligence', group: PERMISSION_GROUPS.MARKET_INTEL, description: 'View market intelligence' },

  // Audit Logs
  { key: 'auditLogs.view', name: 'View Audit Logs', group: PERMISSION_GROUPS.AUDIT_LOGS, description: 'View system audit logs', isSensitive: true },
  { key: 'auditLogs.export', name: 'Export Audit Logs', group: PERMISSION_GROUPS.AUDIT_LOGS, description: 'Export audit logs', isSensitive: true },

  // Commerce - Products
  { key: 'products.view', name: 'View Products', group: PERMISSION_GROUPS.COMMERCE, description: 'View products catalogue' },
  { key: 'products.create', name: 'Create Products', group: PERMISSION_GROUPS.COMMERCE, description: 'Create new products' },
  { key: 'products.update', name: 'Update Products', group: PERMISSION_GROUPS.COMMERCE, description: 'Edit existing products' },
  { key: 'products.archive', name: 'Archive Products', group: PERMISSION_GROUPS.COMMERCE, description: 'Archive products' },
  { key: 'products.delete', name: 'Delete Products', group: PERMISSION_GROUPS.COMMERCE, description: 'Delete products permanently', isSensitive: true },
  { key: 'products.variants.manage', name: 'Manage Variants', group: PERMISSION_GROUPS.COMMERCE, description: 'Manage product variants' },
  { key: 'products.inventory.manage', name: 'Manage Inventory', group: PERMISSION_GROUPS.COMMERCE, description: 'Manage inventory levels' },

  // Commerce - Coupons
  { key: 'coupons.view', name: 'View Coupons', group: PERMISSION_GROUPS.COMMERCE, description: 'View discount coupons' },
  { key: 'coupons.create', name: 'Create Coupons', group: PERMISSION_GROUPS.COMMERCE, description: 'Create new coupons' },
  { key: 'coupons.update', name: 'Update Coupons', group: PERMISSION_GROUPS.COMMERCE, description: 'Edit existing coupons' },
  { key: 'coupons.disable', name: 'Disable Coupons', group: PERMISSION_GROUPS.COMMERCE, description: 'Disable active coupons' },
  { key: 'coupons.delete', name: 'Delete Coupons', group: PERMISSION_GROUPS.COMMERCE, description: 'Delete coupons' },

  // Commerce - Orders
  { key: 'orders.view', name: 'View Orders', group: PERMISSION_GROUPS.COMMERCE, description: 'View customer orders' },
  { key: 'orders.view_customer', name: 'View Customer Intelligence', group: PERMISSION_GROUPS.COMMERCE, description: 'View customer statistics and history on orders' },
  { key: 'orders.view_financial', name: 'View Financial Data', group: PERMISSION_GROUPS.COMMERCE, description: 'View detailed order financials and transaction IDs', isSensitive: true },
  { key: 'orders.update', name: 'Update Orders', group: PERMISSION_GROUPS.COMMERCE, description: 'Update order details' },
  { key: 'orders.update_status', name: 'Update Order Status', group: PERMISSION_GROUPS.COMMERCE, description: 'Change order and fulfillment statuses' },
  { key: 'orders.cancel', name: 'Cancel Orders', group: PERMISSION_GROUPS.COMMERCE, description: 'Cancel active orders' },
  { key: 'orders.return', name: 'Initiate Returns', group: PERMISSION_GROUPS.COMMERCE, description: 'Initiate and manage order returns' },
  { key: 'orders.refund', name: 'Refund Orders', group: PERMISSION_GROUPS.COMMERCE, description: 'Process order refunds', isSensitive: true },
  { key: 'orders.ship', name: 'Ship Orders', group: PERMISSION_GROUPS.COMMERCE, description: 'Generate shipping labels and assign AWBs' },
  { key: 'orders.bulk_update', name: 'Bulk Update Orders', group: PERMISSION_GROUPS.COMMERCE, description: 'Perform bulk status updates on orders' },
  { key: 'orders.export', name: 'Export Orders', group: PERMISSION_GROUPS.COMMERCE, description: 'Export order data and reports' },
  { key: 'orders.notify_customer', name: 'Notify Customer', group: PERMISSION_GROUPS.COMMERCE, description: 'Send custom notifications to order customers' },

  // Commerce - Carts & Wishlists
  { key: 'carts.view', name: 'View Carts', group: PERMISSION_GROUPS.COMMERCE, description: 'View customer carts' },
  { key: 'wishlists.view', name: 'View Wishlists', group: PERMISSION_GROUPS.COMMERCE, description: 'View customer wishlists' },

  // Commerce - Logistics
  { key: 'logistics.view', name: 'View Logistics', group: PERMISSION_GROUPS.COMMERCE, description: 'View shipments and logistics' },
  { key: 'logistics.update', name: 'Update Logistics', group: PERMISSION_GROUPS.COMMERCE, description: 'Update shipment status' },

  // Customers - Customers
  { key: 'customers.view', name: 'View Customers', group: PERMISSION_GROUPS.CUSTOMERS, description: 'View customer data' },
  { key: 'customers.update', name: 'Update Customers', group: PERMISSION_GROUPS.CUSTOMERS, description: 'Edit customer profiles' },
  { key: 'customers.suspend', name: 'Suspend Customers', group: PERMISSION_GROUPS.CUSTOMERS, description: 'Suspend customer accounts', isSensitive: true },
  { key: 'customers.delete', name: 'Delete Customers', group: PERMISSION_GROUPS.CUSTOMERS, description: 'Delete customer data', isSensitive: true },
  { key: 'customers.export', name: 'Export Customers', group: PERMISSION_GROUPS.CUSTOMERS, description: 'Export customer data', isSensitive: true },

  // Customers - Messages
  { key: 'messages.view', name: 'View Messages', group: PERMISSION_GROUPS.CUSTOMERS, description: 'View communications' },
  { key: 'messages.send', name: 'Send Messages', group: PERMISSION_GROUPS.CUSTOMERS, description: 'Send individual messages' },
  { key: 'messages.createCampaign', name: 'Create Campaign', group: PERMISSION_GROUPS.CUSTOMERS, description: 'Create messaging campaigns' },
  { key: 'messages.updateCampaign', name: 'Update Campaign', group: PERMISSION_GROUPS.CUSTOMERS, description: 'Edit existing campaigns' },
  { key: 'messages.scheduleCampaign', name: 'Schedule Campaign', group: PERMISSION_GROUPS.CUSTOMERS, description: 'Schedule campaigns for dispatch' },
  { key: 'messages.cancelCampaign', name: 'Cancel Campaign', group: PERMISSION_GROUPS.CUSTOMERS, description: 'Cancel scheduled campaigns' },
  { key: 'messages.bulkSend', name: 'Bulk Send Messages', group: PERMISSION_GROUPS.CUSTOMERS, description: 'Send bulk communications', isSensitive: true },

  // Customers - Referrals
  { key: 'referrals.view', name: 'View Referrals', group: PERMISSION_GROUPS.CUSTOMERS, description: 'View referral programs' },
  { key: 'referrals.manage', name: 'Manage Referrals', group: PERMISSION_GROUPS.CUSTOMERS, description: 'Configure referral programs' },

  // Customers - Rewards
  { key: 'rewards.view', name: 'View Rewards', group: PERMISSION_GROUPS.CUSTOMERS, description: 'View customer rewards' },
  { key: 'rewards.manage', name: 'Manage Rewards', group: PERMISSION_GROUPS.CUSTOMERS, description: 'Configure reward tiers and rules' },
  { key: 'rewards.adjust', name: 'Adjust Points', group: PERMISSION_GROUPS.CUSTOMERS, description: 'Manually adjust customer points', isSensitive: true },

  // Content
  { key: 'content.view', name: 'View Content', group: PERMISSION_GROUPS.CONTENT, description: 'View site content' },
  { key: 'content.create', name: 'Create Content', group: PERMISSION_GROUPS.CONTENT, description: 'Create site content' },
  { key: 'content.update', name: 'Update Content', group: PERMISSION_GROUPS.CONTENT, description: 'Update site content' },
  { key: 'content.publish', name: 'Publish Content', group: PERMISSION_GROUPS.CONTENT, description: 'Publish site content' },
  { key: 'content.delete', name: 'Delete Content', group: PERMISSION_GROUPS.CONTENT, description: 'Delete site content' },

  // Promotions - Lottery
  { key: 'lottery.view', name: 'View Lottery', group: PERMISSION_GROUPS.PROMOTIONS, description: 'View lottery draws' },
  { key: 'lottery.configure', name: 'Configure Lottery', group: PERMISSION_GROUPS.PROMOTIONS, description: 'Configure lottery settings' },
  { key: 'lottery.draw', name: 'Execute Draw', group: PERMISSION_GROUPS.PROMOTIONS, description: 'Execute lottery draws', isSensitive: true },

  // Support
  { key: 'support.view', name: 'View Support Tickets', group: PERMISSION_GROUPS.SUPPORT, description: 'View all support tickets and conversations' },
  { key: 'support.reply', name: 'Reply to Tickets', group: PERMISSION_GROUPS.SUPPORT, description: 'Reply to support tickets as an agent' },
  { key: 'support.note', name: 'Add Internal Notes', group: PERMISSION_GROUPS.SUPPORT, description: 'Add internal notes visible only to agents' },
  { key: 'support.assign', name: 'Assign Tickets', group: PERMISSION_GROUPS.SUPPORT, description: 'Assign tickets to agents and teams' },
  { key: 'support.close', name: 'Close/Resolve Tickets', group: PERMISSION_GROUPS.SUPPORT, description: 'Close or resolve support tickets' },
  { key: 'support.configure', name: 'Configure Support', group: PERMISSION_GROUPS.SUPPORT, description: 'Manage support teams, tags, and settings', isSensitive: true },
  { key: 'support.export', name: 'Export Support Data', group: PERMISSION_GROUPS.SUPPORT, description: 'Export support ticket data', isSensitive: true },

  // Administration
  { key: 'roles.view', name: 'View Roles', group: PERMISSION_GROUPS.ADMINISTRATION, description: 'View roles and permissions' },
  { key: 'roles.manage', name: 'Manage Roles', group: PERMISSION_GROUPS.ADMINISTRATION, description: 'Create, update, and delete roles', isSensitive: true },
  { key: 'roles.assign', name: 'Assign Roles', group: PERMISSION_GROUPS.ADMINISTRATION, description: 'Assign roles to administrators', isSensitive: true },
  { key: 'administrators.view', name: 'View Administrators', group: PERMISSION_GROUPS.ADMINISTRATION, description: 'View administrators' },
  { key: 'administrators.manage', name: 'Manage Administrators', group: PERMISSION_GROUPS.ADMINISTRATION, description: 'Create, disable, or delete administrators', isSensitive: true },
];

export const SYSTEM_ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  MARKETING_MANAGER: 'Marketing Manager',
  CATALOG_MANAGER: 'Catalog Manager',
  ORDER_MANAGER: 'Order Manager',
  CUSTOMER_SUPPORT: 'Customer Support',
  LOGISTICS_MANAGER: 'Logistics Manager',
  FINANCE_MANAGER: 'Finance Manager',
  VIEWER: 'Viewer'
};
