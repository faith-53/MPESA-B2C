const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { protect, authRateLimit } = require('../middleware/auth');
const { asyncHandler, CustomError } = require('../middleware/errorHandler');

const router = express.Router();

// Apply rate limiting to all auth routes
router.use(authRateLimit(5, 15 * 60 * 1000)); // 5 attempts per 15 minutes

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public (but should be restricted in production)
router.post('/register', [
  body('firstName').trim().isLength({ min: 2, max: 50 }).withMessage('First name must be between 2 and 50 characters'),
  body('lastName').trim().isLength({ min: 2, max: 50 }).withMessage('Last name must be between 2 and 50 characters'),
  body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character')
], asyncHandler(async (req, res) => {
  // Check validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }

const { firstName, lastName, email, password } = req.body;
const role = 'user'; // Default role
  const clientIP = req.ip || req.connection.remoteAddress;

  try {
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      await AuditLog.logSecurityEvent({
        user: null,
        userEmail: email,
        description: `Registration attempt with existing email: ${email}`,
        ipAddress: clientIP,
        userAgent: req.get('User-Agent'),
        severity: 'medium',
        success: false,
        metadata: {
          attemptedEmail: email,
          reason: 'Email already exists'
        }
      });

      return res.status(400).json({
        success: false,
        error: 'User already exists with this email'
      });
    }

    // Create user
    const user = await User.create({
      firstName,
      lastName,
      email,
      password,
      role
    });

    // Generate JWT token
    const token = user.generateAuthToken();

    // Log successful registration - handle audit log creation safely
    try {
      // Ensure user._id is properly converted to ObjectId
      const userId = user._id;
      if (userId) {
        await AuditLog.create({
          user: userId,
          userEmail: user.email,
          action: 'create_user',
          description: `User registered: ${user.firstName} ${user.lastName}`,
          resourceType: 'user',
          resourceId: userId.toString(),
          ipAddress: clientIP || '127.0.0.1',
          userAgent: req.get('User-Agent') || 'Unknown',
          severity: 'low',
          success: true,
          metadata: {
            role: user.role,
            registrationMethod: 'self-registration'
          }
        });
      }
    } catch (auditError) {
      // Log audit error but don't fail registration
      console.error('Audit log creation failed:', auditError.message);
      // Continue with registration success
    }

    // Reset auth attempts on successful registration
    if (req.resetAuthAttempts) {
      req.resetAuthAttempts();
    }

    res.status(201).json({
      success: true,
      data: {
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          fullName: user.fullName,
          email: user.email,
          role: user.role,
          permissions: user.permissions,
          isActive: user.isActive
        },
        token
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    throw new CustomError('Registration failed', 500);
  }
}));

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
router.post('/login', [
  body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
  body('password').notEmpty().withMessage('Password is required')
], asyncHandler(async (req, res) => {
  // Check validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }

  const { email, password } = req.body;
  const clientIP = req.ip || req.connection.remoteAddress;

  try {
    // Get user with password
    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      await AuditLog.logFailedLogin(email, clientIP, req.get('User-Agent'), 'User not found');
      
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      await AuditLog.logFailedLogin(email, clientIP, req.get('User-Agent'), 'Account deactivated');
      
      return res.status(401).json({
        success: false,
        error: 'Account has been deactivated'
      });
    }

    // Check if account is locked
    if (user.isLocked) {
      await AuditLog.logFailedLogin(email, clientIP, req.get('User-Agent'), 'Account locked');
      
      return res.status(401).json({
        success: false,
        error: 'Account is temporarily locked due to multiple failed login attempts'
      });
    }

    // Check IP whitelist
    if (!user.isIPAllowed(clientIP)) {
      await AuditLog.logSecurityEvent({
        user: user._id,
        userEmail: user.email,
        description: `Login denied from non-whitelisted IP: ${clientIP}`,
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
        error: 'Access denied from this IP address'
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);

    if (!isPasswordValid) {
      // Increment failed login attempts
      await user.incLoginAttempts();
      
      await AuditLog.logFailedLogin(email, clientIP, req.get('User-Agent'), 'Invalid password');
      
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    // Reset login attempts on successful login
    await user.resetLoginAttempts();

    // Generate JWT token
    const token = user.generateAuthToken();

    // Log successful login
    await AuditLog.logAction({
      user: user._id,
      userEmail: user.email,
      action: 'login',
      description: `User logged in: ${user.fullName}`,
      resourceType: 'user',
      resourceId: user._id.toString(),
      ipAddress: clientIP,
      userAgent: req.get('User-Agent'),
      severity: 'low',
      success: true,
      metadata: {
        loginMethod: 'password',
        previousLogin: user.lastLogin
      }
    });

    // Reset auth attempts on successful login
    if (req.resetAuthAttempts) {
      req.resetAuthAttempts();
    }

    res.status(200).json({
      success: true,
      data: {
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          fullName: user.fullName,
          email: user.email,
          role: user.role,
          permissions: user.permissions,
          isActive: user.isActive,
          lastLogin: user.lastLogin
        },
        token
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    throw new CustomError('Login failed', 500);
  }
}));

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
router.get('/me', protect, asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      user: {
        id: req.user._id,
        firstName: req.user.firstName,
        lastName: req.user.lastName,
        fullName: req.user.fullName,
        email: req.user.email,
        role: req.user.role,
        permissions: req.user.permissions,
        isActive: req.user.isActive,
        lastLogin: req.user.lastLogin,
        createdAt: req.user.createdAt
      }
    }
  });
}));

// @desc    Update user profile
// @route   PUT /api/auth/profile
// @access  Private
router.put('/profile', protect, [
  body('firstName').optional().trim().isLength({ min: 2, max: 50 }).withMessage('First name must be between 2 and 50 characters'),
  body('lastName').optional().trim().isLength({ min: 2, max: 50 }).withMessage('Last name must be between 2 and 50 characters'),
  body('email').optional().isEmail().normalizeEmail().withMessage('Please provide a valid email')
], asyncHandler(async (req, res) => {
  // Check validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }

  const { firstName, lastName, email } = req.body;
  const updates = {};
  
  if (firstName) updates.firstName = firstName;
  if (lastName) updates.lastName = lastName;
  if (email && email !== req.user.email) {
    // Check if email is already taken
    const existingUser = await User.findOne({ email, _id: { $ne: req.user._id } });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'Email is already taken'
      });
    }
    updates.email = email;
  }

  const user = await User.findByIdAndUpdate(req.user._id, updates, {
    new: true,
    runValidators: true
  });

  // Log profile update
  await AuditLog.logAction({
    user: user._id,
    userEmail: user.email,
    action: 'update_user',
    description: `Profile updated: ${user.fullName}`,
    resourceType: 'user',
    resourceId: user._id.toString(),
    ipAddress: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    severity: 'low',
    success: true,
    metadata: {
      updatedFields: Object.keys(updates),
      previousValues: {
        firstName: req.user.firstName,
        lastName: req.user.lastName,
        email: req.user.email
      },
      newValues: updates
    }
  });

  res.status(200).json({
    success: true,
    data: {
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        permissions: user.permissions,
        isActive: user.isActive,
        lastLogin: user.lastLogin
      }
    }
  });
}));

// @desc    Change password
// @route   PUT /api/auth/password
// @access  Private
router.put('/password', protect, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('New password must contain at least one uppercase letter, one lowercase letter, one number, and one special character')
], asyncHandler(async (req, res) => {
  // Check validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }

  const { currentPassword, newPassword } = req.body;

  // Get user with password
  const user = await User.findById(req.user._id).select('+password');

  // Check current password
  const isCurrentPasswordValid = await user.comparePassword(currentPassword);
  if (!isCurrentPasswordValid) {
    await AuditLog.logSecurityEvent({
      user: user._id,
      userEmail: user.email,
      description: 'Failed password change attempt - incorrect current password',
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      severity: 'medium',
      success: false
    });

    return res.status(400).json({
      success: false,
      error: 'Current password is incorrect'
    });
  }

  // Update password
  user.password = newPassword;
  await user.save();

  // Log password change
  await AuditLog.logAction({
    user: user._id,
    userEmail: user.email,
    action: 'password_change',
    description: 'Password changed successfully',
    resourceType: 'user',
    resourceId: user._id.toString(),
    ipAddress: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    severity: 'medium',
    success: true
  });

  res.status(200).json({
    success: true,
    message: 'Password changed successfully'
  });
}));

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
router.post('/logout', protect, asyncHandler(async (req, res) => {
  // Log logout
  await AuditLog.logAction({
    user: req.user._id,
    userEmail: req.user.email,
    action: 'logout',
    description: `User logged out: ${req.user.fullName}`,
    resourceType: 'user',
    resourceId: req.user._id.toString(),
    ipAddress: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    severity: 'low',
    success: true
  });

  res.status(200).json({
    success: true,
    message: 'Logged out successfully'
  });
}));

module.exports = router;
