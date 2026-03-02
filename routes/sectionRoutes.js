const express = require("express");
const router = express.Router();
const {
  createSection,
  getSections,
  getSectionById,
  getSectionsByProgramAndSemester,
  getSectionsBySession,
  updateSection,
  deleteSection,
  toggleSectionStatus,
  assignSectionIncharge,
  getAvailableTeachers,
  getSectionStats,
} = require("../controllers/sectionController");
const { protect, authorize } = require("../middleware/authMiddleware");

router.use(protect);

router
  .route("/")
  .get(authorize("Admin", "Teacher", "Student"), getSections)
  .post(authorize("Admin"), createSection);

router.get(
  "/program/:programId/semester/:semesterId",
  authorize("Admin", "Teacher", "Student"),
  getSectionsByProgramAndSemester,
);
router.get(
  "/session/:sessionId",
  authorize("Admin", "Teacher", "Student"),
  getSectionsBySession,
);
router.get(
  "/available-teachers/:departmentId",
  authorize("Admin"),
  getAvailableTeachers,
);
router.get("/stats/overview", authorize("Admin"), getSectionStats);

router
  .route("/:id")
  .get(authorize("Admin", "Teacher", "Student"), getSectionById)
  .put(authorize("Admin"), updateSection)
  .delete(authorize("Admin"), deleteSection);

router.put("/:id/toggle-status", authorize("Admin"), toggleSectionStatus);
router.put("/:id/assign-incharge", authorize("Admin"), assignSectionIncharge);

module.exports = router;
