class ClientExcelValidator {
  constructor() {
    this.requiredColumns = ['phone_number', 'amount', 'internal_reference'];
    this.optionalColumns = ['description'];
    this.maxRows = 1000;
    this.minAmount = 1;
    this.maxAmount = 150000;
  }

  async validateFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const XLSX = require('xlsx');
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          
          if (!sheetName) {
            resolve({
              isValid: false,
              errors: [{
                type: 'file_error',
                message: 'No worksheets found in Excel file',
                suggestion: 'Please ensure your Excel file contains at least one worksheet'
              }]
            });
            return;
          }

          const worksheet = workbook.Sheets[sheetName];
          const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
          
          if (rawData.length < 2) {
            resolve({
              isValid: false,
              errors: [{
                type: 'file_error',
                message: 'Excel file must contain at least a header row and one data row',
                suggestion: 'Please ensure your Excel file has both column headers and at least one row of data'
              }]
            });
            return;
          }

          const headers = rawData[0].map(h => this.normalizeColumnName(h.toString().trim()));
          const dataRows = rawData.slice(1);
          
          const result = this.validateData(headers, dataRows);
          resolve(result);

        } catch (error) {
          resolve({
            isValid: false,
            errors: [{
              type: 'system_error',
              message: 'Failed to parse Excel file',
              suggestion: 'Please check if the file is a valid Excel file'
            }]
          });
        }
      };

      reader.onerror = () => {
        resolve({
          isValid: false,
          errors: [{
            type: 'system_error',
            message: 'Failed to read file',
            suggestion: 'Please try uploading the file again'
          }]
        });
      };

      reader.readAsArrayBuffer(file);
    });
  }

  validateData(headers, dataRows) {
    const errors = [];
    const warnings = [];
    const data = [];
    
    // Check required columns
    const missingColumns = this.requiredColumns.filter(col => !headers.includes(col));
    if (missingColumns.length > 0) {
      errors.push({
        type: 'missing_columns',
        message: `Missing required columns: ${missingColumns.join(', ')}`,
        suggestion: `Please ensure your Excel file contains these columns: ${this.requiredColumns.join(', ')}`
      });
    }

    // Check for duplicate headers
    const duplicateHeaders = headers.filter((h, i) => headers.indexOf(h) !== i && h !== '');
    if (duplicateHeaders.length > 0) {
      errors.push({
        type: 'duplicate_headers',
        message: `Duplicate column headers: ${duplicateHeaders.join(', ')}`,
        suggestion: 'Please ensure each column has a unique header name'
      });
    }

    // Process data rows
    const columnMap = this.createColumnMap(headers);
    const internalReferences = new Set();
    
    dataRows.forEach((row, index) => {
      const rowIndex = index + 2;
      const rowErrors = [];
      
      // Phone number validation
      if (columnMap.phone_number !== undefined) {
        const phone = this.cleanValue(row[columnMap.phone_number]);
        const phoneValidation = this.validatePhoneNumber(phone);
        if (!phoneValidation.isValid) {
          rowErrors.push({
            type: 'phone_error',
            row: rowIndex,
            field: 'phone_number',
            message: phoneValidation.error,
            suggestion: 'Use format: 254XXXXXXXXX'
          });
        }
      }

      // Amount validation
      if (columnMap.amount !== undefined) {
        const amount = row[columnMap.amount]; // keep raw value
        const amountValidation = this.validateAmount(amount);
        if (!amountValidation.isValid) {
          rowErrors.push({
            type: 'amount_error',
            row: rowIndex,
            field: 'amount',
            message: amountValidation.error,
            suggestion: 'Amount must be between 1 and 150,000 KES'
          });
        }
      }

      // Internal reference validation
      if (columnMap.internal_reference !== undefined) {
        const ref = this.cleanValue(row[columnMap.internal_reference]);
        const refValidation = this.validateInternalReference(ref);
        if (!refValidation.isValid) {
          rowErrors.push({
            type: 'reference_error',
            row: rowIndex,
            field: 'internal_reference',
            message: refValidation.error,
            suggestion: 'Must be unique, 3-100 characters'
          });
        } else if (internalReferences.has(ref)) {
          rowErrors.push({
            type: 'duplicate_reference',
            row: rowIndex,
            field: 'internal_reference',
            message: 'Duplicate internal reference',
            suggestion: 'Each reference must be unique within the file'
          });
        } else {
          internalReferences.add(ref);
        }
      }

      if (rowErrors.length > 0) {
        errors.push(...rowErrors);
      } else {
        data.push({
          phone_number: columnMap.phone_number !== undefined ? this.cleanValue(row[columnMap.phone_number]) : '',
          amount: columnMap.amount !== undefined ? this.cleanValue(row[columnMap.amount]) : '',
          internal_reference: columnMap.internal_reference !== undefined ? this.cleanValue(row[columnMap.internal_reference]) : '',
          description: columnMap.description !== undefined ? this.cleanValue(row[columnMap.description]) : '',
          rowNumber: rowIndex
        });
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      data,
      statistics: {
        totalRows: dataRows.length,
        validRows: data.length,
        invalidRows: errors.length,
        duplicateReferences: Array.from(internalReferences).length
      }
    };
  }

  validateHeaders(headers) {
    const missingColumns = this.requiredColumns.filter(col => !headers.includes(col));
    const duplicateHeaders = headers.filter((h, i) => headers.indexOf(h) !== i && h !== '');
    
    return {
      missingColumns,
      duplicateHeaders,
      availableColumns: headers
    };
  }

  validatePhoneNumber(phone) {
    if (!phone) return { isValid: false, error: 'Phone number is required' };
    
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = '254' + cleaned.substring(1);
    } else if (cleaned.startsWith('7') || cleaned.startsWith('1')) {
      cleaned = '254' + cleaned;
    }

    if (!/^254[0-9]{9}$/.test(cleaned)) {
      return { isValid: false, error: 'Invalid Kenyan phone number format' };
    }

    return { isValid: true, cleanedNumber: cleaned };
  }

  validateAmount(amount) {
    if (!amount && amount !== 0) return { isValid: false, error: 'Amount is required' };
    
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount)) return { isValid: false, error: 'Amount must be a number' };
    
    if (numAmount < this.minAmount || numAmount > this.maxAmount) {
      return { isValid: false, error: `Amount must be between ${this.minAmount} and ${this.maxAmount} KES` };
    }

    return { isValid: true, cleanedAmount: Math.round(numAmount * 100) / 100 };
  }

  validateInternalReference(ref) {
    if (!ref) return { isValid: false, error: 'Internal reference is required' };
    if (ref.length < 3) return { isValid: false, error: 'Must be at least 3 characters' };
    if (ref.length > 100) return { isValid: false, error: 'Cannot exceed 100 characters' };
    if (!/^[a-zA-Z0-9_-]+$/.test(ref)) return { isValid: false, error: 'Invalid characters' };
    
    return { isValid: true, cleanedReference: ref.trim() };
  }

  validateDescription(desc) {
    return desc ? desc.trim().substring(0, 200) : '';
  }

  normalizeColumnName(columnName) {
    return columnName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  }

  createColumnMap(headers) {
    const map = {};
    headers.forEach((header, index) => {
      if (this.requiredColumns.includes(header) || this.optionalColumns.includes(header)) {
        map[header] = index;
      }
    });
    return map;
  }

  cleanValue(value) {
    if (value === null || value === undefined) return '';
    return value.toString().trim();
  }
}

export default ClientExcelValidator;
