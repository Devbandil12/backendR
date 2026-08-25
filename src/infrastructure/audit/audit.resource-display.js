// src/infrastructure/audit/audit.resource-display.js

/**
 * Formats the resource display name and subtitle based on the resource type.
 * @param {string} resourceType 
 * @param {object} resourceData The raw resource object
 * @returns {{ resourceDisplayName: string | null, resourceDisplaySubtitle: string | null }}
 */
export function formatResourceDisplay(resourceType, resourceData) {
  if (!resourceData) {
    return { resourceDisplayName: null, resourceDisplaySubtitle: null };
  }

  let name = null;
  let subtitle = null;

  switch (resourceType) {
    case 'PRODUCT':
      name = resourceData.name;
      subtitle = resourceData.category || null;
      break;

    case 'VARIANT':
      name = resourceData.productName ? `${resourceData.productName} — ${resourceData.name}` : resourceData.name;
      subtitle = resourceData.sku ? `SKU: ${resourceData.sku}` : null;
      break;

    case 'ORDER':
      name = resourceData.id;
      subtitle = `${resourceData.totalAmount !== undefined ? '₹' + resourceData.totalAmount : ''} ${resourceData.status ? '• ' + resourceData.status : ''}`.trim();
      if (subtitle === '•') subtitle = null;
      break;

    case 'COUPON':
      name = resourceData.code;
      subtitle = resourceData.discountType === 'percentage' 
        ? `${resourceData.discountValue}% OFF` 
        : `₹${resourceData.discountValue} OFF`;
      break;

    case 'USER':
      name = resourceData.name;
      subtitle = resourceData.email;
      break;

    case 'ROLE':
      name = resourceData.name;
      subtitle = resourceData.description || null;
      break;

    case 'SUPPORT_TICKET':
      name = resourceData.ticketNumber || resourceData.id;
      subtitle = resourceData.subject || null;
      break;

    case 'REFUND':
      name = resourceData.refundId || resourceData.id;
      subtitle = `Order: ${resourceData.orderId || 'Unknown'}`;
      break;

    case 'SITE_CONTROL':
      name = resourceData.mode;
      subtitle = resourceData.schedule || null;
      break;

    case 'BUNDLE':
      name = resourceData.name;
      subtitle = resourceData.description || null;
      break;

    default:
      name = resourceData.name || resourceData.title || resourceData.id || null;
      break;
  }

  return {
    resourceDisplayName: name,
    resourceDisplaySubtitle: subtitle
  };
}
