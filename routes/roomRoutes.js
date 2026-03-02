const express = require("express");
const router = express.Router();
const {
  createRoom,
  getRooms,
  getRoomById,
  getRoomsByDepartment,
  getSuitableRooms,
  updateRoom,
  deleteRoom,
  toggleRoomAvailability,
  getRoomStats,
  updateRoomEquipment,
  scheduleMaintenance,
  getBuildingsList,
} = require("../controllers/roomController");
const { protect, authorize } = require("../middleware/authMiddleware");

router.use(protect);

router
  .route("/")
  .get(authorize("Admin", "Teacher", "Student"), getRooms)
  .post(authorize("Admin"), createRoom);

router.get(
  "/department/:departmentId",
  authorize("Admin", "Teacher", "Student"),
  getRoomsByDepartment,
);
router.get(
  "/suitable/:courseType/:requiredCapacity",
  authorize("Admin", "Teacher", "Student"),
  getSuitableRooms,
);

router.get("/stats/overview", authorize("Admin"), getRoomStats);
router.get(
  "/buildings/list",
  authorize("Admin", "Teacher", "Student"),
  getBuildingsList,
);

router
  .route("/:id")
  .get(authorize("Admin", "Teacher", "Student"), getRoomById)
  .put(authorize("Admin"), updateRoom)
  .delete(authorize("Admin"), deleteRoom);

router.put(
  "/:id/toggle-availability",
  authorize("Admin"),
  toggleRoomAvailability,
);
router.put("/:id/equipment", authorize("Admin"), updateRoomEquipment);
router.put("/:id/maintenance", authorize("Admin"), scheduleMaintenance);

module.exports = router;
