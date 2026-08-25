// src/infrastructure/events/event-bus.js
// Lightweight in-process event bus using Node's EventEmitter.
// Use for decoupled domain events (order placed → send email, update stock, etc.)

import { EventEmitter } from 'events';

class EventBus extends EventEmitter {}

export const eventBus = new EventBus();
eventBus.setMaxListeners(50); // Increase for many subscribers
