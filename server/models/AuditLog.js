const mongoose = require('mongoose');
const validator = require('validator');

const auditLogSchema = new mongoose.Schema({
  // Who performed the action
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
    index: true
  },
  userEmail: {
    type: String,
    required: true
  },
  
  // What action was performed
  action: {
    type: String,
    required: [true, 'Action is required'],
    enum: [
      'login',
      'logout',
      'failed_login',
      'password_change',
      'upload_file',
      'validate_batch',
      'process_payments',
      'cancel_batch',
      'export_report',
      'create_user',
      'update_user',
      'delete_user',
      'update_permissions',
      'system_config_change',
      'api_call',
      'data_access',
      'security_event',
      'fetch_batches'
    ],
    index: true
  },
  
  // Action details
  description: {
    type: String,
    required: [true, 'Description is required'],
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  
  // What resource was affected
  resourceType: {
    type: String,
    enum: ['user', 'payment', 'batch', 'report', 'system', 'api', 'file'],
    index: true
  },
  resourceId: {
    type: String,
    index: true
  },
  
  // Request/Session information
  ipAddress: {
  type: String,
  required: true,
  validate: {
    validator: function(ip) {
      return validator.isIP(ip);
    },
    message: 'Invalid IP address format'
  }
},
source: {
  type: String,
  enum: ['user', 'system'],
  default: 'user'
},
  userAgent: {
    type: String,
    maxlength: [500, 'User agent cannot exceed 500 characters']
  },
  sessionId: {
    type: String,
    index: true
  },
  
  // Request details for API calls
  requestMethod: {
    type: String,
    enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
  },
  requestUrl: {
    type: String,
    maxlength: [200, 'Request URL cannot exceed 200 characters']
  },
  responseStatus: {
    type: Number,
    min: 100,
    max: 599
  },
  
  // Additional metadata
  metadata: {
    // Previous values for update operations
    previousValues: mongoose.Schema.Types.Mixed,
    
    // New values for update operations
    newValues: mongoose.Schema.Types.Mixed,
    
    // File information for upload operations
    fileName: String,
    fileSize: Number,
    
    // Batch information for payment operations
    batchId: String,
    paymentCount: Number,
    totalAmount: Number,
    
    // Error information
    errorMessage: String,
    errorCode: String,
    
    // Processing time
    processingTime: Number, // in milliseconds
    
    // Additional context
    context: mongoose.Schema.Types.Mixed
  },
  
  // Security classification
  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'low',
    index: true
  },
  
  // Success/failure status
  success: {
    type: Boolean,
    required: true,
    default: true,
    index: true
  },
  
  // Retention information
  retentionDate: {
    type: Date,
    index: { expireAfterSeconds: 0 } // TTL index for automatic cleanup
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound indexes for common queries
auditLogSchema.index({ user: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ resourceType: 1, resourceId: 1, createdAt: -1 });
auditLogSchema.index({ ipAddress: 1, createdAt: -1 });
auditLogSchema.index({ severity: 1, success: 1, createdAt: -1 });

// Virtual for formatted timestamp
auditLogSchema.virtual('formattedTimestamp').get(function() {
  return this.createdAt.toISOString();
});

// Virtual for action display name
auditLogSchema.virtual('actionDisplay').get(function() {
  const actionMap = {
    'login': 'User Login',
    'logout': 'User Logout',
    'failed_login': 'Failed Login Attempt',
    'password_change': 'Password Changed',
    'upload_file': 'File Uploaded',
    'validate_batch': 'Batch Validated',
    'process_payments': 'Payments Processed',
    'cancel_batch': 'Batch Cancelled',
    'export_report': 'Report Exported',
    'create_user': 'User Created',
    'update_user': 'User Updated',
    'delete_user': 'User Deleted',
    'update_permissions': 'Permissions Updated',
    'system_config_change': 'System Configuration Changed',
    'api_call': 'API Call',
    'data_access': 'Data Accessed',
    'security_event': 'Security Event',
    'fetch_batches': 'Fetch Upload Batches'
  };
  return actionMap[this.action] || this.action;
});

// Pre-save middleware to set retention date
auditLogSchema.pre('save', function(next) {
  if (this.isNew && !this.retentionDate) {
    // Set retention period based on severity
    const retentionDays = {
      'low': 90,      // 3 months
      'medium': 180,  // 6 months
      'high': 365,    // 1 year
      'critical': 2555 // 7 years
    };
    
    const days = retentionDays[this.severity] || 90;
    this.retentionDate = new Date(Date.now() + (days * 24 * 60 * 60 * 1000));
  }
  next();
});

// Static method to log user action
auditLogSchema.statics.logAction = function(actionData) {
  const {
    user,
    userEmail,
    action,
    description,
    resourceType,
    resourceId,
    ipAddress,
    userAgent,
    sessionId,
    requestMethod,
    requestUrl,
    responseStatus,
    metadata = {},
    severity = 'low',
    success = true
  } = actionData;

  return this.create({
    user,
    userEmail,
    action,
    description,
    resourceType,
    resourceId,
    ipAddress,
    userAgent,
    sessionId,
    requestMethod,
    requestUrl,
    responseStatus,
    metadata,
    severity,
    success
  });
};

// Static method to log security event
auditLogSchema.statics.logSecurityEvent = function(eventData) {
  return this.logAction({
    ...eventData,
    action: 'security_event',
    severity: eventData.severity || 'high'
  });
};

// Static method to log failed login
auditLogSchema.statics.logFailedLogin = function(email, ipAddress, userAgent, reason) {
  return this.create({
    user: null, // No user ID for failed logins
    userEmail: email,
    action: 'failed_login',
    description: `Failed login attempt: ${reason}`,
    resourceType: 'user',
    ipAddress,
    userAgent,
    severity: 'medium',
    success: false,
    metadata: {
      reason,
      attemptedEmail: email
    }
  });
};

// Static method to get user activity
auditLogSchema.statics.getUserActivity = function(userId, limit = 50, days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  return this.find({
    user: userId,
    createdAt: { $gte: startDate }
  })
  .populate('user', 'firstName lastName email')
  .sort({ createdAt: -1 })
  .limit(limit);
};

// Static method to get security events
auditLogSchema.statics.getSecurityEvents = function(limit = 100, days = 7) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  return this.find({
    $or: [
      { action: 'failed_login' },
      { action: 'security_event' },
      { severity: { $in: ['high', 'critical'] } }
    ],
    createdAt: { $gte: startDate }
  })
  .populate('user', 'firstName lastName email')
  .sort({ createdAt: -1 })
  .limit(limit);
};

// Static method to get activity statistics
auditLogSchema.statics.getActivityStats = function(days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  return this.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: '$action',
        count: { $sum: 1 },
        successCount: {
          $sum: { $cond: ['$success', 1, 0] }
        },
        failureCount: {
          $sum: { $cond: ['$success', 0, 1] }
        }
      }
    },
    {
      $sort: { count: -1 }
    }
  ]);
};

// Static method to get daily activity
auditLogSchema.statics.getDailyActivity = function(days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  return this.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day: { $dayOfMonth: '$createdAt' }
        },
        totalActions: { $sum: 1 },
        uniqueUsers: { $addToSet: '$user' },
        successfulActions: {
          $sum: { $cond: ['$success', 1, 0] }
        },
        failedActions: {
          $sum: { $cond: ['$success', 0, 1] }
        }
      }
    },
    {
      $addFields: {
        uniqueUserCount: { $size: '$uniqueUsers' }
      }
    },
    {
      $project: {
        uniqueUsers: 0 // Remove the array, keep only the count
      }
    },
    {
      $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 }
    }
  ]);
};

module.exports = mongoose.model('AuditLog', auditLogSchema);
