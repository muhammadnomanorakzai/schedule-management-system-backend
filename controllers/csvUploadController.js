// import csvProcessorService from "../services/csvProcessorService.js";
import csvProcessorService, {
  conflictDetectionEngine,
} from "../services/csvProcessorService.js";
import CSVUpload from "../models/CSVUpload.js";
import Timetable from "../models/Timetable.js";
import Conflict from "../models/Conflict.js";
import Section from "../models/Section.js";
import User from "../models/User.js";
import Course from "../models/Course.js";
import TimeSlot from "../models/TimeSlot.js";
import Room from "../models/Room.js";
import csv from "csv-parser";
import stream from "stream";
// Remove fs import
// import fs from "fs";
import AcademicSession from "../models/AcademicSession.js";
import Program from "../models/Program.js";
// Remove cloudinary service import
// import { downloadFromCloudinary } from "../services/cloudinaryService.js";

// @desc    Upload CSV file for bulk processing
// @route   POST /api/csv/upload
// @access  Private (Admin, HOD)
export const uploadCSV = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    const { uploadType, academicSession, semester, program } = req.body;

    if (!uploadType) {
      return res.status(400).json({
        success: false,
        message: "Upload type is required",
      });
    }

    // Validate upload type
    const validTypes = [
      // "course_allocations",
      // "timetable_entries",
      "schedule_entries",
      // "teachers",
      // "rooms",
      // "courses",
    ];

    if (!validTypes.includes(uploadType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid upload type. Valid types: ${validTypes.join(", ")}`,
      });
    }

    // Validate file type
    if (
      !req.file.mimetype.includes("csv") &&
      !req.file.originalname.endsWith(".csv")
    ) {
      return res.status(400).json({
        success: false,
        message: "Only CSV files are allowed",
      });
    }

    // Process CSV directly from buffer
    const result = await csvProcessorService.processCSV(
      req.file,
      uploadType,
      req.user._id,
      {
        academicSession,
        semester,
        program,
        template: req.body.template || "default",
      },
    );

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.error,
      });
    }

    // Get upload record with details
    const uploadRecord = await CSVUpload.findById(result.uploadId)
      .populate("uploadedBy", "name email")
      .populate("academicSession", "name code")
      .populate("program", "name code");

    // Conflict detection for schedule entries
    let conflictResults = null;
    let timetableInfo = null;
    let createdConflicts = [];

    if (uploadType === "schedule_entries" && result.success) {
      try {
        // Get all timetables created/updated by this upload
        const successRecordIds = uploadRecord.successData
          .map((sd) => sd.recordId)
          .filter((id) => id);

        console.log(
          `Found ${successRecordIds.length} successful records for conflict detection`,
        );

        if (successRecordIds.length > 0) {
          // Run conflict detection on each timetable
          conflictResults =
            await conflictDetectionEngine.detectConflictsForUpload(
              successRecordIds,
              req.user._id,
              `csv_upload_${uploadRecord._id}`,
            );

          console.log(
            `Conflict detection completed: ${conflictResults?.length || 0} conflicts found`,
          );

          // Also run immediate conflict check
          createdConflicts =
            await csvProcessorService.runPostUploadConflictDetection(
              successRecordIds,
              uploadRecord._id,
              req.user._id,
            );
        }

        // Get timetable info
        const timetables = await Timetable.find({
          _id: { $in: successRecordIds },
        })
          .populate("section", "code name")
          .populate({
            path: "schedule",
            populate: [
              { path: "timeSlot", select: "name timeRange" },
              {
                path: "courseAllocation",
                populate: [
                  { path: "teacher", select: "name email" },
                  { path: "course", select: "code name" },
                  { path: "section", select: "code name" },
                ],
              },
              { path: "room", select: "roomNumber name" },
            ],
          });

        if (timetables.length > 0) {
          timetableInfo = timetables.map((timetable) => ({
            _id: timetable._id,
            name: timetable.name,
            scheduleCount: timetable.schedule.length,
            schedule: timetable.schedule.map((entry) => ({
              day: entry.day,
              timeSlot: entry.timeSlot?.name || entry.timeSlot?.timeRange,
              course: entry.courseAllocation?.course?.code,
              teacher: entry.courseAllocation?.teacher?.name,
              room: entry.room?.roomNumber,
            })),
          }));
        }
      } catch (timetableError) {
        console.error(
          "Error in conflict detection/timetable info:",
          timetableError,
        );
      }
    }

    res.json({
      success: true,
      message: "CSV upload processed successfully",
      data: {
        ...uploadRecord.toObject(),
        conflictDetection: conflictResults,
        timetableInfo: timetableInfo,
        createdConflicts: createdConflicts,
      },
      results: result.results,
      conflictDetection: conflictResults,
      timetableInfo: timetableInfo,
      createdConflicts: createdConflicts,
    });
  } catch (error) {
    console.error("Error uploading CSV:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Get CSV template for download
// @route   GET /api/csv/template/:uploadType
// @access  Private
export const getCSVTemplate = async (req, res) => {
  try {
    const { uploadType } = req.params;

    const template = csvProcessorService.getCSVTemplate(uploadType);

    res.json({
      success: true,
      data: template,
    });
  } catch (error) {
    console.error("Error getting CSV template:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Download CSV template
// @route   GET /api/csv/template/:uploadType/download
// @access  Private
export const downloadCSVTemplate = async (req, res) => {
  try {
    const { uploadType } = req.params;

    const template = await csvProcessorService.downloadTemplate(uploadType);

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${template.filename}"`,
    );

    res.send(template.content);
  } catch (error) {
    console.error("Error downloading CSV template:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Get upload history
// @route   GET /api/csv/uploads
// @access  Private
export const getUploadHistory = async (req, res) => {
  try {
    const {
      uploadType,
      status,
      startDate,
      endDate,
      uploadedBy,
      page = 1,
      limit = 20,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    // Build filter
    const filter = {};

    if (uploadType) filter.uploadType = uploadType;
    if (status) filter.status = status;
    if (uploadedBy) filter.uploadedBy = uploadedBy;

    // Date filter
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    // Pagination
    const pageNumber = parseInt(page);
    const pageSize = parseInt(limit);
    const skip = (pageNumber - 1) * pageSize;

    // Sorting
    const sort = {};
    sort[sortBy] = sortOrder === "desc" ? -1 : 1;

    // Get total count
    const total = await CSVUpload.countDocuments(filter);

    // Get uploads
    const uploads = await CSVUpload.find(filter)
      .populate("uploadedBy", "name email")
      .populate("academicSession", "name code")
      .populate("program", "name code")
      .sort(sort)
      .skip(skip)
      .limit(pageSize);

    // Calculate statistics using the new method
    const stats = await CSVUpload.getUploadSummary(req.user._id);

    res.json({
      success: true,
      data: uploads,
      pagination: {
        total,
        page: pageNumber,
        pages: Math.ceil(total / pageSize),
        limit: pageSize,
      },
      stats,
    });
  } catch (error) {
    console.error("Error fetching upload history:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Get upload by ID
// @route   GET /api/csv/uploads/:id
// @access  Private
export const getUploadById = async (req, res) => {
  try {
    const upload = await CSVUpload.findById(req.params.id)
      .populate("uploadedBy", "name email")
      .populate("processedBy", "name email")
      .populate("academicSession", "name code year")
      .populate("program", "name code department")
      .populate({
        path: "successData.recordId",
        select: "name code email",
      });

    if (!upload) {
      return res.status(404).json({
        success: false,
        message: "Upload record not found",
      });
    }

    res.json({
      success: true,
      data: upload,
    });
  } catch (error) {
    console.error("Error fetching upload:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Retry failed upload - MODIFIED to remove Cloudinary dependency
// @route   POST /api/csv/uploads/:id/retry
// @access  Private (Admin, HOD)
export const retryUpload = async (req, res) => {
  try {
    const upload = await CSVUpload.findById(req.params.id);

    if (!upload) {
      return res.status(404).json({
        success: false,
        message: "Upload record not found",
      });
    }

    if (upload.status !== "failed" && upload.status !== "partial_success") {
      return res.status(400).json({
        success: false,
        message: "Only failed or partial success uploads can be retried",
      });
    }

    // Since we're no longer storing files in Cloudinary, we need to inform the user
    // that they need to upload the file again
    return res.status(400).json({
      success: false,
      message:
        "Original file not available for retry. Please upload the file again.",
      requiresNewUpload: true,
      uploadId: upload._id,
      uploadType: upload.uploadType,
      metadata: {
        academicSession: upload.academicSession,
        semester: upload.semester,
        program: upload.program,
      },
    });

    /* 
    // Alternative approach if you want to store the buffer temporarily:
    // You would need to modify the uploadCSV function to store the buffer
    // in MongoDB or temporary storage, then retrieve it here
    
    if (!upload.fileBuffer) {
      return res.status(400).json({
        success: false,
        message: "Original file not available for retry",
      });
    }

    // Update upload status
    upload.status = "processing";
    upload.progress = 0;
    upload.processingStartedAt = new Date();
    upload.errors = [];
    upload.successData = [];
    upload.processingLogs = [];
    upload.totalRecords = 0;
    upload.processedRecords = 0;
    upload.successfulRecords = 0;
    upload.failedRecords = 0;
    upload.resultFileUrl = "";
    upload.errorReportUrl = "";

    await upload.save();

    // Create file data object for processing
    const fileData = {
      originalname: upload.originalName,
      buffer: upload.fileBuffer, // You would need to store this
      size: upload.fileSize,
      mimetype: upload.mimeType || "text/csv",
    };

    // Process immediately
    const result = await csvProcessorService.processCSV(
      fileData,
      upload.uploadType,
      req.user._id,
      {
        academicSession: upload.academicSession,
        semester: upload.semester,
        program: upload.program,
        template: upload.templateUsed || "default",
      },
    );

    if (!result.success) {
      upload.status = "failed";
      upload.summary = `Retry failed: ${result.error}`;
      await upload.save();
    }

    // Get updated upload record
    const updatedUpload = await CSVUpload.findById(upload._id)
      .populate("uploadedBy", "name email")
      .populate("academicSession", "name code")
      .populate("program", "name code");

    res.json({
      success: true,
      message: "Upload retry completed",
      data: updatedUpload,
      results: result.results || {},
    });
    */
  } catch (error) {
    console.error("Error retrying upload:", error);

    // Update upload status to failed if upload exists
    try {
      await CSVUpload.findByIdAndUpdate(req.params.id, {
        status: "failed",
        summary: `Retry error: ${error.message}`,
      });
    } catch (updateError) {
      console.error("Error updating upload status:", updateError);
    }

    res.status(500).json({
      success: false,
      message: error.message || "Server error during retry",
    });
  }
};

// @desc    Get upload statistics
// @route   GET /api/csv/stats
// @access  Private
export const getUploadStats = async (req, res) => {
  try {
    const { timeRange = "month", userId } = req.query;

    // Get time-based stats
    const stats = await CSVUpload.getUploadStats(
      userId || req.user._id,
      timeRange,
    );

    // Get recent uploads using new method
    const recentUploads = await CSVUpload.getRecentUploads(
      userId || req.user._id,
      10,
    );

    // Calculate summary using new method
    const summary = await CSVUpload.getUploadSummary(userId || req.user._id);

    res.json({
      success: true,
      data: {
        stats: stats || [],
        recentUploads,
        summary,
      },
    });
  } catch (error) {
    console.error("Error getting upload stats:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Get available upload types
// @route   GET /api/csv/upload-types
// @access  Private
export const getUploadTypes = async (req, res) => {
  try {
    const uploadTypes = [
      // {
      //   type: "course_allocations",
      //   name: "Course Allocations",
      //   description:
      //     "Bulk assign teachers to courses for specific semesters and sections",
      //   icon: "FaListAlt",
      //   sampleSize: "50-1000 records",
      //   estimatedTime: "1-5 minutes",
      // },
      // {
      //   type: "timetable_entries",
      //   name: "Timetable Entries",
      //   description: "Bulk add schedule entries to existing timetables",
      //   icon: "FaCalendarAlt",
      //   sampleSize: "10-500 records",
      //   estimatedTime: "1-3 minutes",
      // },
      {
        type: "schedule_entries",
        name: "Schedule Entries",
        description:
          "Bulk create schedule entries (creates timetables if needed)",
        icon: "FaClock",
        sampleSize: "10-500 records",
        estimatedTime: "2-5 minutes",
      },
      // {
      //   type: "teachers",
      //   name: "Teachers",
      //   description: "Bulk register or update teacher profiles",
      //   icon: "FaUserGraduate",
      //   sampleSize: "10-200 records",
      //   estimatedTime: "1-3 minutes",
      // },
      // {
      //   type: "rooms",
      //   name: "Rooms & Labs",
      //   description: "Bulk register or update room/lab information",
      //   icon: "FaBuilding",
      //   sampleSize: "10-100 records",
      //   estimatedTime: "1-2 minutes",
      // },
    ];

    res.json({
      success: true,
      data: uploadTypes,
    });
  } catch (error) {
    console.error("Error getting upload types:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Validate CSV before upload
// @route   POST /api/csv/validate
// @access  Private (Admin, HOD)
export const validateCSV = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    const { uploadType } = req.body;

    if (!uploadType) {
      return res.status(400).json({
        success: false,
        message: "Upload type is required",
      });
    }

    // Read and validate CSV structure
    const rows = [];
    const errors = [];

    await new Promise((resolve, reject) => {
      const bufferStream = new stream.PassThrough();
      bufferStream.end(req.file.buffer);

      bufferStream
        .pipe(csv())
        .on("data", (row) => {
          rows.push(row);
        })
        .on("end", () => {
          resolve();
        })
        .on("error", (error) => {
          reject(error);
        });
    });

    // Basic validation
    if (rows.length === 0) {
      errors.push({
        row: 0,
        column: "all",
        error: "EMPTY_FILE",
        message: "CSV file is empty",
      });
    }

    // Get template for this upload type
    const template = csvProcessorService.templates[uploadType];
    if (!template) {
      errors.push({
        row: 0,
        column: "all",
        error: "INVALID_TYPE",
        message: `Invalid upload type: ${uploadType}`,
      });
    } else {
      // Check required columns
      if (rows.length > 0) {
        const firstRow = rows[0];
        for (const requiredColumn of template.required) {
          if (!firstRow[requiredColumn]) {
            errors.push({
              row: 1,
              column: requiredColumn,
              error: "MISSING_COLUMN",
              message: `Required column '${requiredColumn}' is missing`,
            });
          }
        }
      }
    }

    res.json({
      success: true,
      data: {
        rowCount: rows.length,
        validationErrors: errors,
        isValid: errors.length === 0,
        sampleRows: rows.slice(0, 3), // First 3 rows as sample
      },
    });
  } catch (error) {
    console.error("Error validating CSV:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Get conflicts for a specific CSV upload
// @route   GET /api/csv/uploads/:id/conflicts
// @access  Private
export const getUploadConflicts = async (req, res) => {
  try {
    const upload = await CSVUpload.findById(req.params.id)
      .populate("uploadedBy", "name email")
      .populate("academicSession", "name code")
      .populate("program", "name code");

    if (!upload) {
      return res.status(404).json({
        success: false,
        message: "Upload record not found",
      });
    }

    if (upload.uploadType !== "schedule_entries") {
      return res.status(400).json({
        success: false,
        message: "Conflicts are only available for schedule entries uploads",
      });
    }

    // Find related timetables based on upload parameters
    const filter = {};
    if (upload.academicSession)
      filter.academicSession = upload.academicSession._id;
    if (upload.semester) filter.semester = upload.semester;
    if (upload.program) filter.program = upload.program._id;

    const timetables = await Timetable.find(filter)
      .populate("section", "code name")
      .populate("program", "code name");

    // Get conflicts for each timetable
    const timetableConflicts = [];
    for (const timetable of timetables) {
      const conflicts = await Conflict.find({
        timetable: timetable._id,
        status: { $in: ["detected", "reviewed"] },
        $or: [
          { detectionSource: `csv_upload_${upload._id}` },
          { uploadReference: upload._id },
        ],
      })
        .populate("detectedBy", "name email")
        .populate("teacher", "name email")
        .populate("room", "roomNumber name")
        .sort({ severity: -1, createdAt: -1 })
        .limit(50);

      if (conflicts.length > 0) {
        timetableConflicts.push({
          timetable: {
            _id: timetable._id,
            name: timetable.name,
            section: timetable.section?.code,
            program: timetable.program?.code,
          },
          conflicts: conflicts,
          count: conflicts.length,
        });
      }
    }

    res.json({
      success: true,
      data: {
        upload,
        timetableConflicts,
        summary: {
          totalTimetables: timetables.length,
          timetablesWithConflicts: timetableConflicts.length,
          totalConflicts: timetableConflicts.reduce(
            (sum, tc) => sum + tc.count,
            0,
          ),
        },
      },
    });
  } catch (error) {
    console.error("Error getting upload conflicts:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Analyze CSV for conflicts before uploading
// @route   POST /api/csv/analyze-conflicts
// @access  Private (Teacher, Admin, HOD)
// @desc    Analyze CSV for conflicts before uploading (IMPROVED)
// @route   POST /api/csv/analyze-conflicts
// @access  Private (Teacher, Admin, HOD)
export const analyzeCSVConflicts = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    const { uploadType, academicSession, semester, program } = req.body;

    if (!uploadType) {
      return res.status(400).json({
        success: false,
        message: "Upload type is required",
      });
    }

    if (uploadType !== "schedule_entries") {
      return res.status(400).json({
        success: false,
        message: "Conflict analysis is only available for schedule entries",
      });
    }

    // Parse CSV first
    const rows = [];
    await new Promise((resolve, reject) => {
      const bufferStream = new stream.PassThrough();
      bufferStream.end(req.file.buffer);

      bufferStream
        .pipe(csv())
        .on("data", (row) => {
          // Clean row data
          const cleanedRow = {};
          Object.keys(row).forEach((key) => {
            cleanedRow[key.trim()] =
              typeof row[key] === "string" ? row[key].trim() : row[key];
          });
          rows.push(cleanedRow);
        })
        .on("end", () => {
          resolve();
        })
        .on("error", (error) => {
          reject(error);
        });
    });

    // Get academic session and program if IDs are provided
    let sessionFilter = null;
    let programFilter = null;
    let semesterFilter = null;

    if (academicSession) {
      sessionFilter = await AcademicSession.findById(academicSession);
    }
    if (program) {
      programFilter = await Program.findById(program);
    }
    if (semester) {
      semesterFilter = parseInt(semester);
    }

    // Pre-load all reference data for validation
    const referenceData = await loadReferenceDataForAnalysis(rows);

    // Build a map of all potential conflicts from the CSV itself (internal conflicts)
    const internalConflicts = new Map(); // key: teacher-day-timeSlot or room-day-timeSlot

    // First pass: Detect conflicts WITHIN the CSV
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 1;

      // Create keys for internal conflict checking
      const teacherKey = `${row.teacher_email}-${row.day}-${row.time_slot_name}`;
      const roomKey = row.room_code
        ? `${row.room_code.toUpperCase()}-${row.day}-${row.time_slot_name}`
        : null;

      // Check teacher conflicts within CSV
      if (!internalConflicts.has(teacherKey)) {
        internalConflicts.set(teacherKey, []);
      }
      internalConflicts.get(teacherKey).push({
        row: rowNumber,
        type: "teacher_conflict",
        data: row,
      });

      // Check room conflicts within CSV
      if (roomKey) {
        if (!internalConflicts.has(roomKey)) {
          internalConflicts.set(roomKey, []);
        }
        internalConflicts.get(roomKey).push({
          row: rowNumber,
          type: "room_conflict",
          data: row,
        });
      }
    }

    // Analyze each row for conflicts with database
    const analysisResults = [];
    const allConflicts = [];
    const conflictRowMap = new Map(); // Track which rows have conflicts

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 1;

      try {
        // Validate the row first using reference data
        await csvProcessorService.validateRow(row, uploadType, rowNumber);

        // Get references for conflict checking using pre-loaded data
        let session = null;
        let prog = null;
        let teacher = null;
        let timeSlot = null;
        let room = null;

        // Get academic session
        if (row.academic_session_code) {
          session = referenceData.sessionMap.get(row.academic_session_code);
        }

        // Get program
        if (row.program_code) {
          prog = referenceData.programMap.get(row.program_code);
        }

        // Get teacher
        if (row.teacher_email) {
          teacher = referenceData.teacherMap.get(
            row.teacher_email.toLowerCase(),
          );
        }

        // Get time slot
        if (row.time_slot_name) {
          timeSlot = referenceData.timeSlotMap.get(row.time_slot_name);
        }

        // Get room
        if (row.room_code && row.room_code.trim()) {
          room = referenceData.roomMap.get(row.room_code.trim().toUpperCase());
        }

        // Check for conflicts with database using session/program/semester filters
        const conflicts = await csvProcessorService.checkScheduleConflicts(
          row,
          rowNumber,
          sessionFilter || session,
          programFilter || prog,
          semesterFilter || (row.semester ? parseInt(row.semester) : null),
          teacher,
          timeSlot,
          room,
          { excludeTimetableIds: [] }, // No exclusions for analysis
        );

        // Check for internal CSV conflicts
        const teacherKey = `${row.teacher_email}-${row.day}-${row.time_slot_name}`;
        const roomKey = row.room_code
          ? `${row.room_code.toUpperCase()}-${row.day}-${row.time_slot_name}`
          : null;

        const internalTeacherConflicts =
          internalConflicts.get(teacherKey) || [];
        const internalRoomConflicts = roomKey
          ? internalConflicts.get(roomKey) || []
          : [];

        const hasInternalTeacherConflict = internalTeacherConflicts.length > 1;
        const hasInternalRoomConflict = internalRoomConflicts.length > 1;

        const rowAnalysis = {
          row: rowNumber,
          data: row,
          isValid: true,
          conflicts: conflicts || {},
          internalConflicts: {
            teacher: hasInternalTeacherConflict,
            room: hasInternalRoomConflict,
          },
          hasConflicts: false,
        };

        // Check if there are any conflicts
        if (
          (conflicts &&
            (conflicts.teacherConflicts.length > 0 ||
              conflicts.roomConflicts.length > 0 ||
              conflicts.validationErrors.length > 0)) ||
          hasInternalTeacherConflict ||
          hasInternalRoomConflict
        ) {
          rowAnalysis.hasConflicts = true;
          conflictRowMap.set(rowNumber, true);

          // Add database conflicts
          if (conflicts.teacherConflicts.length > 0) {
            allConflicts.push({
              type: "teacher_conflict",
              source: "database",
              row: rowNumber,
              teacher: row.teacher_email,
              day: row.day,
              timeSlot: row.time_slot_name,
              conflicts: conflicts.teacherConflicts,
            });
          }

          if (conflicts.roomConflicts.length > 0) {
            allConflicts.push({
              type: "room_conflict",
              source: "database",
              row: rowNumber,
              room: row.room_code,
              day: row.day,
              timeSlot: row.time_slot_name,
              conflicts: conflicts.roomConflicts,
            });
          }

          // Add internal CSV conflicts
          if (hasInternalTeacherConflict) {
            const conflictingRows = internalTeacherConflicts
              .filter((c) => c.row !== rowNumber)
              .map((c) => c.row);

            allConflicts.push({
              type: "teacher_conflict",
              source: "csv_internal",
              row: rowNumber,
              teacher: row.teacher_email,
              day: row.day,
              timeSlot: row.time_slot_name,
              conflictingRows: conflictingRows,
              conflicts: [
                {
                  message: `Teacher ${row.teacher_email} appears multiple times in the same time slot (rows: ${conflictingRows.join(", ")})`,
                  day: row.day,
                  timeSlot: row.time_slot_name,
                },
              ],
            });
          }

          if (hasInternalRoomConflict) {
            const conflictingRows = internalRoomConflicts
              .filter((c) => c.row !== rowNumber)
              .map((c) => c.row);

            allConflicts.push({
              type: "room_conflict",
              source: "csv_internal",
              row: rowNumber,
              room: row.room_code,
              day: row.day,
              timeSlot: row.time_slot_name,
              conflictingRows: conflictingRows,
              conflicts: [
                {
                  message: `Room ${row.room_code} appears multiple times in the same time slot (rows: ${conflictingRows.join(", ")})`,
                  day: row.day,
                  timeSlot: row.time_slot_name,
                },
              ],
            });
          }
        }

        analysisResults.push(rowAnalysis);
      } catch (error) {
        analysisResults.push({
          row: rowNumber,
          data: row,
          isValid: false,
          error: error.message,
          hasConflicts: false,
        });
      }
    }

    // Deduplicate conflicts (remove duplicates)
    const uniqueConflicts = [];
    const conflictKeyMap = new Map();

    for (const conflict of allConflicts) {
      let key;
      if (conflict.type === "teacher_conflict") {
        key = `${conflict.type}-${conflict.teacher}-${conflict.day}-${conflict.timeSlot}`;
      } else {
        key = `${conflict.type}-${conflict.room}-${conflict.day}-${conflict.timeSlot}`;
      }

      if (!conflictKeyMap.has(key)) {
        conflictKeyMap.set(key, true);
        uniqueConflicts.push(conflict);
      }
    }

    // Generate summary
    const summary = {
      totalRows: rows.length,
      validRows: analysisResults.filter((r) => r.isValid).length,
      rowsWithConflicts: conflictRowMap.size,
      totalConflicts: uniqueConflicts.length,
      conflictTypes: {
        teacher: uniqueConflicts.filter((c) => c.type === "teacher_conflict")
          .length,
        room: uniqueConflicts.filter((c) => c.type === "room_conflict").length,
      },
    };

    res.json({
      success: true,
      data: {
        analysis: analysisResults,
        conflicts: uniqueConflicts,
        summary: summary,
        recommendations:
          summary.rowsWithConflicts > 0
            ? [
                "⚠️ Conflicts detected in your CSV file.",
                "• Some rows conflict with existing schedule entries in the database.",
                "• Some rows conflict with other rows within the same CSV file.",
                "Please review the conflicts before uploading.",
              ]
            : [
                "✓ No conflicts detected. Ready to upload.",
                "All schedule entries appear to be valid and don't conflict with existing data.",
              ],
      },
    });
  } catch (error) {
    console.error("Error analyzing CSV conflicts:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// Helper function to load reference data for analysis
async function loadReferenceDataForAnalysis(rows) {
  // Extract unique values
  const sessionCodes = new Set();
  const programCodes = new Set();
  const teacherEmails = new Set();
  const timeSlotNames = new Set();
  const roomCodes = new Set();

  rows.forEach((row) => {
    if (row.academic_session_code)
      sessionCodes.add(row.academic_session_code.trim());
    if (row.program_code) programCodes.add(row.program_code.trim());
    if (row.teacher_email)
      teacherEmails.add(row.teacher_email.trim().toLowerCase());
    if (row.time_slot_name) timeSlotNames.add(row.time_slot_name.trim());
    if (row.room_code) roomCodes.add(row.room_code.trim().toUpperCase());
  });

  // Load all data in parallel
  const [sessions, programs, teachers, timeSlots, rooms] = await Promise.all([
    AcademicSession.find({
      $or: [
        { code: { $in: Array.from(sessionCodes) } },
        { name: { $in: Array.from(sessionCodes) } },
      ],
    }).lean(),

    Program.find({
      code: { $in: Array.from(programCodes) },
    }).lean(),

    User.find({
      email: { $in: Array.from(teacherEmails) },
      role: "Teacher",
    }).lean(),

    TimeSlot.find({
      $or: [
        { name: { $in: Array.from(timeSlotNames) } },
        { timeRange: { $in: Array.from(timeSlotNames) } },
      ],
      isActive: true,
    }).lean(),

    Room.find({
      $or: [
        { roomNumber: { $in: Array.from(roomCodes) } },
        { code: { $in: Array.from(roomCodes) } },
      ],
      isAvailable: true,
    }).lean(),
  ]);

  // Create lookup maps
  const sessionMap = new Map();
  sessions.forEach((s) => {
    sessionMap.set(s.code, s);
    if (s.name) sessionMap.set(s.name, s);
  });

  const programMap = new Map(programs.map((p) => [p.code, p]));

  const teacherMap = new Map(teachers.map((t) => [t.email.toLowerCase(), t]));

  const timeSlotMap = new Map();
  timeSlots.forEach((ts) => {
    timeSlotMap.set(ts.name, ts);
    if (ts.timeRange) timeSlotMap.set(ts.timeRange, ts);
  });

  const roomMap = new Map();
  rooms.forEach((r) => {
    roomMap.set(r.roomNumber, r);
    if (r.code) roomMap.set(r.code, r);
  });

  return {
    sessionMap,
    programMap,
    teacherMap,
    timeSlotMap,
    roomMap,
  };
}

// @desc    Get schedule entries from a CSV upload
// @route   GET /api/csv/uploads/:id/schedule-entries
// @access  Private
export const getUploadScheduleEntries = async (req, res) => {
  try {
    const upload = await CSVUpload.findById(req.params.id)
      .populate("uploadedBy", "name email")
      .populate("academicSession", "name code")
      .populate("program", "name code");

    if (!upload) {
      return res.status(404).json({
        success: false,
        message: "Upload record not found",
      });
    }

    if (upload.uploadType !== "schedule_entries") {
      return res.status(400).json({
        success: false,
        message: "This endpoint is only for schedule entries uploads",
      });
    }

    // Get all timetable entries created by this upload
    const timetableEntries = [];

    // Get unique timetable IDs from successData
    const timetableIds = [
      ...new Set(
        upload.successData.map((sd) => sd.recordId).filter((id) => id),
      ),
    ];

    // Find timetables that contain these entries
    for (const recordId of timetableIds) {
      // Check if it's a timetable ID or schedule entry ID
      const timetable = await Timetable.findOne({
        $or: [{ _id: recordId }, { "schedule._id": recordId }],
      })
        .populate("academicSession", "name code")
        .populate("program", "name code")
        .populate("section", "code name")
        .populate({
          path: "schedule.timeSlot",
          select: "name timeRange durationMinutes",
        })
        .populate({
          path: "schedule.courseAllocation",
          populate: [
            { path: "teacher", select: "name email" },
            { path: "course", select: "code name" },
            { path: "section", select: "code name" },
          ],
        })
        .populate({
          path: "schedule.room",
          select: "roomNumber name capacity",
        });

      if (timetable) {
        // Find specific entries if recordId is a schedule entry ID
        let entries = timetable.schedule;
        if (!timetable._id.equals(recordId)) {
          entries = timetable.schedule.filter((entry) =>
            entry._id.equals(recordId),
          );
        }

        timetableEntries.push({
          timetable: {
            _id: timetable._id,
            name: timetable.name,
            academicSession: timetable.academicSession,
            program: timetable.program,
            section: timetable.section,
          },
          entries: entries,
          totalEntries: entries.length,
        });
      }
    }

    // Also check for conflicts related to this upload
    let conflicts = [];
    if (upload.academicSession && upload.program && upload.semester) {
      const timetables = await Timetable.find({
        academicSession: upload.academicSession._id,
        semester: upload.semester,
        program: upload.program._id,
        status: { $ne: "archived" },
      });

      for (const timetable of timetables) {
        const timetableConflicts = await Conflict.find({
          timetable: timetable._id,
          status: { $in: ["detected", "reviewed"] },
          $or: [
            { detectionSource: { $regex: `csv_upload_${upload._id}` } },
            { uploadReference: upload._id },
          ],
        })
          .populate("detectedBy", "name email")
          .populate("teacher", "name email")
          .populate("room", "roomNumber name")
          .sort({ severity: -1, createdAt: -1 });

        if (timetableConflicts.length > 0) {
          conflicts.push({
            timetable: {
              _id: timetable._id,
              name: timetable.name,
            },
            conflicts: timetableConflicts,
            count: timetableConflicts.length,
          });
        }
      }
    }

    res.json({
      success: true,
      data: {
        upload,
        timetableEntries,
        conflicts: {
          timetableConflicts: conflicts,
          totalConflicts: conflicts.reduce((sum, c) => sum + c.count, 0),
        },
      },
    });
  } catch (error) {
    console.error("Error getting upload schedule entries:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Debug timetable data
// @route   GET /api/csv/debug-timetable/:timetableId
// @access  Private
export const debugTimetable = async (req, res) => {
  try {
    const timetable = await Timetable.findById(req.params.timetableId)
      .populate("academicSession", "name code")
      .populate("program", "name code")
      .populate("section", "code name")
      .populate({
        path: "schedule.timeSlot",
        select: "name timeRange durationMinutes",
      })
      .populate({
        path: "schedule.courseAllocation",
        populate: [
          { path: "teacher", select: "name email" },
          { path: "course", select: "code name" },
          { path: "section", select: "code name" },
        ],
      })
      .populate({
        path: "schedule.room",
        select: "roomNumber name capacity",
      });

    if (!timetable) {
      return res.status(404).json({
        success: false,
        message: "Timetable not found",
      });
    }

    // Check for conflicts manually
    const manualConflicts = {
      teacherConflicts: [],
      roomConflicts: [],
    };

    const teacherSchedule = {};
    const roomSchedule = {};

    for (const entry of timetable.schedule) {
      const key = `${entry.day}-${entry.timeSlot?._id}`;

      // Check teacher conflicts
      if (entry.courseAllocation?.teacher) {
        const teacherKey = `${key}-${entry.courseAllocation.teacher._id}`;
        if (teacherSchedule[teacherKey]) {
          manualConflicts.teacherConflicts.push({
            day: entry.day,
            timeSlot: entry.timeSlot?.name || entry.timeSlot?.timeRange,
            teacher: entry.courseAllocation.teacher.name,
            existingCourse: teacherSchedule[teacherKey].course?.code,
            newCourse: entry.courseAllocation.course?.code,
            entryId: entry._id,
          });
        } else {
          teacherSchedule[teacherKey] = {
            course: entry.courseAllocation.course,
            entryId: entry._id,
          };
        }
      }

      // Check room conflicts
      if (entry.room) {
        const roomKey = `${key}-${entry.room._id}`;
        if (roomSchedule[roomKey]) {
          manualConflicts.roomConflicts.push({
            day: entry.day,
            timeSlot: entry.timeSlot?.name || entry.timeSlot?.timeRange,
            room: entry.room.roomNumber,
            existingCourse: roomSchedule[roomKey].course?.code,
            newCourse: entry.courseAllocation.course?.code,
            entryId: entry._id,
          });
        } else {
          roomSchedule[roomKey] = {
            course: entry.courseAllocation.course,
            entryId: entry._id,
          };
        }
      }
    }

    res.json({
      success: true,
      data: {
        timetable: {
          _id: timetable._id,
          name: timetable.name,
          academicSession: timetable.academicSession,
          program: timetable.program,
          section: timetable.section,
          scheduleCount: timetable.schedule.length,
          schedule: timetable.schedule.map((entry) => ({
            _id: entry._id,
            day: entry.day,
            timeSlot: entry.timeSlot,
            course: entry.courseAllocation?.course,
            teacher: entry.courseAllocation?.teacher,
            room: entry.room,
            notes: entry.notes,
          })),
        },
        manualConflicts,
        hasTeacherConflicts: manualConflicts.teacherConflicts.length > 0,
        hasRoomConflicts: manualConflicts.roomConflicts.length > 0,
      },
    });
  } catch (error) {
    console.error("Error debugging timetable:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Download error report (new function)
// @route   GET /api/csv/download-error-report/:id
// @access  Private
export const downloadErrorReport = async (req, res) => {
  try {
    const upload = await CSVUpload.findById(req.params.id);

    if (!upload) {
      return res.status(404).json({
        success: false,
        message: "Upload not found",
      });
    }

    // For now, just return a message that the file is not available
    // In a production environment, you would generate the report on-demand
    res.json({
      success: false,
      message:
        "Error report download not implemented yet. The error data is available in the upload record.",
      errors: upload.errors,
    });
  } catch (error) {
    console.error("Error downloading report:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Download success report (new function)
// @route   GET /api/csv/download-success-report/:id
// @access  Private
export const downloadSuccessReport = async (req, res) => {
  try {
    const upload = await CSVUpload.findById(req.params.id);

    if (!upload) {
      return res.status(404).json({
        success: false,
        message: "Upload not found",
      });
    }

    // For now, just return a message that the file is not available
    res.json({
      success: false,
      message:
        "Success report download not implemented yet. The success data is available in the upload record.",
      successes: upload.successData,
    });
  } catch (error) {
    console.error("Error downloading report:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
