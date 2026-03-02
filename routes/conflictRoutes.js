const express = require("express");
const router = express.Router();

const {
  detectConflicts,
  getTimetableConflicts,
  getConflictById,
  updateConflictStatus,
  applySuggestedResolution,
  autoResolveConflicts,
  getConflictStats,
  bulkUpdateConflicts,
  getCriticalConflicts,
} = require("../controllers/conflictController.js");
const { protect, authorize } = require("../middleware/authMiddleware.js");

// All routes are protected
router.use(protect);

// Conflict detection and resolution
router.post("/detect/:timetableId", authorize("admin", "hod"), detectConflicts);
router.post(
  "/auto-resolve/:timetableId",
  authorize("admin", "hod"),
  autoResolveConflicts,
);
router.post(
  "/:id/apply-resolution",
  authorize("admin", "hod"),
  applySuggestedResolution,
);
router.put("/bulk-update", authorize("admin", "hod"), bulkUpdateConflicts);

// Conflict management
router.put("/:id/status", authorize("admin", "hod"), updateConflictStatus);

// View conflicts
router.get("/stats", getConflictStats);
router.get("/critical", getCriticalConflicts);
router.get("/timetable/:timetableId", getTimetableConflicts);
router.get("/:id", getConflictById);

module.exports = router;
