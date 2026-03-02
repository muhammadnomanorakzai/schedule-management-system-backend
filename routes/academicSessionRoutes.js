const express = require("express");
const router = express.Router();
const {
  createAcademicSession,
  getAcademicSessions,
  getCurrentSession,
  updateAcademicSession,
  deleteAcademicSession,
  setCurrentSession,
  toggleRegistration,
} = require("../controllers/academicSessionController");
const { protect, authorize } = require("../middleware/authMiddleware");

router.use(protect);

router
  .route("/")
  .get(authorize("Admin", "Teacher", "Student"), getAcademicSessions)
  .post(authorize("Admin"), createAcademicSession);

router.get(
  "/current",
  authorize("Admin", "Teacher", "Student"),
  getCurrentSession,
);

router
  .route("/:id")
  .get(authorize("Admin", "Teacher", "Student"), getCurrentSession)
  .put(authorize("Admin"), updateAcademicSession)
  .delete(authorize("Admin"), deleteAcademicSession);

router.put("/:id/set-current", authorize("Admin"), setCurrentSession);
router.put("/:id/toggle-registration", authorize("Admin"), toggleRegistration);

module.exports = router;
