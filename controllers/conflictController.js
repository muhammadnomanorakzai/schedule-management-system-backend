import mongoose from "mongoose";

import Conflict from "../models/Conflict.js";
import Timetable from "../models/Timetable.js";
import conflictDetectionEngine from "../services/conflictDetectionService.js";

// @desc    Detect conflicts in a timetable
// @route   POST /api/conflicts/detect/:timetableId
// @access  Private (Admin, HOD)
export const detectConflicts = async (req, res) => {
  try {
    const { timetableId } = req.params;
    const {
      clearOldConflicts = false,
      detectionMethod = "manual",
      detectionSource = "user_request",
    } = req.body;

    const result = await conflictDetectionEngine.detectConflicts(
      timetableId,
      req.user._id,
      { clearOldConflicts, detectionMethod, detectionSource },
    );

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.error,
      });
    }

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Error detecting conflicts:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Get all conflicts for a timetable
// @route   GET /api/conflicts/timetable/:timetableId
// @access  Private
export const getTimetableConflicts = async (req, res) => {
  try {
    const { timetableId } = req.params;
    const {
      status,
      conflictType,
      severity,
      resolvedBy,
      page = 1,
      limit = 20,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    // Build filter
    const filter = { timetable: timetableId };

    if (status) filter.status = status;
    if (conflictType) filter.conflictType = conflictType;
    if (severity) filter.severity = severity;
    if (resolvedBy) filter.resolvedBy = resolvedBy;

    // Pagination
    const pageNumber = parseInt(page);
    const pageSize = parseInt(limit);
    const skip = (pageNumber - 1) * pageSize;

    // Sorting
    const sort = {};
    sort[sortBy] = sortOrder === "desc" ? -1 : 1;

    // Get total count
    const total = await Conflict.countDocuments(filter);

    // Get conflicts with populated data
    const conflicts = await Conflict.find(filter)
      .populate("timetable", "name program section semester")
      .populate("detectedBy", "name email")
      .populate("resolvedBy", "name email")
      .populate("scheduleEntries.timeSlot", "name startTime endTime")
      .populate("scheduleEntries.courseAllocation", "course teacher")
      .populate({
        path: "scheduleEntries.courseAllocation",
        populate: [
          { path: "course", select: "code name" },
          { path: "teacher", select: "name email" },
        ],
      })
      .populate("scheduleEntries.room", "code name")
      .sort(sort)
      .skip(skip)
      .limit(pageSize);

    res.json({
      success: true,
      data: conflicts,
      pagination: {
        total,
        page: pageNumber,
        pages: Math.ceil(total / pageSize),
        limit: pageSize,
      },
    });
  } catch (error) {
    console.error("Error fetching conflicts:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Get conflict by ID
// @route   GET /api/conflicts/:id
// @access  Private
export const getConflictById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid conflict ID" });
    }
    const conflict = await Conflict.findById(req.params.id)
      .populate("timetable", "name program section semester academicSession")
      .populate("detectedBy", "name email")
      .populate("resolvedBy", "name email")
      .populate("scheduleEntries.timeSlot", "name startTime endTime slotType")
      .populate("scheduleEntries.courseAllocation", "course teacher section")
      .populate({
        path: "scheduleEntries.courseAllocation",
        populate: [
          { path: "course", select: "code name creditHours department" },
          { path: "teacher", select: "name email employeeId department" },
          { path: "section", select: "name code" },
        ],
      })
      .populate("scheduleEntries.room", "code name type capacity building");

    if (!conflict) {
      return res.status(404).json({
        success: false,
        message: "Conflict not found",
      });
    }

    // Check if conflict is still valid
    const isValid = await conflict.isStillValid();

    res.json({
      success: true,
      data: conflict,
      isValid,
    });
  } catch (error) {
    console.error("Error fetching conflict:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Update conflict status
// @route   PUT /api/conflicts/:id/status
// @access  Private (Admin, HOD)
export const updateConflictStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, resolutionNotes, resolutionType } = req.body;

    const conflict = await Conflict.findById(id);
    if (!conflict) {
      return res.status(404).json({
        success: false,
        message: "Conflict not found",
      });
    }

    // Validate status transition
    const validTransitions = {
      detected: ["reviewed", "resolved", "ignored"],
      reviewed: ["resolved", "ignored", "detected"],
      resolved: ["detected"], // Can re-open resolved conflicts
      ignored: ["detected", "resolved"],
      auto_resolved: ["detected", "resolved", "ignored"],
    };

    const allowedTransitions = validTransitions[conflict.status] || [];
    if (!allowedTransitions.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot change status from ${conflict.status} to ${status}`,
      });
    }

    conflict.status = status;

    if (status === "resolved") {
      conflict.resolutionNotes = resolutionNotes || conflict.resolutionNotes;
      conflict.resolutionType = resolutionType || conflict.resolutionType;
      conflict.resolvedBy = req.user._id;
      conflict.resolvedAt = new Date();
    } else if (status === "ignored") {
      conflict.resolutionNotes = resolutionNotes || "Conflict ignored by user";
      conflict.resolutionType = "manual";
      conflict.resolvedBy = req.user._id;
      conflict.resolvedAt = new Date();
    }

    await conflict.save();

    // Get updated conflict
    const updatedConflict = await Conflict.findById(id).populate(
      "resolvedBy",
      "name email",
    );

    res.json({
      success: true,
      data: updatedConflict,
      message: `Conflict marked as ${status}`,
    });
  } catch (error) {
    console.error("Error updating conflict status:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Apply suggested resolution
// @route   POST /api/conflicts/:id/apply-resolution
// @access  Private (Admin, HOD)
export const applySuggestedResolution = async (req, res) => {
  try {
    const { id } = req.params;
    const { suggestionIndex, customChanges } = req.body;

    const conflict = await Conflict.findById(id);
    if (!conflict) {
      return res.status(404).json({
        success: false,
        message: "Conflict not found",
      });
    }

    if (conflict.status === "resolved") {
      return res.status(400).json({
        success: false,
        message: "Conflict already resolved",
      });
    }

    const timetable = await Timetable.findById(conflict.timetable);
    if (!timetable) {
      return res.status(404).json({
        success: false,
        message: "Timetable not found",
      });
    }

    let resolutionDetails;

    if (customChanges) {
      // Apply custom changes
      resolutionDetails = await applyCustomResolution(
        timetable,
        conflict,
        customChanges,
      );
    } else if (
      suggestionIndex !== undefined &&
      conflict.suggestedResolutions[suggestionIndex]
    ) {
      // Apply suggested resolution
      const suggestion = conflict.suggestedResolutions[suggestionIndex];
      resolutionDetails = await applySuggestionResolution(
        timetable,
        conflict,
        suggestion,
      );
    } else {
      return res.status(400).json({
        success: false,
        message: "No resolution specified",
      });
    }

    if (!resolutionDetails.success) {
      return res.status(400).json({
        success: false,
        message: resolutionDetails.message,
      });
    }

    // Update conflict status
    conflict.status = "resolved";
    conflict.resolutionType = resolutionDetails.type;
    conflict.resolutionNotes = resolutionDetails.notes;
    conflict.resolvedBy = req.user._id;
    conflict.resolvedAt = new Date();
    await conflict.save();

    res.json({
      success: true,
      message: "Resolution applied successfully",
      data: {
        conflict,
        timetable: resolutionDetails.updatedTimetable,
        changes: resolutionDetails.changes,
      },
    });
  } catch (error) {
    console.error("Error applying resolution:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// Helper function to apply custom resolution
const applyCustomResolution = async (timetable, conflict, changes) => {
  try {
    const updatedEntries = [];

    for (const change of changes) {
      const { entryId, field, newValue } = change;

      const entryIndex = timetable.schedule.findIndex(
        (e) => e._id.toString() === entryId,
      );

      if (entryIndex === -1) {
        return {
          success: false,
          message: `Entry ${entryId} not found`,
        };
      }

      // Validate field
      const validFields = ["day", "timeSlot", "room"];
      if (!validFields.includes(field)) {
        return {
          success: false,
          message: `Invalid field: ${field}`,
        };
      }

      // Apply change
      timetable.schedule[entryIndex][field] = newValue;
      timetable.schedule[entryIndex].isModified = true;
      updatedEntries.push({
        entryId,
        field,
        oldValue: timetable.schedule[entryIndex][field],
        newValue,
      });
    }

    timetable.markModified("schedule");
    await timetable.save();

    return {
      success: true,
      type: "manual",
      notes: "Custom resolution applied",
      changes: updatedEntries,
      updatedTimetable: timetable,
    };
  } catch (error) {
    console.error("Error applying custom resolution:", error);
    return {
      success: false,
      message: error.message,
    };
  }
};

// Helper function to apply suggested resolution
const applySuggestionResolution = async (timetable, conflict, suggestion) => {
  try {
    const { type, details } = suggestion;
    let changes = [];

    switch (type) {
      case "time_change":
        const { entryId, currentTimeSlot, availableTimeSlots } = details;

        if (!availableTimeSlots || availableTimeSlots.length === 0) {
          return {
            success: false,
            message: "No available time slots",
          };
        }

        // Use first available time slot
        const newTimeSlot = availableTimeSlots[0];
        const entryIndex = timetable.schedule.findIndex(
          (e) => e._id.toString() === entryId,
        );

        if (entryIndex === -1) {
          return {
            success: false,
            message: "Schedule entry not found",
          };
        }

        // Check if new time slot conflicts with others
        const newConflict = await conflictDetectionEngine.detectConflicts(
          timetable._id,
          conflict.detectedBy,
          { clearOldConflicts: false },
        );

        if (newConflict.summary.totalConflicts > 0) {
          return {
            success: false,
            message: "New time slot creates additional conflicts",
          };
        }

        timetable.schedule[entryIndex].timeSlot = newTimeSlot.id;
        timetable.schedule[entryIndex].isModified = true;

        changes.push({
          entryId,
          field: "timeSlot",
          oldValue: currentTimeSlot,
          newValue: newTimeSlot.id,
        });
        break;

      case "room_change":
        const roomDetails = details;
        const roomEntryIndex = timetable.schedule.findIndex(
          (e) => e._id.toString() === roomDetails.entryId,
        );

        if (roomEntryIndex === -1) {
          return {
            success: false,
            message: "Schedule entry not found",
          };
        }

        if (
          !roomDetails.availableRooms ||
          roomDetails.availableRooms.length === 0
        ) {
          return {
            success: false,
            message: "No available rooms",
          };
        }

        // Use first available room
        const newRoom = roomDetails.availableRooms[0];
        timetable.schedule[roomEntryIndex].room = newRoom.id;
        timetable.schedule[roomEntryIndex].isModified = true;

        changes.push({
          entryId: roomDetails.entryId,
          field: "room",
          oldValue: roomDetails.currentRoom,
          newValue: newRoom.id,
        });
        break;

      case "day_change":
        const dayDetails = details;
        const dayEntryIndex = timetable.schedule.findIndex(
          (e) => e._id.toString() === dayDetails.entryId,
        );

        if (dayEntryIndex === -1) {
          return {
            success: false,
            message: "Schedule entry not found",
          };
        }

        if (
          !dayDetails.availableDays ||
          dayDetails.availableDays.length === 0
        ) {
          return {
            success: false,
            message: "No available days",
          };
        }

        // Use first available day
        const newDay = dayDetails.availableDays[0];
        timetable.schedule[dayEntryIndex].day = newDay;
        timetable.schedule[dayEntryIndex].isModified = true;

        changes.push({
          entryId: dayDetails.entryId,
          field: "day",
          oldValue: dayDetails.currentDay,
          newValue: newDay,
        });
        break;

      default:
        return {
          success: false,
          message: `Unsupported resolution type: ${type}`,
        };
    }

    timetable.markModified("schedule");
    await timetable.save();

    return {
      success: true,
      type: "auto_" + type,
      notes: `Applied ${type} resolution`,
      changes,
      updatedTimetable: timetable,
    };
  } catch (error) {
    console.error("Error applying suggestion:", error);
    return {
      success: false,
      message: error.message,
    };
  }
};

// @desc    Auto-resolve conflicts
// @route   POST /api/conflicts/auto-resolve/:timetableId
// @access  Private (Admin, HOD)
export const autoResolveConflicts = async (req, res) => {
  try {
    const { timetableId } = req.params;
    const { conflictTypes = ["room_occupancy", "resource_unavailable"] } =
      req.body;

    const result = await conflictDetectionEngine.autoResolveConflicts(
      timetableId,
      req.user._id,
      conflictTypes,
    );

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error,
      });
    }

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Error auto-resolving conflicts:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Get conflict statistics
// @route   GET /api/conflicts/stats
// @access  Private
export const getConflictStats = async (req, res) => {
  try {
    const { timetableId, startDate, endDate } = req.query;

    const stats = await conflictDetectionEngine.getConflictStats(timetableId);

    // Filter by date range if provided
    let dateFilteredStats = stats;
    if (startDate || endDate) {
      const dateFilter = {};
      if (startDate) {
        dateFilter.$gte = new Date(startDate);
      }
      if (endDate) {
        dateFilter.$lte = new Date(endDate);
      }

      const dateFiltered = await Conflict.find({
        createdAt: dateFilter,
        ...(timetableId && { timetable: timetableId }),
      });

      dateFilteredStats = {
        byType: [],
        bySeverity: [],
        byStatus: [],
        total: dateFiltered.length,
      };
    }

    res.json({
      success: true,
      data: dateFilteredStats,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error("Error getting conflict stats:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Bulk update conflict status
// @route   PUT /api/conflicts/bulk-update
// @access  Private (Admin, HOD)
export const bulkUpdateConflicts = async (req, res) => {
  try {
    const { conflictIds, status, resolutionNotes } = req.body;

    if (
      !conflictIds ||
      !Array.isArray(conflictIds) ||
      conflictIds.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "No conflict IDs provided",
      });
    }

    const updateData = { status };

    if (status === "resolved" || status === "ignored") {
      updateData.resolutionNotes = resolutionNotes || `Bulk ${status} by user`;
      updateData.resolutionType = "manual";
      updateData.resolvedBy = req.user._id;
      updateData.resolvedAt = new Date();
    }

    const result = await Conflict.updateMany(
      { _id: { $in: conflictIds } },
      updateData,
    );

    res.json({
      success: true,
      message: `Updated ${result.modifiedCount} conflicts`,
      data: result,
    });
  } catch (error) {
    console.error("Error bulk updating conflicts:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Get unresolved critical conflicts
// @route   GET /api/conflicts/critical
// @access  Private
export const getCriticalConflicts = async (req, res) => {
  try {
    const conflicts = await Conflict.find({
      severity: "critical",
      status: { $in: ["detected", "reviewed"] },
    })
      .populate("timetable", "name program section")
      .populate("detectedBy", "name email")
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({
      success: true,
      data: conflicts,
      count: conflicts.length,
    });
  } catch (error) {
    console.error("Error fetching critical conflicts:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};
