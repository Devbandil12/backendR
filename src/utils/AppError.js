// ✅ file: utils/AppError.js
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true; // Marks error as "Known Issue" (e.g. Invalid Input) vs "Bug"

    Error.captureStackTrace(this, this.constructor);
  }
}

export default AppError;