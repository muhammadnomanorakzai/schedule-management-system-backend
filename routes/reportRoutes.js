const express = require("express");
const router = express.Router();
const reportController = require("../controllers/reportController");
const { protect, authorize } = require("../middleware/authMiddleware");

// All routes require authentication
router.use(protect);

// Generate report
router.post(
  "/generate",
  authorize("admin", "hod"),
  reportController.generateReport,
);

// Get all reports
router.get(
  "/",
  authorize("admin", "hod", "teacher"),
  reportController.getAllReports,
);

// Get report statistics
router.get(
  "/statistics",
  authorize("admin", "hod"),
  reportController.getReportStatistics,
);

// Get single report
router.get(
  "/:id",
  authorize("admin", "hod", "teacher"),
  reportController.getReportById,
);

// Download report file
router.get(
  "/download/:id",
  authorize("admin", "hod", "teacher"),
  reportController.downloadReport,
);

// Delete report
router.delete("/:id", authorize("admin"), reportController.deleteReport);

module.exports = router;
