const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const UploadBatch = require('../models/UploadBatch');
const Payment = require('../models/Payment');
const AuditLog = require('../models/AuditLog');
const ExcelValidator = require('../utils/excelValidator');
const { protect, requirePermission } = require('../middleware/auth');
const { asyncHandler, CustomError, ValidationError } = require('../middleware/errorHandler');

const router = express.Router();

// Configure multer for file upload
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024, // 5MB default
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Check file type
    const allowedMimeTypes = [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    
    const allowedExtensions = ['.xls', '.xlsx'];
    const fileExtension = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf('.'));
    
    if (allowedMimeTypes.includes(file.mimetype) || allowedExtensions.includes(fileExtension)) {
      cb(null, true);
    } else {
      cb(new CustomError('Only Excel files (.xls, .xlsx) are allowed', 400), false);
    }
  }
});

  // @desc    Upload Excel file for payment processing
// @route   POST /api/upload
// @access  Private (requires canUpload permission)
router.post('/', protect, requirePermission('canUpload'), upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: 'No file uploaded',
      details: { message: 'Please select an Excel file to upload' }
    });
  }

  const startTime = Date.now();
  const clientIP = req.ip || req.connection.remoteAddress;

  try {
    // Initialize Excel validator
    const validator = new ExcelValidator();
    
    // Check for duplicate file upload (by hash)
    const fileHash = require('crypto').createHash('sha256').update(req.file.buffer).digest('hex');
    const existingBatch = await UploadBatch.findOne({ fileHash });
    
    if (existingBatch) {
      await AuditLog.logAction({
        user: req.user._id,
        userEmail: req.user.email,
        action: 'upload_file',
        description: `Duplicate file upload attempt: ${req.file.originalname}`,
        resourceType: 'file',
        ipAddress: clientIP,
        userAgent: req.get('User-Agent'),
        success: false,
        severity: 'medium',
        metadata: {
          fileName: req.file.originalname,
          fileSize: req.file.size,
          fileHash,
          duplicateOf: existingBatch.batchId,
          reason: 'File already uploaded'
        }
      });

      return res.status(400).json({
        success: false,
        error: 'This file has already been uploaded',
        details: {
          originalBatch: existingBatch.batchId,
          originalUploadDate: existingBatch.createdAt
        }
      });
    }

    // Validate Excel file
    const validationResult = await validator.validateFile(req.file.buffer, req.file.originalname);
    
    if (!validationResult.isValid) {
      await AuditLog.logAction({
        user: req.user._id,
        userEmail: req.user.email,
        action: 'upload_file',
        description: `File validation failed: ${req.file.originalname}`,
        resourceType: 'file',
        ipAddress: clientIP,
        userAgent: req.get('User-Agent'),
        success: false,
        severity: 'low',
        metadata: {
          fileName: req.file.originalname,
          fileSize: req.file.size,
          validationErrors: validationResult.errors,
          statistics: validationResult.statistics
        }
      });

      return res.status(400).json({
        success: false,
        error: 'File validation failed',
        details: {
          errors: validationResult.errors,
          warnings: validationResult.warnings,
          statistics: validationResult.statistics
        }
      });
    }

    // Create upload batch record
    const uploadBatch = new UploadBatch({
      originalFileName: req.file.originalname,
      uploadedBy: req.user._id,
      status: 'validating',
      totalRows: validationResult.statistics.totalRows,
      validRows: validationResult.statistics.validRows,
      invalidRows: validationResult.statistics.invalidRows,
      totalAmount: validationResult.statistics.totalAmount,
      fileSize: req.file.size,
      fileHash: validationResult.statistics.fileHash,
      validationErrors: validationResult.errors,
      metadata: {
        ipAddress: clientIP,
        userAgent: req.get('User-Agent'),
        uploadDuration: Date.now() - startTime,
        fileColumns: Object.keys(validationResult.data[0] || {}),
        duplicateReferences: validationResult.statistics.duplicateReferences
      }
    });

    await uploadBatch.save();

    // Create payment records for valid rows
    const paymentPromises = validationResult.data.map(rowData => {
      return new Payment({
        uploadBatch: uploadBatch._id,
        uploadedBy: req.user._id,
        rowNumber: rowData.rowNumber,
        phoneNumber: rowData.phone_number,
        amount: rowData.amount,
        internalReference: rowData.internal_reference,
        description: rowData.description || '',
        status: 'pending',
        metadata: {
          ipAddress: clientIP,
          userAgent: req.get('User-Agent')
        }
      });
    });

    const payments = await Payment.insertMany(paymentPromises);

    // Update batch status to validated
    await uploadBatch.updateStatus('validated', {
      validationCompletedAt: new Date()
    });

    // Log successful upload
    await AuditLog.logAction({
      user: req.user._id,
      userEmail: req.user.email,
      action: 'upload_file',
      description: `File uploaded successfully: ${req.file.originalname}`,
      resourceType: 'batch',
      resourceId: uploadBatch._id.toString(),
      ipAddress: clientIP,
      userAgent: req.get('User-Agent'),
      success: true,
      severity: 'low',
      metadata: {
        fileName: req.file.originalname,
        fileSize: req.file.size,
        batchId: uploadBatch.batchId,
        totalRows: validationResult.statistics.totalRows,
        validRows: validationResult.statistics.validRows,
        totalAmount: validationResult.statistics.totalAmount,
        processingTime: Date.now() - startTime
      }
    });

    res.status(201).json({
      success: true,
      message: 'File uploaded and validated successfully',
      data: {
        batch: uploadBatch.getSummary(),
        payments: payments.length,
        validation: {
          errors: validationResult.errors,
          warnings: validationResult.warnings,
          statistics: validationResult.statistics
        }
      }
    });

  } catch (error) {
    console.error('Upload error:', error);

    // Log upload failure
    await AuditLog.logAction({
      user: req.user._id,
      userEmail: req.user.email,
      action: 'upload_file',
      description: `File upload failed: ${req.file.originalname}`,
      resourceType: 'file',
      ipAddress: clientIP,
      userAgent: req.get('User-Agent'),
      success: false,
      severity: 'high',
      metadata: {
        fileName: req.file.originalname,
        fileSize: req.file.size,
        errorMessage: error.message,
        processingTime: Date.now() - startTime
      }
    });

    throw error;
  }
}));

// @desc    Get upload batches
// @route   GET /api/upload/batches
// @access  Private
router.get('/batches', protect, asyncHandler(async (req, res) => {
  try {
    const { page = 1, limit = 20, status, userId } = req.query;
    
    // Validate page and limit parameters
    let pageNum = parseInt(page);
    let limitNum = parseInt(limit);
    
    // Set defaults if parsing fails
    if (isNaN(pageNum) || pageNum < 1) pageNum = 1;
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) limitNum = 20;
    
    const query = {};
    
    // Filter by status if provided
    if (status) {
      // Validate status value
      const validStatuses = ['uploading', 'validating', 'validated', 'processing', 'completed', 'failed', 'cancelled'];
      if (validStatuses.includes(status)) {
        query.status = status;
      }
    }
    
    // Filter by user if provided (admins can see all, others see only their own)
    if (req.user && req.user.role) {
      if (req.user.role === 'admin' && userId) {
        // Validate userId format if provided
        if (mongoose.Types.ObjectId.isValid(userId)) {
          query.uploadedBy = userId;
        }
      } else if (req.user.role !== 'admin' && req.user._id) {
        query.uploadedBy = req.user._id;
      }
    } else {
      // If user object is malformed, return error
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const options = {
      page: pageNum,
      limit: limitNum,
      sort: { createdAt: -1 },
      populate: {
        path: 'uploadedBy',
        select: 'firstName lastName email'
      }
    };

    const result = await UploadBatch.paginate(query, options);

    res.status(200).json({
      success: true,
      data: {
        batches: result.docs.map(batch => batch.getSummary()),
        pagination: {
          page: result.page,
          pages: result.totalPages,
          limit: result.limit,
          total: result.totalDocs
        }
      }
    });
  } catch (error) {
    console.error('Error fetching upload batches:', error);
    
    // Log error to audit system
    if (req.user) {
      await AuditLog.logAction({
        user: req.user._id,
        userEmail: req.user.email,
        action: 'fetch_batches',
        description: 'Error fetching upload batches',
        resourceType: 'batch',
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
        success: false,
        severity: 'high',
        metadata: {
          errorMessage: error.message,
          errorStack: error.stack,
          query: req.query
        }
      }).catch(auditError => {
        console.error('Failed to log error to audit system:', auditError);
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to fetch upload batches'
    });
  }
}));

// @desc    Get specific upload batch details
// @route   GET /api/upload/batches/:batchId
// @access  Private
router.get('/batches/:batchId', protect, asyncHandler(async (req, res) => {
  const batch = await UploadBatch.findOne({ 
    batchId: req.params.batchId 
  }).populate('uploadedBy', 'firstName lastName email');

  if (!batch) {
    throw new CustomError('Upload batch not found', 404);
  }

  // Check if user can access this batch
  if (req.user.role !== 'admin' && batch.uploadedBy._id.toString() !== req.user._id.toString()) {
    throw new CustomError('Access denied to this upload batch', 403);
  }

  // Get payment details for this batch
  const payments = await Payment.find({ uploadBatch: batch._id })
    .select('rowNumber phoneNumber amount internalReference description status mpesaTransactionId errorMessage')
    .sort({ rowNumber: 1 });

  res.status(200).json({
    success: true,
    data: {
      batch: batch.getSummary(),
      payments: payments,
      validationErrors: batch.validationErrors
    }
  });
}));

// @desc    Cancel upload batch
// @route   DELETE /api/upload/batches/:batchId
// @access  Private
router.delete('/batches/:batchId', protect, asyncHandler(async (req, res) => {
  const batch = await UploadBatch.findOne({ batchId: req.params.batchId });

  if (!batch) {
    throw new CustomError('Upload batch not found', 404);
  }

  // Check if user can cancel this batch
  if (req.user.role !== 'admin' && batch.uploadedBy.toString() !== req.user._id.toString()) {
    throw new CustomError('Access denied to cancel this upload batch', 403);
  }

  // Check if batch can be cancelled
  if (batch.isComplete()) {
    throw new CustomError('Cannot cancel completed batch', 400);
  }

  // Update batch status
  await batch.updateStatus('cancelled');

  // Cancel all pending payments in this batch
  await Payment.updateMany(
    { uploadBatch: batch._id, status: 'pending' },
    { status: 'cancelled' }
  );

  // Log batch cancellation
  await AuditLog.logAction({
    user: req.user._id,
    userEmail: req.user.email,
    action: 'cancel_batch',
    description: `Upload batch cancelled: ${batch.batchId}`,
    resourceType: 'batch',
    resourceId: batch._id.toString(),
    ipAddress: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    success: true,
    severity: 'medium',
    metadata: {
      _id: batch._id,
      batchId: batch.batchId,
      originalFileName: batch.originalFileName,
      totalRows: batch.totalRows,
      validRows: batch.validRows
    }
  });

  res.status(200).json({
    success: true,
    message: 'Upload batch cancelled successfully',
    data: {
      batch: batch.getSummary()
    }
  });
}));

// @desc    Get upload statistics
// @route   GET /api/upload/stats
// @access  Private
router.get('/stats', protect, asyncHandler(async (req, res) => {
  const { days = 30 } = req.query;
  
  // Get processing statistics
  const processingStats = await UploadBatch.getProcessingStats(parseInt(days));
  
  // Get daily statistics
  const dailyStats = await UploadBatch.getDailyStats(parseInt(days));

  // Get user-specific stats if not admin
  let userStats = null;
  if (req.user.role !== 'admin') {
    const userBatches = await UploadBatch.find({
      uploadedBy: req.user._id,
      createdAt: { $gte: new Date(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000) }
    });

    userStats = {
      totalBatches: userBatches.length,
      totalRows: userBatches.reduce((sum, batch) => sum + batch.totalRows, 0),
      totalAmount: userBatches.reduce((sum, batch) => sum + batch.totalAmount, 0),
      successfulRows: userBatches.reduce((sum, batch) => sum + batch.successfulRows, 0),
      successfulAmount: userBatches.reduce((sum, batch) => sum + batch.successfulAmount, 0)
    };
  }

  res.status(200).json({
    success: true,
    data: {
      processingStats,
      dailyStats,
      userStats,
      period: `${days} days`
    }
  });
}));

// @desc    Download sample Excel template
// @route   GET /api/upload/template
// @access  Private
router.get('/template', protect, asyncHandler(async (req, res) => {
  const XLSX = require('xlsx');
  
  // Create sample data
  const sampleData = [
    {
      'Phone Number': '254712345678',
      'Amount': 1000,
      'Internal Reference': 'REF001',
      'Description': 'Sample payment description'
    },
    {
      'Phone Number': '254723456789', 
      'Amount': 2500,
      'Internal Reference': 'REF002',
      'Description': 'Another sample payment'
    }
  ];

  // Create workbook
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(sampleData);

  // Add instructions sheet
  const instructions = [
    ['MPESA B2C Bulk Payment Template Instructions'],
    [''],
    ['Required Columns:'],
    ['• Phone Number: Kenyan mobile number (254XXXXXXXXX format)'],
    ['• Amount: Payment amount in KES (1 to 150,000)'],
    ['• Internal Reference: Your unique reference (3-100 characters)'],
    [''],
    ['Optional Columns:'],
    ['• Description: Payment description (max 200 characters)'],
    [''],
    ['Important Notes:'],
    ['• Maximum 1,000 rows per file'],
    ['• Phone numbers must be valid Kenyan mobile numbers'],
    ['• Internal references must be unique within the file'],
    ['• Only .xls and .xlsx files are supported'],
    ['• File size limit: 5MB'],
    [''],
    ['Example Phone Number Formats:'],
    ['• 254712345678 (preferred)'],
    ['• 0712345678 (will be converted to 254712345678)'],
    ['• 712345678 (will be converted to 254712345678)']
  ];

  const instructionsSheet = XLSX.utils.aoa_to_sheet(instructions);

  // Add sheets to workbook
  XLSX.utils.book_append_sheet(workbook, instructionsSheet, 'Instructions');
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Payment Data');

  // Generate buffer
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  // Log template download
  await AuditLog.logAction({
    user: req.user._id,
    userEmail: req.user.email,
    action: 'export_report',
    description: 'Downloaded Excel template',
    resourceType: 'file',
    ipAddress: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    success: true,
    severity: 'low',
    metadata: {
      templateType: 'excel_upload_template'
    }
  });

  // Set response headers
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="MPESA_B2C_Template.xlsx"');
  res.setHeader('Content-Length', buffer.length);

  res.send(buffer);
}));

module.exports = router;
