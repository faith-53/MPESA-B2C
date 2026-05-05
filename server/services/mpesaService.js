const axios = require("axios");
const { MPESAError } = require("../middleware/errorHandler");

class MPESAService {
  constructor() {
    this.consumerKey = process.env.MPESA_CONSUMER_KEY;
    this.consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    this.shortcode = process.env.MPESA_SHORTCODE;
    this.initiatorName = process.env.INITIATOR_NAME;
    this.securityCredential = process.env.SECURITY_CREDENTIAL;

    this.environment = process.env.MPESA_ENVIRONMENT || "sandbox";

    this.baseURL =
      this.environment === "production"
        ? "https://api.safaricom.co.ke"
        : "https://sandbox.safaricom.co.ke";

    this.accessToken = null;
    this.tokenExpiry = null;

    // Rate limiting
    this.requestQueue = [];
    this.isProcessingQueue = false;
    this.maxRequestsPerSecond = 5;
    this.requestInterval = 1000 / this.maxRequestsPerSecond;

    this.validateConfiguration();
  }

  validateConfiguration() {
    const required = [
      "MPESA_CONSUMER_KEY",
      "MPESA_CONSUMER_SECRET",
      "MPESA_SHORTCODE",
      "INITIATOR_NAME",
      "SECURITY_CREDENTIAL",
    ];

    const missing = required.filter((key) => !process.env[key]);

    if (missing.length > 0) {
      throw new Error(
        `Missing required MPESA environment variables: ${missing.join(", ")}`
      );
    }

    console.log(`MPESA B2C Service initialized (${this.environment})`);
  }

  // =============================
  //  OAuth Token
  // =============================
  async getAccessToken() {
    try {
      if (
        this.accessToken &&
        this.tokenExpiry &&
        Date.now() < this.tokenExpiry
      ) {
        return this.accessToken;
      }

      const credentials = Buffer.from(
        `${this.consumerKey}:${this.consumerSecret}`
      ).toString("base64");

      const response = await axios.get(
        `${this.baseURL}/oauth/v1/generate?grant_type=client_credentials`,
        {
          headers: {
            Authorization: `Basic ${credentials}`,
          },
          timeout: 30000,
        }
      );

      const token = response.data.access_token;
      const expiresIn = parseInt(response.data.expires_in);

      this.accessToken = token;
      this.tokenExpiry = Date.now() + expiresIn * 1000 * 0.9;

      return token;
    } catch (error) {
      throw this.handleError(error, "Token request failed");
    }
  }

  // =============================
  //  B2C Payment
  // =============================
  async initiateB2CPayment({
    phoneNumber,
    amount,
    internalReference,
    description = "Bulk Payment",
    commandID = "BusinessPayment",
  }) {
    try {
      if (!this.validatePhoneNumber(phoneNumber)) {
        throw new Error(`Invalid phone number: ${phoneNumber}`);
      }

      if (!this.validateAmount(amount)) {
        throw new Error(`Invalid amount: ${amount}`);
      }

      const token = await this.getAccessToken();

      const payload = {
        InitiatorName: this.initiatorName,
        SecurityCredential: this.securityCredential,
        CommandID: commandID,
        Amount: Math.round(amount),
        PartyA: this.shortcode,
        PartyB: phoneNumber,
        Remarks: description.substring(0, 100),
        QueueTimeOutURL: `${process.env.BASE_URL}/api/payments/timeout`,
        ResultURL: `${process.env.BASE_URL}/api/payments/result`,
        Occasion: internalReference.substring(0, 100),
      };

      const response = await this.makeQueuedRequest(
        "POST",
        "/mpesa/b2c/v1/paymentrequest",
        payload,
        {
          Authorization: `Bearer ${token}`,
        }
      );

      if (response.ResponseCode === "0") {
        return {
          success: true,
          conversationId: response.ConversationID,
          originatorConversationId: response.OriginatorConversationID,
          description: response.ResponseDescription,
        };
      }

      throw new MPESAError(
        response.ResponseDescription || "B2C failed",
        400,
        response.ResponseCode
      );
    } catch (error) {
      throw this.handleError(error, "B2C payment failed");
    }
  }

  // =============================
  //  Transaction Status
  // =============================
  async queryTransactionStatus(transactionId) {
    try {
      const token = await this.getAccessToken();

      const payload = {
        Initiator: this.initiatorName,
        SecurityCredential: this.securityCredential,
        CommandID: "TransactionStatusQuery",
        TransactionID: transactionId,
        PartyA: this.shortcode,
        IdentifierType: "4",
        ResultURL: `${process.env.BASE_URL}/api/payments/status`,
        QueueTimeOutURL: `${process.env.BASE_URL}/api/payments/timeout`,
        Remarks: "Status check",
        Occasion: "Status",
      };

      const response = await this.makeQueuedRequest(
        "POST",
        "/mpesa/transactionstatus/v1/query",
        payload,
        {
          Authorization: `Bearer ${token}`,
        }
      );

      return {
        success: response.ResponseCode === "0",
        data: response,
      };
    } catch (error) {
      throw this.handleError(error, "Status query failed");
    }
  }

  // =============================
  //  Queue System (Rate Limit)
  // =============================
  async makeQueuedRequest(method, endpoint, data, headers) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({
        method,
        endpoint,
        data,
        headers,
        resolve,
        reject,
      });

      this.processQueue();
    });
  }

  async processQueue() {
    if (this.isProcessingQueue || this.requestQueue.length === 0) return;

    this.isProcessingQueue = true;

    while (this.requestQueue.length > 0) {
      const req = this.requestQueue.shift();

      try {
        const res = await axios({
          method: req.method,
          url: `${this.baseURL}${req.endpoint}`,
          data: req.data,
          headers: req.headers,
          timeout: 30000,
        });

        req.resolve(res.data);
      } catch (err) {
        req.reject(err);
      }

      if (this.requestQueue.length > 0) {
        await new Promise((r) => setTimeout(r, this.requestInterval));
      }
    }

    this.isProcessingQueue = false;
  }

  // =============================
  //  Callback Parser
  // =============================
  processCallback(data) {
    const result = data.Result || {};
    const params = result.ResultParameters?.ResultParameter || [];

    const extracted = {};
    params.forEach((p) => {
      extracted[p.Key] = p.Value;
    });

    return {
      resultCode: result.ResultCode,
      resultDesc: result.ResultDesc,
      transactionId: result.TransactionID,
      conversationId: result.ConversationID,
      isSuccess: result.ResultCode === 0,
      parameters: extracted,
    };
  }

  // =============================
  //  Validators
  // =============================
  validatePhoneNumber(phone) {
    return /^254[0-9]{9}$/.test(phone);
  }

  validateAmount(amount) {
    return Number.isInteger(amount) && amount >= 1 && amount <= 150000;
    amount = Math.round(amount);
  }

  // =============================
  //  Error Handler
  // =============================
  handleError(error, message) {
    if (error instanceof MPESAError) return error;

    if (error.response) {
      return new MPESAError(
        error.response.data?.errorMessage ||
          error.response.data?.ResponseDescription ||
          message,
        error.response.status,
        error.response.data?.errorCode
      );
    }

    return new MPESAError(`${message}: ${error.message}`, 500);
  }
}

module.exports = new MPESAService();