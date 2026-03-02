const express = require("express");
const router = express.Router();
const {
  createCourse,
  getCourses,
  getCourseById,
  getCoursesByProgram,
  getCoursesByProgramAndSemester,
  updateCourse,
  deleteCourse,
  toggleCourseStatus,
  getAvailablePrerequisites,
} = require("../controllers/courseController");
const { protect, authorize } = require("../middleware/authMiddleware");

router.use(protect);

router
  .route("/")
  .get(authorize("Admin", "Teacher", "Student"), getCourses)
  .post(authorize("Admin"), createCourse);

router.get(
  "/program/:programId",
  authorize("Admin", "Teacher", "Student"),
  getCoursesByProgram,
);
router.get(
  "/program/:programId/semester/:semester",
  authorize("Admin", "Teacher", "Student"),
  getCoursesByProgramAndSemester,
);
router.get(
  "/:id/available-prerequisites",
  authorize("Admin"),
  getAvailablePrerequisites,
);

router
  .route("/:id")
  .get(authorize("Admin", "Teacher", "Student"), getCourseById)
  .put(authorize("Admin"), updateCourse)
  .delete(authorize("Admin"), deleteCourse);

router.put("/:id/toggle-status", authorize("Admin"), toggleCourseStatus);

module.exports = router;
