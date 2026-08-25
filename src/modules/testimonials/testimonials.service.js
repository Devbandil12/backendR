import * as TestimonialsRepository from './testimonials.repository.js';
import { invalidateMultiple } from '../../infrastructure/cache/cache.invalidate.js';
import { makeAllTestimonialsKey } from '../../infrastructure/cache/cache.keys.js';

export async function getAllTestimonials() {
  return await TestimonialsRepository.getAllTestimonials();
}

export async function createTestimonial(clerkId, data) {
  const user = await TestimonialsRepository.getUserByClerkId(clerkId);
  if (!user) throw Object.assign(new Error('User not found'), { status: 401 });
  
  await TestimonialsRepository.insertTestimonial({ 
    name: data.name || user.name, 
    title: data.title || 'Verified Customer', 
    text: data.text, 
    rating: data.rating || 5, 
    avatar: data.avatar || null 
  });
  
  await invalidateMultiple([{ key: makeAllTestimonialsKey() }]);
  return { success: true };
}
