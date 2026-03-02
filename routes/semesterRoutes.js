const express = require("express");
const router = express.Router();
const {
  createSemester,
  getSemesters,
  getSemestersBySession,
  getSemesterById,
  updateSemester,
  deleteSemester,
  toggleSemesterStatus,
  getValidSemestersForSession,
} = require("../controllers/semesterController");
const { protect, authorize } = require("../middleware/authMiddleware");

router.use(protect);

router
  .route("/")
  .get(authorize("Admin", "Teacher", "Student"), getSemesters)
  .post(authorize("Admin"), createSemester);

router.get(
  "/session/:sessionId",
  authorize("Admin", "Teacher", "Student"),
  getSemestersBySession,
);
router.get(
  "/valid/:sessionType",
  authorize("Admin", "Teacher", "Student"),
  getValidSemestersForSession,
);

router
  .route("/:id")
  .get(authorize("Admin", "Teacher", "Student"), getSemesterById)
  .put(authorize("Admin"), updateSemester)
  .delete(authorize("Admin"), deleteSemester);

router.put("/:id/toggle-status", authorize("Admin"), toggleSemesterStatus);

module.exports = router;
