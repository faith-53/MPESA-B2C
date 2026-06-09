const Payment = require('../models/Payment');
const UploadBatch = require('../models/UploadBatch');
const AuditLog = require('../models/AuditLog');
const mpesaService = require('./mpesaService');

class PaymentProcessor {
  constructor() {
    this.isProcessing = false;
    this.processingBatch = null;
    this.batchSize = 10; // Process payments in batches
    this.delayBetweenBatches = 2000; // 2 seconds delay between batches
    this.maxRetries = 3;
    this.processingStats = {
      totalProcessed: 0,
      successful: 0,
      failed: 0,
      startTime: null,
      currentBatch: null
    };
  }

  /**
   * Start processing payments for a specific batch
   * @param {string} batchId - Custom batch identifier
   * @param {Object} user - User initiating the process
   * @returns {Promise<Object>} Processing result
   */
  async processBatch(batchId, user) {
    try {
      // Check if already processing
      if (this.isProcessing) {
        throw new Error('Payment processing is already in progress');
      }

      // Get the batch by custom batchId
      const batch = await UploadBatch.findOne({ batchId: batchId }).populate('uploadedBy');
      if (!batch) {
        throw new Error('Upload batch not found');
      }

      // Check if batch can be processed
      if (!batch.canProcess()) {
        throw new Error(`Batch cannot be processed. Current status: ${batch.status}`);
      }

      // Get pending payments for this batch
      const pendingPayments = await Payment.find({
        uploadBatch: batch._id,
        status: 'pending'
      }).sort({ rowNumber: 1 });

      if (pendingPayments.length === 0) {
        throw new Error('No pending payments found for this batch');
      }

      // Initialize processing
      this.isProcessing = true;
      this.processingBatch = batch.batchId;
      this.processingStats = {
        totalProcessed: 0,
        successful: 0,
        failed: 0,
        startTime: new Date(),
        currentBatch: batch.batchId
      };

      // Update batch status
      await batch.updateStatus('processing', {
        processingStartedAt: new Date()
      });

      // Log processing start
      await AuditLog.logAction({
        user: user._id,
        userEmail: user.email,
        action: 'process_payments', //
        description: `Started processing batch: ${batch.batchId}`,
        resourceType: 'batch',
        resourceId: batch._id.toString(),
        ipAddress: '127.0.0.1',
        source: 'system',
        userAgent: 'payment-processor',
        success: true,
        severity: 'medium',
        metadata: {
          batchId: batch.batchId,
          totalPayments: pendingPayments.length,
          batchSize: this.batchSize
        }
      });

      // Process payments in batches
      const results = await this.processPaymentsInBatches(pendingPayments, batch, user);

      // Update batch final status
      const finalStatus = results.failed === 0
        ? 'completed'
        : results.successful === 0
        ? 'failed'
        : 'partial';

      await batch.updateStatus(finalStatus, {
        processingCompletedAt: new Date(),
        processedRows: results.totalProcessed,
        successfulRows: results.successful,
        failedRows: results.failed,
        processedAmount: results.successfulAmount,
        successfulAmount: results.successfulAmount
      });

      // Calculate processing time safely
      const processingTime = this.processingStats.startTime 
        ? Date.now() - this.processingStats.startTime.getTime() 
        : 0;

      // Log processing completion
      await AuditLog.logAction({
        user: user._id,
        userEmail: user.email,
        action: 'process_payments', 
        description: `Completed processing batch: ${batch.batchId}`,
        resourceType: 'batch',
        resourceId: batch._id.toString(),
        ipAddress: '127.0.0.1',
        source: 'system',
        userAgent: 'payment-processor',
        success: true,
        severity: 'medium',
        metadata: {
          batchId: batch.batchId,
          results,
          processingTime
        }
      });

      // Reset processing state
      this.isProcessing = false;
      this.processingBatch = null;

      return {
        success: true,
        batchId: batch.batchId,
        results,
        processingTime
      };

    } catch (error) {
      console.error('Batch processing error:', error);
      
      // Reset processing state
      this.isProcessing = false;
      this.processingBatch = null;

      // Update batch status to failed if we have a batch
      if (batchId) {
        try {
          const batch = await UploadBatch.findOne({ batchId: batchId });
          if (batch && batch.status === 'processing') {
            await batch.updateStatus('failed', {
              errorMessage: error.message
            });
          }
        } catch (updateError) {
          console.error('Failed to update batch status:', updateError);
        }
      }

      throw error;
    }
  }

  /**
   * Process payments in smaller batches with rate limiting
   * @param {Array} payments - Array of payment documents
   * @param {Object} batch - Upload batch document
   * @param {Object} user - User initiating the process
   * @returns {Promise<Object>} Processing results
   */
  async processPaymentsInBatches(payments, batch, user) {
    const results = {
      totalProcessed: 0,
      successful: 0,
      failed: 0,
      successfulAmount: 0,
      errors: []
    };

    // Split payments into batches
    const paymentBatches = this.chunkArray(payments, this.batchSize);

    console.log(`Processing ${payments.length} payments in ${paymentBatches.length} batches`);

    for (let i = 0; i < paymentBatches.length; i++) {
      const paymentBatch = paymentBatches[i];
      
      console.log(`Processing batch ${i + 1}/${paymentBatches.length} (${paymentBatch.length} payments)`);

      // Process payments in parallel within each batch
      const batchPromises = paymentBatch.map(payment => 
        this.processIndividualPayment(payment, user)
      );

      const batchResults = await Promise.allSettled(batchPromises);

      // Collect results
      for (const result of batchResults) {
        results.totalProcessed++;
        
        if (result.status === 'fulfilled' && result.value.success) {
          results.successful++;
          results.successfulAmount += result.value.amount;
        } else {
          results.failed++;
          if (result.status === 'rejected') {
            results.errors.push(result.reason.message);
          } else if (!result.value.success) {
            results.errors.push(result.value.error);
          }
        }
      }

      // Update processing stats
      this.processingStats.totalProcessed = results.totalProcessed;
      this.processingStats.successful = results.successful;
      this.processingStats.failed = results.failed;

      // Update batch progress
      await batch.updateProcessingStats(
        results.totalProcessed,
        results.successful,
        results.failed,
        results.successfulAmount,
        results.successfulAmount
      );

      // Delay between batches (except for the last one)
      if (i < paymentBatches.length - 1) {
        console.log(`Waiting ${this.delayBetweenBatches}ms before next batch...`);
        await new Promise(resolve => setTimeout(resolve, this.delayBetweenBatches));
      }
    }

    return results;
  }

  /**
   * Process individual payment
   * @param {Object} payment - Payment document
   * @param {Object} user - User initiating the process
   * @returns {Promise<Object>} Processing result
   */
  async processIndividualPayment(payment, user) {
    const startTime = Date.now();
    
    try {
      // Update payment status to processing
      await payment.updateStatus('processing', {
        processedBy: user._id,
        processedAt: new Date()
      });

      // Get payment data
      let phoneNumber = payment.phoneNumberDecrypted;
      // fallback if decryption failed
      if (!phoneNumber) {
        phoneNumber = payment.phoneNumber;
      }

      let amount = payment.amountDecrypted;

      //correct type here
      amount = Number(amount);

      if (!Number.isFinite(amount)) {
        throw new Error(`Invalid amount after decryption: ${payment.amount}`);
      }

      
      if (!phoneNumber) {
        throw new Error(`Phone number missing for ${payment.internalReference}`);
      }
      //Validate payment data
      if (!mpesaService.validatePhoneNumber(phoneNumber)) {
        throw new Error(`Invalid phone format: ${phoneNumber}`);
      }

      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error(`Invalid amount after decryption for ${payment.internalReference}`);
      }

      console.log(`Processing payment: ${payment.internalReference} - ${phoneNumber} - KES ${amount}`);

      // Initiate MPESA B2C payment
      const mpesaResponse = await mpesaService.initiateB2CPayment({
        phoneNumber,
        amount,
        internalReference: payment.internalReference,
        description: payment.description || `Payment ${payment.internalReference}`
      });

      // Update payment with MPESA response
      await payment.updateStatus('completed', {
        mpesaConversationId: mpesaResponse.conversationId,
        mpesaOriginatorConversationId: mpesaResponse.originatorConversationId,
        mpesaResponseCode: mpesaResponse.responseCode,
        mpesaResponseDescription: mpesaResponse.responseDescription,
        completedAt: new Date(),
        metadata: {
          ...payment.metadata,
          processingTime: Date.now() - startTime,
          mpesaInitiated: true
        }
      });

      // Log successful payment
      await AuditLog.logAction({
        user: user._id,
        userEmail: user.email,
        action: 'process_payments', 
        description: `Payment processed: ${payment.internalReference}`,
        resourceType: 'payment',
        resourceId: payment._id.toString(),
        ipAddress: '127.0.0.1',
        source: 'system',
        userAgent: 'payment-processor',
        success: true,
        severity: 'low',
        metadata: {
          internalReference: payment.internalReference,
          phoneNumber: phoneNumber.replace(/(\d{3})(\d{3})(\d{3})(\d{3})/, '$1***$3$4'), // Mask middle digits
          amount,
          mpesaConversationId: mpesaResponse.conversationId,
          processingTime: Date.now() - startTime
        }
      });

      return {
        success: true,
        paymentId: payment._id,
        internalReference: payment.internalReference,
        amount,
        mpesaConversationId: mpesaResponse.conversationId
      };

    } catch (error) {
      console.error(`Payment processing failed for ${payment.internalReference}:`, error);

      // Update payment status to failed
      await payment.updateStatus('failed', {
        errorMessage: error.message,
        completedAt: new Date(),
        metadata: {
          ...payment.metadata,
          processingTime: Date.now() - startTime,
          errorDetails: {
            message: error.message,
            mpesaError: error instanceof Error && error.mpesaError,
            mpesaCode: error.mpesaCode
          }
        }
      });

      // Log failed payment
      await AuditLog.logAction({
        user: user._id,
        userEmail: user.email,
        action: 'process_payments', 
        description: `Payment failed: ${payment.internalReference}`,
        resourceType: 'payment',
        resourceId: payment._id.toString(),
        ipAddress: '127.0.0.1',
        source: 'system',
        userAgent: 'payment-processor',
        success: false,
        severity: 'medium',
        metadata: {
          internalReference: payment.internalReference,
          errorMessage: error.message,
          processingTime: Date.now() - startTime
        }
      });

      return {
        success: false,
        paymentId: payment._id,
        internalReference: payment.internalReference,
        error: error.message
      };
    }
  }

  /**
   * Retry failed payments for a batch (including partial batches)
   * This method ONLY retries failed payments, never retries successful ones
   * @param {string} batchId - Custom batch identifier
   * @param {Object} user - User initiating the retry
   * @returns {Promise<Object>} Retry result
   */
  async retryFailedPayments(batchId, user) {
    try {
      // Get the batch by custom batchId
      const batch = await UploadBatch.findOne({ batchId: batchId });
      if (!batch) {
        throw new Error('Upload batch not found');
      }

      // Check if batch can be retried (partial or failed status)
      if (!['partial', 'failed'].includes(batch.status)) {
        throw new Error(`Batch cannot be retried. Current status: ${batch.status}`);
      }

      // Get failed payments that can be retried (retryCount < maxRetries)
      const failedPayments = await Payment.find({
        uploadBatch: batch._id,
        status: 'failed',
        retryCount: { $lt: this.maxRetries }
      }).sort({ rowNumber: 1 });

      if (failedPayments.length === 0) {
        throw new Error('No failed payments available for retry (all have reached max retry attempts)');
      }

      // Get successful payments count to ensure we're not retrying them
      const successfulPayments = await Payment.countDocuments({
        uploadBatch: batch._id,
        status: 'completed'
      });

      console.log(`Retrying ${failedPayments.length} failed payments for batch ${batch.batchId}`);
      console.log(`Batch has ${successfulPayments} successful payments that will not be retried`);

      // Log the retry operation
      await AuditLog.logAction({
        user: user._id,
        userEmail: user.email,
        action: 'retry_payments',
        description: `Retrying ${failedPayments.length} failed payments for batch: ${batch.batchId}`,
        resourceType: 'batch',
        resourceId: batch._id.toString(),
        ipAddress: '127.0.0.1',
        source: 'system',
        userAgent: 'payment-processor',
        success: true,
        severity: 'medium',
        metadata: {
          batchId: batch.batchId,
          failedCount: failedPayments.length,
          successfulCount: successfulPayments,
          maxRetries: this.maxRetries,
        }
      });

      // Reset payment status to pending for retry and increment retry count
      for (const payment of failedPayments) {
        await payment.updateStatus('pending');
        await payment.incrementRetry();
        console.log(`Reset payment ${payment.internalReference} for retry (attempt ${payment.retryCount}/${this.maxRetries})`);
      }

      // Initialize processing stats for retry
      this.processingStats = {
        totalProcessed: 0,
        successful: 0,
        failed: 0,
        startTime: new Date(), // Make sure startTime is set!
        currentBatch: batch.batchId
      };

      // IMPORTANT: Update batch status to 'processing' for the retry operation
      await batch.updateStatus('processing', {
        processingStartedAt: new Date(),
        errorMessage: null // Clear any previous error message
      });

      // Process only the retried payments (the pending ones we just reset)
      const pendingPayments = await Payment.find({
        uploadBatch: batch._id,
        status: 'pending'
      }).sort({ rowNumber: 1 });

      if (pendingPayments.length === 0) {
        throw new Error('No pending payments found after resetting failed payments');
      }

      console.log(`Processing ${pendingPayments.length} retried payments`);

      // Process payments in batches
      const results = await this.processPaymentsInBatches(pendingPayments, batch, user);

      // Update batch final status after retry
      // Get updated counts for the entire batch
      const totalSuccessful = await Payment.countDocuments({
        uploadBatch: batch._id,
        status: 'completed'
      });
      
      const totalFailed = await Payment.countDocuments({
        uploadBatch: batch._id,
        status: 'failed'
      });
      
      const totalProcessed = totalSuccessful + totalFailed;
      
      // Calculate successful amount
      const successfulAmounts = await Payment.aggregate([
        {
          $match: {
            uploadBatch: batch._id,
            status: 'completed'
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: { $toDouble: '$amountDecrypted' } }
          }
        }
      ]);
      
      const totalSuccessfulAmount = successfulAmounts[0]?.total || 0;

      // Determine final status after retry
      let finalStatus;
      if (totalFailed === 0) {
        finalStatus = 'completed';
      } else if (totalSuccessful === 0) {
        finalStatus = 'failed';
      } else {
        finalStatus = 'partial';
      }

      await batch.updateStatus(finalStatus, {
        processingCompletedAt: new Date(),
        processedRows: totalProcessed,
        successfulRows: totalSuccessful,
        failedRows: totalFailed,
        processedAmount: totalSuccessfulAmount,
        successfulAmount: totalSuccessfulAmount
      });

      // Calculate processing time safely
      const processingTime = this.processingStats.startTime 
        ? Date.now() - this.processingStats.startTime.getTime() 
        : 0;

      // Log retry completion
      await AuditLog.logAction({
        user: user._id,
        userEmail: user.email,
        action: 'retry_payments',
        description: `Completed retry for batch: ${batch.batchId}`,
        resourceType: 'batch',
        resourceId: batch._id.toString(),
        ipAddress: '127.0.0.1',
        source: 'system',
        userAgent: 'payment-processor',
        success: true,
        severity: 'medium',
        metadata: {
          batchId: batch.batchId,
          retryResults: results,
          finalStatus,
          totalSuccessful,
          totalFailed,
          totalSuccessfulAmount,
        }
      });

      // Reset processing state
      this.isProcessing = false;
      this.processingBatch = null;

      return {
        success: true,
        batchId: batch.batchId,
        results: {
          ...results,
          totalSuccessfulInBatch: totalSuccessful,
          totalFailedInBatch: totalFailed,
          finalStatus
        },
        processingTime
      };

    } catch (error) {
      console.error('Retry failed payments error:', error);
      
      // Reset processing state
      this.isProcessing = false;
      this.processingBatch = null;

      // Update batch status if needed
      if (batchId) {
        try {
          const batch = await UploadBatch.findOne({ batchId: batchId });
          if (batch && batch.status === 'processing') {
            await batch.updateStatus('partial', { // Keep as partial, not failed
              errorMessage: error.message,
              processingCompletedAt: new Date()
            });
          }
        } catch (updateError) {
          console.error('Failed to update batch status:', updateError);
        }
      }

      throw error;
    }
  }

  /**
   * Get processing status
   * @returns {Object} Current processing status
   */
  getProcessingStatus() {
    return {
      isProcessing: this.isProcessing,
      processingBatch: this.processingBatch,
      stats: this.processingStats,
      uptime: this.processingStats.startTime ? 
        Date.now() - this.processingStats.startTime.getTime() : 0
    };
  }

  /**
   * Cancel current processing
   * @param {Object} user - User cancelling the process
   * @returns {Promise<boolean>} Cancellation success
   */
  async cancelProcessing(user) {
    if (!this.isProcessing) {
      return false;
    }

    try {
      // Update batch status
      if (this.processingBatch) {
        const batch = await UploadBatch.findOne({ batchId: this.processingBatch });
        if (batch) {
          await batch.updateStatus('cancelled');
        }
      }

      // Log cancellation
      await AuditLog.logAction({
        user: user._id,
        userEmail: user.email,
        action: 'cancel_batch', // Fixed: changed from 'cancel_batch' to match enum
        description: `Payment processing cancelled for batch: ${this.processingStats.currentBatch}`,
        resourceType: 'batch',
        resourceId: this.processingBatch?.toString(),
        ipAddress: '127.0.0.1',
        source: 'system',
        userAgent: 'payment-processor',
        success: true,
        severity: 'medium',
        metadata: {
          batchId: this.processingStats.currentBatch,
          processedCount: this.processingStats.totalProcessed,
          successfulCount: this.processingStats.successful,
          failedCount: this.processingStats.failed,
        }
      });

      // Reset processing state
      this.isProcessing = false;
      this.processingBatch = null;

      return true;
    } catch (error) {
      console.error('Cancel processing error:', error);
      return false;
    }
  }

  /**
   * Utility function to split array into chunks
   * @param {Array} array - Array to chunk
   * @param {number} size - Chunk size
   * @returns {Array} Array of chunks
   */
  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

// Create singleton instance
const paymentProcessor = new PaymentProcessor();

module.exports = paymentProcessor;