import cloudinary from "../config/cloudinary.js";
import stream from "stream";

/**
 * Upload a file buffer to Cloudinary
 * @param {Buffer} fileBuffer - The file buffer from multer
 * @param {string} folder - Folder path in Cloudinary
 * @param {string} fileName - Original file name
 * @returns {Promise} - Cloudinary upload result
 */
export const uploadToCloudinary = (fileBuffer, folder, fileName) => {
  return new Promise((resolve, reject) => {
    // Sanitize filename for Cloudinary
    const sanitizedName = fileName
      .replace(/[^a-zA-Z0-9.-]/g, "_")
      .replace(/\.[^/.]+$/, ""); // Remove extension

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: folder,
        public_id: `${Date.now()}_${sanitizedName}`,
        resource_type: "raw", // Important for CSV files
        format: "csv",
        use_filename: true,
        unique_filename: true,
      },
      (error, result) => {
        if (error) {
          console.error("Cloudinary upload error:", error);
          return reject(error);
        }
        resolve(result);
      },
    );

    // Convert buffer to stream and pipe to Cloudinary
    const bufferStream = new stream.PassThrough();
    bufferStream.end(fileBuffer);
    bufferStream.pipe(uploadStream);
  });
};

/**
 * Delete a file from Cloudinary
 * @param {string} publicId - The public ID of the file to delete
 * @returns {Promise}
 */
export const deleteFromCloudinary = async (publicId) => {
  try {
    if (!publicId) return null;

    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: "raw",
    });
    return result;
  } catch (error) {
    console.error("Cloudinary delete error:", error);
    throw error;
  }
};

/**
 * Download a file from Cloudinary as buffer
 * @param {string} url - Cloudinary URL
 * @returns {Promise<Buffer>}
 */
export const downloadFromCloudinary = async (url) => {
  try {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error("Error downloading from Cloudinary:", error);
    throw error;
  }
};
