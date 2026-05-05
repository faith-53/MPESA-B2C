# MPESA B2C Bulk Payments System

A secure, standalone web-based application for managing MPESA B2C bulk payments via Excel upload without requiring ERP integration.

## Features

- **Secure Excel Upload Interface**: Web portal for uploading payment instructions
- **MPESA B2C Integration**: Direct integration with Safaricom Daraja API
- **Transaction Management**: Real-time processing and status tracking
- **Custom Reconciliation**: Generate detailed reports with internal references
- **Role-Based Security**: User authentication with different access levels

## Tech Stack

- **Frontend**: React.js with modern UI components
- **Backend**: Node.js with Express framework
- **Database**: MongoDB with encryption for sensitive data
- **API**: MPESA B2C API via Safaricom Daraja
- **Security**: JWT authentication, HTTPS, encrypted storage

## Quick Start

### Prerequisites

- Node.js (v16 or higher)
- MongoDB (local or cloud instance)
- MPESA API credentials from Safaricom Daraja

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm run install-all
   ```

3. Set up environment variables (see `.env.example` files)

4. Start the development server:
   ```bash
   npm run dev
   ```

### Environment Setup

#### Server Environment (.env in server directory)
```
PORT=5000
MONGODB_URI=mongodb://localhost:27017/mpesa-b2c
JWT_SECRET=your-jwt-secret-key
MPESA_CONSUMER_KEY=your-mpesa-consumer-key
MPESA_CONSUMER_SECRET=your-mpesa-consumer-secret
MPESA_SHORTCODE=your-business-shortcode
MPESA_PASSKEY=your-mpesa-passkey
MPESA_ENVIRONMENT=sandbox
ENCRYPTION_KEY=your-32-character-encryption-key
```

#### Client Environment (.env in client directory)
```
REACT_APP_API_URL=http://localhost:5000/api
```

## Project Structure

```
mpesa-b2c-bulk-payments/
├── client/                 # React frontend
│   ├── public/
│   ├── src/
│   │   ├── components/     # Reusable components
│   │   ├── pages/         # Page components
│   │   ├── services/      # API services
│   │   ├── utils/         # Utility functions
│   │   └── App.js
│   └── package.json
├── server/                 # Node.js backend
│   ├── controllers/       # Route controllers
│   ├── middleware/        # Custom middleware
│   ├── models/           # MongoDB models
│   ├── routes/           # API routes
│   ├── services/         # Business logic
│   ├── utils/            # Utility functions
│   ├── config/           # Configuration files
│   └── index.js
├── package.json
└── README.md
```

## Security Features

- HTTPS/TLS encryption for all communications
- JWT-based authentication with role management
- Database field encryption for sensitive data
- Secure MPESA API credential handling
- Optional IP whitelisting
- Input validation and sanitization

## Usage

1. **Login**: Access the web portal with your credentials
2. **Upload Excel**: Upload Excel files with payment data
3. **Validate**: System validates format and checks for duplicates
4. **Process**: Initiate MPESA B2C transactions
5. **Monitor**: Track transaction status in real-time
6. **Reconcile**: Generate and export detailed reports

## Excel Format

Your Excel file should contain the following columns:
- **Phone Number**: Recipient phone number (254XXXXXXXXX format)
- **Amount**: Payment amount (minimum 1 KES)
- **Internal Reference**: Your internal payment reference/tag
- **Description**: Optional payment description

## API Documentation

The API provides endpoints for:
- User authentication and management
- Excel file upload and validation
- MPESA transaction processing
- Report generation and export

## Deployment

The application is designed for AWS deployment with:
- EC2 instances for application hosting
- RDS or MongoDB Atlas for database
- S3 for file storage
- CloudFront for CDN
- SSL certificates for HTTPS

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For support and questions, please contact the development team.
