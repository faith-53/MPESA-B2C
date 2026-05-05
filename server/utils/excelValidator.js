const XLSX = require('xlsx');
const crypto = require('crypto');

class ExcelValidator {
  constructor() {
    this.requiredColumns = [
      'phone_number',
      'amount', 
      'internal_reference'
    ];
    this.optionalColumns = [
      'description'
    ];
    this.maxRows = 1000; // Maximum rows per upload
    this.minAmount = 1;
    this.maxAmount = 150000; // MPESA B2C limits
  }

  /**
   * Parse and validate Excel file
   * @param {Buffer} fileBuffer - Excel file buffer
   * @param {string} fileName - Original file name
   * @returns {Object} Validation result
   */
  async validateFile(fileBuffer, fileName) {
    const result = {
      isValid: false,
      data: [],
      errors: [],
      warnings: [],
      statistics: {
        totalRows: 0,
        validRows: 0,
        invalidRows: 0,
        totalAmount: 0,
        duplicateReferences: [],
        fileHash: null,
        fileSize: fileBuffer.length
      }
    };

    try {
      // Generate file hash for duplicate detection
      result.statistics.fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      // Parse Excel file
      const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      
      if (!sheetName) {
        result.errors.push({
          row: 0,
          field: 'file',
          error: 'No worksheets found in Excel file',
          value: null
        });
        return result;
      }

      const worksheet = workbook.Sheets[sheetName];
      const rawData = XLSX.utils.sheet_to_json(worksheet, { 
        header: 1,
        defval: '',
        blankrows: false
      });

      if (rawData.length < 2) {
        result.errors.push({
          row: 0,
          field: 'file',
          error: 'Excel file must contain at least a header row and one data row',
          value: null,
          suggestion: 'Please ensure your Excel file has both column headers and at least one row of data'
        });
        return result;
      }

      // Get headers and normalize them
      const headers = rawData[0].map(header => 
        this.normalizeColumnName(header.toString().trim())
      );

      // Validate headers
      const headerValidation = this.validateHeaders(headers);
      if (!headerValidation.isValid) {
        result.errors.push(...headerValidation.errors);
        return result;
      }

      // Create column mapping
      const columnMap = this.createColumnMap(headers);
      
      // Process data rows
      const dataRows = rawData.slice(1);
      result.statistics.totalRows = dataRows.length;

      if (dataRows.length > this.maxRows) {
        result.errors.push({
          row: 0,
          field: 'file',
          error: `File contains ${dataRows.length} rows. Maximum allowed is ${this.maxRows}`,
          value: dataRows.length
        });
        return result;
      }

      // Track internal references for duplicate detection
      const internalReferences = new Set();
      const duplicateReferences = new Set();

      // Validate each data row
      for (let i = 0; i < dataRows.length; i++) {
        const rowIndex = i + 2; // Excel row number (1-based + header)
        const row = dataRows[i];
        
        const validationResult = this.validateRow(row, columnMap, rowIndex);
        
        if (validationResult.isValid) {
          const rowData = validationResult.data;
          
          // Check for duplicate internal reference
          if (internalReferences.has(rowData.internal_reference)) {
            duplicateReferences.add(rowData.internal_reference);
            result.errors.push({
              row: rowIndex,
              field: 'internal_reference',
              error: 'Duplicate internal reference found',
              value: rowData.internal_reference
            });
            result.statistics.invalidRows++;
          } else {
            internalReferences.add(rowData.internal_reference);
            result.data.push({
              ...rowData,
              rowNumber: rowIndex
            });
            result.statistics.validRows++;
            result.statistics.totalAmount += rowData.amount;
          }
        } else {
          result.errors.push(...validationResult.errors);
          result.statistics.invalidRows++;
        }
      }

      result.statistics.duplicateReferences = Array.from(duplicateReferences);

      // Add warnings
      if (result.statistics.invalidRows > 0) {
        result.warnings.push(`${result.statistics.invalidRows} rows contain errors and will be skipped`);
      }

      if (result.statistics.duplicateReferences.length > 0) {
        result.warnings.push(`${result.statistics.duplicateReferences.length} duplicate internal references found`);
      }

      // File is valid if we have at least one valid row and no critical errors
      result.isValid = result.statistics.validRows > 0;

      return result;

    } catch (error) {
      console.error('Excel validation error:', error);
      result.errors.push({
        row: 0,
        field: 'file',
        error: `Failed to parse Excel file: ${error.message}`,
        value: null
      });
      return result;
    }
  }

  /**
   * Validate Excel headers
   * @param {Array} headers - Column headers
   * @returns {Object} Validation result
   */
  validateHeaders(headers) {
    const result = {
      isValid: true,
      errors: []
    };

    // Check for required columns
    for (const required of this.requiredColumns) {
      if (!headers.includes(required)) {
        result.errors.push({
          row: 1,
          field: 'headers',
          error: `Missing required column: ${required}`,
          value: headers.join(', ')
        });
        result.isValid = false;
      }
    }

    // Check for duplicate headers
    const duplicates = headers.filter((header, index) => 
      headers.indexOf(header) !== index && header !== ''
    );

    if (duplicates.length > 0) {
      result.errors.push({
        row: 1,
        field: 'headers',
        error: `Duplicate column headers found: ${duplicates.join(', ')}`,
        value: headers.join(', ')
      });
      result.isValid = false;
    }

    return result;
  }

  /**
   * Validate individual row data
   * @param {Array} row - Row data
   * @param {Object} columnMap - Column mapping
   * @param {number} rowIndex - Row index for error reporting
   * @returns {Object} Validation result
   */
  validateRow(row, columnMap, rowIndex) {
    const result = {
      isValid: true,
      data: {},
      errors: []
    };

    try {
      // Phone number validation
      const phoneNumber = this.cleanValue(row[columnMap.phone_number]);
      const phoneValidation = this.validatePhoneNumber(phoneNumber);
      if (!phoneValidation.isValid) {
        result.errors.push({
          row: rowIndex,
          field: 'phone_number',
          error: phoneValidation.error,
          value: phoneNumber
        });
        result.isValid = false;
      } else {
        result.data.phone_number = phoneValidation.cleanedNumber;
      }

      // Amount validation
      const amount = row[columnMap.amount]; 
      const amountValidation = this.validateAmount(amount);
      if (!amountValidation.isValid) {
        result.errors.push({
          row: rowIndex,
          field: 'amount',
          error: amountValidation.error,
          value: amount
        });
        result.isValid = false;
      } else {
        result.data.amount = amountValidation.cleanedAmount;
      }

      // Internal reference validation
      const internalReference = this.cleanValue(row[columnMap.internal_reference]);
      const referenceValidation = this.validateInternalReference(internalReference);
      if (!referenceValidation.isValid) {
        result.errors.push({
          row: rowIndex,
          field: 'internal_reference',
          error: referenceValidation.error,
          value: internalReference
        });
        result.isValid = false;
      } else {
        result.data.internal_reference = referenceValidation.cleanedReference;
      }

      // Description validation (optional)
      const description = this.cleanValue(row[columnMap.description] || '');
      result.data.description = this.validateDescription(description);

    } catch (error) {
      result.errors.push({
        row: rowIndex,
        field: 'general',
        error: `Row processing error: ${error.message}`,
        value: null
      });
      result.isValid = false;
    }

    return result;
  }

  /**
   * Validate phone number
   * @param {string} phoneNumber - Phone number to validate
   * @returns {Object} Validation result
   */
  validatePhoneNumber(phoneNumber) {
    if (!phoneNumber) {
      return { isValid: false, error: 'Phone number is required' };
    }

    // Remove all non-digit characters
    let cleaned = phoneNumber.replace(/\D/g, '');
    const original = phoneNumber;

    // Handle different formats
    if (cleaned.startsWith('0')) {
      cleaned = '254' + cleaned.substring(1);
    } else if (cleaned.startsWith('254')) {
      // Already in correct format
    } else if (cleaned.startsWith('7') || cleaned.startsWith('1')) {
      cleaned = '254' + cleaned;
    } else {
      return { 
        isValid: false, 
        error: `Invalid phone number format "${original}". Use 254XXXXXXXXX, 0XXXXXXXXX, or XXXXXXXXX` 
      };
    }

    // Validate Kenyan phone number format
    if (!/^254[0-9]{9}$/.test(cleaned)) {
      return { 
        isValid: false, 
        error: `Invalid Kenyan phone number "${original}". Must be 12 digits starting with 254 (converted to: ${cleaned})` 
      };
    }

    // Validate network prefixes (Safaricom, Airtel, Telkom)
    const validPrefixes = ['254700', '254701', '254702', '254703', '254704', '254705', '254706', '254707', '254708', '254709', '254710', '254711', '254712', '254713', '254714', '254715', '254716', '254717', '254718', '254719', '254720', '254721', '254722', '254723', '254724', '254725', '254726', '254727', '254728', '254729', '254740', '254741', '254742', '254743', '254744', '254745', '254746', '254747', '254748', '254749', '254750', '254751', '254752', '254753', '254754', '254755', '254756', '254757', '254758', '254759', '254760', '254761', '254762', '254763', '254764', '254765', '254766', '254767', '254768', '254769', '254770', '254771', '254772', '254773', '254774', '254775', '254776', '254777', '254778', '254779'];
    
    if (!/^254(7\d{8}|1\d{8})$/.test(cleaned)) {
      return { 
        isValid: false, 
        error: `Phone number "${original}" must be a valid Kenyan mobile number` 
      };
    }

    return { isValid: true, cleanedNumber: cleaned };
  }

  /**
   * Validate amount
   * @param {string|number} amount - Amount to validate
   * @returns {Object} Validation result
   */
  validateAmount(amount) {
  if (amount === undefined || amount === null || amount === '') {
    return { isValid: false, error: 'Amount is required' };
  }

  // Normalize input (handles "1,500", " 1500 ", etc.)
  const normalized = amount.toString().replace(/,/g, '').trim();

  const numAmount = parseFloat(normalized);

  if (isNaN(numAmount)) {
    return { isValid: false, error: `Amount "${amount}" must be a valid number` };
  }

  if (numAmount < this.minAmount) {
    return { 
      isValid: false, 
      error: `Amount "${amount}" must be at least ${this.minAmount} KES` 
    };
  }

  if (numAmount > this.maxAmount) {
    return { 
      isValid: false, 
      error: `Amount "${amount}" cannot exceed ${this.maxAmount} KES` 
    };
  }

  return { 
    isValid: true, 
    cleanedAmount: Number(numAmount) // always return number
  };
}

  /**
   * Validate internal reference
   * @param {string} reference - Internal reference to validate
   * @returns {Object} Validation result
   */
  validateInternalReference(reference) {
    if (!reference) {
      return { isValid: false, error: 'Internal reference is required' };
    }

    if (reference.length < 3) {
      return { 
        isValid: false, 
        error: 'Internal reference must be at least 3 characters long' 
      };
    }

    if (reference.length > 100) {
      return { 
        isValid: false, 
        error: 'Internal reference cannot exceed 100 characters' 
      };
    }

    // Check for valid characters (alphanumeric, hyphens, underscores)
    if (!/^[a-zA-Z0-9_-]+$/.test(reference)) {
      return { 
        isValid: false, 
        error: 'Internal reference can only contain letters, numbers, hyphens, and underscores' 
      };
    }

    return { isValid: true, cleanedReference: reference.trim() };
  }

  /**
   * Validate description (optional field)
   * @param {string} description - Description to validate
   * @returns {string} Cleaned description
   */
  validateDescription(description) {
    if (!description) return '';
    
    // Clean and truncate description
    const cleaned = description.trim();
    return cleaned.length > 200 ? cleaned.substring(0, 200) : cleaned;
  }

  /**
   * Normalize column names for mapping
   * @param {string} columnName - Original column name
   * @returns {string} Normalized column name
   */
  normalizeColumnName(columnName) {
    const normalized = columnName
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '');

    // Map common variations
    const mappings = {
      'phone': 'phone_number',
      'mobile': 'phone_number',
      'number': 'phone_number',
      'msisdn': 'phone_number',
      'amt': 'amount',
      'value': 'amount',
      'sum': 'amount',
      'reference': 'internal_reference',
      'ref': 'internal_reference',
      'id': 'internal_reference',
      'tag': 'internal_reference',
      'desc': 'description',
      'note': 'description',
      'comment': 'description',
      'remarks': 'description'
    };

    return mappings[normalized] || normalized;
  }

  /**
   * Create column mapping from headers
   * @param {Array} headers - Normalized headers
   * @returns {Object} Column mapping
   */
  createColumnMap(headers) {
    const map = {};
    
    headers.forEach((header, index) => {
      if (this.requiredColumns.includes(header) || this.optionalColumns.includes(header)) {
        map[header] = index;
      }
    });

    return map;
  }

  /**
   * Clean cell value
   * @param {any} value - Cell value
   * @returns {string} Cleaned value
   */
  cleanValue(value) {
    if (value === null || value === undefined) return '';
    return value.toString().trim();
  }
}

module.exports = ExcelValidator;
