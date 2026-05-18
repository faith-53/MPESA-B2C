import React, { useState } from 'react';
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import {
  reportsService,
  downloadFile,
  formatCurrency,
  formatDate,
} from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';

const Reports = () => {
  const [activeTab, setActiveTab] = useState('reconciliation');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [reconFilters, setReconFilters] = useState({
    batchId: '',
    startDate: '',
    endDate: '',
    status: '',
  });
  const [reconData, setReconData] = useState(null);

  const [summaryDays, setSummaryDays] = useState(30);
  const [summaryData, setSummaryData] = useState(null);

  const loadReconciliation = async () => {
    try {
      setLoading(true);
      const params = {};
      if (reconFilters.batchId) params.batchId = reconFilters.batchId;
      if (reconFilters.startDate) params.startDate = reconFilters.startDate;
      if (reconFilters.endDate) params.endDate = reconFilters.endDate;
      if (reconFilters.status) params.status = reconFilters.status;
      const response = await reportsService.getReconciliation(params);
      setReconData(response?.data || response);
      toast.success('Report generated');
    } catch (err) {
      toast.error(err.message || 'Failed to load report');
      setReconData(null);
    } finally {
      setLoading(false);
    }
  };

  const exportReconciliation = async () => {
    try {
      setExporting(true);
      const params = { format: 'excel' };
      if (reconFilters.batchId) params.batchId = reconFilters.batchId;
      if (reconFilters.startDate) params.startDate = reconFilters.startDate;
      if (reconFilters.endDate) params.endDate = reconFilters.endDate;
      if (reconFilters.status) params.status = reconFilters.status;
      const blob = await reportsService.downloadReconciliation(params);
      downloadFile(blob, `reconciliation_${new Date().toISOString().split('T')[0]}.xlsx`);
      toast.success('Export downloaded');
    } catch (err) {
      toast.error(err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const loadBatchSummary = async () => {
    try {
      setLoading(true);
      const response = await reportsService.getBatchSummary({ days: summaryDays });
      setSummaryData(response?.data || response);
      toast.success('Summary loaded');
    } catch (err) {
      toast.error(err.message || 'Failed to load summary');
      setSummaryData(null);
    } finally {
      setLoading(false);
    }
  };

  const exportBatchSummary = async () => {
    try {
      setExporting(true);
      const blob = await reportsService.downloadBatchSummary({ days: summaryDays, format: 'excel' });
      downloadFile(blob, `batch_summary_${new Date().toISOString().split('T')[0]}.xlsx`);
      toast.success('Export downloaded');
    } catch (err) {
      toast.error(err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const reconSummary = reconData?.summary;
  const reconPayments = reconData?.payments || [];
  const batchSummary = summaryData?.summary;
  const batchRows = summaryData?.batches || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Reports</h1>
        <p className="text-gray-600">Reconciliation and batch summary reports</p>
      </div>

      <div className="border-b border-gray-200">
        <nav className="flex space-x-8">
          <button
            type="button"
            onClick={() => setActiveTab('reconciliation')}
            className={`py-4 px-1 border-b-2 text-sm font-medium ${
              activeTab === 'reconciliation'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Reconciliation
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('summary')}
            className={`py-4 px-1 border-b-2 text-sm font-medium ${
              activeTab === 'summary'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Batch Summary
          </button>
        </nav>
      </div>

      {activeTab === 'reconciliation' && (
        <div className="space-y-6">
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Filters</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Batch ID</label>
                <input
                  type="text"
                  value={reconFilters.batchId}
                  onChange={(e) => setReconFilters({ ...reconFilters, batchId: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  placeholder="Optional"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start date</label>
                <input
                  type="date"
                  value={reconFilters.startDate}
                  onChange={(e) => setReconFilters({ ...reconFilters, startDate: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End date</label>
                <input
                  type="date"
                  value={reconFilters.endDate}
                  onChange={(e) => setReconFilters({ ...reconFilters, endDate: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select
                  value={reconFilters.status}
                  onChange={(e) => setReconFilters({ ...reconFilters, status: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                >
                  <option value="">All</option>
                  <option value="pending">Pending</option>
                  <option value="processing">Processing</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={loadReconciliation}
                disabled={loading}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50"
              >
                Generate Report
              </button>
              <button
                type="button"
                onClick={exportReconciliation}
                disabled={exporting || !reconData}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
              >
                <ArrowDownTrayIcon className="h-4 w-4 mr-2" />
                {exporting ? 'Exporting...' : 'Export Excel'}
              </button>
            </div>
          </div>

          {loading && (
            <div className="flex justify-center py-12">
              <LoadingSpinner text="Generating report..." />
            </div>
          )}

          {!loading && reconData && (
            <div className="bg-white shadow rounded-lg p-6">
              {reconSummary && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-xs text-gray-500 uppercase">Total Payments</p>
                    <p className="text-lg font-semibold">{reconSummary.totalPayments}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-xs text-gray-500 uppercase">Total Amount</p>
                    <p className="text-lg font-semibold">{formatCurrency(reconSummary.totalAmount || 0)}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-xs text-gray-500 uppercase">Successful</p>
                    <p className="text-lg font-semibold">{formatCurrency(reconSummary.successfulAmount || 0)}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-xs text-gray-500 uppercase">Statuses</p>
                    <p className="text-sm">{Object.entries(reconSummary.statusBreakdown || {}).map(([k, v]) => `${k}: ${v}`).join(', ') || '—'}</p>
                  </div>
                </div>
              )}
              <div className="overflow-x-auto border border-gray-200 rounded-lg">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Batch</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {reconPayments.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-gray-500 text-sm">No payments</td>
                      </tr>
                    ) : reconPayments.map((row) => (
                      <tr key={row.internalReference} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-sm">{row.internalReference}</td>
                        <td className="px-4 py-2 text-sm">{row.batchId || '—'}</td>
                        <td className="px-4 py-2 text-sm">{formatCurrency(row.amount || 0)}</td>
                        <td className="px-4 py-2 text-sm">{row.status}</td>
                        <td className="px-4 py-2 text-sm text-gray-500">{row.createdAt ? formatDate(row.createdAt) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'summary' && (
        <div className="space-y-6">
          <div className="bg-white shadow rounded-lg p-6">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Last N days</label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={summaryDays}
                  onChange={(e) => setSummaryDays(parseInt(e.target.value, 10) || 30)}
                  className="w-32 border border-gray-300 rounded-md px-3 py-2 text-sm"
                />
              </div>
              <button
                type="button"
                onClick={loadBatchSummary}
                disabled={loading}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50"
              >
                Load Summary
              </button>
              <button
                type="button"
                onClick={exportBatchSummary}
                disabled={exporting || !summaryData}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
              >
                <ArrowDownTrayIcon className="h-4 w-4 mr-2" />
                {exporting ? 'Exporting...' : 'Export'}
              </button>
            </div>
          </div>

          {loading && (
            <div className="flex justify-center py-12">
              <LoadingSpinner text="Loading..." />
            </div>
          )}

          {!loading && summaryData && (
            <div className="bg-white shadow rounded-lg p-6">
              {batchSummary && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-xs text-gray-500">Batches</p>
                    <p className="text-lg font-semibold">{batchSummary.totalBatches}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-xs text-gray-500">Rows</p>
                    <p className="text-lg font-semibold">{batchSummary.totalRows}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-xs text-gray-500">Amount</p>
                    <p className="text-lg font-semibold">{formatCurrency(batchSummary.totalAmount || 0)}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-xs text-gray-500">Avg success</p>
                    <p className="text-lg font-semibold">{batchSummary.averageSuccessRate}%</p>
                  </div>
                </div>
              )}
              <div className="overflow-x-auto border rounded-lg">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs text-gray-500 uppercase">Batch</th>
                      <th className="px-4 py-2 text-left text-xs text-gray-500 uppercase">File</th>
                      <th className="px-4 py-2 text-left text-xs text-gray-500 uppercase">Status</th>
                      <th className="px-4 py-2 text-left text-xs text-gray-500 uppercase">Rows</th>
                      <th className="px-4 py-2 text-left text-xs text-gray-500 uppercase">Amount</th>
                      <th className="px-4 py-2 text-left text-xs text-gray-500 uppercase">Success</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {batchRows.map((b) => (
                      <tr key={b.batchId} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-sm font-medium">{b.batchId}</td>
                        <td className="px-4 py-2 text-sm">{b.originalFileName}</td>
                        <td className="px-4 py-2 text-sm">{b.status}</td>
                        <td className="px-4 py-2 text-sm">{b.successfulRows}/{b.totalRows}</td>
                        <td className="px-4 py-2 text-sm">{formatCurrency(b.totalAmount || 0)}</td>
                        <td className="px-4 py-2 text-sm">{b.successRate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Reports;