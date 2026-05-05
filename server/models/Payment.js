const mongoose = require('mongoose');
const CryptoJS = require('crypto-js');

const paymentSchema = new mongoose.Schema({
  // Original upload data
  uploadBatch: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UploadBatch',
    required: true,
    index: true
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  rowNumber: {
    type: Number,
    required: true
  },
  
  // Encrypted sensitive data
  phoneNumber: {
    type: String,
    required: [true, 'Phone number is required'],
    validate: {
      validator: function(phone) {
        // Allow both plaintext and encrypted input; validate after decryption if applicable
        const candidate = this.isEncrypted(phone) ? this.decryptField(phone) : phone;
        return /^254[0-9]{9}$/.test(candidate);
      },
      message: 'Phone number must be in format 254XXXXXXXXX'
    }
  },
  amount: {
    type: String, // Encrypted or plaintext before save
    required: [true, 'Amount is required'],
    validate: {
      validator: function(amount) {
        const candidateStr = this.isEncrypted(amount) ? this.decryptField(amount) : amount;
        const decrypted = parseFloat(candidateStr);
        return Number.isFinite(decrypted) && decrypted >= 1 && decrypted <= 150000; // MPESA limits
      },
      message: 'Amount must be between 1 and 150,000 KES'
    }
  },
  
  // Non-sensitive data (not encrypted)
  internalReference: {
    type: String,
    required: [true, 'Internal reference is required'],
    trim: true,
    maxlength: [100, 'Internal reference cannot exceed 100 characters'],
    index: true
  },
  description: {
    type: String,
    trim: true,
    maxlength: [200, 'Description cannot exceed 200 characters'],
    default: ''
  },
  
  // Processing status
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled', 'partial'],
    default: 'pending',
    index: true
  },
  
  // MPESA transaction data
  mpesaTransactionId: {
    type: String,
    index: true,
    sparse: true // Allow null values but index non-null ones
  },
  mpesaReceiptNumber: {
    type: String,
    index: true,
    sparse: true
  },
  mpesaResponseCode: {
    type: String
  },
  mpesaResponseDescription: {
    type: String
  },
  mpesaConversationId: {
    type: String,
    index: true,
    sparse: true
  },
  mpesaOriginatorConversationId: {
    type: String
  },
  
  // Processing timestamps
  processedAt: {
    type: Date,
    index: true
  },
  completedAt: {
    type: Date,
    index: true
  },
  
  // Error handling
  errorMessage: {
    type: String
  },
  retryCount: {
    type: Number,
    default: 0,
    max: 3
  },
  lastRetryAt: {
    type: Date
  },
  
  // Audit trail
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Additional metadata
  metadata: {
    ipAddress: String,
    userAgent: String,
    processingTime: Number // in milliseconds
  }
}, {
  timestamps: true,
  toJSON: { 
    virtuals: true,
    transform: function(doc, ret) {
      // Decrypt sensitive fields when converting to JSON
      if (ret.phoneNumber) {
        ret.phoneNumber = doc.decryptField(ret.phoneNumber);
      }
      if (ret.amount) {
        ret.amount = parseFloat(doc.decryptField(ret.amount));
      }
      return ret;
    }
  },
  toObject: { 
    virtuals: true,
    transform: function(doc, ret) {
      // Decrypt sensitive fields when converting to Object
      if (ret.phoneNumber) {
        ret.phoneNumber = doc.decryptField(ret.phoneNumber);
      }
      if (ret.amount) {
        ret.amount = parseFloat(doc.decryptField(ret.amount));
      }
      return ret;
    }
  }
});

// Compound indexes for better query performance
paymentSchema.index({ uploadBatch: 1, status: 1 });
paymentSchema.index({ uploadedBy: 1, createdAt: -1 });
paymentSchema.index({ status: 1, createdAt: -1 });
paymentSchema.index({ mpesaTransactionId: 1, status: 1 });
paymentSchema.index({ internalReference: 1, uploadBatch: 1 });

// Virtual for decrypted phone number (read-only)
paymentSchema.virtual('phoneNumberDecrypted').get(function () {
  const value = this.phoneNumber;

  // If not encrypted, return as-is
  if (!this.isEncrypted(value)) {
    return value;
  }

  const decrypted = this.decryptField(value);

  // If decryption fails, fallback safely
  if (!decrypted) {
    return null;
  }

  return decrypted;
});

// Virtual for decrypted amount (read-only)
paymentSchema.virtual('amountDecrypted').get(function () {
  const value = this.amount;

  // If not encrypted, use directly
  if (!this.isEncrypted(value)) {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? num : null;
  }

  const decrypted = this.decryptField(value);

  // Reject empty or invalid
  if (!decrypted || decrypted.trim() === '') {
    return null;
  }

  const num = Number(decrypted);

  if (!Number.isFinite(num) || num <= 0) {
    return null;
  }

  return num;
});

// Virtual for processing duration
paymentSchema.virtual('processingDuration').get(function() {
  if (this.processedAt && this.completedAt) {
    return this.completedAt.getTime() - this.processedAt.getTime();
  }
  return null;
});

// Virtual for status display
paymentSchema.virtual('statusDisplay').get(function() {
  const statusMap = {
    'pending': 'Pending',
    'processing': 'Processing',
    'completed': 'Completed',
    'failed': 'Failed',
    'cancelled': 'Cancelled'
  };
  return statusMap[this.status] || this.status;
});

// Pre-save middleware to encrypt sensitive data
paymentSchema.pre('save', function(next) {
  try {
    // Encrypt phone number if modified
    if (this.isModified('phoneNumber') && !this.isEncrypted(this.phoneNumber)) {
      this.phoneNumber = this.encryptField(this.phoneNumber);
    }
    
    // Encrypt amount if modified
    if (this.isModified('amount') && !this.isEncrypted(this.amount)) {
      this.amount = this.encryptField(this.amount.toString());
    }
    
    next();
  } catch (error) {
    next(error);
  }
});

// Method to encrypt field
paymentSchema.methods.encryptField = function(text) {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('Encryption key not configured');
  }
  return CryptoJS.AES.encrypt(text, key).toString();
};

// Method to decrypt field
paymentSchema.methods.decryptField = function(encryptedText) {
  try {
    const key = process.env.ENCRYPTION_KEY;
    if (!key) {
      throw new Error('Encryption key not configured');
    }
    const bytes = CryptoJS.AES.decrypt(encryptedText, key);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (error) {
    console.error('Decryption error:', error);
    return encryptedText; // Return original if decryption fails
  }
};

// Method to check if field is encrypted
paymentSchema.methods.isEncrypted = function(text) {
  return typeof text === 'string' && text.startsWith('U2FsdGVkX1');
};

// Method to update status with timestamp
paymentSchema.methods.updateStatus = function(newStatus, additionalData = {}) {
  this.status = newStatus;
  
  if (newStatus === 'processing') {
    this.processedAt = new Date();
  } else if (newStatus === 'completed' || newStatus === 'failed') {
    this.completedAt = new Date();
  }
  
  // Update additional fields
  Object.assign(this, additionalData);
  
  return this.save();
};

// Method to increment retry count
paymentSchema.methods.incrementRetry = function() {
  this.retryCount += 1;
  this.lastRetryAt = new Date();
  return this.save();
};

// Method to check if payment can be retried
paymentSchema.methods.canRetry = function() {
  return this.retryCount < 3 && this.status === 'failed';
};

// Static method to get payments by status
paymentSchema.statics.getByStatus = function(status, limit = 100) {
  return this.find({ status })
    .populate('uploadedBy', 'firstName lastName email')
    .populate('processedBy', 'firstName lastName email')
    .sort({ createdAt: -1 })
    .limit(limit);
};

// Static method to get payments for processing
paymentSchema.statics.getPendingPayments = function(limit = 50) {
  return this.find({ 
    status: 'pending',
    retryCount: { $lt: 3 }
  })
  .populate('uploadBatch')
  .sort({ createdAt: 1 }) // FIFO processing
  .limit(limit);
};

// Static method to get payment statistics
paymentSchema.statics.getStats = function(uploadBatch = null) {
  const match = uploadBatch ? { uploadBatch } : {};
  
  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalAmount: { 
          $sum: { 
            $toDouble: '$amount' // This won't work with encrypted data, needs special handling
          }
        }
      }
    }
  ]);
};

module.exports = mongoose.model('Payment', paymentSchema);
