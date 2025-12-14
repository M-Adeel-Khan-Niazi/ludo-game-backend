const multer = require("multer");
const path = require("path");
const axios = require("axios");
const FormData = require("form-data");
const { UPLOAD_API_TOKEN } = require("../config/env");

// API upload endpoint configuration
const UPLOAD_API_URL = "https://client1.appsstaging.com:3019/upload";

// Custom storage engine for API upload
const apiStorage = {
  _handleFile: (req, file, cb) => {
    // Create FormData for the API request
    const formData = new FormData();
    formData.append("projectName", "Vocally-Uploads");
    formData.append("file", file.stream, {
      filename: file.originalname,
      contentType: file.mimetype,
    });

    // Upload to the API
    axios
      .post(UPLOAD_API_URL, formData, {
        headers: {
          ...formData.getHeaders(),
          "Content-Type": "multipart/form-data",
          Authorization: `Bearer ${UPLOAD_API_TOKEN}`,
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 120000, // 120 seconds timeout
      })
      .then((response) => {
        const data = response.data.data;
        // Success callback with file info
        cb(null, {
          filename: data.originalName,
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: data.size || 0,
          location: data.url,
          key: data.fileKey,
          apiResponse: data,
        });
      })
      .catch((error) => {
        console.error("API Upload Error:", error.message);
        cb(error);
      });
  },
  _removeFile: (req, file, cb) => {
    // Optional: Implement file removal logic if the API supports it
    cb(null);
  },
};

// Configure multer with API storage
const upload = multer({
  storage: apiStorage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow common file types
    const allowedMimeTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/webp",
      "video/mp4",
      "video/avi",
      "video/mov",
      "video/wmv",
      "video/flv",
      "video/webm",
      "audio/mp3",
      "audio/wav",
      "audio/ogg",
      "audio/m4a",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Invalid file type. Only images, videos, audio, and documents are allowed."
        ),
        false
      );
    }
  },
});

module.exports = upload;
