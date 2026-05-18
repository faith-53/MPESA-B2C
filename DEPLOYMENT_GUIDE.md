# MPESA B2C Bulk Payments System - Deployment Guide

## Overview

This is a complete, production-ready MPESA B2C bulk payments system that allows users to upload Excel files, process bulk payments, and generate detailed reconciliation reports.

## System Architecture

### Backend (Node.js/Express)
- **Authentication**: JWT-based with role-based access control
- **Database**: MongoDB with field-level encryption for sensitive data
- **MPESA Integration**: Direct integration with Safaricom Daraja API
- **File Processing**: Excel validation and bulk payment processing
- **Security**: Comprehensive security middleware, rate limiting, and audit logging

### Frontend (React)
- **Modern UI**: Built with Tailwind CSS and Headless UI
- **State Management**: React Query for server state, Context API for app state
- **Authentication**: Secure token-based authentication
- **Responsive Design**: Mobile-first responsive design

### Security Features
- HTTPS/TLS encryption
- JWT authentication with role-based permissions
- Database field encryption for sensitive data (phone numbers, amounts)
- Rate limiting and IP whitelisting
- Comprehensive audit logging
- Input validation and sanitization
- CORS protection
- Security headers (CSP, HSTS, etc.)

## Quick Start (Development)

### Prerequisites
- Node.js 16+ 
- MongoDB (local or cloud)
- MPESA API credentials from Safaricom Daraja

### Installation

1. **Clone and install dependencies**:
   ```bash
   git clone <repository-url>
   cd mpesa-b2c
   npm run install-all
   ```

2. **Set up environment variables**:
   ```bash
   # Server environment
   cd server
   
   # Client environment  
   cd ../client
   # Update .env with your API URL
   ```

3. **Start development servers**:
   ```bash
   npm run dev
   ```

The application will be available at:
- Frontend: http://localhost:3000
- Backend API: http://localhost:5000

## Production Deployment

### Docker Deployment

1. **Using Docker Compose**:
   
   # Start services
   docker-compose up -d
   ```

### AWS Deployment

1. **Prerequisites**:
   - AWS CLI configured
   - Domain name and SSL certificate
   - EC2 key pair

2. **Deploy infrastructure**:

## Configuration

### Required Environment Variables

#### Server (.env)
```env
# Database
MONGODB_URI=mongodb://localhost:27017/mpesa-b2c

# JWT
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRE=7d

# MPESA API
MPESA_CONSUMER_KEY=your-mpesa-consumer-key
MPESA_CONSUMER_SECRET=your-mpesa-consumer-secret  
MPESA_SHORTCODE=your-business-shortcode
MPESA_ENVIRONMENT=sandbox|production

# Encryption (32 characters)
ENCRYPTION_KEY=your-32-character-encryption-key

# Security
BCRYPT_ROUNDS=12
CORS_ORIGIN=http://localhost:3000
```

#### Client (.env)
```env
REACT_APP_API_URL=http://localhost:5000/api
```

## Excel File Format

Your Excel files should contain these columns:

| Column | Description | Required | Format |
|--------|-------------|----------|---------|
| Phone Number | Recipient phone number | Yes | 254XXXXXXXXX |
| Amount | Payment amount in KES | Yes | 1-150000 |
| Internal Reference | Your unique reference | Yes | 3-100 chars |
| Description | Payment description | No | Max 200 chars |

### Example Excel Structure:
```
Phone Number    | Amount | Internal Reference | Description
254712345678   | 1000   | REF001            | Salary payment
254723456789   | 2500   | REF002            | Bonus payment
```

## User Roles & Permissions

### Admin
- Full system access
- User management
- All payment operations
- All reports

### Finance Officer  
- Upload and process payments
- View all reports
- Cannot manage users

### User
- Upload files
- View own batches and reports
- Cannot process payments

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration  
- `GET /api/auth/me` - Get current user
- `POST /api/auth/logout` - User logout

### File Upload
- `POST /api/upload` - Upload Excel file
- `GET /api/upload/batches` - Get upload batches
- `GET /api/upload/batches/:id` - Get batch details
- `GET /api/upload/template` - Download template

### Payments
- `POST /api/payments/process/:batchId` - Process payments
- `GET /api/payments/status` - Get processing status
- `POST /api/payments/cancel` - Cancel processing

### Reports
- `GET /api/reports/reconciliation` - Reconciliation report
- `GET /api/reports/batch-summary` - Batch summary
- `GET /api/reports/dashboard` - Dashboard data

## Monitoring & Maintenance

### Health Checks
- Frontend: `GET /health`
- Backend: `GET /health`

### Logging
- Application logs in CloudWatch (AWS)
- Audit logs in MongoDB
- Security events tracked

### Backup
- MongoDB automated backups
- S3 file storage with versioning

## Security Considerations

1. **Data Protection**:
   - Phone numbers and amounts encrypted at rest
   - TLS encryption in transit
   - Secure key management

2. **Access Control**:
   - Role-based permissions
   - IP whitelisting support
   - Session management

3. **Monitoring**:
   - Failed login tracking
   - Rate limiting
   - Audit trail for all actions

## Troubleshooting

### Common Issues

1. **MPESA API Errors**:
   - Check credentials and environment
   - Verify callback URLs are accessible
   - Check rate limiting

2. **File Upload Issues**:
   - Verify file format (.xlsx/.xls)
   - Check file size limits (5MB)
   - Validate Excel structure

3. **Database Connection**:
   - Check MongoDB connection string
   - Verify network connectivity
   - Check authentication credentials

### Support

For technical support:
1. Check application logs
2. Review audit logs for security issues
3. Monitor system health endpoints
4. Contact system administrator

## Development

### Running Tests
```bash
# Backend tests
cd server
npm test

# Frontend tests  
cd client
npm test
```

### Code Quality
- ESLint configuration included
- Prettier for code formatting
- Pre-commit hooks recommended

### Contributing
1. Fork the repository
2. Create feature branch
3. Make changes with tests
4. Submit pull request

## License

This project is licensed under the MIT License. See LICENSE file for details.

---

**Important**: This system handles financial transactions. Ensure proper security measures, compliance with regulations, and thorough testing before production use.
