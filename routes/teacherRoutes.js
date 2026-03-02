const express = require("express");
const router = express.Router();
const {
  getTeachers,
  createTeacher,
  deleteTeacher,
  // New enhanced functions
  assignDepartment,
  assignCourse,
  removeCourse,
  updateAvailability,
  toggleScheduling,
  updateTeacher,
  getTeachersByDepartment,
  getAvailableTeachersForCourse,
  getTeacherStats,
} = require("../controllers/teacherController");
const { protect, admin } = require("../middleware/authMiddleware");

router.route("/").get(protect, getTeachers).post(protect, admin, createTeacher);

router.route("/stats/overview").get(protect, admin, getTeacherStats);

router.route("/department/:departmentId").get(protect, getTeachersByDepartment);

router
  .route("/available/:courseId/:departmentId")
  .get(protect, admin, getAvailableTeachersForCourse);

router
  .route("/:id")
  .put(protect, admin, updateTeacher)
  .delete(protect, admin, deleteTeacher);

router.put("/:id/assign-department", protect, admin, assignDepartment);
router.put("/:id/assign-course", protect, admin, assignCourse);
router.put("/:id/remove-course/:courseId", protect, admin, removeCourse);
router.put("/:id/availability", protect, updateAvailability);
router.put("/:id/toggle-scheduling", protect, admin, toggleScheduling);

module.exports = router;
