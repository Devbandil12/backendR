import { AUDIT_CATEGORIES, AUDIT_SEVERITY } from './audit.constants.js';

export const AUDIT_EVENTS = {
  // Auth & Security
  AUTH_LOGIN: { category: AUDIT_CATEGORIES.AUTH, severity: AUDIT_SEVERITY.INFO, critical: false },
  AUTH_LOGOUT: { category: AUDIT_CATEGORIES.AUTH, severity: AUDIT_SEVERITY.INFO, critical: false },
  AUTH_LOGIN_FAILED: { category: AUDIT_CATEGORIES.SECURITY, severity: AUDIT_SEVERITY.WARNING, critical: true },
  PERMISSION_DENIED: { category: AUDIT_CATEGORIES.SECURITY, severity: AUDIT_SEVERITY.WARNING, critical: true },
  PRIVILEGE_ESCALATION_ATTEMPT: { category: AUDIT_CATEGORIES.SECURITY, severity: AUDIT_SEVERITY.CRITICAL, critical: true },

  // User
  USER_CREATED: { category: AUDIT_CATEGORIES.USER, severity: AUDIT_SEVERITY.INFO, critical: false },
  USER_UPDATED: { category: AUDIT_CATEGORIES.USER, severity: AUDIT_SEVERITY.INFO, critical: false },
  USER_SUSPENDED: { category: AUDIT_CATEGORIES.USER, severity: AUDIT_SEVERITY.HIGH, critical: true },
  ADMIN_CREATED: { category: AUDIT_CATEGORIES.RBAC, severity: AUDIT_SEVERITY.HIGH, critical: true },
  ADMIN_DISABLED: { category: AUDIT_CATEGORIES.RBAC, severity: AUDIT_SEVERITY.HIGH, critical: true },
  ADMIN_UPDATED: { category: AUDIT_CATEGORIES.RBAC, severity: AUDIT_SEVERITY.INFO, critical: true },

  // Product
  PRODUCT_CREATED: { category: AUDIT_CATEGORIES.PRODUCT, severity: AUDIT_SEVERITY.INFO, critical: false },
  PRODUCT_UPDATED: { category: AUDIT_CATEGORIES.PRODUCT, severity: AUDIT_SEVERITY.INFO, critical: true }, // critical if price/stock changes
  PRODUCT_ARCHIVED: { category: AUDIT_CATEGORIES.PRODUCT, severity: AUDIT_SEVERITY.WARNING, critical: true },
  PRODUCT_RESTORED: { category: AUDIT_CATEGORIES.PRODUCT, severity: AUDIT_SEVERITY.INFO, critical: false },
  PRODUCT_BULK_UPDATE: { category: AUDIT_CATEGORIES.PRODUCT, severity: AUDIT_SEVERITY.WARNING, critical: true },

  // Variant
  VARIANT_CREATED: { category: AUDIT_CATEGORIES.PRODUCT, severity: AUDIT_SEVERITY.INFO, critical: false },
  VARIANT_UPDATED: { category: AUDIT_CATEGORIES.PRODUCT, severity: AUDIT_SEVERITY.INFO, critical: true },
  VARIANT_ARCHIVED: { category: AUDIT_CATEGORIES.PRODUCT, severity: AUDIT_SEVERITY.WARNING, critical: true },
  VARIANT_UNARCHIVE: { category: AUDIT_CATEGORIES.PRODUCT, severity: AUDIT_SEVERITY.INFO, critical: false },

  // Bundle
  BUNDLE_ADD_ITEM: { category: AUDIT_CATEGORIES.PRODUCT, severity: AUDIT_SEVERITY.INFO, critical: false },
  BUNDLE_REMOVE_ITEM: { category: AUDIT_CATEGORIES.PRODUCT, severity: AUDIT_SEVERITY.INFO, critical: false },

  // Order & Payment
  ORDER_CREATED: { category: AUDIT_CATEGORIES.ORDER, severity: AUDIT_SEVERITY.INFO, critical: false },
  ORDER_UPDATED: { category: AUDIT_CATEGORIES.ORDER, severity: AUDIT_SEVERITY.INFO, critical: false },
  ORDER_STATUS_CHANGED: { category: AUDIT_CATEGORIES.ORDER, severity: AUDIT_SEVERITY.INFO, critical: false },
  ORDER_STATUS_UPDATE: { category: AUDIT_CATEGORIES.ORDER, severity: AUDIT_SEVERITY.INFO, critical: false },
  ORDER_CANCELLED: { category: AUDIT_CATEGORIES.ORDER, severity: AUDIT_SEVERITY.WARNING, critical: false },
  ORDER_REFUND_STARTED: { category: AUDIT_CATEGORIES.PAYMENT, severity: AUDIT_SEVERITY.HIGH, critical: true },
  ORDER_REFUND_COMPLETED: { category: AUDIT_CATEGORIES.PAYMENT, severity: AUDIT_SEVERITY.HIGH, critical: true },
  ORDER_REFUND_INITIATED: { category: AUDIT_CATEGORIES.PAYMENT, severity: AUDIT_SEVERITY.HIGH, critical: true },
  ORDER_RETURN_INITIATED: { category: AUDIT_CATEGORIES.ORDER, severity: AUDIT_SEVERITY.WARNING, critical: false },
  ORDER_NOTE_ADDED: { category: AUDIT_CATEGORIES.ORDER, severity: AUDIT_SEVERITY.INFO, critical: false },
  ORDER_SHIPPED: { category: AUDIT_CATEGORIES.LOGISTICS, severity: AUDIT_SEVERITY.INFO, critical: false },
  ORDER_STATUS_BULK_UPDATE: { category: AUDIT_CATEGORIES.ORDER, severity: AUDIT_SEVERITY.INFO, critical: false },

  // Coupon
  COUPON_CREATED: { category: AUDIT_CATEGORIES.COUPON, severity: AUDIT_SEVERITY.INFO, critical: true },
  COUPON_UPDATED: { category: AUDIT_CATEGORIES.COUPON, severity: AUDIT_SEVERITY.INFO, critical: true },
  COUPON_DELETED: { category: AUDIT_CATEGORIES.COUPON, severity: AUDIT_SEVERITY.WARNING, critical: true },

  // RBAC
  ROLE_CREATED: { category: AUDIT_CATEGORIES.RBAC, severity: AUDIT_SEVERITY.HIGH, critical: true },
  ROLE_UPDATED: { category: AUDIT_CATEGORIES.RBAC, severity: AUDIT_SEVERITY.HIGH, critical: true },
  ROLE_DELETED: { category: AUDIT_CATEGORIES.RBAC, severity: AUDIT_SEVERITY.CRITICAL, critical: true },
  ROLE_ASSIGNED: { category: AUDIT_CATEGORIES.RBAC, severity: AUDIT_SEVERITY.HIGH, critical: true },
  ROLE_REVOKED: { category: AUDIT_CATEGORIES.RBAC, severity: AUDIT_SEVERITY.HIGH, critical: true },
  PERMISSION_ADDED: { category: AUDIT_CATEGORIES.RBAC, severity: AUDIT_SEVERITY.CRITICAL, critical: true },
  PERMISSION_REMOVED: { category: AUDIT_CATEGORIES.RBAC, severity: AUDIT_SEVERITY.CRITICAL, critical: true },

  // Site Control
  SITE_MODE_CHANGED: { category: AUDIT_CATEGORIES.SITE_CONTROL, severity: AUDIT_SEVERITY.CRITICAL, critical: true },
  SITE_MAINTENANCE_SCHEDULED: { category: AUDIT_CATEGORIES.SITE_CONTROL, severity: AUDIT_SEVERITY.HIGH, critical: true },
  SITE_MAINTENANCE_CANCELLED: { category: AUDIT_CATEGORIES.SITE_CONTROL, severity: AUDIT_SEVERITY.INFO, critical: true },

  // Support
  SUPPORT_TICKET_CREATED: { category: AUDIT_CATEGORIES.SUPPORT, severity: AUDIT_SEVERITY.INFO, critical: false },
  SUPPORT_TICKET_UPDATED: { category: AUDIT_CATEGORIES.SUPPORT, severity: AUDIT_SEVERITY.INFO, critical: false },
  SUPPORT_TICKET_ASSIGNED: { category: AUDIT_CATEGORIES.SUPPORT, severity: AUDIT_SEVERITY.INFO, critical: false },
  SUPPORT_TICKET_RESOLVED: { category: AUDIT_CATEGORIES.SUPPORT, severity: AUDIT_SEVERITY.INFO, critical: false },

  // Reward
  REWARD_APPROVED: { category: AUDIT_CATEGORIES.REWARD, severity: AUDIT_SEVERITY.HIGH, critical: true },
  REWARD_REJECTED: { category: AUDIT_CATEGORIES.REWARD, severity: AUDIT_SEVERITY.INFO, critical: true },
  LOTTERY_DRAWN: { category: AUDIT_CATEGORIES.REWARD, severity: AUDIT_SEVERITY.HIGH, critical: true },
};
