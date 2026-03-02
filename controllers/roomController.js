const Room = require("../models/Room");
const Department = require("../models/Department");

// @desc    Create a new room
// @route   POST /api/rooms
// @access  Admin
exports.createRoom = async (req, res) => {
  try {
    const {
      roomNumber,
      name,
      building,
      floor,
      roomType,
      capacity,
      department,
      equipment,
      facilities,
      isAirConditioned,
      hasProjector,
      hasWhiteboard,
      description,
    } = req.body;

    // Validate department exists
    const deptExists = await Department.findById(department);
    if (!deptExists) {
      return res.status(404).json({
        message: "Department not found",
      });
    }

    // Check if room with same number in same building exists
    const existingRoom = await Room.findOne({
      roomNumber: roomNumber.toUpperCase(),
      building,
    });

    if (existingRoom) {
      return res.status(400).json({
        message: `Room ${roomNumber} already exists in ${building} building`,
      });
    }

    const room = await Room.create({
      roomNumber: roomNumber.toUpperCase(),
      name,
      building,
      floor,
      roomType,
      capacity: parseInt(capacity),
      department,
      equipment: equipment || [],
      facilities: facilities || [],
      isAirConditioned: isAirConditioned || false,
      hasProjector: hasProjector || false,
      hasWhiteboard: hasWhiteboard !== undefined ? hasWhiteboard : true,
      description,
    });

    const populatedRoom = await Room.findById(room._id).populate(
      "department",
      "name code",
    );

    res.status(201).json(populatedRoom);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Get all rooms
// @route   GET /api/rooms
// @access  All authenticated users
exports.getRooms = async (req, res) => {
  try {
    const {
      department,
      building,
      roomType,
      minCapacity,
      maxCapacity,
      isAvailable,
      hasProjector,
      isAirConditioned,
    } = req.query;

    let filter = {};

    if (department) filter.department = department;
    if (building) filter.building = building;
    if (roomType) filter.roomType = roomType;
    if (isAvailable !== undefined) filter.isAvailable = isAvailable === "true";
    if (hasProjector !== undefined)
      filter.hasProjector = hasProjector === "true";
    if (isAirConditioned !== undefined)
      filter.isAirConditioned = isAirConditioned === "true";

    // Capacity range filtering
    if (minCapacity || maxCapacity) {
      filter.capacity = {};
      if (minCapacity) filter.capacity.$gte = parseInt(minCapacity);
      if (maxCapacity) filter.capacity.$lte = parseInt(maxCapacity);
    }

    const rooms = await Room.find(filter)
      .populate("department", "name code")
      .sort({ building: 1, floor: 1, roomNumber: 1 });

    res.status(200).json(rooms);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Get rooms by department
// @route   GET /api/rooms/department/:departmentId
// @access  All authenticated users
exports.getRoomsByDepartment = async (req, res) => {
  try {
    const rooms = await Room.find({
      department: req.params.departmentId,
      isAvailable: true,
    })
      .populate("department", "name code")
      .sort({ roomType: 1, capacity: -1 });

    res.status(200).json(rooms);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Get rooms suitable for a course
// @route   GET /api/rooms/suitable/:courseType/:requiredCapacity/:departmentId
// @access  All authenticated users
exports.getSuitableRooms = async (req, res) => {
  try {
    const { courseType, requiredCapacity, departmentId } = req.params;

    let filter = {
      capacity: { $gte: parseInt(requiredCapacity) },
      isAvailable: true,
    };

    if (departmentId && departmentId !== "undefined") {
      filter.department = departmentId;
    }

    // Lab courses can only use Lab rooms
    if (courseType === "Lab") {
      filter.roomType = "Lab";
    } else {
      // Theory courses can use Lecture, Conference, Auditorium, Seminar rooms
      filter.roomType = {
        $in: ["Lecture", "Conference", "Auditorium", "Seminar"],
      };
    }

    const rooms = await Room.find(filter)
      .populate("department", "name code")
      .sort({ capacity: 1, building: 1, roomNumber: 1 });

    res.status(200).json(rooms);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Get single room
// @route   GET /api/rooms/:id
// @access  All authenticated users
exports.getRoomById = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id).populate(
      "department",
      "name code",
    );

    if (!room) {
      return res.status(404).json({
        message: "Room not found",
      });
    }

    res.status(200).json(room);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Update room
// @route   PUT /api/rooms/:id
// @access  Admin
exports.updateRoom = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);

    if (!room) {
      return res.status(404).json({
        message: "Room not found",
      });
    }

    // Check for duplicate room number if updating
    if (req.body.roomNumber || req.body.building) {
      const roomNumber = req.body.roomNumber || room.roomNumber;
      const building = req.body.building || room.building;

      const existing = await Room.findOne({
        _id: { $ne: room._id },
        roomNumber: roomNumber.toUpperCase(),
        building,
      });

      if (existing) {
        return res.status(400).json({
          message: "Room with this number already exists in this building",
        });
      }
    }

    const updatedRoom = await Room.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    }).populate("department", "name code");

    res.status(200).json(updatedRoom);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Delete room
// @route   DELETE /api/rooms/:id
// @access  Admin
exports.deleteRoom = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);

    if (!room) {
      return res.status(404).json({
        message: "Room not found",
      });
    }

    // TODO: Check if room has scheduled classes before deleting

    await room.deleteOne();

    res.status(200).json({
      message: "Room deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Toggle room availability
// @route   PUT /api/rooms/:id/toggle-availability
// @access  Admin
exports.toggleRoomAvailability = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);

    if (!room) {
      return res.status(404).json({
        message: "Room not found",
      });
    }

    room.isAvailable = !room.isAvailable;
    await room.save();

    const populatedRoom = await Room.findById(room._id).populate(
      "department",
      "name code",
    );

    res.status(200).json({
      message: `Room ${room.isAvailable ? "made available" : "marked unavailable"} successfully`,
      room: populatedRoom,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Get room statistics
// @route   GET /api/rooms/stats/overview
// @access  Admin
exports.getRoomStats = async (req, res) => {
  try {
    const totalRooms = await Room.countDocuments();
    const availableRooms = await Room.countDocuments({ isAvailable: true });

    const roomTypes = await Room.aggregate([
      { $group: { _id: "$roomType", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    const capacityStats = await Room.aggregate([
      {
        $group: {
          _id: null,
          totalCapacity: { $sum: "$capacity" },
          avgCapacity: { $avg: "$capacity" },
          maxCapacity: { $max: "$capacity" },
          minCapacity: { $min: "$capacity" },
        },
      },
    ]);

    const departmentStats = await Room.aggregate([
      {
        $group: {
          _id: "$department",
          count: { $sum: 1 },
          totalCapacity: { $sum: "$capacity" },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]);

    // Populate department names
    const populatedDeptStats = await Promise.all(
      departmentStats.map(async (stat) => {
        const dept = await Department.findById(stat._id).select("name code");
        return {
          department: dept,
          count: stat.count,
          totalCapacity: stat.totalCapacity,
        };
      }),
    );

    res.status(200).json({
      totalRooms,
      availableRooms,
      roomTypes,
      capacityStats: capacityStats[0] || {},
      departmentStats: populatedDeptStats,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Update room equipment
// @route   PUT /api/rooms/:id/equipment
// @access  Admin
exports.updateRoomEquipment = async (req, res) => {
  try {
    const { equipment } = req.body;
    const room = await Room.findById(req.params.id);

    if (!room) {
      return res.status(404).json({
        message: "Room not found",
      });
    }

    room.equipment = equipment;
    await room.save();

    const populatedRoom = await Room.findById(room._id).populate(
      "department",
      "name code",
    );

    res.status(200).json({
      message: "Room equipment updated successfully",
      room: populatedRoom,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Schedule maintenance
// @route   PUT /api/rooms/:id/maintenance
// @access  Admin
exports.scheduleMaintenance = async (req, res) => {
  try {
    const { nextMaintenance, notes } = req.body;
    const room = await Room.findById(req.params.id);

    if (!room) {
      return res.status(404).json({
        message: "Room not found",
      });
    }

    room.maintenanceSchedule = {
      lastMaintenance: new Date(),
      nextMaintenance: new Date(nextMaintenance),
      notes,
    };

    // Mark room as unavailable during maintenance
    room.isAvailable = false;

    await room.save();

    const populatedRoom = await Room.findById(room._id).populate(
      "department",
      "name code",
    );

    res.status(200).json({
      message: "Maintenance scheduled successfully",
      room: populatedRoom,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Get buildings list
// @route   GET /api/rooms/buildings/list
// @access  All authenticated users
exports.getBuildingsList = async (req, res) => {
  try {
    const buildings = await Room.distinct("building");
    res.status(200).json(buildings.sort());
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};
