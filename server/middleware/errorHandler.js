const AuditLog = require('../models/AuditLog');

const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log error details
  console.error('Error Handler:', err);

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = 'Resource not found';
    error = { message, statusCode: 404 };
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    let message = 'Duplicate field value entered';
    
    // Extract field name from error
    const field = Object.keys(err.keyValue)[0];
    if (field) {
      message = `${field.charAt(0).toUpperCase() + field.slice(1)} already exists`;
    }
    
    error = { message, statusCode: 400 };
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join(', ');
    error = { message, statusCode: 400 };
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    const message = 'Invalid token';
    error = { message, statusCode: 401 };
  }

  if (err.name === 'TokenExpiredError') {
    const message = 'Token expired';
    error = { message, statusCode: 401 };
  }

  // File upload errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    const message = 'File too large';
    error = { message, statusCode: 413 };
  }

  if (err.code === 'LIMIT_FILE_COUNT') {
    const message = 'Too many files';
    error = { message, statusCode: 413 };
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    const message = 'Unexpected file field';
    error = { message, statusCode: 400 };
  }

  // MPESA API errors
  if (err.mpesaError) {
    const message = err.message || 'MPESA API error';
    error = { message, statusCode: err.statusCode || 502 };
  }

  // Database connection errors
  if (err.name === 'MongoError' || err.name === 'MongooseError') {
    const message = 'Database connection error';
    error = { message, statusCode: 503 };
  }

  // Rate limiting errors
  if (err.status === 429) {
    const message = 'Too many requests';
    error = { message, statusCode: 429 };
  }

  const statusCode = error.statusCode || 500;
  const message = error.message || 'Server Error';

  // Log error to audit system for serious errors
  if (statusCode >= 500 && req.user) {
    AuditLog.logAction({
      user: req.user._id,
      userEmail: req.user.email,
      action: 'api_call',
      description: `Server error: ${req.method} ${req.originalUrl}`,
      resourceType: 'api',
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      requestMethod: req.method,
      requestUrl: req.originalUrl,
      responseStatus: statusCode,
      success: false,
      severity: 'critical',
      metadata: {
        errorMessage: message,
        errorStack: err.stack,
        errorName: err.name
      }
    }).catch(auditError => {
      console.error('Failed to log error to audit system:', auditError);
    });
  }

  // Prepare error response
  const errorResponse = {
    success: false,
    error: message
  };

  // Add additional error details in development
  if (process.env.NODE_ENV === 'development') {
    errorResponse.stack = err.stack;
    errorResponse.details = {
      name: err.name,
      code: err.code,
      statusCode: error.statusCode
    };
  }

  // Send error response
  res.status(statusCode).json(errorResponse);
};

// Async error handler wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Custom error class
class CustomError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'CustomError';
  }
}

// MPESA error class
class MPESAError extends Error {
  constructor(message, statusCode, mpesaCode) {
    super(message);
    this.statusCode = statusCode;
    this.mpesaCode = mpesaCode;
    this.mpesaError = true;
    this.name = 'MPESAError';
  }
}

// Validation error class
class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.statusCode = 400;
    this.field = field;
    this.name = 'ValidationError';
  }
}

// Not found error handler
const notFound = (req, res, next) => {
  const error = new CustomError(`Route ${req.originalUrl} not found`, 404);
  next(error);
};

module.exports = {
  errorHandler,
  asyncHandler,
  CustomError,
  MPESAError,
  ValidationError,
  notFound
};
