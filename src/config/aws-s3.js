const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const {
  AWS_ACCESS_KEY_ID,
  AWS_REGION,
  AWS_SECRET_ACCESS_KEY,
  AWS_S3_BUCKET_NAME,
  APP_NAME,
} = require("./env");
const logger = require("./logger");

// Initialize S3 client
const s3Client = new S3Client({
  region: AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
});

const bucketName = AWS_S3_BUCKET_NAME;

// Utility functions for S3 operations
const s3Utils = {
  // Upload file to S3
  uploadFile: async (key, body, contentType) => {
    try {
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: body,
        ContentType: contentType,
      });

      const result = await s3Client.send(command);
      return result;
    } catch (error) {
      logger.error(`Error uploading file to S3: ${error.message}`);
      throw error;
    }
  },

  // Delete file from S3
  deleteFile: async (key) => {
    try {
      const command = new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
      });

      const result = await s3Client.send(command);
      return result;
    } catch (error) {
      logger.error(`Error deleting file from S3: ${error.message}`);
      throw error;
    }
  },

  // Check if S3 is properly configured
  isConfigured: () => {
    return !!(
      AWS_ACCESS_KEY_ID &&
      AWS_SECRET_ACCESS_KEY &&
      AWS_S3_BUCKET_NAME &&
      APP_NAME
    );
  },
};

module.exports = {
  s3Client,
  bucketName,
  s3Utils,
};
