const express = require("express");
const router = express.Router();
const multer = require("multer");

const {
  uploadCSV,
  getCSVTemplate,
  downloadCSVTemplate,
  getUploadHistory,
  getUploadById,
  getUploadConflicts,
  getUploadScheduleEntries,
  retryUpload,
  getUploadStats,
  analyzeCSVConflicts,
  getUploadTypes,
  validateCSV,
} = require("../controllers/csvUploadController.js");
const { protect, authorize } = require("../middleware/authMiddleware.js");

// Configure multer for file upload
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept CSV files only
    if (file.mimetype === "text/csv" || file.originalname.match(/\.(csv)$/)) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are allowed"), false);
    }
  },
});

// All routes are protected
router.use(protect);

// Upload and process CSV
router.post(
  "/upload",
  authorize("admin", "hod"),
  upload.single("csvFile"),
  uploadCSV,
);
router.post(
  "/validate",
  authorize("admin", "hod"),
  upload.single("csvFile"),
  validateCSV,
);

// Template management
router.get("/template/:uploadType", getCSVTemplate);
router.get("/template/:uploadType/download", downloadCSVTemplate);
router.get("/uploads/:id/schedule-entries", getUploadScheduleEntries);

// Upload history and management
router.get("/uploads", getUploadHistory);
router.get("/uploads/:id", getUploadById);

router.post("/uploads/:id/retry", authorize("admin", "hod"), retryUpload);

// Statistics and info
router.get("/stats", getUploadStats);
router.get("/upload-types", getUploadTypes);

router.post(
  "/analyze-conflicts",
  protect,
  authorize("admin", "hod", "teacher"),
  upload.single("csvFile"),
  analyzeCSVConflicts,
);
// Get conflicts for a specific upload
router.get("/uploads/:id/conflicts", protect, getUploadConflicts);

module.exports = router;
