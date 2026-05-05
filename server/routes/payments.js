const express = require('express');
const { body, validationResult } = require('express-validator');
const Payment = require('../models/Payment');
const UploadBatch = require('../models/UploadBatch');
const AuditLog = require('../models/AuditLog');
const mpesaService = require('../services/mpesaService');
const paymentProcessor = require('../services/paymentProcessor');
const { protect, requirePermission, financeOrAdmin } = require('../middleware/auth');
const { asyncHandler, CustomError } = require('../middleware/errorHandler');

const router = express.Router();

// @desc    Start processing payments for a batch
// @route   POST /api/payments/process/:batchId
// @access  Private (requires canProcess permission)
router.post('/process/:batchId', protect, requirePermission('canProcess'), asyncHandler(async (req, res) => {
  const { batchId } = req.params;

  try {
    const result = await paymentProcessor.processBatch(batchId, req.user);

    res.status(200).json({
      success: true,
      message: 'Payment processing completed',
      data: result
    });
  } catch (error) {
    console.error('Process payments error:', error);
    throw new CustomError(error.message, 400);
  }
}));

// @desc    Retry failed payments for a batch
// @route   POST /api/payments/retry/:batchId
// @access  Private (requires canProcess permission)
router.post('/retry/:batchId', protect, requirePermission('canProcess'), asyncHandler(async (req, res) => {
  const { batchId } = req.params;

  try {
    const result = await paymentProcessor.retryFailedPayments(batchId, req.user);

    res.status(200).json({
      success: true,
      message: 'Failed payments retry completed',
      data: result
    });
  } catch (error) {
    console.error('Retry payments error:', error);
    throw new CustomError(error.message, 400);
  }
}));

// @desc    Get processing status
// @route   GET /api/payments/status
// @access  Private
router.get('/status', protect, asyncHandler(async (req, res) => {
  const processingStatus = paymentProcessor.getProcessingStatus();
  const mpesaStatus = mpesaService.getStatus();

  res.status(200).json({
    success: true,
    data: {
      processing: processingStatus,
      mpesa: mpesaStatus
    }
  });
}));

// @desc    Cancel current processing
// @route   POST /api/payments/cancel
// @access  Private (requires canProcess permission)
router.post('/cancel', protect, requirePermission('canProcess'), asyncHandler(async (req, res) => {
  const cancelled = await paymentProcessor.cancelProcessing(req.user);

  if (cancelled) {
    res.status(200).json({
      success: true,
      message: 'Payment processing cancelled successfully'
    });
  } else {
    res.status(400).json({
      success: false,
      error: 'No active processing to cancel'
    });
  }
}));

// @desc    Get payments for a batch
// @route   GET /api/payments/batch/:batchId
// @access  Private
router.get('/batch/:batchId', protect, asyncHandler(async (req, res) => {
  const { batchId } = req.params;
  const { page = 1, limit = 50, status } = req.query;

  // Get the batch by _id
  const batch = await UploadBatch.findById(batchId);
  if (!batch) {
    throw new CustomError('Upload batch not found', 404);
  }

  // Check access permissions
  if (req.user.role !== 'admin' && batch.uploadedBy.toString() !== req.user._id.toString()) {
    throw new CustomError('Access denied to this batch', 403);
  }

  // Build query
  const query = { uploadBatch: batch._id };
  if (status) {
    query.status = status;
  }

  // Get payments with pagination
  const options = {
    page: parseInt(page),
    limit: parseInt(limit),
    sort: { rowNumber: 1 },
    select: 'rowNumber phoneNumber amount internalReference description status mpesaTransactionId mpesaReceiptNumber errorMessage processedAt completedAt'
  };

  const result = await Payment.paginate(query, options);

  res.status(200).json({
    success: true,
    data: {
      batch: batch.getSummary(),
      payments: result.docs,
      pagination: {
        page: result.page,
        pages: result.totalPages,
        limit: result.limit,
        total: result.totalDocs
      }
    }
  });
}));

// @desc    Get specific payment details
// @route   GET /api/payments/:paymentId
// @access  Private
router.get('/:paymentId', protect, asyncHandler(async (req, res) => {
  const payment = await Payment.findById(req.params.paymentId)
    .populate('uploadBatch', '_id originalFileName uploadedBy')
    .populate('uploadedBy', 'firstName lastName email')
    .populate('processedBy', 'firstName lastName email');

  if (!payment) {
    throw new CustomError('Payment not found', 404);
  }

  // Check access permissions
  if (req.user.role !== 'admin' && 
      payment.uploadedBy._id.toString() !== req.user._id.toString()) {
    throw new CustomError('Access denied to this payment', 403);
  }

  res.status(200).json({
    success: true,
    data: { payment }
  });
}));

// @desc    Test MPESA connectivity
// @route   GET /api/payments/test/connectivity
// @access  Private (Admin only)
router.get('/test/connectivity', protect, financeOrAdmin, asyncHandler(async (req, res) => {
  const testResult = await mpesaService.testConnectivity();

  // Log test
  await AuditLog.logAction({
    user: req.user._id,
    userEmail: req.user.email,
    action: 'system_config_change',
    description: 'MPESA connectivity test performed',
    resourceType: 'system',
    ipAddress: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    success: testResult.success,
    severity: 'medium',
    metadata: testResult
  });

  res.status(200).json({
    success: true,
    data: testResult
  });
}));

// @desc    Get account balance
// @route   GET /api/payments/mpesa/balance
// @access  Private (Finance officer or admin)
router.get('/mpesa/balance', protect, financeOrAdmin, asyncHandler(async (req, res) => {
  try {
    const balanceResult = await mpesaService.getAccountBalance();

    // Log balance inquiry
    await AuditLog.logAction({
      user: req.user._id,
      userEmail: req.user.email,
      action: 'data_access',
      description: 'MPESA account balance inquiry',
      resourceType: 'system',
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      success: balanceResult.success,
      severity: 'medium',
      metadata: {
        conversationId: balanceResult.conversationId,
        responseCode: balanceResult.responseCode
      }
    });

    res.status(200).json({
      success: true,
      data: balanceResult
    });
  } catch (error) {
    console.error('Balance inquiry error:', error);
    throw new CustomError(error.message, error.statusCode || 500);
  }
}));

// @desc    Query transaction status
// @route   GET /api/payments/mpesa/status/:conversationId
// @access  Private (Finance officer or admin)
router.get('/mpesa/status/:conversationId', protect, financeOrAdmin, asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const { originatorConversationId } = req.query;

  try {
    const statusResult = await mpesaService.queryTransactionStatus(conversationId, originatorConversationId);

    // Log status query
    await AuditLog.logAction({
      user: req.user._id,
      userEmail: req.user.email,
      action: 'data_access',
      description: `MPESA transaction status query: ${conversationId}`,
      resourceType: 'system',
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      success: statusResult.success,
      severity: 'low',
      metadata: {
        conversationId,
        originatorConversationId,
        responseCode: statusResult.responseCode
      }
    });

    res.status(200).json({
      success: true,
      data: statusResult
    });
  } catch (error) {
    console.error('Transaction status query error:', error);
    throw new CustomError(error.message, error.statusCode || 500);
  }
}));

// @desc    MPESA B2C callback handler
// @route   POST /api/payments/callback
// @access  Public (MPESA callback)
router.post('/callback', asyncHandler(async (req, res) => {
  try {
    console.log('MPESA B2C Callback received:', JSON.stringify(req.body, null, 2));

    const callbackData = mpesaService.processCallback(req.body);
    
    if (callbackData.conversationId) {
      // Find payment by conversation ID
      const payment = await Payment.findOne({
        mpesaConversationId: callbackData.conversationId
      });

      if (payment) {
        const updateData = {
          mpesaTransactionId: callbackData.transactionId,
          mpesaResponseCode: callbackData.resultCode.toString(),
          mpesaResponseDescription: callbackData.resultDesc
        };

        // Extract additional parameters
        if (callbackData.parameters.TransactionReceipt) {
          updateData.mpesaReceiptNumber = callbackData.parameters.TransactionReceipt;
        }

        // Update payment status based on result
        if (callbackData.isSuccess) {
          await payment.updateStatus('completed', updateData);
          console.log(`Payment ${payment.internalReference} completed successfully`);
        } else {
          updateData.errorMessage = callbackData.resultDesc;
          await payment.updateStatus('failed', updateData);
          console.log(`Payment ${payment.internalReference} failed: ${callbackData.resultDesc}`);
        }

        // Log callback processing
        await AuditLog.logAction({
          user: payment.uploadedBy,
          userEmail: 'system',
          action: 'api_call',
          description: `MPESA callback processed for payment: ${payment.internalReference}`,
          resourceType: 'payment',
          resourceId: payment._id.toString(),
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: 'MPESA-API',
          success: true,
          severity: 'low',
          metadata: {
            callbackData,
            paymentReference: payment.internalReference,
            transactionId: callbackData.transactionId
          }
        });
      } else {
        console.warn('Payment not found for conversation ID:', callbackData.conversationId);
      }
    }

    // Always respond with success to MPESA
    res.status(200).json({
      ResultCode: 0,
      ResultDesc: 'Callback processed successfully'
    });

  } catch (error) {
    console.error('MPESA callback processing error:', error);
    
    // Still respond with success to avoid retries
    res.status(200).json({
      ResultCode: 0,
      ResultDesc: 'Callback received'
    });
  }
}));

// @desc    MPESA timeout callback handler
// @route   POST /api/payments/timeout
// @access  Public (MPESA callback)
router.post('/timeout', asyncHandler(async (req, res) => {
  try {
    console.log('MPESA Timeout received:', JSON.stringify(req.body, null, 2));

    const timeoutData = req.body;
    
    if (timeoutData.ConversationID) {
      // Find payment by conversation ID
      const payment = await Payment.findOne({
        mpesaConversationId: timeoutData.ConversationID
      });

      if (payment && payment.status === 'processing') {
        await payment.updateStatus('failed', {
          errorMessage: 'Transaction timeout',
          mpesaResponseCode: 'TIMEOUT',
          mpesaResponseDescription: 'Transaction timed out'
        });

        console.log(`Payment ${payment.internalReference} timed out`);
      }
    }

    res.status(200).json({
      ResultCode: 0,
      ResultDesc: 'Timeout processed'
    });

  } catch (error) {
    console.error('MPESA timeout processing error:', error);
    res.status(200).json({
      ResultCode: 0,
      ResultDesc: 'Timeout received'
    });
  }
}));

// @desc    MPESA balance callback handler
// @route   POST /api/payments/balance-callback
// @access  Public (MPESA callback)
router.post('/balance-callback', asyncHandler(async (req, res) => {
  try {
    console.log('MPESA Balance Callback received:', JSON.stringify(req.body, null, 2));

    // Process and log balance information
    const balanceData = mpesaService.processCallback(req.body);
    
    // Log balance callback
    await AuditLog.logAction({
      user: null,
      userEmail: 'system',
      action: 'api_call',
      description: 'MPESA balance callback received',
      resourceType: 'system',
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: 'MPESA-API',
      success: true,
      severity: 'low',
      metadata: { balanceData }
    });

    res.status(200).json({
      ResultCode: 0,
      ResultDesc: 'Balance callback processed'
    });

  } catch (error) {
    console.error('MPESA balance callback error:', error);
    res.status(200).json({
      ResultCode: 0,
      ResultDesc: 'Balance callback received'
    });
  }
}));

// @desc    MPESA status callback handler
// @route   POST /api/payments/status-callback
// @access  Public (MPESA callback)
router.post('/status-callback', asyncHandler(async (req, res) => {
  try {
    console.log('MPESA Status Callback received:', JSON.stringify(req.body, null, 2));

    const statusData = mpesaService.processCallback(req.body);
    
    // Log status callback
    await AuditLog.logAction({
      user: null,
      userEmail: 'system',
      action: 'api_call',
      description: 'MPESA status callback received',
      resourceType: 'system',
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: 'MPESA-API',
      success: true,
      severity: 'low',
      metadata: { statusData }
    });

    res.status(200).json({
      ResultCode: 0,
      ResultDesc: 'Status callback processed'
    });

  } catch (error) {
    console.error('MPESA status callback error:', error);
    res.status(200).json({
      ResultCode: 0,
      ResultDesc: 'Status callback received'
    });
  }
}));

module.exports = router;