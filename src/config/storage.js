// src/config/storage.js
// Storage / upload configuration (multer, cloud providers, etc.)
// Individual routes currently configure multer inline — centralise here over time.

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const UPLOADS_DIR = path.resolve(__dirname, '../../uploads');
