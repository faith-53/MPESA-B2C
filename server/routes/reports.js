const express = require('express');
const { query, validationResult } = require('express-validator');
const XLSX = require('xlsx');
const Payment = require('../models/Payment');
const UploadBatch = require('../models/UploadBatch');
const AuditLog = require('../models/AuditLog');
const { protect, requirePermission } = require('../middleware/auth');
const { asyncHandler, CustomError } = require('../middleware/errorHandler');

const router = express.Router();

// @desc    Generate reconciliation report
// @route   GET /api/reports/reconciliation
// @access  Private (requires canViewReports permission)
router.get('/reconciliation', protect, requirePermission('canViewReports'), [
  query('batchId').optional().isString().withMessage('Batch ID must be a string'),
  query('startDate').optional().isISO8601().withMessage('Start date must be a valid ISO 8601 date'),
  query('endDate').optional().isISO8601().withMessage('End date must be a valid ISO 8601 date'),
  query('status').optional().isIn(['pending', 'processing', 'completed', 'failed', 'cancelled']).withMessage('Invalid status'),
  query('format').optional().isIn(['json', 'excel', 'csv']).withMessage('Format must be json, excel, or csv'),
  query('includeDecrypted').optional().isBoolean().withMessage('includeDecrypted must be boolean')
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

  const {
    batchId,
    startDate,
    endDate,
    status,
    format = 'json',
    includeDecrypted = false
  } = req.query;

  try {
    // Build query
    const query = {};
    
    // Filter by batch if specified
    if (batchId) {
      const batch = await UploadBatch.findOne({ batchId });
      if (!batch) {
        throw new CustomError('Batch not found', 404);
      }
      
      // Check access permissions
      if (req.user.role !== 'admin' && batch.uploadedBy.toString() !== req.user._id.toString()) {
        throw new CustomError('Access denied to this batch', 403);
      }
      
      query.uploadBatch = batch._id;
    }

    // Filter by date range
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    // Filter by status
    if (status) {
      query.status = status;
    }

    // Filter by user if not admin
    if (req.user.role !== 'admin') {
      query.uploadedBy = req.user._id;
    }

    // Get payments with related data
    const payments = await Payment.find(query)
      .populate('uploadBatch', 'batchId originalFileName createdAt')
      .populate('uploadedBy', 'firstName lastName email')
      .populate('processedBy', 'firstName lastName email')
      .sort({ createdAt: -1 });

    // Process payment data for report
    const reportData = payments.map(payment => {
      const data = {
        // Basic payment info
        internalReference: payment.internalReference,
        description: payment.description,
        status: payment.status,
        statusDisplay: payment.statusDisplay,
        
        // Batch info
        batchId: payment.uploadBatch?.batchId,
        originalFileName: payment.uploadBatch?.originalFileName,
        uploadDate: payment.uploadBatch?.createdAt,
        rowNumber: payment.rowNumber,
        
        // User info
        uploadedBy: payment.uploadedBy ? 
          `${payment.uploadedBy.firstName} ${payment.uploadedBy.lastName}` : 'Unknown',
        uploadedByEmail: payment.uploadedBy?.email,
        processedBy: payment.processedBy ? 
          `${payment.processedBy.firstName} ${payment.processedBy.lastName}` : null,
        
        // MPESA transaction info
        mpesaTransactionId: payment.mpesaTransactionId,
        mpesaReceiptNumber: payment.mpesaReceiptNumber,
        mpesaResponseCode: payment.mpesaResponseCode,
        mpesaResponseDescription: payment.mpesaResponseDescription,
        mpesaConversationId: payment.mpesaConversationId,
        
        // Timestamps
        createdAt: payment.createdAt,
        processedAt: payment.processedAt,
        completedAt: payment.completedAt,
        
        // Error info
        errorMessage: payment.errorMessage,
        retryCount: payment.retryCount,
        
        // Processing duration
        processingDuration: payment.processingDuration
      };

      // Add decrypted sensitive data if requested and user has permission
      if (includeDecrypted && (req.user.role === 'admin' || req.user.role === 'finance_officer')) {
        data.phoneNumber = payment.phoneNumberDecrypted;
        data.amount = payment.amountDecrypted;
      } else {
        // Mask phone number for security
        const phone = payment.phoneNumberDecrypted;
        data.phoneNumber = phone ? phone.replace(/(\d{3})(\d{3})(\d{3})(\d{3})/, '$1***$3$4') : null;
        data.amount = payment.amountDecrypted;
      }

      return data;
    });

    // Generate summary statistics
    const summary = {
      totalPayments: reportData.length,
      statusBreakdown: {},
      totalAmount: 0,
      successfulAmount: 0,
      dateRange: {
        from: startDate || (reportData.length > 0 ? reportData[reportData.length - 1].createdAt : null),
        to: endDate || (reportData.length > 0 ? reportData[0].createdAt : null)
      }
    };

    // Calculate statistics
    reportData.forEach(payment => {
      // Status breakdown
      summary.statusBreakdown[payment.status] = (summary.statusBreakdown[payment.status] || 0) + 1;
      
      // Amount calculations
      if (payment.amount) {
        summary.totalAmount += payment.amount;
        if (payment.status === 'completed') {
          summary.successfulAmount += payment.amount;
        }
      }
    });

    // Log report generation
    await AuditLog.logAction({
      user: req.user._id,
      userEmail: req.user.email,
      action: 'export_report',
      description: `Reconciliation report generated (${format} format)`,
      resourceType: 'report',
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      success: true,
      severity: 'low',
      metadata: {
        format,
        recordCount: reportData.length,
        filters: { batchId, startDate, endDate, status },
        includeDecrypted,
        summary
      }
    });

    // Return data based on requested format
    if (format === 'json') {
      res.status(200).json({
        success: true,
        data: {
          summary,
          payments: reportData
        }
      });
    } else if (format === 'excel') {
      // Generate Excel file
      const workbook = generateExcelReport(reportData, summary);
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="reconciliation_report_${new Date().toISOString().split('T')[0]}.xlsx"`);
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);
    } else if (format === 'csv') {
      // Generate CSV file
      const csv = generateCSVReport(reportData);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="reconciliation_report_${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csv);
    }

  } catch (error) {
    console.error('Reconciliation report error:', error);
    throw error;
  }
}));

// @desc    Generate batch summary report
// @route   GET /api/reports/batch-summary
// @access  Private (requires canViewReports permission)
router.get('/batch-summary', protect, requirePermission('canViewReports'), [
  query('days').optional().isInt({ min: 1, max: 365 }).withMessage('Days must be between 1 and 365'),
  query('format').optional().isIn(['json', 'excel', 'csv']).withMessage('Format must be json, excel, or csv')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }

  const { days = 30, format = 'json' } = req.query;

  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    // Build query
    const query = {
      createdAt: { $gte: startDate }
    };

    // Filter by user if not admin
    if (req.user.role !== 'admin') {
      query.uploadedBy = req.user._id;
    }

    // Get batches with statistics
    const batches = await UploadBatch.find(query)
      .populate('uploadedBy', 'firstName lastName email')
      .sort({ createdAt: -1 });

    const reportData = batches.map(batch => ({
      _id: batch._id,
      batchId: batch.batchId,
      originalFileName: batch.originalFileName,
      status: batch.status,
      statusDisplay: batch.statusDisplay,
      uploadedBy: `${batch.uploadedBy.firstName} ${batch.uploadedBy.lastName}`,
      uploadedByEmail: batch.uploadedBy.email,
      totalRows: batch.totalRows,
      validRows: batch.validRows,
      invalidRows: batch.invalidRows,
      processedRows: batch.processedRows,
      successfulRows: batch.successfulRows,
      failedRows: batch.failedRows,
      totalAmount: batch.totalAmount,
      processedAmount: batch.processedAmount,
      successfulAmount: batch.successfulAmount,
      completionPercentage: batch.completionPercentage,
      successRate: batch.successRate,
      validationRate: batch.validationRate,
      createdAt: batch.createdAt,
      uploadCompletedAt: batch.uploadCompletedAt,
      processingCompletedAt: batch.processingCompletedAt,
      totalProcessingTime: batch.totalProcessingTime,
      fileSize: batch.fileSize,
      validationErrorCount: batch.validationErrors.length
    }));

    // Calculate summary
    const summary = {
      totalBatches: reportData.length,
      statusBreakdown: {},
      totalRows: 0,
      totalAmount: 0,
      successfulAmount: 0,
      averageSuccessRate: 0,
      period: `${days} days`
    };

    let totalSuccessRates = 0;
    let batchesWithSuccessRate = 0;

    reportData.forEach(batch => {
      summary.statusBreakdown[batch.status] = (summary.statusBreakdown[batch.status] || 0) + 1;
      summary.totalRows += batch.totalRows;
      summary.totalAmount += batch.totalAmount;
      summary.successfulAmount += batch.successfulAmount;
      
      if (batch.successRate > 0) {
        totalSuccessRates += batch.successRate;
        batchesWithSuccessRate++;
      }
    });

    if (batchesWithSuccessRate > 0) {
      summary.averageSuccessRate = Math.round(totalSuccessRates / batchesWithSuccessRate);
    }

    // Log report generation
    await AuditLog.logAction({
      user: req.user._id,
      userEmail: req.user.email,
      action: 'export_report',
      description: `Batch summary report generated (${format} format)`,
      resourceType: 'report',
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      success: true,
      severity: 'low',
      metadata: {
        format,
        batchCount: reportData.length,
        days: parseInt(days),
        summary
      }
    });

    if (format === 'json') {
      res.status(200).json({
        success: true,
        data: {
          summary,
          batches: reportData
        }
      });
    } else if (format === 'excel') {
      const workbook = generateBatchSummaryExcel(reportData, summary);
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="batch_summary_${new Date().toISOString().split('T')[0]}.xlsx"`);
      res.send(buffer);
    } else if (format === 'csv') {
      const csv = generateBatchSummaryCSV(reportData);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="batch_summary_${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csv);
    }

  } catch (error) {
    console.error('Batch summary report error:', error);
    throw error;
  }
}));

// @desc    Get dashboard statistics
// @route   GET /api/reports/dashboard
// @access  Private
router.get('/dashboard', protect, asyncHandler(async (req, res) => {
  const { days = 7 } = req.query;
  
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    // Build base query
    const batchQuery = {
      createdAt: { $gte: startDate }
    };

    const paymentQuery = {
      createdAt: { $gte: startDate }
    };

    // Filter by user if not admin
    if (req.user.role !== 'admin') {
      batchQuery.uploadedBy = req.user._id;

      // ⚠️ IMPORTANT: payments need to be filtered via batch
      paymentQuery.batchId = {
        $in: await UploadBatch.find({ uploadedBy: req.user._id }).distinct('batchId')
      };
    }

    // Get batch statistics
    const batchStats = await UploadBatch.aggregate([
      { $match: batchQuery },
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

    // Get payment statistics
    const paymentStats = await Payment.aggregate([
      { $match: paymentQuery },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Get daily statistics
    const dailyStats = await UploadBatch.getDailyStats(parseInt(days));

    // Recent activity
    const recentBatches = await UploadBatch.find(batchQuery)
      .populate('uploadedBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(5)
      .select('_id batchId originalFileName status totalRows successfulRows totalAmount createdAt uploadedBy');

    const dashboard = {
      period: `${days} days`,
      batchStatistics: batchStats,
      paymentStatistics: paymentStats,
      dailyStatistics: dailyStats,
      recentActivity: recentBatches.map(batch => ({
        _id: batch._id,
        batchId: batch.batchId,
        fileName: batch.originalFileName,
        status: batch.status,
        totalRows: batch.totalRows,
        successfulRows: batch.successfulRows,
        totalAmount: batch.totalAmount,
        uploadedBy: batch.uploadedBy ? `${batch.uploadedBy.firstName} ${batch.uploadedBy.lastName}` : 'Unknown',
        createdAt: batch.createdAt
      }))
    };

    res.status(200).json({
      success: true,
      data: dashboard
    });

  } catch (error) {
    console.error('Dashboard statistics error:', error);
    throw error;
  }
}));

/**
 * Generate Excel report from payment data
 */
function generateExcelReport(payments, summary) {
  const workbook = XLSX.utils.book_new();

  // Create summary sheet
  const summaryData = [
    ['Reconciliation Report Summary'],
    [''],
    ['Total Payments', summary.totalPayments],
    ['Total Amount (KES)', summary.totalAmount],
    ['Successful Amount (KES)', summary.successfulAmount],
    [''],
    ['Status Breakdown:']
  ];

  Object.entries(summary.statusBreakdown).forEach(([status, count]) => {
    summaryData.push([status.toUpperCase(), count]);
  });

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

  // Create payments sheet
  const paymentsSheet = XLSX.utils.json_to_sheet(payments);
  XLSX.utils.book_append_sheet(workbook, paymentsSheet, 'Payments');

  return workbook;
}

/**
 * Generate CSV report from payment data
 */
function generateCSVReport(payments) {
  if (payments.length === 0) {
    return 'No data available';
  }

  const headers = Object.keys(payments[0]);
  const csvRows = [headers.join(',')];

  payments.forEach(payment => {
    const values = headers.map(header => {
      const value = payment[header];
      // Handle values that contain commas or quotes
      if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value || '';
    });
    csvRows.push(values.join(','));
  });

  return csvRows.join('\n');
}

/**
 * Generate Excel batch summary report
 */
function generateBatchSummaryExcel(batches, summary) {
  const workbook = XLSX.utils.book_new();

  // Summary sheet
  const summaryData = [
    ['Batch Summary Report'],
    [''],
    ['Total Batches', summary.totalBatches],
    ['Total Rows', summary.totalRows],
    ['Total Amount (KES)', summary.totalAmount],
    ['Successful Amount (KES)', summary.successfulAmount],
    ['Average Success Rate (%)', summary.averageSuccessRate],
    ['Period', summary.period],
    [''],
    ['Status Breakdown:']
  ];

  Object.entries(summary.statusBreakdown).forEach(([status, count]) => {
    summaryData.push([status.toUpperCase(), count]);
  });

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

  // Batches sheet
  const batchesSheet = XLSX.utils.json_to_sheet(batches);
  XLSX.utils.book_append_sheet(workbook, batchesSheet, 'Batches');

  return workbook;
}

/**
 * Generate CSV batch summary report
 */
function generateBatchSummaryCSV(batches) {
  if (batches.length === 0) {
    return 'No data available';
  }

  const headers = Object.keys(batches[0]);
  const csvRows = [headers.join(',')];

  batches.forEach(batch => {
    const values = headers.map(header => {
      const value = batch[header];
      if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value || '';
    });
    csvRows.push(values.join(','));
  });

  return csvRows.join('\n');
}

module.exports = router;
