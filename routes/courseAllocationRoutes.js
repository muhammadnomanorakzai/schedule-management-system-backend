const express = require("express");
const router = express.Router();
const {
  createCourseAllocation,
  getAllCourseAllocations,
  getCourseAllocationById,
  updateCourseAllocation,
  deleteCourseAllocation,
  approveCourseAllocation,
  getTeacherWorkload,
  getAvailableTeachers,
} = require("../controllers/courseAllocationController");
const { protect, authorize } = require("../middleware/authMiddleware");

// All routes are protected
router.use(protect);

// Admin and HOD can create/update/delete allocations
router.post("/", authorize("admin", "hod"), createCourseAllocation);
router.put("/:id", authorize("admin", "hod"), updateCourseAllocation);
router.delete("/:id", authorize("admin", "hod"), deleteCourseAllocation);
router.put("/:id/approve", authorize("admin", "hod"), approveCourseAllocation);

// All authenticated users can view
router.get("/", getAllCourseAllocations);
router.get("/:id", getCourseAllocationById);
router.get("/teacher-workload/:teacherId", getTeacherWorkload);
router.get("/available-teachers", getAvailableTeachers);

module.exports = router;
