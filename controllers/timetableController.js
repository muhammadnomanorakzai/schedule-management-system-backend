import Timetable from "../models/Timetable.js";
import CourseAllocation from "../models/CourseAllocation.js";
import TimeSlot from "../models/TimeSlot.js";
import Room from "../models/Room.js";
import User from "../models/User.js";
import AcademicSession from "../models/AcademicSession.js";
import Program from "../models/Program.js";
import Section from "../models/Section.js";
import mongoose from "mongoose";

// @desc    Create a new timetable
// @route   POST /api/timetables
// @access  Private (Admin, HOD)
export const createTimetable = async (req, res) => {
  try {
    const {
      name,
      description,
      academicSession,
      semester,
      program,
      section,
      schedule,
      constraints,
    } = req.body;

    // Validate academic session
    const session = await AcademicSession.findById(academicSession);
    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Academic session not found",
      });
    }

    // Validate semester based on session type
    const validSemesters =
      session.sessionType === "Fall" ? [1, 3, 5, 7] : [2, 4, 6, 8];
    if (!validSemesters.includes(parseInt(semester))) {
      return res.status(400).json({
        message: `Invalid semester for ${session.sessionType} session. Valid semesters: ${validSemesters.join(", ")}`,
      });
    }

    // Validate program
    const programData = await Program.findById(program);
    if (!programData) {
      return res.status(404).json({
        success: false,
        message: "Program not found",
      });
    }

    // Validate section
    const sectionData = await Section.findById(section);
    if (!sectionData) {
      return res.status(404).json({
        success: false,
        message: "Section not found",
      });
    }

    // Check if timetable already exists
    const existingTimetable = await Timetable.findOne({
      academicSession,
      semester,
      program,
      section,
      status: { $ne: "archived" },
    });

    if (existingTimetable) {
      return res.status(400).json({
        success: false,
        message:
          "Timetable already exists for this section. Use update instead.",
      });
    }

    // Create timetable
    const timetable = new Timetable({
      name:
        name || `${programData.code} - Sem ${semester} - ${sectionData.name}`,
      description,
      academicSession,
      semester,
      program,
      section,
      schedule: schedule || [],
      constraints: constraints || {
        noBackToBackClasses: false,
        maxDailyHours: 8,
        preferMorningSlots: true,
        preferLabAfternoons: true,
      },
      createdBy: req.user._id,
      status: "draft",
    });

    await timetable.save();

    // Populate references
    const populatedTimetable = await Timetable.findById(timetable._id)
      .populate("academicSession", "name year sessionType")
      .populate("program", "name code")
      .populate("section", "name code")
      .populate("createdBy", "name email")
      .populate({
        path: "schedule.courseAllocation",
        populate: [
          { path: "course", select: "code name creditHours" },
          { path: "teacher", select: "name email employeeId" },
        ],
      })
      .populate("schedule.timeSlot", "name startTime endTime slotType")
      .populate("schedule.room", "name code type capacity");

    res.status(201).json({
      success: true,
      data: populatedTimetable,
      message: "Timetable created successfully",
    });
  } catch (error) {
    console.error("Error creating timetable:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Get all timetables with filters
// @route   GET /api/timetables
// @access  Private
export const getAllTimetables = async (req, res) => {
  try {
    const {
      academicSession,
      semester,
      program,
      section,
      status,
      teacher,
      isApproved,
      page = 1,
      limit = 20,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    // Build filter object
    const filter = {};

    if (academicSession) filter.academicSession = academicSession;
    if (semester) filter.semester = parseInt(semester);
    if (program) filter.program = program;
    if (section) filter.section = section;
    if (status) filter.status = status;
    if (isApproved !== undefined) filter.isApproved = isApproved === "true";

    // Teacher filter - through schedule
    if (teacher) {
      // Find timetables where schedule has this teacher
      filter["schedule.courseAllocation.teacher"] = teacher;
    }

    // Pagination
    const pageNumber = parseInt(page);
    const pageSize = parseInt(limit);
    const skip = (pageNumber - 1) * pageSize;

    // Sorting
    const sort = {};
    sort[sortBy] = sortOrder === "desc" ? -1 : 1;

    // Get total count
    const total = await Timetable.countDocuments(filter);

    // Get timetables
    const timetables = await Timetable.find(filter)
      .populate("academicSession", "name year sessionType")
      .populate("program", "name code")
      .populate("section", "name code")
      .populate("createdBy", "name email")
      .populate("approvedBy", "name email")
      .sort(sort)
      .skip(skip)
      .limit(pageSize);

    res.json({
      success: true,
      data: timetables,
      pagination: {
        total,
        page: pageNumber,
        pages: Math.ceil(total / pageSize),
        limit: pageSize,
      },
    });
  } catch (error) {
    console.error("Error fetching timetables:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Get timetable by ID
// @route   GET /api/timetables/:id
// @access  Private
export const getTimetableById = async (req, res) => {
  try {
    const timetable = await Timetable.findById(req.params.id)
      .populate("academicSession", "name year sessionType")
      .populate("program", "name code department")
      .populate("section", "name code")
      .populate("createdBy", "name email")
      .populate("lastModifiedBy", "name email")
      .populate("approvedBy", "name email")
      .populate("publishedBy", "name email")
      .populate({
        path: "schedule.courseAllocation",
        populate: [
          {
            path: "course",
            select: "code name creditHours contactHoursPerWeek",
          },
          {
            path: "teacher",
            select: "name email employeeId department designation",
          },
          { path: "section", select: "name code" },
        ],
      })
      .populate(
        "schedule.timeSlot",
        "name startTime endTime slotType durationMinutes availableDays",
      )
      .populate("schedule.room", "name code type capacity building floor");

    if (!timetable) {
      return res.status(404).json({
        success: false,
        message: "Timetable not found",
      });
    }

    // Check for conflicts
    const conflicts = await timetable.checkConflicts();

    res.json({
      success: true,
      data: timetable,
      conflicts,
      hasConflicts:
        conflicts.teacherConflicts.length > 0 ||
        conflicts.roomConflicts.length > 0 ||
        conflicts.timeConflicts.length > 0,
    });
  } catch (error) {
    console.error("Error fetching timetable:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Update timetable
// @route   PUT /api/timetables/:id
// @access  Private (Admin, HOD)
export const updateTimetable = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Find timetable
    const timetable = await Timetable.findById(id);
    if (!timetable) {
      return res.status(404).json({
        success: false,
        message: "Timetable not found",
      });
    }

    // Check if timetable can be updated
    if (timetable.status === "published" || timetable.status === "archived") {
      return res.status(400).json({
        success: false,
        message: "Cannot update published or archived timetables",
      });
    }

    // Update timetable
    updateData.lastModifiedBy = req.user._id;
    Object.assign(timetable, updateData);
    await timetable.save();

    // Get updated timetable
    const updatedTimetable = await Timetable.findById(id)
      .populate("academicSession", "name year sessionType")
      .populate("program", "name code")
      .populate("section", "name code")
      .populate({
        path: "schedule.courseAllocation",
        populate: [
          { path: "course", select: "code name creditHours" },
          { path: "teacher", select: "name email employeeId" },
        ],
      })
      .populate("schedule.timeSlot", "name startTime endTime slotType")
      .populate("schedule.room", "name code type capacity");

    res.json({
      success: true,
      data: updatedTimetable,
      message: "Timetable updated successfully",
    });
  } catch (error) {
    console.error("Error updating timetable:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Delete timetable
// @route   DELETE /api/timetables/:id
// @access  Private (Admin, HOD)
export const deleteTimetable = async (req, res) => {
  try {
    const timetable = await Timetable.findById(req.params.id);

    if (!timetable) {
      return res.status(404).json({
        success: false,
        message: "Timetable not found",
      });
    }

    // Archive instead of delete
    timetable.status = "archived";
    timetable.lastModifiedBy = req.user._id;
    await timetable.save();

    res.json({
      success: true,
      message: "Timetable archived successfully",
    });
  } catch (error) {
    console.error("Error deleting timetable:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Publish timetable
// @route   PUT /api/timetables/:id/publish
// @access  Private (Admin, HOD)
export const publishTimetable = async (req, res) => {
  try {
    const timetable = await Timetable.findById(req.params.id);

    if (!timetable) {
      return res.status(404).json({
        success: false,
        message: "Timetable not found",
      });
    }

    // Check if timetable can be published
    if (timetable.status !== "draft") {
      return res.status(400).json({
        message: "Only draft timetables can be published",
      });
    }

    // Check for conflicts
    const conflicts = await timetable.checkConflicts();
    if (
      conflicts.teacherConflicts.length > 0 ||
      conflicts.roomConflicts.length > 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Cannot publish timetable with conflicts",
        conflicts,
      });
    }

    timetable.status = "published";
    timetable.publishedBy = req.user._id;
    timetable.publishedAt = new Date();
    await timetable.save();

    res.json({
      success: true,
      message: "Timetable published successfully",
      data: timetable,
    });
  } catch (error) {
    console.error("Error publishing timetable:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Approve timetable
// @route   PUT /api/timetables/:id/approve
// @access  Private (Admin, HOD)
export const approveTimetable = async (req, res) => {
  try {
    const { approvalNotes } = req.body;
    const timetable = await Timetable.findById(req.params.id);

    if (!timetable) {
      return res.status(404).json({
        success: false,
        message: "Timetable not found",
      });
    }

    if (timetable.status !== "published") {
      return res.status(400).json({
        message: "Only published timetables can be approved",
      });
    }

    timetable.isApproved = true;
    timetable.approvedBy = req.user._id;
    timetable.approvedAt = new Date();
    timetable.status = "published";
    await timetable.save();

    res.json({
      success: true,
      message: "Timetable approved successfully",
      data: timetable,
    });
  } catch (error) {
    console.error("Error approving timetable:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Reject timetable
// @route   PUT /api/timetables/:id/reject
// @access  Private (Admin, HOD)
export const rejectTimetable = async (req, res) => {
  try {
    const { rejectionReason } = req.body;

    if (!rejectionReason) {
      return res.status(400).json({
        message: "Rejection reason is required",
      });
    }

    const timetable = await Timetable.findById(req.params.id);

    if (!timetable) {
      return res.status(404).json({
        success: false,
        message: "Timetable not found",
      });
    }

    timetable.status = "rejected";
    timetable.rejectionReason = rejectionReason;
    timetable.lastModifiedBy = req.user._id;
    await timetable.save();

    res.json({
      success: true,
      message: "Timetable rejected successfully",
      data: timetable,
    });
  } catch (error) {
    console.error("Error rejecting timetable:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Add schedule entry
// @route   POST /api/timetables/:id/schedule
// @access  Private (Admin, HOD)
// @desc    Add schedule entry
// @route   POST /api/timetables/:id/schedule
// @access  Private
export const addScheduleEntry = async (req, res) => {
  try {
    const { id } = req.params;
    const { day, timeSlot, courseAllocation, room, notes } = req.body;

    const timetable = await Timetable.findById(id);
    if (!timetable) {
      return res.status(404).json({
        success: false,
        message: "Timetable not found",
      });
    }

    // Check conflicts using the direct function
    const conflictCheck = await checkConflicts(id, {
      day,
      timeSlot,
      courseAllocation,
      room,
      excludeEntryId: null,
    });

    if (conflictCheck.hasConflicts) {
      // Return conflict information
      return res.status(409).json({
        success: false,
        message: "Schedule conflicts detected",
        conflicts: conflictCheck.conflicts,
      });
    }

    // Create new schedule entry
    const newEntry = {
      day,
      timeSlot,
      courseAllocation,
      room: room || null,
      notes: notes || "",
      addedBy: req.user._id,
    };

    timetable.schedule.push(newEntry);
    timetable.updatedBy = req.user._id;
    timetable.version += 0.1;

    await timetable.save();

    // Populate and return the updated timetable
    const updatedTimetable = await Timetable.findById(id)
      .populate("academicSession", "name year")
      .populate("program", "code name")
      .populate("section", "name code")
      .populate({
        path: "schedule.courseAllocation",
        populate: [
          { path: "teacher", select: "name email" },
          { path: "course", select: "code name credits" },
        ],
      })
      .populate("schedule.room", "code name capacity");

    res.status(200).json({
      success: true,
      message: "Schedule entry added successfully",
      data: updatedTimetable,
      conflicts: null,
    });
  } catch (error) {
    console.error("Error adding schedule entry:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Remove schedule entry
// @route   DELETE /api/timetables/:id/schedule/:entryId
// @access  Private (Admin, HOD)
export const removeScheduleEntry = async (req, res) => {
  try {
    const { id, entryId } = req.params;

    const timetable = await Timetable.findById(id);
    if (!timetable) {
      return res.status(404).json({
        success: false,
        message: "Timetable not found",
      });
    }

    // Find and remove entry
    const entryIndex = timetable.schedule.findIndex(
      (entry) => entry._id.toString() === entryId,
    );

    if (entryIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Schedule entry not found",
      });
    }

    timetable.schedule.splice(entryIndex, 1);
    timetable.lastModifiedBy = req.user._id;
    await timetable.save();

    res.json({
      success: true,
      message: "Schedule entry removed successfully",
      data: timetable,
    });
  } catch (error) {
    console.error("Error removing schedule entry:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Get available course allocations for timetable
// @route   GET /api/timetables/:id/available-allocations
// @access  Private
export const getAvailableAllocations = async (req, res) => {
  try {
    const timetable = await Timetable.findById(req.params.id)
      .populate("academicSession", "_id")
      .populate("program", "_id")
      .populate("section", "_id");

    if (!timetable) {
      return res.status(404).json({
        success: false,
        message: "Timetable not found",
      });
    }

    // Get all course allocations for this program, semester, and session
    const allocations = await CourseAllocation.find({
      academicSession: timetable.academicSession._id,
      semester: timetable.semester,
      program: timetable.program._id,
      section: timetable.section._id,
      status: { $in: ["approved", "active"] },
    })
      .populate("course", "code name creditHours")
      .populate("teacher", "name email employeeId")
      .populate("section", "name code");

    // Get already scheduled allocations
    const scheduledAllocationIds = timetable.schedule
      .map((entry) => entry.courseAllocation?.toString())
      .filter(Boolean);

    // Filter out already scheduled allocations
    const availableAllocations = allocations.filter(
      (allocation) =>
        !scheduledAllocationIds.includes(allocation._id.toString()),
    );

    res.json({
      success: true,
      data: availableAllocations,
      count: availableAllocations.length,
    });
  } catch (error) {
    console.error("Error fetching available allocations:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Get timetable matrix
// @route   GET /api/timetables/:id/matrix
// @access  Private
export const getTimetableMatrix = async (req, res) => {
  try {
    const timetable = await Timetable.findById(req.params.id);

    if (!timetable) {
      return res.status(404).json({
        success: false,
        message: "Timetable not found",
      });
    }

    const matrix = await timetable.getTimetableMatrix();

    res.json({
      success: true,
      data: matrix,
      timetable: {
        name: timetable.name,
        program: timetable.program,
        section: timetable.section,
        semester: timetable.semester,
      },
    });
  } catch (error) {
    console.error("Error getting timetable matrix:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Check schedule conflicts
// @route   POST /api/timetables/:id/check-conflicts
// @access  Private
export const checkScheduleConflicts = async (req, res) => {
  try {
    const { id } = req.params;
    const { day, timeSlot, courseAllocation, room, excludeEntryId } = req.body;

    const timetable = await Timetable.findById(id);
    if (!timetable) {
      return res
        .status(404)
        .json({ success: false, message: "Timetable not found" });
    }

    const conflicts = await checkConflictsHelper(timetable, {
      day,
      timeSlot,
      courseAllocation,
      room,
      excludeEntryId,
    });

    res.json({
      success: true,
      hasConflicts: conflicts.hasConflicts,
      conflicts: conflicts.details,
      message: conflicts.hasConflicts ? "Conflicts found" : "No conflicts",
    });
  } catch (error) {
    console.error("Error checking conflicts:", error);
    res
      .status(500)
      .json({ success: false, message: error.message || "Server error" });
  }
};

// Helper function to check schedule conflicts - can be called directly
export const checkConflicts = async (timetableId, entryData) => {
  try {
    const timetable = await Timetable.findById(timetableId);
    if (!timetable) {
      return { success: false, message: "Timetable not found" };
    }

    const conflicts = await checkConflictsHelper(timetable, entryData);

    return {
      success: true,
      hasConflicts: conflicts.hasConflicts,
      conflicts: conflicts.details,
      message: conflicts.hasConflicts ? "Conflicts found" : "No conflicts",
    };
  } catch (error) {
    console.error("Error checking conflicts:", error);
    return {
      success: false,
      message: error.message || "Server error",
    };
  }
};

// Internal helper function (keep private)
const checkConflictsHelper = async (timetable, entryData) => {
  const conflicts = {
    hasConflicts: false,
    details: {
      teacherConflicts: [],
      roomConflicts: [],
      timeSlotConflicts: [],
    },
  };

  // Get course allocation details
  const allocation = await CourseAllocation.findById(entryData.courseAllocation)
    .populate("teacher", "_id name")
    .populate("course", "_id code");

  if (!allocation) return conflicts;

  // Check each existing schedule entry
  for (const existingEntry of timetable.schedule) {
    // Skip the entry being updated
    if (
      entryData.excludeEntryId &&
      existingEntry._id.toString() === entryData.excludeEntryId
    ) {
      continue;
    }

    // Check same day and time slot
    if (
      existingEntry.day === entryData.day &&
      existingEntry.timeSlot.toString() === entryData.timeSlot
    ) {
      // Check teacher conflict
      if (
        existingEntry.courseAllocation?.teacher?.toString() ===
        allocation.teacher._id.toString()
      ) {
        conflicts.hasConflicts = true;
        conflicts.details.teacherConflicts.push({
          type: "teacher",
          message: `Teacher ${allocation.teacher.name} already has a class at this time`,
          existingEntry,
        });
      }

      // Check room conflict
      if (entryData.room && existingEntry.room?.toString() === entryData.room) {
        conflicts.hasConflicts = true;
        conflicts.details.roomConflicts.push({
          type: "room",
          message: "Room already occupied at this time",
          existingEntry,
        });
      }

      // Check same course conflict
      if (
        existingEntry.courseAllocation?.course?.toString() ===
        allocation.course._id.toString()
      ) {
        conflicts.hasConflicts = true;
        conflicts.details.timeSlotConflicts.push({
          type: "course",
          message: `Course ${allocation.course.code} already scheduled at this time`,
          existingEntry,
        });
      }
    }
  }

  return conflicts;
};
