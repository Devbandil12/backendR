// src/modules/testimonials/testimonials.controller.js
import * as testimonialsService from './testimonials.service.js';

export const getAllTestimonials = async (req, res) => {
  try {
    const result = await testimonialsService.getAllTestimonials();
    res.json(result);
  } catch (err) {
    console.error('GET /testimonials error:', err);
    res.status(500).json({ error: 'Failed to load testimonials' });
  }
};

export const createTestimonial = async (req, res) => {
  try {
    const result = await testimonialsService.createTestimonial(req.auth.userId, req.body);
    res.status(201).json(result);
  } catch (err) {
    console.error('POST /testimonials error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to add testimonial' });
  }
};
