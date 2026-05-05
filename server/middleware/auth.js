const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');

// Protect routes - verify JWT token
const protect = async (req, res, next) => {
  let token;
  
  try {
    // Get token from header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    
    // Make sure token exists
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Access denied. No token provided.'
      });
    }
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user from token
    const user = await User.findById(decoded.id).select('+password');
    
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token. User not found.'
      });
    }
    
    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        error: 'Account has been deactivated.'
      });
    }
    
    // Check if user account is locked
    if (user.isLocked) {
      return res.status(401).json({
        success: false,
        error: 'Account is temporarily locked due to multiple failed login attempts.'
      });
    }
    
    // Check if password was changed after token was issued
    if (user.changedPasswordAfter(decoded.iat)) {
      return res.status(401).json({
        success: false,
        error: 'Password was recently changed. Please log in again.'
      });
    }
    
    // Check IP whitelist if configured
    const clientIP = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];
    if (!user.isIPAllowed(clientIP)) {
      // Log security event
      await AuditLog.logSecurityEvent({
        user: user._id,
        userEmail: user.email,
        description: `Access denied from non-whitelisted IP: ${clientIP}`,
        ipAddress: clientIP,
        userAgent: req.get('User-Agent'),
        severity: 'high',
        success: false,
        metadata: {
          allowedIPs: user.ipWhitelist,
          attemptedIP: clientIP
        }
      });
      
      return res.status(403).json({
        success: false,
        error: 'Access denied from this IP address.'
      });
    }
    
    // Add user to request object
    req.user = user;
    req.token = token;
    
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    
    // Log failed authentication attempt
    if (token) {
      try {
        const decoded = jwt.decode(token);
        if (decoded && decoded.email) {
          await AuditLog.logSecurityEvent({
            user: decoded.id || null,
            userEmail: decoded.email,
            description: `Invalid token used: ${error.message}`,
            ipAddress: req.ip || req.connection.remoteAddress,
            userAgent: req.get('User-Agent'),
            severity: 'medium',
            success: false,
            metadata: {
              error: error.message,
              tokenDecoded: !!decoded
            }
          });
        }
      } catch (decodeError) {
        // Token couldn't be decoded, continue with generic error
      }
    }
    
    return res.status(401).json({
      success: false,
      error: 'Invalid token.'
    });
  }
};

// Grant access to specific roles
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Access denied. Please authenticate first.'
      });
    }
    
    if (!roles.includes(req.user.role)) {
      // Log unauthorized access attempt
      AuditLog.logSecurityEvent({
        user: req.user._id,
        userEmail: req.user.email,
        description: `Unauthorized access attempt to ${req.method} ${req.originalUrl}`,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
        severity: 'medium',
        success: false,
        metadata: {
          requiredRoles: roles,
          userRole: req.user.role,
          requestedResource: req.originalUrl
        }
      });
      
      return res.status(403).json({
        success: false,
        error: `Access denied. Required role: ${roles.join(' or ')}`
      });
    }
    
    next();
  };
};

// Check specific permission
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Access denied. Please authenticate first.'
      });
    }
    
    if (!req.user.hasPermission(permission)) {
      // Log permission denied
      AuditLog.logSecurityEvent({
        user: req.user._id,
        userEmail: req.user.email,
        description: `Permission denied: ${permission} for ${req.method} ${req.originalUrl}`,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
        severity: 'medium',
        success: false,
        metadata: {
          requiredPermission: permission,
          userPermissions: req.user.permissions,
          requestedResource: req.originalUrl
        }
      });
      
      return res.status(403).json({
        success: false,
        error: `Access denied. Required permission: ${permission}`
      });
    }
    
    next();
  };
};

// Admin only access
const adminOnly = authorize('admin');

// Finance officer or admin access
const financeOrAdmin = authorize('finance_officer', 'admin');

// Rate limiting for authentication endpoints
const authRateLimit = (maxAttempts = 5, windowMs = 15 * 60 * 1000) => {
  const attempts = new Map();
  
  return (req, res, next) => {
    const key = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    
    // Clean old attempts
    for (const [ip, data] of attempts.entries()) {
      if (now - data.firstAttempt > windowMs) {
        attempts.delete(ip);
      }
    }
    
    // Get current attempts for this IP
    const currentAttempts = attempts.get(key) || { count: 0, firstAttempt: now };
    
    // Check if limit exceeded
    if (currentAttempts.count >= maxAttempts) {
      const timeLeft = windowMs - (now - currentAttempts.firstAttempt);
      
      // Log rate limit exceeded
      AuditLog.logSecurityEvent({
        user: null,
        userEmail: req.body.email || 'unknown',
        description: `Rate limit exceeded for authentication from IP: ${key}`,
        ipAddress: key,
        userAgent: req.get('User-Agent'),
        severity: 'high',
        success: false,
        metadata: {
          attempts: currentAttempts.count,
          timeLeft: Math.ceil(timeLeft / 1000),
          maxAttempts,
          windowMs
        }
      });
      
      return res.status(429).json({
        success: false,
        error: `Too many authentication attempts. Try again in ${Math.ceil(timeLeft / 1000)} seconds.`
      });
    }
    
    // Increment attempts
    currentAttempts.count++;
    attempts.set(key, currentAttempts);
    
    // Add reset function to request
    req.resetAuthAttempts = () => {
      attempts.delete(key);
    };
    
    next();
  };
};

// Audit middleware - log all authenticated requests
const auditRequest = async (req, res, next) => {
  if (!req.user) {
    return next();
  }
  
  const startTime = Date.now();
  
  // Override res.json to capture response status
  const originalJson = res.json;
  res.json = function(body) {
    const processingTime = Date.now() - startTime;
    
    // Log the request (async, don't wait)
    AuditLog.logAction({
      user: req.user._id,
      userEmail: req.user.email,
      action: 'api_call',
      description: `${req.method} ${req.originalUrl}`,
      resourceType: 'api',
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      requestMethod: req.method,
      requestUrl: req.originalUrl,
      responseStatus: res.statusCode,
      success: res.statusCode < 400,
      severity: res.statusCode >= 500 ? 'high' : (res.statusCode >= 400 ? 'medium' : 'low'),
      metadata: {
        processingTime,
        requestBody: req.method !== 'GET' ? req.body : undefined,
        queryParams: req.query
      }
    }).catch(error => {
      console.error('Failed to log audit entry:', error);
    });
    
    return originalJson.call(this, body);
  };
  
  next();
};

module.exports = {
  protect,
  authorize,
  requirePermission,
  adminOnly,
  financeOrAdmin,
  authRateLimit,
  auditRequest
};
