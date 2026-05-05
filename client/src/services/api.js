import axios from 'axios';

// Create axios instance
const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Handle 401 errors (unauthorized)
    if (error.response?.status === 401) {
      // Clear token and redirect to login
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    
    // Handle network errors
    if (!error.response) {
      error.message = 'Network error. Please check your connection.';
    }
    
    // Ensure error messages are properly formatted
    if (error.response?.data) {
      error.message = error.response.data.error || error.response.data.message || 'An error occurred';
    }
    
    return Promise.reject(error);
  }
);

// Auth service
export const authService = {
  // Set auth token in headers
  setAuthToken: (token) => {
    if (token) {
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      delete api.defaults.headers.common['Authorization'];
    }
  },

  // Login
  login: (credentials) => api.post('/auth/login', credentials),
  
  // Register
  register: (userData) => api.post('/auth/register', userData),
  
  // Get current user
  getCurrentUser: () => api.get('/auth/me'),
  
  // Update profile
  updateProfile: (profileData) => api.put('/auth/profile', profileData),
  
  // Change password
  changePassword: (passwordData) => api.put('/auth/password', passwordData),
  
  // Logout
  logout: () => api.post('/auth/logout'),
};

// Upload service
export const uploadService = {
  // Upload Excel file
  uploadFile: (formData, onUploadProgress) => 
    api.post('/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress,
    }),
  
  // Get upload batches
  getBatches: (params) => api.get('/upload/batches', { params }),
  
  // Get specific batch
  getBatch: (batchId) => api.get(`/upload/batches/${batchId}`),
  
  // Cancel batch
  cancelBatch: (batchId) => api.delete(`/upload/batches/${batchId}`),
  
  // Get upload statistics
  getStats: (params) => api.get('/upload/stats', { params }),
  
  // Download template
  downloadTemplate: () => api.get('/upload/template', { responseType: 'blob' }),
};

// Payment service
export const paymentService = {
  // Process payments for batch
  processBatch: (batchId) => api.post(`/payments/process/${batchId}`),
  
  // Retry failed payments
  retryBatch: (batchId) => api.post(`/payments/retry/${batchId}`),
  
  // Get processing status
  getStatus: () => api.get('/payments/status'),
  
  // Cancel processing
  cancelProcessing: () => api.post('/payments/cancel'),
  
  // Get payments for batch
  getBatchPayments: (batchId, params) => api.get(`/payments/batch/${batchId}`, { params }),
  
  // Get specific payment
  getPayment: (paymentId) => api.get(`/payments/${paymentId}`),
  
  // Test MPESA connectivity
  testConnectivity: () => api.get('/payments/test/connectivity'),
  
  // Get account balance
  getBalance: () => api.get('/payments/mpesa/balance'),
  
  // Query transaction status
  queryStatus: (conversationId, originatorConversationId) => 
    api.get(`/payments/mpesa/status/${conversationId}`, {
      params: { originatorConversationId }
    }),
};

// Reports service
export const reportsService = {
  // Get reconciliation report
  getReconciliation: (params) => api.get('/reports/reconciliation', { params }),
  
  // Download reconciliation report
  downloadReconciliation: (params) => 
    api.get('/reports/reconciliation', { 
      params: { ...params, format: 'excel' },
      responseType: 'blob'
    }),
  
  // Get batch summary
  getBatchSummary: (params) => api.get('/reports/batch-summary', { params }),
  
  // Download batch summary
  downloadBatchSummary: (params) => 
    api.get('/reports/batch-summary', { 
      params: { ...params, format: 'excel' },
      responseType: 'blob'
    }),
  
  // Get dashboard data
  getDashboard: (params) => api.get('/reports/dashboard', { params }),
};

// Users service
export const usersService = {
  // Get all users
  getUsers: (params) => api.get('/users', { params }),
  
  // Get specific user
  getUser: (userId) => api.get(`/users/${userId}`),
  
  // Create user
  createUser: (userData) => api.post('/users', userData),
  
  // Update user
  updateUser: (userId, userData) => api.put(`/users/${userId}`, userData),
  
  // Delete user
  deleteUser: (userId) => api.delete(`/users/${userId}`),
  
  // Reset user password
  resetPassword: (userId, passwordData) => api.post(`/users/${userId}/reset-password`, passwordData),
  
  // Get user statistics
  getStats: (params) => api.get('/users/stats/overview', { params }),
  
  // Get security events
  getSecurityEvents: (params) => api.get('/users/security/events', { params }),
};

// Utility functions
export const downloadFile = (blob, filename) => {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

export const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const formatCurrency = (amount, currency = 'KES') => {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
};

export const formatDate = (date, options = {}) => {
  const defaultOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  };
  
  return new Intl.DateTimeFormat('en-US', { ...defaultOptions, ...options }).format(new Date(date));
};

export const formatRelativeTime = (date) => {
  const now = new Date();
  const diffInSeconds = Math.floor((now - new Date(date)) / 1000);
  
  if (diffInSeconds < 60) return 'Just now';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} minutes ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hours ago`;
  if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)} days ago`;
  
  return formatDate(date, { year: 'numeric', month: 'short', day: 'numeric' });
};

export default api;
