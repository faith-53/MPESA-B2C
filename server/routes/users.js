const express = require('express');
const { body, query, validationResult } = require('express-validator');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { protect, adminOnly, authorize } = require('../middleware/auth');
const { asyncHandler, CustomError } = require('../middleware/errorHandler');

const router = express.Router();

// @desc    Get all users
// @route   GET /api/users
// @access  Private (Admin only)
router.get('/', protect, adminOnly, [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('role').optional().isIn(['admin', 'finance_officer', 'user']).withMessage('Invalid role'),
  query('isActive').optional().isBoolean().withMessage('isActive must be boolean'),
  query('search').optional().isString().withMessage('Search must be a string')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }

  const {
    page = 1,
    limit = 20,
    role,
    isActive,
    search
  } = req.query;

  // Build query
  const query = {};
  
  if (role) {
    query.role = role;
  }
  
  if (isActive !== undefined) {
    query.isActive = isActive === 'true';
  }
  
  if (search) {
    query.$or = [
      { firstName: { $regex: search, $options: 'i' } },
      { lastName: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } }
    ];
  }

  const options = {
    page: parseInt(page),
    limit: parseInt(limit),
    sort: { createdAt: -1 },
    select: '-password -passwordResetToken -passwordResetExpires'
  };

  const result = await User.paginate(query, options);

  res.status(200).json({
    success: true,
    data: {
      users: result.docs,
      pagination: {
        page: result.page,
        pages: result.totalPages,
        limit: result.limit,
        total: result.totalDocs
      }
    }
  });
}));

// @desc    Get user by ID
// @route   GET /api/users/:id
// @access  Private (Admin only)
router.get('/:id', protect, adminOnly, asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('-password -passwordResetToken -passwordResetExpires');

  if (!user) {
    throw new CustomError('User not found', 404);
  }

  // Get user activity
  const recentActivity = await AuditLog.getUserActivity(user._id, 10, 7);

  res.status(200).json({
    success: true,
    data: {
      user,
      recentActivity
    }
  });
}));

// @desc    Create new user
// @route   POST /api/users
// @access  Private (Admin only)
router.post('/', protect, adminOnly, [
  body('firstName').trim().isLength({ min: 2, max: 50 }).withMessage('First name must be between 2 and 50 characters'),
  body('lastName').trim().isLength({ min: 2, max: 50 }).withMessage('Last name must be between 2 and 50 characters'),
  body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
  body('role').isIn(['admin', 'finance_officer', 'user']).withMessage('Invalid role'),
  body('permissions').optional().isObject().withMessage('Permissions must be an object'),
  body('ipWhitelist').optional().isArray().withMessage('IP whitelist must be an array')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }

  const { firstName, lastName, email, password, role, permissions, ipWhitelist } = req.body;

  // Check if user already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new CustomError('User already exists with this email', 400);
  }

  // Create user
  const userData = {
    firstName,
    lastName,
    email,
    password,
    role
  };

  // Set permissions based on role
  if (role === 'admin') {
    userData.permissions = {
      canUpload: true,
      canProcess: true,
      canViewReports: true,
      canManageUsers: true
    };
  } else if (role === 'finance_officer') {
    userData.permissions = {
      canUpload: true,
      canProcess: true,
      canViewReports: true,
      canManageUsers: false
    };
  } else {
    userData.permissions = {
      canUpload: true,
      canProcess: false,
      canViewReports: true,
      canManageUsers: false
    };
  }

  // Override with custom permissions if provided
  if (permissions) {
    userData.permissions = { ...userData.permissions, ...permissions };
  }

  if (ipWhitelist) {
    userData.ipWhitelist = ipWhitelist;
  }

  const user = await User.create(userData);

  // Log user creation
  await AuditLog.logAction({
    user: req.user._id,
    userEmail: req.user.email,
    action: 'create_user',
    description: `User created: ${user.fullName} (${user.email})`,
    resourceType: 'user',
    resourceId: user._id.toString(),
    ipAddress: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    success: true,
    severity: 'medium',
    metadata: {
      createdUserEmail: user.email,
      createdUserRole: user.role,
      permissions: user.permissions
    }
  });

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
        isActive: user.isActive,
        createdAt: user.createdAt
      }
    }
  });
}));

// @desc    Update user
// @route   PUT /api/users/:id
// @access  Private (Admin only)
router.put('/:id', protect, adminOnly, [
  body('firstName').optional().trim().isLength({ min: 2, max: 50 }).withMessage('First name must be between 2 and 50 characters'),
  body('lastName').optional().trim().isLength({ min: 2, max: 50 }).withMessage('Last name must be between 2 and 50 characters'),
  body('email').optional().isEmail().normalizeEmail().withMessage('Please provide a valid email'),
  body('role').optional().isIn(['admin', 'finance_officer', 'user']).withMessage('Invalid role'),
  body('isActive').optional().isBoolean().withMessage('isActive must be boolean'),
  body('permissions').optional().isObject().withMessage('Permissions must be an object'),
  body('ipWhitelist').optional().isArray().withMessage('IP whitelist must be an array')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }

  const user = await User.findById(req.params.id);

  if (!user) {
    throw new CustomError('User not found', 404);
  }

  // Prevent admin from deactivating themselves
  if (req.user._id.toString() === user._id.toString() && req.body.isActive === false) {
    throw new CustomError('You cannot deactivate your own account', 400);
  }

  // Store previous values for audit log
  const previousValues = {
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    permissions: user.permissions,
    ipWhitelist: user.ipWhitelist
  };

  const { firstName, lastName, email, role, isActive, permissions, ipWhitelist } = req.body;

  // Check if email is already taken by another user
  if (email && email !== user.email) {
    const existingUser = await User.findOne({ email, _id: { $ne: user._id } });
    if (existingUser) {
      throw new CustomError('Email is already taken by another user', 400);
    }
  }

  // Update fields
  const updates = {};
  if (firstName !== undefined) updates.firstName = firstName;
  if (lastName !== undefined) updates.lastName = lastName;
  if (email !== undefined) updates.email = email;
  if (role !== undefined) updates.role = role;
  if (isActive !== undefined) updates.isActive = isActive;
  if (permissions !== undefined) updates.permissions = { ...user.permissions, ...permissions };
  if (ipWhitelist !== undefined) updates.ipWhitelist = ipWhitelist;

  const updatedUser = await User.findByIdAndUpdate(user._id, updates, {
    new: true,
    runValidators: true
  }).select('-password -passwordResetToken -passwordResetExpires');

  // Log user update
  await AuditLog.logAction({
    user: req.user._id,
    userEmail: req.user.email,
    action: 'update_user',
    description: `User updated: ${updatedUser.fullName} (${updatedUser.email})`,
    resourceType: 'user',
    resourceId: updatedUser._id.toString(),
    ipAddress: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    success: true,
    severity: 'medium',
    metadata: {
      updatedUserEmail: updatedUser.email,
      updatedFields: Object.keys(updates),
      previousValues,
      newValues: updates
    }
  });

  res.status(200).json({
    success: true,
    data: { user: updatedUser }
  });
}));

// @desc    Delete user
// @route   DELETE /api/users/:id
// @access  Private (Admin only)
router.delete('/:id', protect, adminOnly, asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    throw new CustomError('User not found', 404);
  }

  // Prevent admin from deleting themselves
  if (req.user._id.toString() === user._id.toString()) {
    throw new CustomError('You cannot delete your own account', 400);
  }

  // Check if user has any uploaded batches
  const UploadBatch = require('../models/UploadBatch');
  const userBatches = await UploadBatch.countDocuments({ uploadedBy: user._id });
  
  if (userBatches > 0) {
    throw new CustomError('Cannot delete user with existing upload batches. Deactivate instead.', 400);
  }

  await User.findByIdAndDelete(user._id);

  // Log user deletion
  await AuditLog.logAction({
    user: req.user._id,
    userEmail: req.user.email,
    action: 'delete_user',
    description: `User deleted: ${user.fullName} (${user.email})`,
    resourceType: 'user',
    resourceId: user._id.toString(),
    ipAddress: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    success: true,
    severity: 'high',
    metadata: {
      deletedUserEmail: user.email,
      deletedUserRole: user.role
    }
  });

  res.status(200).json({
    success: true,
    message: 'User deleted successfully'
  });
}));

// @desc    Reset user password
// @route   POST /api/users/:id/reset-password
// @access  Private (Admin only)
router.post('/:id/reset-password', protect, adminOnly, [
  body('newPassword').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }

  const user = await User.findById(req.params.id);

  if (!user) {
    throw new CustomError('User not found', 404);
  }

  const { newPassword } = req.body;

  // Update password
  user.password = newPassword;
  await user.save();

  // Log password reset
  await AuditLog.logAction({
    user: req.user._id,
    userEmail: req.user.email,
    action: 'password_change',
    description: `Password reset for user: ${user.fullName} (${user.email})`,
    resourceType: 'user',
    resourceId: user._id.toString(),
    ipAddress: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    success: true,
    severity: 'high',
    metadata: {
      targetUserEmail: user.email,
      resetByAdmin: true
    }
  });

  res.status(200).json({
    success: true,
    message: 'Password reset successfully'
  });
}));

// @desc    Get user statistics
// @route   GET /api/users/stats
// @access  Private (Admin only)
router.get('/stats/overview', protect, adminOnly, asyncHandler(async (req, res) => {
  const { days = 30 } = req.query;
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - parseInt(days));

  // Get user statistics
  const totalUsers = await User.countDocuments();
  const activeUsers = await User.countDocuments({ isActive: true });
  const newUsers = await User.countDocuments({ createdAt: { $gte: startDate } });

  // Get role breakdown
  const roleStats = await User.aggregate([
    {
      $group: {
        _id: '$role',
        count: { $sum: 1 },
        active: { $sum: { $cond: ['$isActive', 1, 0] } }
      }
    }
  ]);

  // Get recent activity statistics
  const activityStats = await AuditLog.getActivityStats(parseInt(days));

  res.status(200).json({
    success: true,
    data: {
      overview: {
        totalUsers,
        activeUsers,
        inactiveUsers: totalUsers - activeUsers,
        newUsers,
        period: `${days} days`
      },
      roleBreakdown: roleStats,
      recentActivity: activityStats
    }
  });
}));

// @desc    Get security events
// @route   GET /api/users/security/events
// @access  Private (Admin only)
router.get('/security/events', protect, adminOnly, [
  query('days').optional().isInt({ min: 1, max: 30 }).withMessage('Days must be between 1 and 30'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }

  const { days = 7, limit = 50 } = req.query;

  const securityEvents = await AuditLog.getSecurityEvents(parseInt(limit), parseInt(days));

  res.status(200).json({
    success: true,
    data: {
      events: securityEvents,
      period: `${days} days`
    }
  });
}));

module.exports = router;
