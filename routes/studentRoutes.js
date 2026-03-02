const express = require("express");
const router = express.Router();
const {
  getStudents,
  createStudent,
  getStudentById,
  updateStudent,
  deleteStudent,
  enrollStudent,
  updateEnrollmentStatus,
  assignSection,
  getStudentsByProgram,
  getStudentsBySection,
  getStudentStats,
  getAvailableSections,
  bulkImportStudents,
} = require("../controllers/studentController");
const { protect, authorize } = require("../middleware/authMiddleware");

router.use(protect);

router
  .route("/")
  .get(authorize("Admin", "Teacher"), getStudents)
  .post(authorize("Admin"), createStudent);

router.post("/bulk-import", authorize("Admin"), bulkImportStudents);
router.get("/stats/overview", authorize("Admin"), getStudentStats);
router.get(
  "/program/:programId",
  authorize("Admin", "Teacher"),
  getStudentsByProgram,
);
router.get(
  "/section/:sectionId",
  authorize("Admin", "Teacher"),
  getStudentsBySection,
);
router.get(
  "/available-sections/:programId/:semesterId/:academicSessionId",
  authorize("Admin"),
  getAvailableSections,
);

router
  .route("/:id")
  .get(authorize("Admin", "Teacher", "Student"), getStudentById)
  .put(authorize("Admin"), updateStudent)
  .delete(authorize("Admin"), deleteStudent);

router.put("/:id/enroll", authorize("Admin"), enrollStudent);
router.put(
  "/:id/enrollment-status",
  authorize("Admin"),
  updateEnrollmentStatus,
);
router.put("/:id/assign-section", authorize("Admin"), assignSection);

module.exports = router;
