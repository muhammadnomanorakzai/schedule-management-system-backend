const express = require("express");
const router = express.Router();
const {
  createProgram,
  getPrograms,
  getProgramById,
  getProgramsByDepartment,
  updateProgram,
  deleteProgram,
  toggleProgramStatus,
} = require("../controllers/programController");
const { protect, authorize } = require("../middleware/authMiddleware");

// All routes are protected
router.use(protect);

router
  .route("/")
  .get(authorize("Admin", "Teacher", "Student"), getPrograms)
  .post(authorize("Admin"), createProgram);

router.get(
  "/department/:deptId",
  authorize("Admin", "Teacher", "Student"),
  getProgramsByDepartment,
);

router
  .route("/:id")
  .get(authorize("Admin", "Teacher", "Student"), getProgramById)
  .put(authorize("Admin"), updateProgram)
  .delete(authorize("Admin"), deleteProgram);

router.put("/:id/toggle-status", authorize("Admin"), toggleProgramStatus);

module.exports = router;
