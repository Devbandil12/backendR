import * as CmsRepository from './cms.repository.js';
import { invalidateMultiple } from '../../infrastructure/cache/cache.invalidate.js';

export const BANNERS_CACHE_KEY = 'cms_banners_list';
export const ABOUT_CACHE_KEY = 'cms_about_data';

export async function getAllBanners() {
  return await CmsRepository.getAllBanners();
}

export async function createBanner(data) {
  const { title, subtitle, imageUrl, link, buttonText, type, layout, imageLayer1, imageLayer2, poeticLine, description, templateType, config } = data;
  
  const newBanner = await CmsRepository.insertBanner({ 
    title, subtitle, imageUrl, link, buttonText, 
    type: type || 'hero', 
    layout: layout || 'split', 
    imageLayer1, imageLayer2, poeticLine, description, 
    templateType: templateType || 'standard', 
    config: config || {} 
  });
  
  await invalidateMultiple([{ key: BANNERS_CACHE_KEY }]);
  return newBanner;
}

export async function deleteBanner(id) {
  await CmsRepository.deleteBanner(id);
  await invalidateMultiple([{ key: BANNERS_CACHE_KEY }]);
  return true;
}

export async function updateBanner(id, data) {
  const updated = await CmsRepository.updateBanner(id, data);
  await invalidateMultiple([{ key: BANNERS_CACHE_KEY }]);
  return updated;
}

export async function getAboutUs() {
  const result = await CmsRepository.getAboutUs();
  return result.length > 0 ? result[0] : null;
}

export async function upsertAboutUs(data) {
  const existing = await CmsRepository.getAboutUs();
  let result;
  
  if (existing.length === 0) {
    result = await CmsRepository.insertAboutUs(data);
  } else {
    result = await CmsRepository.updateAboutUs(existing[0].id, data);
  }
  
  await invalidateMultiple([{ key: ABOUT_CACHE_KEY }]);
  return { result, isNew: existing.length === 0 };
}
