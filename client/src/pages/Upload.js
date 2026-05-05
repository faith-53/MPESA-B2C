import React, { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { uploadService, formatFileSize, formatRelativeTime, downloadFile } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';

const Upload = () => {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [validationErrors, setValidationErrors] = useState([]);
  const [showValidationErrors, setShowValidationErrors] = useState(false);

  // Fetch upload batches on component mount
  useEffect(() => {
    fetchBatches();
  }, []);

  const fetchBatches = async () => {
    try {
      setLoading(true);
      const response = await uploadService.getBatches();
      setBatches(response.data?.batches || []);
    } catch (err) {
      setError('Failed to fetch upload batches');
      setBatches([]); // Ensure batches is always an array
    } finally {
      setLoading(false);
    }
  };

  const onDrop = useCallback(async (acceptedFiles) => {
    // Filter for Excel files only
    const excelFiles = acceptedFiles.filter(file => 
      file.type === 'application/vnd.ms-excel' ||
      file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    
    if (excelFiles.length === 0) {
      setError('Please select valid Excel files (.xls, .xlsx)');
      return;
    }
    
    // Set the file directly without client-side validation
    setFiles(excelFiles);
    setError(null);
    setValidationErrors([]);
    setShowValidationErrors(false);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx']
    },
    maxFiles: 1
  });

  const handleUpload = async () => {
    if (files.length === 0) return;

    const file = files[0];
    const formData = new FormData();
    formData.append('file', file);

    try {
      setUploading(true);
      setUploadProgress(0);
      setError(null);
      setValidationErrors([]);
      setShowValidationErrors(false);

      await uploadService.uploadFile(formData, (progressEvent) => {
        const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        setUploadProgress(percentCompleted);
      });

      setSuccess(`File "${file.name}" uploaded successfully!`);
      setFiles([]);
      await fetchBatches();
    } catch (err) {
      // Handle validation errors specifically
      if (err.response?.data?.validationErrors) {
        setValidationErrors(err.response.data.validationErrors);
        setShowValidationErrors(true);
        setError(`File validation failed: ${err.response.data.message || 'Please check the errors below'}`);
      } else if (err.response?.data?.errors) {
        // Format server validation errors for display
        const formattedErrors = err.response.data.errors.map(error => ({
          field: error.field || 'file',
          error: error.error || error.message || 'Validation error',
          row: error.row || 0,
          value: error.value || null
        }));
        setValidationErrors(formattedErrors);
        setShowValidationErrors(true);
        setError(`File validation failed: ${err.response.data.message || 'Please check the errors below'}`);
      } else if (err.response?.status === 400) {
        // Handle generic 400 errors with more detail
        setError(err.response.data?.message || err.response.data?.error || 'Invalid file format or content');
      } else {
        setError(err.response?.data?.message || 'Upload failed. Please try again.');
      }
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const response = await uploadService.downloadTemplate();
      downloadFile(response.data, 'payment_template.xlsx');
    } catch (err) {
      setError('Failed to download template');
    }
  };

  const getStatusColor = (status) => {
    const colors = {
      validating: 'text-yellow-600 bg-yellow-50',
      validated: 'text-green-600 bg-green-50',
      processing: 'text-blue-600 bg-blue-50',
      completed: 'text-green-600 bg-green-50',
      failed: 'text-red-600 bg-red-50',
      cancelled: 'text-gray-600 bg-gray-50'
    };
    return colors[status] || 'text-gray-600 bg-gray-50';
  };

  const getErrorTypeColor = (errorType) => {
    const colors = {
      phone_number: 'text-red-600',
      amount: 'text-orange-600',
      internal_reference: 'text-purple-600',
      headers: 'text-blue-600',
      file: 'text-gray-600'
    };
    return colors[errorType] || 'text-gray-600';
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Upload Excel File</h1>
        <p className="text-gray-600">Upload payment data via Excel file for processing</p>
      </div>

      {/* Success/Error Messages */}
      {success && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-md">
          <p className="text-green-800">{success}</p>
        </div>
      )}
      
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
          <p className="text-red-800">{error}</p>
        </div>
      )}

      {/* Validation Errors */}
      {showValidationErrors && validationErrors.length > 0 && (
        <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-yellow-800">Validation Errors</h3>
            <button
              onClick={() => setShowValidationErrors(false)}
              className="text-yellow-600 hover:text-yellow-800"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {validationErrors.map((error, index) => (
              <div key={index} className="text-sm text-yellow-700 mb-1">
                <span className={`font-medium ${getErrorTypeColor(error.field)}`}>
                  {error.field}:
                </span>{' '}
                {error.error} {error.value && `(${error.value})`}
                {error.row && <span className="text-gray-500"> - Row {error.row}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upload Section */}
      <div className="bg-white shadow rounded-lg mb-8">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">File Upload</h2>
        </div>
        
        <div className="p-6">
          {/* Dropzone */}
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
            }`}
          >
            <input {...getInputProps()} />
            <div className="space-y-2">
              <svg className="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48">
                <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l8.828-8.828a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div className="text-sm text-gray-600">
                {isDragActive ? (
                  <p>Drop the Excel file here...</p>
                ) : (
                  <p>
                    Drag & drop an Excel file here, or{' '}
                    <span className="text-blue-600 hover:text-blue-500">click to select</span>
                  </p>
                )}
              </div>
              <p className="text-xs text-gray-500">Supports .xls and .xlsx files</p>
            </div>
          </div>

          {/* Selected Files */}
          {files.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-medium text-gray-900 mb-2">Selected File:</h3>
              <div className="bg-gray-50 rounded-md p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{files[0].name}</p>
                    <p className="text-sm text-gray-500">{formatFileSize(files[0].size)}</p>
                  </div>
                  <button
                    onClick={() => setFiles([])}
                    className="text-red-600 hover:text-red-500 text-sm"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Upload Progress */}
          {uploading && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-900">Uploading...</span>
                <span className="text-sm text-gray-600">{uploadProgress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Template Requirements */}
          <div className="mt-4 p-4 bg-blue-50 rounded-md">
            <h4 className="text-sm font-medium text-blue-900 mb-2">Template Requirements</h4>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• Required columns: <strong>phone_number</strong>, <strong>amount</strong>, <strong>internal_reference</strong></li>
              <li>• Optional column: <strong>description</strong></li>
              <li>• Phone format: 254XXXXXXXXX (Kenyan mobile numbers)</li>
              <li>• Amount: 1 - 150,000 KES</li>
              <li>• Max 1,000 rows per file</li>
            </ul>
          </div>

          {/* Action Buttons */}
          <div className="mt-6 flex items-center justify-between">
            <button
              onClick={handleDownloadTemplate}
              className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              <svg className="-ml-1 mr-2 h-5 w-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Download Template
            </button>
            
            <button
              onClick={handleUpload}
              disabled={files.length === 0 || uploading}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? (
                <>
                  <LoadingSpinner size="sm" className="mr-2" />
                  Uploading...
                </>
              ) : (
                <>
                  <svg className="-ml-1 mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Upload File
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Upload History */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Upload History</h2>
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
              <p>No uploads yet</p>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    File Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Rows
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Uploaded
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
              {(batches || []).map((batch) => (
                  <tr key={batch._id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{batch.originalFileName}</div>
                      <div className="text-sm text-gray-500">Batch ID: {batch.batchId}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(batch.status)}`}>
                        {batch.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {batch.totalRows || 0}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      KES {batch.totalAmount?.toLocaleString() || 0}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatRelativeTime(batch.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default Upload;
