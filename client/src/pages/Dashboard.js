import React from 'react';
import { useQuery } from 'react-query';
import { 
  DocumentArrowUpIcon,
  FolderIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  CurrencyDollarIcon,
} from '@heroicons/react/24/outline';
import { motion } from 'framer-motion';

import { reportsService, formatCurrency, formatRelativeTime } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';

const Dashboard = () => {
  const { user } = useAuth();

  // Fetch dashboard data
  const { data: dashboardData, isLoading, error } = useQuery(
    ['dashboard', { days: 7 }],
    () => reportsService.getDashboard({ days: 7 }),
    {
      refetchInterval: 30000, // Refetch every 30 seconds
    }
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="large" text="Loading dashboard..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-red-600 mb-2">Failed to load dashboard data</div>
        <p className="text-gray-500">Please try refreshing the page</p>
      </div>
    );
  }

  const dashboard = dashboardData?.data || {};
  const { batchStatistics = [], paymentStatistics = [], recentActivity = [] } = dashboard;

  // Calculate totals
  const totalBatches = batchStatistics.reduce((sum, stat) => sum + stat.count, 0);
  const totalPayments = paymentStatistics.reduce((sum, stat) => sum + stat.count, 0);
  const totalAmount = batchStatistics.reduce((sum, stat) => sum + (stat.totalAmount || 0), 0);
  const successfulAmount = batchStatistics.reduce((sum, stat) => sum + (stat.successfulAmount || 0), 0);

  // Get status counts
  const completedBatches = batchStatistics.find(s => s._id === 'completed')?.count || 0;
  const failedBatches = batchStatistics.find(s => s._id === 'failed')?.count || 0;
  const processingBatches = batchStatistics.find(s => s._id === 'processing')?.count || 0;
  const pendingBatches = batchStatistics.find(s => s._id === 'pending')?.count || 0;

  const stats = [
    {
      name: 'Total Batches',
      value: totalBatches,
      icon: FolderIcon,
      change: '+12%',
      changeType: 'positive',
    },
    {
      name: 'Total Payments',
      value: totalPayments.toLocaleString(),
      icon: DocumentArrowUpIcon,
      change: '+8%',
      changeType: 'positive',
    },
    {
      name: 'Total Amount',
      value: formatCurrency(totalAmount),
      icon: CurrencyDollarIcon,
      change: '+15%',
      changeType: 'positive',
    },
    {
      name: 'Success Rate',
      value: totalAmount > 0 ? `${Math.round((successfulAmount / totalAmount) * 100)}%` : '0%',
      icon: CheckCircleIcon,
      change: '+2%',
      changeType: 'positive',
    },
  ];

  const statusStats = [
    { name: 'Completed', count: completedBatches, color: 'green', icon: CheckCircleIcon },
    { name: 'Processing', count: processingBatches, color: 'blue', icon: ClockIcon },
    { name: 'Failed', count: failedBatches, color: 'red', icon: XCircleIcon },
    { name: 'Pending', count: pendingBatches, color: 'yellow', icon: ClockIcon },
  ];

  return (
    <div className="space-y-6">
      {/* Welcome message */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-lg shadow p-6"
      >
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Welcome back, {user?.firstName}!
        </h1>
        <p className="text-gray-600">
          Here's an overview of your MPESA B2C payment activities from the last 7 days.
        </p>
      </motion.div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat, index) => (
          <motion.div
            key={stat.name}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className="card p-6"
          >
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <stat.icon className="h-8 w-8 text-gray-400" />
              </div>
              <div className="ml-4 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">
                    {stat.name}
                  </dt>
                  <dd className="flex items-baseline">
                    <div className="text-2xl font-semibold text-gray-900">
                      {stat.value}
                    </div>
                    <div className={`ml-2 flex items-baseline text-sm font-semibold ${
                      stat.changeType === 'positive' ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {stat.change}
                    </div>
                  </dd>
                </dl>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Status breakdown */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="card p-6"
        >
          <h3 className="text-lg font-medium text-gray-900 mb-4">Batch Status</h3>
          <div className="space-y-4">
            {statusStats.map((status) => (
              <div key={status.name} className="flex items-center justify-between">
                <div className="flex items-center">
                  <status.icon className={`h-5 w-5 text-${status.color}-500 mr-2`} />
                  <span className="text-sm text-gray-600">{status.name}</span>
                </div>
                <span className="text-sm font-semibold text-gray-900">
                  {status.count}
                </span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Recent activity */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="lg:col-span-2 card p-6"
        >
          <h3 className="text-lg font-medium text-gray-900 mb-4">Recent Activity</h3>
          {recentActivity.length > 0 ? (
            <div className="space-y-4">
              {recentActivity.map((activity, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {activity.fileName}
                    </p>
                    <p className="text-xs text-gray-500">
                      {activity.totalRows} payments • {formatCurrency(activity.totalAmount)}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className={`status-${activity.status}`}>
                      {activity.status}
                    </span>
                    <p className="text-xs text-gray-500 mt-1">
                      {formatRelativeTime(activity.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              No recent activity found
            </div>
          )}
        </motion.div>
      </div>

      {/* Quick actions */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="card p-6"
      >
        <h3 className="text-lg font-medium text-gray-900 mb-4">Quick Actions</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <a
            href="/upload"
            className="flex items-center p-4 border-2 border-dashed border-gray-300 rounded-lg hover:border-primary-300 hover:bg-primary-50 transition-colors"
          >
            <DocumentArrowUpIcon className="h-8 w-8 text-gray-400 mr-3" />
            <div>
              <p className="font-medium text-gray-900">Upload Excel</p>
              <p className="text-sm text-gray-500">Start new batch</p>
            </div>
          </a>
          
          <a
            href="/batches"
            className="flex items-center p-4 border-2 border-dashed border-gray-300 rounded-lg hover:border-primary-300 hover:bg-primary-50 transition-colors"
          >
            <FolderIcon className="h-8 w-8 text-gray-400 mr-3" />
            <div>
              <p className="font-medium text-gray-900">View Batches</p>
              <p className="text-sm text-gray-500">Manage uploads</p>
            </div>
          </a>
          
          <a
            href="/reports"
            className="flex items-center p-4 border-2 border-dashed border-gray-300 rounded-lg hover:border-primary-300 hover:bg-primary-50 transition-colors"
          >
            <CheckCircleIcon className="h-8 w-8 text-gray-400 mr-3" />
            <div>
              <p className="font-medium text-gray-900">Generate Reports</p>
              <p className="text-sm text-gray-500">View reconciliation</p>
            </div>
          </a>
        </div>
      </motion.div>
    </div>
  );
};

export default Dashboard;
