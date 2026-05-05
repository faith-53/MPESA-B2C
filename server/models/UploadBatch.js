const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');

const uploadBatchSchema = new mongoose.Schema({ 
  batchId: {
  type: String,
  required: true,
  unique: true,
  default: function () {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
    const randomStr = Math.random().toString(36).substr(2, 5).toUpperCase();
    return `BATCH_${dateStr}_${timeStr}_${randomStr}`;
  }
},
  // Upload details
  originalFileName: {
    type: String,
    required: [true, 'Original file name is required'],
    trim: true
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // File processing status
  status: {
    type: String,
    enum: ['uploading', 'validating', 'validated', 'processing', 'completed', 'failed', 'partial', 'cancelled'],
    default: 'uploading',
    index: true
  },
  
  // File statistics
  totalRows: {
    type: Number,
    required: true,
    min: [1, 'File must contain at least 1 payment row']
  },
  validRows: {
    type: Number,
    default: 0
  },
  invalidRows: {
    type: Number,
    default: 0
  },
  processedRows: {
    type: Number,
    default: 0
  },
  successfulRows: {
    type: Number,
    default: 0
  },
  failedRows: {
    type: Number,
    default: 0
  },
  
  // Financial summary
  totalAmount: {
    type: Number,
    required: true,
    min: [0, 'Total amount cannot be negative']
  },
  processedAmount: {
    type: Number,
    default: 0
  },
  successfulAmount: {
    type: Number,
    default: 0
  },
  
  // Validation results
  validationErrors: [{
    row: {
      type: Number,
      required: true
    },
    field: {
      type: String,
      required: true
    },
    error: {
      type: String,
      required: true
    },
    value: {
      type: String
    }
  }],
  
  // Processing timestamps
  uploadStartedAt: {
    type: Date,
    default: Date.now
  },
  uploadCompletedAt: {
    type: Date
  },
  validationStartedAt: {
    type: Date
  },
  validationCompletedAt: {
    type: Date
  },
  processingStartedAt: {
    type: Date
  },
  processingCompletedAt: {
    type: Date
  },
  
  // File metadata
  fileSize: {
    type: Number,
    required: true
  },
  fileHash: {
    type: String,
    required: true,
    index: true // To detect duplicate uploads
  },
  
  // Processing configuration
  processingOptions: {
    batchSize: {
      type: Number,
      default: 10,
      min: 1,
      max: 100
    },
    delayBetweenBatches: {
      type: Number,
      default: 1000, // milliseconds
      min: 0
    },
    maxRetries: {
      type: Number,
      default: 3,
      min: 0,
      max: 5
    }
  },
  
  // Error handling
  errorMessage: {
    type: String
  },
  
  // Audit trail
  metadata: {
    ipAddress: String,
    userAgent: String,
    uploadDuration: Number, // in milliseconds
    processingDuration: Number, // in milliseconds
    fileColumns: [String], // Column headers from Excel file
    duplicateReferences: [String] // Internal references that were duplicated
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
uploadBatchSchema.index({ uploadedBy: 1, createdAt: -1 });
uploadBatchSchema.index({ status: 1, createdAt: -1 });
uploadBatchSchema.index({ batchId: 1, uploadedBy: 1 });

uploadBatchSchema.path('batchId').validate(function(value) {
  return value && value.startsWith('BATCH_');
}, 'Invalid batchId format');

// Virtual for completion percentage
uploadBatchSchema.virtual('completionPercentage').get(function() {
  if (this.totalRows === 0) return 0;
  return Math.round((this.processedRows / this.totalRows) * 100);
});

// Virtual for success rate
uploadBatchSchema.virtual('successRate').get(function() {
  if (this.processedRows === 0) return 0;
  return Math.round((this.successfulRows / this.processedRows) * 100);
});

// Virtual for validation rate
uploadBatchSchema.virtual('validationRate').get(function() {
  if (this.totalRows === 0) return 0;
  return Math.round((this.validRows / this.totalRows) * 100);
});

// Virtual for status display
uploadBatchSchema.virtual('statusDisplay').get(function() {
  const statusMap = {
    'uploading': 'Uploading',
    'validating': 'Validating',
    'validated': 'Validated',
    'processing': 'Processing',
    'completed': 'Completed',
    'failed': 'Failed',
    'cancelled': 'Cancelled'
  };
  return statusMap[this.status] || this.status;
});

// Virtual for total processing time
uploadBatchSchema.virtual('totalProcessingTime').get(function() {
  if (this.uploadStartedAt && this.processingCompletedAt) {
    return this.processingCompletedAt.getTime() - this.uploadStartedAt.getTime();
  }
  return null;
});

// Pre-save middleware to generate batch ID
uploadBatchSchema.pre('save', function(next) {
  if (this.isNew && !this.batchId) {
    // Generate batch ID: BATCH_YYYYMMDD_HHMMSS_XXXXX
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
    const randomStr = Math.random().toString(36).substr(2, 5).toUpperCase();
    this.batchId = `BATCH_${dateStr}_${timeStr}_${randomStr}`;
  }
  next();
});

// Method to update status with timestamp
uploadBatchSchema.methods.updateStatus = function(newStatus, additionalData = {}) {
  const oldStatus = this.status;
  this.status = newStatus;
  
  // Update appropriate timestamp based on status
  const now = new Date();
  switch (newStatus) {
    case 'validating':
      this.uploadCompletedAt = now;
      this.validationStartedAt = now;
      break;
    case 'validated':
      this.validationCompletedAt = now;
      break;
    case 'processing':
      this.processingStartedAt = now;
      break;
    case 'completed':
    case 'failed':
    case 'cancelled':
      this.processingCompletedAt = now;
      break;
  }
  
  // Calculate durations
  if (this.uploadCompletedAt && this.uploadStartedAt) {
    this.metadata.uploadDuration = this.uploadCompletedAt.getTime() - this.uploadStartedAt.getTime();
  }
  
  if (this.processingCompletedAt && this.processingStartedAt) {
    this.metadata.processingDuration = this.processingCompletedAt.getTime() - this.processingStartedAt.getTime();
  }
  
  // Update additional fields
  Object.assign(this, additionalData);
  
  return this.save();
};

// Method to add validation error
uploadBatchSchema.methods.addValidationError = function(row, field, error, value = null) {
  this.validationErrors.push({
    row,
    field,
    error,
    value: value ? value.toString().substring(0, 100) : null // Limit length
  });
  
  // Update invalid rows count
  this.invalidRows = this.validationErrors.length;
  this.validRows = this.totalRows - this.invalidRows;
  
  return this;
};

// Method to update processing statistics
uploadBatchSchema.methods.updateProcessingStats = function(processed, successful, failed, processedAmount, successfulAmount) {
  this.processedRows = processed;
  this.successfulRows = successful;
  this.failedRows = failed;
  this.processedAmount = processedAmount;
  this.successfulAmount = successfulAmount;
  
  return this.save();
};

// Method to check if batch can be processed
uploadBatchSchema.methods.canProcess = function() {
  return ['validated', 'failed'].includes(this.status) && this.validRows > 0;
};

// Method to check if batch is complete
uploadBatchSchema.methods.isComplete = function() {
  return ['completed', 'failed', 'cancelled'].includes(this.status);
};

// Method to get summary
uploadBatchSchema.methods.getSummary = function() {
  return {
    batchId: this.batchId,
    originalFileName: this.originalFileName,
    status: this.status,
    statusDisplay: this.statusDisplay,
    totalRows: this.totalRows,
    validRows: this.validRows,
    invalidRows: this.invalidRows,
    processedRows: this.processedRows,
    successfulRows: this.successfulRows,
    failedRows: this.failedRows,
    totalAmount: this.totalAmount,
    processedAmount: this.processedAmount,
    successfulAmount: this.successfulAmount,
    completionPercentage: this.completionPercentage,
    successRate: this.successRate,
    validationRate: this.validationRate,
    createdAt: this.createdAt,
    uploadCompletedAt: this.uploadCompletedAt,
    processingCompletedAt: this.processingCompletedAt,
    totalProcessingTime: this.totalProcessingTime
  };
};

// Static method to get batches by user
uploadBatchSchema.statics.getByUser = function(userId, limit = 50, status = null) {
  const query = { uploadedBy: userId };
  if (status) {
    query.status = status;
  }
  
  return this.find(query)
    .populate('uploadedBy', 'firstName lastName email')
    .sort({ createdAt: -1 })
    .limit(limit);
};

// Static method to get processing statistics
uploadBatchSchema.statics.getProcessingStats = function(days = 30) {
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
        _id: '$status',
        count: { $sum: 1 },
        totalRows: { $sum: '$totalRows' },
        totalAmount: { $sum: '$totalAmount' },
        successfulRows: { $sum: '$successfulRows' },
        successfulAmount: { $sum: '$successfulAmount' }
      }
    }
  ]);
};

// Static method to get daily statistics
uploadBatchSchema.statics.getDailyStats = function(days = 30) {
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
        batches: { $sum: 1 },
        totalRows: { $sum: '$totalRows' },
        totalAmount: { $sum: '$totalAmount' },
        successfulRows: { $sum: '$successfulRows' },
        successfulAmount: { $sum: '$successfulAmount' }
      }
    },
    {
      $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 }
    }
  ]);
};

// Enable pagination plugin
uploadBatchSchema.plugin(mongoosePaginate);

module.exports = mongoose.model('UploadBatch', uploadBatchSchema);
