// routes/departmentRoutes.js
const express = require("express");
const router = express.Router();
const {
  createDepartment,
  getDepartments,
  getDepartmentById,
  updateDepartment,
  deleteDepartment,
  assignHOD,
} = require("../controllers/departmentController");
const { protect, authorize } = require("../middleware/authMiddleware");

// All routes are protected
router.use(protect);

// Only Admin and HOD can manage departments
router
  .route("/")
  .get(authorize("Admin", "Teacher", "Student"), getDepartments)
  .post(authorize("Admin"), createDepartment);

router
  .route("/:id")
  .get(authorize("Admin", "Teacher", "Student"), getDepartmentById)
  .put(authorize("Admin"), updateDepartment)
  .delete(authorize("Admin"), deleteDepartment);

router.put("/:id/assign-hod", authorize("Admin"), assignHOD);

module.exports = router;
