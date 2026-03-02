const express = require("express");
const router = express.Router();

const {
  createTimeSlot,
  getAllTimeSlots,
  getTimeSlotById,
  updateTimeSlot,
  deleteTimeSlot,
  activateTimeSlot,
  initializeDefaultSlots,
  getSlotsByDay,
  getWeeklyTemplate,
  checkTimeConflict,
} = require("../controllers/timeSlotController.js");
const { protect, authorize } = require("../middleware/authMiddleware.js");

// All routes are protected
router.use(protect);

// Admin only routes
router.post("/", authorize("admin"), createTimeSlot);
router.put("/:id", authorize("admin"), updateTimeSlot);
router.delete("/:id", authorize("admin"), deleteTimeSlot);
router.put("/:id/activate", authorize("admin"), activateTimeSlot);
router.post("/initialize-defaults", authorize("admin"), initializeDefaultSlots);

// All authenticated users can view
router.get("/", getAllTimeSlots);
router.get("/:id", getTimeSlotById);
router.get("/day/:day", getSlotsByDay);
router.get("/weekly-template", getWeeklyTemplate);
router.post("/check-conflict", checkTimeConflict);
module.exports = router;
