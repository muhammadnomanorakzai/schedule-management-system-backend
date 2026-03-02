const express = require("express");
const router = express.Router();

const {
  createTimetable,
  getAllTimetables,
  getTimetableById,
  updateTimetable,
  deleteTimetable,
  publishTimetable,
  approveTimetable,
  rejectTimetable,
  addScheduleEntry,
  removeScheduleEntry,
  getAvailableAllocations,
  getTimetableMatrix,
  checkScheduleConflicts,
} = require("../controllers/timetableController.js");
const { protect, authorize } = require("../middleware/authMiddleware.js");

// All routes are protected
router.use(protect);

// Admin and HOD routes for CRUD operations
router.post("/", authorize("admin", "hod"), createTimetable);
router.put("/:id", authorize("admin", "hod"), updateTimetable);
router.delete("/:id", authorize("admin", "hod"), deleteTimetable);
router.put("/:id/publish", authorize("admin", "hod"), publishTimetable);
router.put("/:id/approve", authorize("admin", "hod"), approveTimetable);
router.put("/:id/reject", authorize("admin", "hod"), rejectTimetable);
router.post("/:id/schedule", authorize("admin", "hod"), addScheduleEntry);
router.delete(
  "/:id/schedule/:entryId",
  authorize("admin", "hod"),
  removeScheduleEntry,
);

// All authenticated users can view
router.get("/", getAllTimetables);
router.get("/:id", getTimetableById);
router.get("/:id/available-allocations", getAvailableAllocations);
router.get("/:id/matrix", getTimetableMatrix);
router.post("/:id/check-conflicts", checkScheduleConflicts);

module.exports = router;
