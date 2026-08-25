import * as PromoNotificationsRepository from './promo-notifications.repository.js';

export async function getLatestPublicPromos() {
  const now = new Date();
  return await PromoNotificationsRepository.getLatestPublicPromos(now);
}
