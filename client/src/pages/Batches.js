import React, { useState, useEffect } from 'react';
import { uploadService, paymentService, formatCurrency, formatRelativeTime } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';
import BatchDetails from './BatchDetails';

const Batches = () => {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [showBatchDetails, setShowBatchDetails] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processingBatchId, setProcessingBatchId] = useState(null);

  useEffect(() => {
    fetchBatches();
  }, []);

  const fetchBatches = async () => {
    try {
      setLoading(true);
      // API returns data directly, not response.data
      const batchesData = await uploadService.getBatches();
      setBatches(batchesData?.data?.batches || []);
    } catch (err) {
      setError('Failed to fetch batches');
      setBatches([]);
    } finally {
      setLoading(false);
    }
  };

  const handleProcessBatch = async (batchId) => {
    if (!window.confirm('Are you sure you want to process this batch?')) return;

    try {
      setProcessing(true);
      setProcessingBatchId(batchId);
      
      const result = await paymentService.processBatch(batchId);
      
      alert(`Batch processed successfully! ${result.successfulPayments} payments completed.`);
      await fetchBatches();
    } catch (err) {
      alert(`Processing failed: ${err.message || 'Unknown error'}`);
    } finally {
      setProcessing(false);
      setProcessingBatchId(null);
    }
  };

  const handleRetryBatch = async (batchId) => {
    if (!window.confirm('Are you sure you want to retry failed payments?')) return;

    try {
      setProcessing(true);
      setProcessingBatchId(batchId);
      
      const result = await paymentService.retryBatch(batchId);
      
      alert(`Retry completed! ${result.successfulPayments} payments retried.`);
      await fetchBatches();
    } catch (err) {
      alert(`Retry failed: ${err.message || 'Unknown error'}`);
    } finally {
      setProcessing(false);
      setProcessingBatchId(null);
    }
  };

  const handleViewBatch = async (batch) => {
    setSelectedBatch(batch);
    setShowBatchDetails(true);
  };

  const getStatusColor = (status) => {
    const colors = {
      validating: 'text-yellow-600 bg-yellow-50',
      validated: 'text-blue-600 bg-blue-50',
      processing: 'text-purple-600 bg-purple-50',
      completed: 'text-green-600 bg-green-50',
      failed: 'text-red-600 bg-red-50',
      cancelled: 'text-gray-600 bg-gray-50'
    };
    return colors[status] || 'text-gray-600 bg-gray-50';
  };

  const getProgress = (batch) => {
    if (batch.totalRows === 0) return 0;
    return Math.round((batch.successfulRows / batch.totalRows) * 100);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Payment Batches</h1>
        <p className="text-gray-600">Manage and process B2C payment batches</p>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
          <p className="text-red-800">{error}</p>
        </div>
      )}

      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Batches Overview</h2>
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-8 text-center">
              <LoadingSpinner />
            </div>
          ) : batches.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p>No batches found</p>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Batch ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    File Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Progress
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Total Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {batches.map((batch) => (
                  <tr key={batch._id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {batch.batchId}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {batch.originalFileName}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(batch.status)}`}>
                        {batch.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-green-600 h-2 rounded-full"
                          style={{ width: `${getProgress(batch)}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500">
                        {batch.successfulRows || 0} / {batch.totalRows || 0}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatCurrency(batch.totalAmount || 0)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatRelativeTime(batch.createdAt)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex space-x-2">
                        <button
                          onClick={() => handleViewBatch(batch)}
                          className="text-blue-600 hover:text-blue-900"
                        >
                          View
                        </button>
                        {batch.status === 'validated' && (
                          <button
                            onClick={() => handleProcessBatch(batch.batchId)}
                            disabled={processing}
                            className="text-green-600 hover:text-green-900 disabled:opacity-50"
                          >
                            {processing && processingBatchId === batch.batchId ? 'Processing...' : 'Process'}
                          </button>
                        )}
                        {batch.failedRows > 0 && (
                          <button
                            onClick={() => handleRetryBatch(batch.batchId)}
                            disabled={processing}
                            className="text-orange-600 hover:text-orange-900 disabled:opacity-50"
                          >
                            {processing && processingBatchId === batch.batchId ? 'Retrying...' : 'Retry'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showBatchDetails && selectedBatch && (
        <BatchDetails
          batch={selectedBatch}
          onClose={() => {
            setShowBatchDetails(false);
            setSelectedBatch(null);
          }}
          onRefresh={fetchBatches}
        />
      )}
    </div>
  );
};

export default Batches;
