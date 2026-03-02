import TimeSlot from "../models/TimeSlot.js";
import mongoose from "mongoose";

// @desc    Create a new time slot
// @route   POST /api/time-slots
// @access  Private (Admin)
export const createTimeSlot = async (req, res) => {
  try {
    const {
      slotNumber,
      name,
      startTime,
      endTime,
      slotType,
      availableDays,
      priority,
      notes,
    } = req.body;

    // Check if slot number already exists
    const existingSlot = await TimeSlot.findOne({ slotNumber });
    if (existingSlot) {
      return res.status(400).json({
        success: false,
        message: `Slot number ${slotNumber} already exists`,
      });
    }

    // Check if slot name already exists
    const existingName = await TimeSlot.findOne({ name });
    if (existingName) {
      return res.status(400).json({
        success: false,
        message: `Slot name "${name}" already exists`,
      });
    }

    // Check for overlapping time slots
    const allSlots = await TimeSlot.find({ isActive: true });
    const newSlot = {
      startTime,
      endTime,
      slotNumber,
      availableDays: availableDays || [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
      ],
    };

    for (const slot of allSlots) {
      if (slot.overlapsWith(newSlot)) {
        return res.status(400).json({
          success: false,
          message: `Time slot overlaps with existing slot: ${slot.name} (${slot.timeRange})`,
        });
      }
    }

    // Create time slot
    const timeSlot = new TimeSlot({
      slotNumber,
      name,
      startTime,
      endTime,
      slotType,
      availableDays: availableDays || [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
      ],
      priority: priority || 5,
      notes,
      createdBy: req.user._id,
    });

    await timeSlot.save();

    res.status(201).json({
      success: true,
      data: timeSlot,
      message: "Time slot created successfully",
    });
  } catch (error) {
    console.error("Error creating time slot:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Get all time slots
// @route   GET /api/time-slots
// @access  Private
export const getAllTimeSlots = async (req, res) => {
  try {
    const {
      activeOnly = "true",
      slotType,
      day,
      category,
      sortBy = "slotNumber",
      sortOrder = "asc",
    } = req.query;

    // Build filter
    const filter = {};

    if (activeOnly === "true") {
      filter.isActive = true;
    }

    if (slotType) {
      filter.slotType = slotType;
    }

    if (day) {
      filter.availableDays = day;
    }

    if (category) {
      filter.category = category;
    }

    // Sorting
    const sort = {};
    sort[sortBy] = sortOrder === "desc" ? -1 : 1;

    const timeSlots = await TimeSlot.find(filter)
      .populate("createdBy", "name email")
      .populate("lastModifiedBy", "name email")
      .sort(sort);

    res.json({
      success: true,
      data: timeSlots,
      count: timeSlots.length,
    });
  } catch (error) {
    console.error("Error fetching time slots:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Get time slot by ID
// @route   GET /api/time-slots/:id
// @access  Private
export const getTimeSlotById = async (req, res) => {
  try {
    const timeSlot = await TimeSlot.findById(req.params.id)
      .populate("createdBy", "name email")
      .populate("lastModifiedBy", "name email");

    if (!timeSlot) {
      return res.status(404).json({
        success: false,
        message: "Time slot not found",
      });
    }

    res.json({
      success: true,
      data: timeSlot,
    });
  } catch (error) {
    console.error("Error fetching time slot:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Update time slot
// @route   PUT /api/time-slots/:id
// @access  Private (Admin)
export const updateTimeSlot = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Find time slot
    const timeSlot = await TimeSlot.findById(id);
    if (!timeSlot) {
      return res.status(404).json({
        success: false,
        message: "Time slot not found",
      });
    }

    // Check for duplicate slot number
    if (
      updateData.slotNumber &&
      updateData.slotNumber !== timeSlot.slotNumber
    ) {
      const existingSlot = await TimeSlot.findOne({
        slotNumber: updateData.slotNumber,
        _id: { $ne: id },
      });
      if (existingSlot) {
        return res.status(400).json({
          success: false,
          message: `Slot number ${updateData.slotNumber} already exists`,
        });
      }
    }

    // Check for duplicate name
    if (updateData.name && updateData.name !== timeSlot.name) {
      const existingName = await TimeSlot.findOne({
        name: updateData.name,
        _id: { $ne: id },
      });
      if (existingName) {
        return res.status(400).json({
          success: false,
          message: `Slot name "${updateData.name}" already exists`,
        });
      }
    }

    // Check for overlapping time slots (if time is being changed)
    if (updateData.startTime || updateData.endTime) {
      const allSlots = await TimeSlot.find({
        isActive: true,
        _id: { $ne: id },
      });

      const updatedSlot = {
        startTime: updateData.startTime || timeSlot.startTime,
        endTime: updateData.endTime || timeSlot.endTime,
        slotNumber: updateData.slotNumber || timeSlot.slotNumber,
        availableDays: updateData.availableDays || timeSlot.availableDays,
      };

      for (const slot of allSlots) {
        // Check if they share any common days
        const commonDays = updatedSlot.availableDays.filter((day) =>
          slot.availableDays.includes(day),
        );

        if (commonDays.length > 0 && slot.overlapsWith(updatedSlot)) {
          return res.status(400).json({
            success: false,
            message: `Time slot overlaps with existing slot: ${slot.name} (${slot.timeRange})`,
          });
        }
      }
    }

    // Update time slot
    updateData.lastModifiedBy = req.user._id;
    Object.assign(timeSlot, updateData);
    await timeSlot.save();

    const updatedSlot = await TimeSlot.findById(id)
      .populate("createdBy", "name email")
      .populate("lastModifiedBy", "name email");

    res.json({
      success: true,
      data: updatedSlot,
      message: "Time slot updated successfully",
    });
  } catch (error) {
    console.error("Error updating time slot:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Delete time slot
// @route   DELETE /api/time-slots/:id
// @access  Private (Admin)
export const deleteTimeSlot = async (req, res) => {
  try {
    const timeSlot = await TimeSlot.findById(req.params.id);

    if (!timeSlot) {
      return res.status(404).json({
        success: false,
        message: "Time slot not found",
      });
    }

    // Soft delete by deactivating
    timeSlot.isActive = false;
    timeSlot.lastModifiedBy = req.user._id;
    await timeSlot.save();

    res.json({
      success: true,
      message: "Time slot deactivated successfully",
    });
  } catch (error) {
    console.error("Error deleting time slot:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Activate time slot
// @route   PUT /api/time-slots/:id/activate
// @access  Private (Admin)
export const activateTimeSlot = async (req, res) => {
  try {
    const timeSlot = await TimeSlot.findById(req.params.id);

    if (!timeSlot) {
      return res.status(404).json({
        success: false,
        message: "Time slot not found",
      });
    }

    // Check for overlapping active slots
    if (timeSlot.startTime && timeSlot.endTime) {
      const activeSlots = await TimeSlot.find({
        isActive: true,
        _id: { $ne: timeSlot._id },
      });

      for (const slot of activeSlots) {
        // Check if they share any common days
        const commonDays = timeSlot.availableDays.filter((day) =>
          slot.availableDays.includes(day),
        );

        if (commonDays.length > 0 && slot.overlapsWith(timeSlot)) {
          return res.status(400).json({
            success: false,
            message: `Cannot activate: Overlaps with active slot ${slot.name} (${slot.timeRange})`,
          });
        }
      }
    }

    timeSlot.isActive = true;
    timeSlot.lastModifiedBy = req.user._id;
    await timeSlot.save();

    res.json({
      success: true,
      message: "Time slot activated successfully",
      data: timeSlot,
    });
  } catch (error) {
    console.error("Error activating time slot:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Initialize default time slots
// @route   POST /api/time-slots/initialize-defaults
// @access  Private (Admin)
export const initializeDefaultSlots = async (req, res) => {
  try {
    const defaultSlots = await TimeSlot.createDefaultSlots(req.user._id);

    res.json({
      success: true,
      data: defaultSlots,
      message: "Default time slots initialized successfully",
    });
  } catch (error) {
    console.error("Error initializing default slots:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Get slots by day
// @route   GET /api/time-slots/day/:day
// @access  Private
export const getSlotsByDay = async (req, res) => {
  try {
    const { day } = req.params;

    const validDays = [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ];
    if (!validDays.includes(day)) {
      return res.status(400).json({
        success: false,
        message: "Invalid day. Must be one of: " + validDays.join(", "),
      });
    }

    const slots = await TimeSlot.find({
      isActive: true,
      availableDays: day,
    }).sort("slotNumber");

    res.json({
      success: true,
      data: slots,
      count: slots.length,
      day,
    });
  } catch (error) {
    console.error("Error fetching slots by day:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Get weekly schedule template
// @route   GET /api/time-slots/weekly-template
// @access  Private
export const getWeeklyTemplate = async (req, res) => {
  try {
    const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    const weeklyTemplate = {};

    for (const day of days) {
      const slots = await TimeSlot.find({
        isActive: true,
        availableDays: day,
      }).sort("slotNumber");

      weeklyTemplate[day] = slots.map((slot) => ({
        slotId: slot._id,
        slotNumber: slot.slotNumber,
        name: slot.name,
        timeRange: slot.timeRange,
        startTime: slot.startTime,
        endTime: slot.endTime,
        slotType: slot.slotType,
        durationMinutes: slot.durationMinutes,
        category: slot.category,
      }));
    }

    res.json({
      success: true,
      data: weeklyTemplate,
      days,
    });
  } catch (error) {
    console.error("Error fetching weekly template:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Check for time conflicts
// @route   POST /api/time-slots/check-conflict
// @access  Private
export const checkTimeConflict = async (req, res) => {
  try {
    const { startTime, endTime, availableDays, excludeSlotId } = req.body;

    const filter = {
      isActive: true,
      $or: [],
    };

    // Check each day for overlap
    for (const day of availableDays || [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
    ]) {
      filter.$or.push({ availableDays: day });
    }

    if (excludeSlotId) {
      filter._id = { $ne: excludeSlotId };
    }

    const existingSlots = await TimeSlot.find(filter);
    const newSlot = { startTime, endTime };

    const conflicts = existingSlots.filter((slot) => {
      // Check if they share any common days
      const commonDays = (
        availableDays || [
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
        ]
      ).filter((day) => slot.availableDays.includes(day));

      return commonDays.length > 0 && slot.overlapsWith(newSlot);
    });

    res.json({
      success: true,
      hasConflict: conflicts.length > 0,
      conflicts: conflicts.map((slot) => ({
        id: slot._id,
        name: slot.name,
        timeRange: slot.timeRange,
        slotType: slot.slotType,
        availableDays: slot.availableDays,
      })),
      message:
        conflicts.length > 0
          ? `Found ${conflicts.length} conflicting slot(s)`
          : "No conflicts found",
    });
  } catch (error) {
    console.error("Error checking time conflict:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};
