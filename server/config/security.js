const crypto = require('crypto');

/**
 * Security configuration and utilities
 */

// Generate secure random string
const generateSecureToken = (length = 32) => {
  return crypto.randomBytes(length).toString('hex');
};

// Generate encryption key
const generateEncryptionKey = () => {
  return crypto.randomBytes(32).toString('hex');
};

// Hash sensitive data
const hashData = (data, salt = null) => {
  const actualSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(data, actualSalt, 10000, 64, 'sha512');
  return {
    hash: hash.toString('hex'),
    salt: actualSalt
  };
};

// Verify hashed data
const verifyHashedData = (data, hash, salt) => {
  const hashedData = crypto.pbkdf2Sync(data, salt, 10000, 64, 'sha512');
  return hashedData.toString('hex') === hash;
};

// Security headers configuration
const securityHeaders = {
  // Prevent clickjacking
  'X-Frame-Options': 'DENY',
  
  // Prevent MIME type sniffing
  'X-Content-Type-Options': 'nosniff',
  
  // Enable XSS protection
  'X-XSS-Protection': '1; mode=block',
  
  // Strict Transport Security (HTTPS only)
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  
  // Content Security Policy
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://api.safaricom.co.ke https://sandbox.safaricom.co.ke",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; '),
  
  // Referrer Policy
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  
  // Permissions Policy
  'Permissions-Policy': [
    'camera=()',
    'microphone=()',
    'geolocation=()',
    'interest-cohort=()'
  ].join(', ')
};

// Rate limiting configurations
const rateLimitConfig = {
  // General API rate limiting
  general: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
  },
  
  // Authentication rate limiting
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // limit each IP to 5 requests per windowMs
    message: 'Too many authentication attempts, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
  },
  
  // Upload rate limiting
  upload: {
    windowMs: 60 * 1000, // 1 minute
    max: 3, // limit each IP to 3 uploads per minute
    message: 'Too many file uploads, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
  },
  
  // Payment processing rate limiting
  payment: {
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 10, // limit each IP to 10 payment requests per 5 minutes
    message: 'Too many payment requests, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
  }
};

// Input validation patterns
const validationPatterns = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  phone: /^254[0-9]{9}$/,
  amount: /^\d+(\.\d{1,2})?$/,
  reference: /^[a-zA-Z0-9_-]+$/,
  password: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
  mongoId: /^[0-9a-fA-F]{24}$/,
  uuid: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  ipAddress: /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/
};

// Sanitization functions
const sanitizeInput = (input) => {
  if (typeof input !== 'string') return input;
  
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+\s*=/gi, ''); // Remove event handlers
};

const sanitizeFileName = (fileName) => {
  return fileName
    .replace(/[^a-zA-Z0-9.-]/g, '_') // Replace special chars with underscore
    .replace(/\.{2,}/g, '.') // Replace multiple dots with single dot
    .substring(0, 255); // Limit length
};

// CORS configuration
const corsConfig = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000').split(',');
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['X-Total-Count', 'X-Page-Count']
};

// Session configuration
const sessionConfig = {
  secret: process.env.SESSION_SECRET || generateSecureToken(64),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    httpOnly: true, // Prevent XSS
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'strict' // CSRF protection
  },
  name: 'sessionId' // Don't use default session name
};

// File upload security
const fileUploadConfig = {
  maxFileSize: 5 * 1024 * 1024, // 5MB
  allowedMimeTypes: [
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ],
  allowedExtensions: ['.xls', '.xlsx'],
  maxFiles: 1,
  preservePath: false,
  safeFileNames: true,
  abortOnLimit: true
};

// Database security
const dbSecurity = {
  // Connection options
  connectionOptions: {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    bufferMaxEntries: 0,
    bufferCommands: false,
  },
  
  // Query timeout
  queryTimeout: 30000,
  
  // Connection string validation
  validateConnectionString: (connectionString) => {
    const urlPattern = /^mongodb(\+srv)?:\/\/[^\/]+\/[^?]+(\?.*)?$/;
    return urlPattern.test(connectionString);
  }
};

// API security middleware
const apiSecurity = {
  // Request size limits
  requestLimits: {
    json: '10mb',
    urlencoded: '10mb',
    text: '10mb'
  },
  
  // Timeout configuration
  timeout: 30000,
  
  // Request ID generation
  generateRequestId: () => {
    return `req_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }
};

module.exports = {
  generateSecureToken,
  generateEncryptionKey,
  hashData,
  verifyHashedData,
  securityHeaders,
  rateLimitConfig,
  validationPatterns,
  sanitizeInput,
  sanitizeFileName,
  corsConfig,
  sessionConfig,
  fileUploadConfig,
  dbSecurity,
  apiSecurity
};
