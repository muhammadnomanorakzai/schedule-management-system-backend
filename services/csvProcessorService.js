import csv from "csv-parser";
import { createObjectCsvWriter } from "csv-writer";
import mongoose from "mongoose";
import stream from "stream";
import path from "path";
import os from "os";
import fs from "fs";

import CourseAllocation from "../models/CourseAllocation.js";
import Timetable from "../models/Timetable.js";
import TimeSlot from "../models/TimeSlot.js";
import Room from "../models/Room.js";
import User from "../models/User.js";
import Course from "../models/Course.js";
import Program from "../models/Program.js";
import Section from "../models/Section.js";
import AcademicSession from "../models/AcademicSession.js";
import CSVUpload from "../models/CSVUpload.js";
import Department from "../models/Department.js";
import Conflict from "../models/Conflict.js";

// Import Cloudinary services
import {
  uploadToCloudinary,
  deleteFromCloudinary,
  downloadFromCloudinary,
} from "../services/cloudinaryService.js";

// Conflict Detection Engine
class ConflictDetectionEngine {
  async detectConflictsForUpload(recordIds, userId, source) {
    console.log(
      `Detecting conflicts for upload, User: ${userId}, Source: ${source}`,
    );

    const conflicts = [];

    try {
      // Find all timetables that might have conflicts
      const timetables = await Timetable.find({
        status: { $ne: "archived" },
      })
        .populate({
          path: "schedule.courseAllocation",
          populate: [{ path: "teacher" }, { path: "course" }],
        })
        .populate("schedule.room")
        .populate("schedule.timeSlot");

      for (const timetable of timetables) {
        console.log(
          `Checking timetable ${timetable.name} with ${timetable.schedule.length} entries`,
        );

        const teacherSchedule = {};
        const roomSchedule = {};

        for (const entry of timetable.schedule) {
          if (!entry.timeSlot) continue;

          const timeKey = `${entry.day}-${entry.timeSlot._id}`;

          // Check teacher conflicts
          if (entry.courseAllocation?.teacher) {
            const teacherKey = `${timeKey}-${entry.courseAllocation.teacher._id}`;
            if (teacherSchedule[teacherKey]) {
              const conflictData = {
                type: "teacher_schedule",
                conflictType: "teacher_schedule",
                severity: "critical",
                description: `Teacher ${entry.courseAllocation.teacher.name} has overlapping classes on ${entry.day} at ${entry.timeSlot.name}`,
                timetable: timetable._id,
                scheduleEntry: entry._id,
                teacher: entry.courseAllocation.teacher._id,
                detectionSource: source,
                status: "detected",
                detectedBy: userId,
              };

              // Remove undefined fields
              Object.keys(conflictData).forEach(
                (key) =>
                  conflictData[key] === undefined && delete conflictData[key],
              );

              const conflict = new Conflict(conflictData);
              await conflict.save();
              conflicts.push(conflict);
            } else {
              teacherSchedule[teacherKey] = true;
            }
          }

          // Check room conflicts
          if (entry.room) {
            const roomKey = `${timeKey}-${entry.room._id}`;
            if (roomSchedule[roomKey]) {
              const conflictData = {
                type: "room_occupancy",
                conflictType: "room_occupancy",
                severity: "high",
                description: `Room ${entry.room.roomNumber || entry.room.code} is double-booked on ${entry.day} at ${entry.timeSlot.name}`,
                timetable: timetable._id,
                scheduleEntry: entry._id,
                room: entry.room._id,
                detectionSource: source,
                status: "detected",
                detectedBy: userId,
              };

              Object.keys(conflictData).forEach(
                (key) =>
                  conflictData[key] === undefined && delete conflictData[key],
              );

              const conflict = new Conflict(conflictData);
              await conflict.save();
              conflicts.push(conflict);
            } else {
              roomSchedule[roomKey] = true;
            }
          }
        }
      }

      console.log(
        `Conflict detection completed: ${conflicts.length} conflicts found`,
      );
    } catch (error) {
      console.error("Error in conflict detection engine:", error);
      throw error;
    }

    return conflicts;
  }
}

// Create instance
const conflictDetectionEngine = new ConflictDetectionEngine();

class CSVProcessorService {
  constructor() {
    // Use temp directory for temporary files instead of persistent storage
    this.tempDir = path.join(os.tmpdir(), "csv-uploads");
    this.resultsDir = path.join(os.tmpdir(), "csv-results");

    // Create temp directories if they don't exist
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    if (!fs.existsSync(this.resultsDir)) {
      fs.mkdirSync(this.resultsDir, { recursive: true });
    }

    // Define CSV templates for each upload type
    this.templates = {
      course_allocations: {
        columns: [
          "academic_session_code",
          "semester",
          "program_code",
          "course_code",
          "teacher_email",
          "section_code",
          "credit_hours",
          "contact_hours_per_week",
          "max_students",
          "is_lab",
          "lab_teacher_email",
          "notes",
        ],
        required: [
          "academic_session_code",
          "semester",
          "program_code",
          "course_code",
          "teacher_email",
          "section_code",
        ],
        description:
          "Bulk course allocations for assigning teachers to courses",
      },
      timetable_entries: {
        columns: [
          "timetable_name",
          "day",
          "time_slot_name",
          "course_code",
          "teacher_email",
          "section_code",
          "room_code",
          "notes",
        ],
        required: [
          "timetable_name",
          "day",
          "time_slot_name",
          "course_code",
          "teacher_email",
          "section_code",
        ],
        description: "Bulk timetable schedule entries",
      },
      schedule_entries: {
        columns: [
          "academic_session_code",
          "semester",
          "program_code",
          "section_code",
          "day",
          "time_slot_name",
          "course_code",
          "teacher_email",
          "room_code",
          "notes",
        ],
        required: [
          "academic_session_code",
          "semester",
          "program_code",
          "section_code",
          "day",
          "time_slot_name",
          "course_code",
          "teacher_email",
        ],
        description: "Bulk schedule entries for timetables",
      },
      teachers: {
        columns: [
          "name",
          "email",
          "employee_id",
          "department_code",
          "designation",
          "qualification",
          "specialization",
          "max_weekly_hours",
          "is_active",
        ],
        required: ["name", "email", "employee_id", "department_code"],
        description: "Bulk teacher registration",
      },
      rooms: {
        columns: [
          "code",
          "name",
          "type",
          "building",
          "floor",
          "capacity",
          "resources",
          "is_active",
        ],
        required: ["code", "name", "type", "capacity"],
        description: "Bulk room/lab registration",
      },
    };

    // Export conflictDetectionEngine
    this.conflictDetectionEngine = conflictDetectionEngine;
  }

  // Main processing method - UPDATED with Cloudinary
  async processCSV(fileData, uploadType, userId, options = {}) {
    console.log(`Processing CSV upload: ${uploadType}, User: ${userId}`);

    // Upload to Cloudinary first
    let cloudinaryResult;
    try {
      const folder = `schools/csv-uploads/${uploadType}/${userId}`;
      cloudinaryResult = await uploadToCloudinary(
        fileData.buffer,
        folder,
        fileData.originalname,
      );
      console.log(`File uploaded to Cloudinary: ${cloudinaryResult.public_id}`);
    } catch (cloudinaryError) {
      console.error("Cloudinary upload error:", cloudinaryError);
      return {
        success: false,
        error: `Failed to upload file to cloud storage: ${cloudinaryError.message}`,
      };
    }

    // Create upload record with Cloudinary info
    const uploadRecord = await this.createUploadRecord(
      fileData,
      uploadType,
      userId,
      cloudinaryResult,
      options,
    );

    try {
      // Start processing
      await this.updateUploadStatus(uploadRecord._id, "processing", 0);

      const results = await this.processFile(uploadRecord, uploadType, options);

      // Generate result files (temporary files)
      const resultFiles = await this.generateResultFiles(uploadRecord, results);

      // Update upload record with results
      await this.finalizeUpload(uploadRecord._id, results, resultFiles);

      return {
        success: true,
        uploadId: uploadRecord._id,
        results,
        resultFiles,
      };
    } catch (error) {
      console.error("Error processing CSV:", error);

      // Update upload record with failure
      await CSVUpload.findByIdAndUpdate(uploadRecord._id, {
        status: "failed",
        progress: 0,
        processingCompletedAt: new Date(),
        summary: `Processing failed: ${error.message}`,
      });

      return {
        success: false,
        uploadId: uploadRecord._id,
        error: error.message,
      };
    }
  }

  // Create upload record in database - UPDATED with Cloudinary
  async createUploadRecord(
    fileData,
    uploadType,
    userId,
    cloudinaryResult,
    options,
  ) {
    // We don't save file locally anymore, just use Cloudinary
    const filename = `${Date.now()}-${fileData.originalname}`;

    const uploadRecord = new CSVUpload({
      uploadType,
      filename,
      originalName: fileData.originalname,
      fileSize: fileData.size,
      filePath: null, // Set to null since we're using Cloudinary
      mimeType: fileData.mimetype,
      // Cloudinary fields
      cloudinaryId: cloudinaryResult.public_id,
      cloudinaryUrl: cloudinaryResult.secure_url,
      cloudinaryFolder: cloudinaryResult.folder,
      uploadedBy: userId,
      academicSession: options.academicSession || null,
      semester: options.semester || null,
      program: options.program || null,
      validationRules: this.templates[uploadType] || {},
      templateUsed: options.template || "default",
      templateVersion: "1.0",
      status: "uploaded",
    });

    await uploadRecord.save();
    console.log(
      `Created upload record: ${uploadRecord._id} with Cloudinary ID: ${cloudinaryResult.public_id}`,
    );
    return uploadRecord;
  }

  // Process CSV file based on type - UPDATED to use buffer parsing
  async processFile(uploadRecord, uploadType, options) {
    const results = {
      total: 0,
      successful: 0,
      failed: 0,
      errors: [],
      successes: [],
    };

    const rows = [];

    // Get file from Cloudinary
    let fileBuffer;
    try {
      fileBuffer = await downloadFromCloudinary(uploadRecord.cloudinaryUrl);
    } catch (error) {
      throw new Error(
        `Failed to download file from Cloudinary: ${error.message}`,
      );
    }

    // Parse CSV from buffer (not from file path)
    await new Promise((resolve, reject) => {
      const bufferStream = new stream.PassThrough();
      bufferStream.end(fileBuffer);

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

    results.total = rows.length;
    console.log(
      `Processing ${rows.length} rows for upload ${uploadRecord._id}`,
    );

    // Get upload user for createdBy fields
    const uploadUser = await this.getUploadUser(uploadRecord._id);

    // Track timetable IDs for post-upload conflict detection
    const processedTimetableIds = new Set();

    // Process rows based on upload type
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 1;

      // Update progress
      const progress = Math.floor(((i + 1) / rows.length) * 100);
      await this.updateUploadStatus(uploadRecord._id, "processing", progress);

      try {
        // Validate row
        await this.validateRow(row, uploadType, rowNumber, uploadRecord._id);

        // Process based on type
        let result;
        switch (uploadType) {
          case "course_allocations":
            result = await this.processCourseAllocation(
              row,
              uploadRecord._id,
              rowNumber,
              uploadUser,
            );
            break;
          case "timetable_entries":
            result = await this.processTimetableEntry(
              row,
              uploadRecord._id,
              rowNumber,
              uploadUser,
            );
            break;
          case "schedule_entries":
            result = await this.processScheduleEntry(
              row,
              uploadRecord._id,
              rowNumber,
              uploadUser,
            );
            // Track timetable ID for conflict detection
            if (result && result.timetableId) {
              processedTimetableIds.add(result.timetableId);
            }
            break;
          case "teachers":
            result = await this.processTeacher(
              row,
              uploadRecord._id,
              rowNumber,
              uploadUser,
            );
            break;
          case "rooms":
            result = await this.processRoom(
              row,
              uploadRecord._id,
              rowNumber,
              uploadUser,
            );
            break;
          default:
            throw new Error(`Unsupported upload type: ${uploadType}`);
        }

        results.successful++;
        results.successes.push({
          row: rowNumber,
          data: row,
          result,
        });

        // Add success to upload record
        await this.addSuccessToUpload(
          uploadRecord._id,
          result.recordId ||
            result.allocationId ||
            result.teacherId ||
            result.roomId,
          rowNumber,
          `Processed row ${rowNumber} successfully`,
        );
      } catch (error) {
        results.failed++;
        results.errors.push({
          row: rowNumber,
          data: row,
          error: error.message,
        });

        // Add error to upload record
        await this.addErrorToUpload(
          uploadRecord._id,
          rowNumber,
          "processing",
          JSON.stringify(row),
          error.name || "VALIDATION_ERROR",
          error.message,
        );
      }
    }

    // Run post-upload conflict detection for schedule entries
    if (uploadType === "schedule_entries" && processedTimetableIds.size > 0) {
      console.log(
        `Running conflict detection for ${processedTimetableIds.size} timetables`,
      );
      await this.runPostUploadConflictDetection(
        Array.from(processedTimetableIds),
        uploadRecord._id,
        uploadUser,
      );
    }

    return results;
  }

  // Validate CSV row (unchanged - keep as is)
  async validateRow(row, uploadType, rowNumber, uploadId = null) {
    const template = this.templates[uploadType];
    if (!template) {
      throw new Error(`No template found for upload type: ${uploadType}`);
    }

    // Check required columns
    for (const requiredColumn of template.required) {
      if (
        !row[requiredColumn] ||
        row[requiredColumn].toString().trim() === ""
      ) {
        throw new Error(
          `Required column '${requiredColumn}' is empty or missing in row ${rowNumber}`,
        );
      }
    }

    // Type-specific validation
    switch (uploadType) {
      case "course_allocations":
        await this.validateCourseAllocationRow(row, rowNumber, uploadId);
        break;
      case "timetable_entries":
        await this.validateTimetableEntryRow(row, rowNumber);
        break;
      case "schedule_entries":
        await this.validateScheduleEntryRow(row, rowNumber, uploadId);
        break;
      case "teachers":
        await this.validateTeacherRow(row, rowNumber);
        break;
      case "rooms":
        await this.validateRoomRow(row, rowNumber);
        break;
    }
  }

  // The rest of your validation methods (validateCourseAllocationRow, validateScheduleEntryRow, etc.)
  // remain exactly the same - no changes needed
  async validateCourseAllocationRow(row, rowNumber, uploadId) {
    console.log(`Validating course allocation row ${rowNumber}`);

    // Validate semester
    const semester = parseInt(row.semester);
    if (isNaN(semester) || semester < 1 || semester > 8) {
      throw new Error(`Invalid semester: ${row.semester} in row ${rowNumber}`);
    }

    // Validate academic session exists
    const sessionCode = row.academic_session_code.trim();
    const session = await AcademicSession.findOne({
      $or: [{ code: sessionCode }, { name: sessionCode }],
    });
    if (!session) {
      throw new Error(
        `Academic session not found: ${row.academic_session_code} in row ${rowNumber}`,
      );
    }

    // Validate program exists
    const programCode = row.program_code.trim();
    const program = await Program.findOne({ code: programCode });
    if (!program) {
      throw new Error(
        `Program not found: ${row.program_code} in row ${rowNumber}`,
      );
    }

    // Validate course exists
    const courseCode = row.course_code.trim();
    const course = await Course.findOne({ code: courseCode });
    if (!course) {
      throw new Error(
        `Course not found: ${row.course_code} in row ${rowNumber}`,
      );
    }

    // Validate teacher exists
    const teacherEmail = row.teacher_email.trim().toLowerCase();
    const teacher = await User.findOne({
      email: teacherEmail,
      role: "Teacher",
      status: "Approved",
    });
    if (!teacher) {
      throw new Error(
        `Teacher not found or not approved: ${row.teacher_email} in row ${rowNumber}`,
      );
    }

    // Validate section exists
    const sectionCode = row.section_code.trim();

    // Find semester document by name or number
    const semesterDoc = await mongoose.model("Semester").findOne({
      $or: [
        { name: `Semester ${semester}` },
        { number: semester },
        { semesterNumber: semester },
      ],
      academicSession: session._id,
    });

    if (!semesterDoc) {
      throw new Error(
        `Semester ${semester} not found for academic session in row ${rowNumber}`,
      );
    }

    const section = await Section.findOne({
      code: sectionCode,
      program: program._id,
      semester: semesterDoc._id,
      academicSession: session._id,
    });

    if (!section) {
      throw new Error(
        `Section not found: ${row.section_code} for program ${row.program_code} and semester ${semester} in row ${rowNumber}`,
      );
    }

    // Validate credit hours
    if (row.credit_hours) {
      const creditHours = parseInt(row.credit_hours);
      if (isNaN(creditHours) || creditHours < 1 || creditHours > 5) {
        throw new Error(
          `Invalid credit hours: ${row.credit_hours} in row ${rowNumber}`,
        );
      }
    }

    // Validate contact hours
    if (row.contact_hours_per_week) {
      const contactHours = parseInt(row.contact_hours_per_week);
      if (isNaN(contactHours) || contactHours < 1 || contactHours > 20) {
        throw new Error(
          `Invalid contact hours: ${row.contact_hours_per_week} in row ${rowNumber}`,
        );
      }
    }

    console.log(`✅ Course allocation row ${rowNumber} validation passed`);
  }

  async validateScheduleEntryRow(row, rowNumber, uploadId) {
    console.log(`\n=== Validating Schedule Entry Row ${rowNumber} ===`);

    // Validate day
    const validDays = [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ];

    const day = row.day.trim();
    if (!validDays.includes(day)) {
      throw new Error(`Invalid day: ${row.day} in row ${rowNumber}`);
    }

    // Validate time slot
    const timeSlotName = row.time_slot_name.trim();
    const timeSlot = await TimeSlot.findOne({
      $or: [{ name: timeSlotName }, { timeRange: timeSlotName }],
      isActive: true,
    });

    if (!timeSlot) {
      throw new Error(
        `Time slot not found: ${row.time_slot_name} in row ${rowNumber}`,
      );
    }

    // Validate academic session
    const sessionCode = row.academic_session_code.trim();
    const session = await AcademicSession.findOne({
      $or: [{ code: sessionCode }, { name: sessionCode }],
    });

    if (!session) {
      throw new Error(
        `Academic session not found: ${row.academic_session_code} in row ${rowNumber}`,
      );
    }

    // Validate program
    const programCode = row.program_code.trim();
    const program = await Program.findOne({ code: programCode });
    if (!program) {
      throw new Error(
        `Program not found: ${row.program_code} in row ${rowNumber}`,
      );
    }

    // Validate semester
    const semesterNumber = parseInt(row.semester);
    if (isNaN(semesterNumber) || semesterNumber < 1 || semesterNumber > 8) {
      throw new Error(`Invalid semester: ${row.semester} in row ${rowNumber}`);
    }

    // Find semester document
    const semesterDoc = await mongoose.model("Semester").findOne({
      $or: [
        { name: `Semester ${semesterNumber}` },
        { number: semesterNumber },
        { semesterNumber: semesterNumber },
      ],
      academicSession: session._id,
    });

    if (!semesterDoc) {
      throw new Error(
        `Semester ${semesterNumber} not found for academic session in row ${rowNumber}`,
      );
    }

    // Validate section
    const sectionCode = row.section_code.trim();
    const section = await Section.findOne({
      code: sectionCode,
      program: program._id,
      semester: semesterDoc._id,
      academicSession: session._id,
    });

    if (!section) {
      throw new Error(
        `Section not found: ${row.section_code} for program ${row.program_code} in row ${rowNumber}`,
      );
    }

    // Validate course
    const courseCode = row.course_code.trim();
    const course = await Course.findOne({ code: courseCode });
    if (!course) {
      throw new Error(
        `Course not found: ${row.course_code} in row ${rowNumber}`,
      );
    }

    // Validate teacher
    const teacherEmail = row.teacher_email.trim().toLowerCase();
    const teacher = await User.findOne({
      email: teacherEmail,
      role: "Teacher",
      status: "Approved",
    });

    if (!teacher) {
      throw new Error(
        `Teacher not found or not approved: ${row.teacher_email} in row ${rowNumber}`,
      );
    }

    console.log(`✅ Teacher found: ${teacher.name} (${teacher.email})`);

    // Check or create course allocation
    const allocation = await CourseAllocation.findOne({
      academicSession: session._id,
      semester: semesterNumber,
      program: program._id,
      course: course._id,
      teacher: teacher._id,
      section: section._id,
      status: { $in: ["approved", "active", "draft"] },
    });

    if (!allocation) {
      console.log("Creating automatic course allocation...");

      // Get upload user for createdBy field
      let createdByUser = null;
      if (uploadId) {
        const upload = await CSVUpload.findById(uploadId);
        if (upload && upload.uploadedBy) {
          createdByUser = upload.uploadedBy;
        }
      }

      const newAllocation = new CourseAllocation({
        academicSession: session._id,
        semester: semesterNumber,
        program: program._id,
        course: course._id,
        teacher: teacher._id,
        section: section._id,
        creditHours: course.creditHours || 3,
        contactHoursPerWeek: course.contactHours || 3,
        maxStudents: course.maxStudents || 50,
        isLab:
          course.courseType === "Lab" || course.courseType === "Theory+Lab",
        status: "draft",
        createdBy: createdByUser || teacher._id, // Fallback to teacher if no upload user
      });

      await newAllocation.save();
      console.log(`✅ Created allocation: ${newAllocation._id}`);
    } else {
      console.log(`✅ Existing allocation found: ${allocation._id}`);
    }

    // Validate room if provided
    if (row.room_code && row.room_code.trim()) {
      const roomCode = row.room_code.trim();
      const room = await Room.findOne({
        roomNumber: roomCode,
        isAvailable: true,
      });

      if (!room) {
        throw new Error(`Room not found: ${row.room_code} in row ${rowNumber}`);
      }
    }

    console.log(`=== Row ${rowNumber} validation passed ===\n`);
  }

  async validateTimetableEntryRow(row, rowNumber) {
    console.log(`Validating timetable entry row ${rowNumber}`);

    // Validate day
    const validDays = [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ];
    const day = row.day.trim();
    if (!validDays.includes(day)) {
      throw new Error(`Invalid day: ${row.day} in row ${rowNumber}`);
    }

    // Validate timetable exists
    const timetableName = row.timetable_name.trim();
    const timetable = await Timetable.findOne({
      name: timetableName,
      status: { $ne: "archived" },
    });
    if (!timetable) {
      throw new Error(
        `Timetable not found: ${row.timetable_name} in row ${rowNumber}`,
      );
    }

    // Validate time slot
    const timeSlotName = row.time_slot_name.trim();
    const timeSlot = await TimeSlot.findOne({
      $or: [{ name: timeSlotName }, { timeRange: timeSlotName }],
      isActive: true,
    });
    if (!timeSlot) {
      throw new Error(
        `Time slot not found: ${row.time_slot_name} in row ${rowNumber}`,
      );
    }

    // Validate course
    const courseCode = row.course_code.trim();
    const course = await Course.findOne({ code: courseCode });
    if (!course) {
      throw new Error(
        `Course not found: ${row.course_code} in row ${rowNumber}`,
      );
    }

    // Validate teacher
    const teacherEmail = row.teacher_email.trim().toLowerCase();
    const teacher = await User.findOne({
      email: teacherEmail,
      role: "Teacher",
    });
    if (!teacher) {
      throw new Error(
        `Teacher not found: ${row.teacher_email} in row ${rowNumber}`,
      );
    }

    // Validate section exists in this timetable
    const sectionCode = row.section_code.trim();
    if (timetable.section && timetable.section.code !== sectionCode) {
      throw new Error(
        `Section mismatch: Timetable has section ${timetable.section.code}, but row specifies ${sectionCode} in row ${rowNumber}`,
      );
    }

    console.log(`✅ Timetable entry row ${rowNumber} validation passed`);
  }

  async validateTeacherRow(row, rowNumber) {
    // Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(row.email)) {
      throw new Error(`Invalid email: ${row.email} in row ${rowNumber}`);
    }

    // Check if email already exists
    const existingUser = await User.findOne({
      email: row.email.trim().toLowerCase(),
    });
    if (existingUser && existingUser.role === "Teacher") {
      console.log(`Teacher ${row.email} already exists, will update`);
    }

    // Validate employee ID if provided
    if (row.employee_id) {
      const existingEmployee = await User.findOne({
        employeeId: row.employee_id.trim(),
        role: "Teacher",
      });
      if (
        existingEmployee &&
        existingEmployee.email !== row.email.trim().toLowerCase()
      ) {
        throw new Error(
          `Employee ID already exists for another teacher: ${row.employee_id} in row ${rowNumber}`,
        );
      }
    }

    // Validate max weekly hours
    if (row.max_weekly_hours) {
      const maxHours = parseInt(row.max_weekly_hours);
      if (isNaN(maxHours) || maxHours < 1 || maxHours > 40) {
        throw new Error(
          `Invalid max weekly hours: ${row.max_weekly_hours} in row ${rowNumber}`,
        );
      }
    }

    // Validate department exists
    if (row.department_code) {
      const department = await Department.findOne({
        code: row.department_code.trim(),
      });
      if (!department) {
        throw new Error(
          `Department not found: ${row.department_code} in row ${rowNumber}`,
        );
      }
    }
  }

  async validateRoomRow(row, rowNumber) {
    // Validate capacity
    const capacity = parseInt(row.capacity);
    if (isNaN(capacity) || capacity < 1 || capacity > 500) {
      throw new Error(`Invalid capacity: ${row.capacity} in row ${rowNumber}`);
    }

    // Validate type - match your Room model enum
    const validTypes = [
      "Lecture",
      "Lab",
      "Conference",
      "Auditorium",
      "Seminar",
    ];
    if (row.type && !validTypes.includes(row.type)) {
      throw new Error(
        `Invalid room type: ${row.type} in row ${rowNumber}. Valid types: ${validTypes.join(", ")}`,
      );
    }

    // Check if room code already exists
    if (row.code) {
      const existingRoom = await Room.findOne({
        roomNumber: row.code.trim().toUpperCase(),
      });
      if (existingRoom) {
        throw new Error(
          `Room code already exists: ${row.code} in row ${rowNumber}`,
        );
      }
    }
  }

  // Process course allocation row (unchanged)
  async processCourseAllocation(row, uploadId, rowNumber, uploadUser) {
    console.log(`Processing course allocation row ${rowNumber}`);

    // Get references
    const session = await AcademicSession.findOne({
      $or: [
        { code: row.academic_session_code.trim() },
        { name: row.academic_session_code.trim() },
      ],
    });

    const program = await Program.findOne({ code: row.program_code.trim() });
    const course = await Course.findOne({ code: row.course_code.trim() });

    const teacher = await User.findOne({
      email: row.teacher_email.trim().toLowerCase(),
      role: "Teacher",
    });

    const semester = parseInt(row.semester);

    // Find semester document
    const semesterDoc = await mongoose.model("Semester").findOne({
      $or: [
        { name: `Semester ${semester}` },
        { number: semester },
        { semesterNumber: semester },
      ],
      academicSession: session._id,
    });

    const section = await Section.findOne({
      code: row.section_code.trim(),
      program: program._id,
      semester: semesterDoc._id,
      academicSession: session._id,
    });

    // Check for existing allocation
    const existingAllocation = await CourseAllocation.findOne({
      academicSession: session._id,
      semester: semester,
      course: course._id,
      section: section._id,
      status: { $ne: "cancelled" },
    });

    if (existingAllocation) {
      // Update existing allocation
      existingAllocation.teacher = teacher._id;
      existingAllocation.creditHours = row.credit_hours
        ? parseInt(row.credit_hours)
        : course.creditHours;
      existingAllocation.contactHoursPerWeek = row.contact_hours_per_week
        ? parseInt(row.contact_hours_per_week)
        : course.contactHours;
      existingAllocation.maxStudents = row.max_students
        ? parseInt(row.max_students)
        : 50;
      existingAllocation.isLab = row.is_lab
        ? row.is_lab.toLowerCase() === "true"
        : false;

      if (
        row.lab_teacher_email &&
        row.is_lab &&
        row.is_lab.toLowerCase() === "true"
      ) {
        const labTeacher = await User.findOne({
          email: row.lab_teacher_email.trim().toLowerCase(),
          role: "Teacher",
        });
        if (labTeacher) {
          existingAllocation.labTeacher = labTeacher._id;
        }
      }

      existingAllocation.notes = row.notes || "";
      existingAllocation.status = "draft";

      await existingAllocation.save();

      return {
        action: "updated",
        allocationId: existingAllocation._id,
        course: course.code,
        section: section.code,
        teacher: teacher.email,
      };
    } else {
      // Create new allocation
      const allocationData = {
        academicSession: session._id,
        semester: semester,
        program: program._id,
        course: course._id,
        teacher: teacher._id,
        section: section._id,
        creditHours: row.credit_hours
          ? parseInt(row.credit_hours)
          : course.creditHours,
        contactHoursPerWeek: row.contact_hours_per_week
          ? parseInt(row.contact_hours_per_week)
          : course.contactHours,
        maxStudents: row.max_students ? parseInt(row.max_students) : 50,
        isLab: row.is_lab ? row.is_lab.toLowerCase() === "true" : false,
        notes: row.notes || "",
        status: "draft",
        createdBy: uploadUser, // Use upload user
      };

      if (row.lab_teacher_email && allocationData.isLab) {
        const labTeacher = await User.findOne({
          email: row.lab_teacher_email.trim().toLowerCase(),
          role: "Teacher",
        });
        if (labTeacher) {
          allocationData.labTeacher = labTeacher._id;
        }
      }

      const allocation = new CourseAllocation(allocationData);
      await allocation.save();

      return {
        action: "created",
        allocationId: allocation._id,
        course: course.code,
        section: section.code,
        teacher: teacher.email,
      };
    }
  }

  // Process timetable entry row (unchanged)
  async processTimetableEntry(row, uploadId, rowNumber, uploadUser) {
    console.log(`Processing timetable entry row ${rowNumber}`);

    // Get references
    const timetable = await Timetable.findOne({
      name: row.timetable_name.trim(),
      status: { $ne: "archived" },
    });

    const course = await Course.findOne({ code: row.course_code.trim() });
    const teacher = await User.findOne({
      email: row.teacher_email.trim().toLowerCase(),
      role: "Teacher",
    });

    const timeSlot = await TimeSlot.findOne({
      $or: [
        { name: row.time_slot_name.trim() },
        { timeRange: row.time_slot_name.trim() },
      ],
      isActive: true,
    });

    // Get or create allocation
    let allocation = await CourseAllocation.findOne({
      academicSession: timetable.academicSession,
      semester: timetable.semester,
      program: timetable.program,
      course: course._id,
      teacher: teacher._id,
      section: timetable.section,
      status: { $in: ["approved", "active", "draft"] },
    });

    if (!allocation) {
      console.log(
        "Creating automatic course allocation for timetable entry...",
      );

      allocation = new CourseAllocation({
        academicSession: timetable.academicSession,
        semester: timetable.semester,
        program: timetable.program,
        course: course._id,
        teacher: teacher._id,
        section: timetable.section,
        creditHours: course.creditHours || 3,
        contactHoursPerWeek: course.contactHours || 3,
        maxStudents: course.maxStudents || 50,
        status: "draft",
        createdBy: uploadUser,
      });
      await allocation.save();
      console.log(`✅ Created allocation: ${allocation._id}`);
    }

    // Find room if provided
    let room = null;
    if (row.room_code && row.room_code.trim()) {
      const roomCode = row.room_code.trim().toUpperCase();
      room = await Room.findOne({
        $or: [
          { roomNumber: roomCode },
          { code: roomCode },
          { name: { $regex: new RegExp(`^${roomCode}$`, "i") } },
        ],
        isAvailable: true,
      });
    }

    // Create new entry
    const newEntry = {
      day: row.day.trim(),
      timeSlot: timeSlot._id,
      courseAllocation: allocation._id,
      room: room ? room._id : null,
      notes: row.notes || "",
      createdBy: uploadUser,
      createdAt: new Date(),
    };

    timetable.schedule.push(newEntry);
    timetable.markModified("schedule");
    await timetable.save();

    // Get the created entry ID
    const savedTimetable = await Timetable.findById(timetable._id);
    let recordId;

    if (savedTimetable.schedule.length > 0) {
      const lastEntry =
        savedTimetable.schedule[savedTimetable.schedule.length - 1];
      recordId = lastEntry._id;
    }

    return {
      action: "created",
      recordId: recordId,
      timetable: timetable.name,
      day: row.day,
      timeSlot: timeSlot.name,
      course: course.code,
      teacher: teacher.email,
      timetableId: timetable._id,
    };
  }

  // Process schedule entry row (unchanged - but note it uses uploadId which we have)
  async processScheduleEntry(row, uploadId, rowNumber, uploadUser) {
    console.log(`\n=== Processing Schedule Entry Row ${rowNumber} ===`);

    // Log raw data
    console.log("Row data:", JSON.stringify(row, null, 2));

    // 1. Get Academic Session
    const sessionCode = row.academic_session_code?.trim();
    console.log(`Looking for session with code/name: "${sessionCode}"`);

    let session = await AcademicSession.findOne({
      $or: [{ code: sessionCode }, { name: sessionCode }],
    });

    // If not found by exact match, try case-insensitive search
    if (!session) {
      session = await AcademicSession.findOne({
        $or: [
          { code: { $regex: new RegExp(`^${sessionCode}$`, "i") } },
          { name: { $regex: new RegExp(`^${sessionCode}$`, "i") } },
        ],
      });
    }

    if (!session) {
      // Try to find any active session
      const fallbackSession = await AcademicSession.findOne({ isActive: true });
      if (fallbackSession) {
        session = fallbackSession;
        console.log(
          `WARNING: Session "${sessionCode}" not found, using fallback: ${fallbackSession.code}`,
        );
      } else {
        throw new Error(
          `Academic session not found: ${sessionCode} in row ${rowNumber}`,
        );
      }
    }

    console.log(`Found Session: ${session.code} (${session.name})`);

    // 2. Get Program
    const programCode = row.program_code?.trim();
    const program = await Program.findOne({
      $or: [
        { code: programCode },
        { name: programCode },
        { code: { $regex: new RegExp(`^${programCode}$`, "i") } },
      ],
    });
    if (!program) {
      throw new Error(`Program not found: ${programCode} in row ${rowNumber}`);
    }

    // 3. Get Semester
    const semesterNumber = parseInt(row.semester);
    if (isNaN(semesterNumber) || semesterNumber < 1 || semesterNumber > 8) {
      throw new Error(`Invalid semester: ${row.semester} in row ${rowNumber}`);
    }

    // Find semester document
    const Semester = mongoose.model("Semester");
    let semesterDoc = await Semester.findOne({
      $or: [
        { name: `Semester ${semesterNumber}` },
        { number: semesterNumber },
        { semesterNumber: semesterNumber },
      ],
      academicSession: session._id,
    });

    // If semester doc not found, create it
    if (!semesterDoc) {
      console.log(
        `Creating semester ${semesterNumber} for session ${session.code}`,
      );
      const newSemester = new Semester({
        name: `Semester ${semesterNumber}`,
        number: semesterNumber,
        semesterNumber: semesterNumber,
        academicSession: session._id,
        isActive: true,
      });
      await newSemester.save();
      semesterDoc = newSemester;
    }

    // 4. Get Section
    const sectionCode = row.section_code?.trim();
    let section = await Section.findOne({
      code: sectionCode,
      program: program._id,
      semester: semesterDoc._id,
      academicSession: session._id,
    });

    if (!section) {
      console.log(
        `Creating section ${sectionCode} for program ${program.code}, semester ${semesterNumber}`,
      );
      // Create section if it doesn't exist
      const newSection = new Section({
        code: sectionCode,
        name: `Section ${sectionCode}`,
        program: program._id,
        semester: semesterDoc._id,
        academicSession: session._id,
        maxStudents: 50,
      });
      await newSection.save();
      section = newSection;
      console.log(`Created new section: ${section._id}`);
    }

    // 5. Get Course
    const courseCode = row.course_code?.trim();
    const course = await Course.findOne({
      $or: [
        { code: courseCode },
        { courseCode: courseCode },
        { code: { $regex: new RegExp(`^${courseCode}$`, "i") } },
      ],
    });
    if (!course) {
      throw new Error(`Course not found: ${courseCode} in row ${rowNumber}`);
    }

    // 6. Get Teacher
    const teacherEmail = row.teacher_email?.trim().toLowerCase();
    const teacher = await User.findOne({
      email: teacherEmail,
      role: "Teacher",
    });
    if (!teacher) {
      throw new Error(`Teacher not found: ${teacherEmail} in row ${rowNumber}`);
    }

    // 7. Get Time Slot
    const timeSlotName = row.time_slot_name?.trim();
    let timeSlot = await TimeSlot.findOne({
      $or: [
        { name: timeSlotName },
        { timeRange: timeSlotName },
        { code: timeSlotName },
      ],
      isActive: true,
    });

    // If time slot not found, create it
    if (!timeSlot) {
      console.log(`Creating time slot: ${timeSlotName}`);
      timeSlot = new TimeSlot({
        name: timeSlotName,
        timeRange: timeSlotName,
        startTime: timeSlotName.split("-")[0],
        endTime: timeSlotName.split("-")[1],
        durationMinutes: 60,
        isActive: true,
      });
      await timeSlot.save();
    }

    console.log(
      `Found: Session=${session.code}, Program=${program.code}, Semester=${semesterNumber}, Section=${section.code}, Course=${course.code}, Teacher=${teacher.name}, TimeSlot=${timeSlot.name}`,
    );

    // 8. Find or create timetable
    let timetable = await Timetable.findOne({
      academicSession: session._id,
      semester: semesterNumber,
      program: program._id,
      section: section._id,
      status: { $ne: "archived" },
    });

    if (!timetable) {
      timetable = new Timetable({
        name: `${program.code} - Sem ${semesterNumber} - ${section.code}`,
        academicSession: session._id,
        semester: semesterNumber,
        program: program._id,
        section: section._id,
        schedule: [],
        status: "draft",
        createdBy: uploadUser,
      });
      console.log(`Created new timetable: ${timetable.name}`);
    } else {
      console.log(`Found existing timetable: ${timetable.name}`);
    }

    // 9. Find or create course allocation
    let allocation = await CourseAllocation.findOne({
      academicSession: session._id,
      semester: semesterNumber,
      program: program._id,
      course: course._id,
      teacher: teacher._id,
      section: section._id,
      status: { $in: ["approved", "active", "draft"] },
    });

    if (!allocation) {
      console.log("Creating automatic course allocation...");

      // Get upload user for createdBy field
      let createdByUser = null;
      if (uploadId) {
        const upload = await CSVUpload.findById(uploadId);
        if (upload && upload.uploadedBy) {
          createdByUser = upload.uploadedBy;
        }
      }

      allocation = new CourseAllocation({
        academicSession: session._id,
        semester: semesterNumber,
        program: program._id,
        course: course._id,
        teacher: teacher._id,
        section: section._id,
        creditHours: course.creditHours || 3,
        contactHoursPerWeek: course.contactHours || 3,
        maxStudents: course.maxStudents || 50,
        isLab:
          course.courseType === "Lab" || course.courseType === "Theory+Lab",
        status: "draft",
        createdBy: createdByUser || teacher._id,
      });
      await allocation.save();
      console.log(`✅ Created allocation: ${allocation._id}`);
    } else {
      console.log(`✅ Existing allocation found: ${allocation._id}`);
    }

    // 10. Find room if provided
    let room = null;
    if (row.room_code && row.room_code.trim()) {
      const roomCode = row.room_code.trim().toUpperCase();
      room = await Room.findOne({
        $or: [
          { roomNumber: roomCode },
          { code: roomCode },
          { name: { $regex: new RegExp(`^${roomCode}$`, "i") } },
        ],
        isAvailable: true,
      });
      if (room) {
        console.log(
          `Found room: ${room.roomNumber || room.code} (${room.name})`,
        );
      } else {
        console.log(
          `WARNING: Room not found: ${roomCode}. Will create entry without room.`,
        );
      }
    }

    // 11. Create a NEW schedule entry
    const newEntry = {
      day: row.day.trim(),
      timeSlot: timeSlot._id,
      courseAllocation: allocation._id,
      room: room ? room._id : null,
      notes: row.notes || "",
      createdBy: uploadUser,
      createdAt: new Date(),
    };

    timetable.schedule.push(newEntry);
    const action = "created";

    console.log(
      `Created new schedule entry for ${course.code} on ${row.day} at ${timeSlot.name}`,
    );

    // Mark schedule as modified
    timetable.markModified("schedule");
    await timetable.save();

    // 12. Get the created entry ID
    const savedTimetable = await Timetable.findById(timetable._id);
    let recordId;

    if (savedTimetable.schedule.length > 0) {
      const lastEntry =
        savedTimetable.schedule[savedTimetable.schedule.length - 1];
      recordId = lastEntry._id;
    }

    console.log(
      `=== Row ${rowNumber} processed: ${action} entry with ID ${recordId} ===\n`,
    );

    // 13. Immediate conflict check
    const immediateConflicts = await this.checkImmediateConflicts(
      timetable._id,
      recordId,
    );
    if (immediateConflicts.length > 0) {
      console.log(
        `⚠️ Immediate conflicts detected: ${immediateConflicts.length}`,
      );
    }

    return {
      action: action,
      recordId: recordId,
      timetable: timetable.name,
      day: row.day,
      timeSlot: timeSlot.name,
      course: course.code,
      teacher: teacher.email,
      timetableId: timetable._id,
      conflicts: immediateConflicts,
    };
  }

  // Process teacher row (unchanged)
  async processTeacher(row, uploadId, rowNumber, uploadUser) {
    const email = row.email.trim().toLowerCase();

    // Check if teacher already exists
    let teacher = await User.findOne({
      email: email,
      role: "Teacher",
    });

    if (teacher) {
      // Update existing teacher
      teacher.name = row.name || teacher.name;
      teacher.employeeId = row.employee_id || teacher.employeeId;

      // Update department if provided
      if (row.department_code) {
        const department = await Department.findOne({
          code: row.department_code.trim(),
        });
        if (department) {
          teacher.department = department._id;
        }
      }

      teacher.designation = row.designation || teacher.designation;
      teacher.qualification = row.qualification || teacher.qualification;
      teacher.specialization = row.specialization || teacher.specialization;

      if (row.max_weekly_hours) {
        teacher.maxWeeklyHours = parseInt(row.max_weekly_hours);
      }

      if (row.is_active !== undefined) {
        teacher.isActive = row.is_active.toLowerCase() === "true";
      }

      teacher.status = "Approved";
      await teacher.save();

      return {
        action: "updated",
        teacherId: teacher._id,
        name: teacher.name,
        email: teacher.email,
      };
    } else {
      // Create new teacher
      const teacherData = {
        name: row.name,
        email: email,
        password: "TempPassword123", // Will need to be reset
        role: "Teacher",
        employeeId: row.employee_id || `TEMP-${Date.now()}`,
        status: "Approved",
        isActive: row.is_active ? row.is_active.toLowerCase() === "true" : true,
      };

      // Add department if provided
      if (row.department_code) {
        const department = await Department.findOne({
          code: row.department_code.trim(),
        });
        if (department) {
          teacherData.department = department._id;
        }
      }

      // Add additional fields
      const additionalFields = {
        designation: row.designation,
        qualification: row.qualification,
        specialization: row.specialization,
      };

      if (row.max_weekly_hours) {
        additionalFields.maxWeeklyHours = parseInt(row.max_weekly_hours);
      }

      teacher = new User({
        ...teacherData,
        ...additionalFields,
      });

      await teacher.save();

      return {
        action: "created",
        teacherId: teacher._id,
        name: teacher.name,
        email: teacher.email,
      };
    }
  }

  // Process room row (unchanged)
  async processRoom(row, uploadId, rowNumber, uploadUser) {
    const roomNumber = row.code.trim().toUpperCase();

    // Check if room already exists
    let room = await Room.findOne({ roomNumber: roomNumber });

    if (room) {
      // Update existing room
      room.name = row.name || room.name;
      room.roomType = row.type || room.roomType;
      room.building = row.building || room.building;
      room.floor = row.floor || room.floor;
      room.capacity = parseInt(row.capacity) || room.capacity;

      if (row.resources) {
        room.equipment = row.resources.split(",").map((r) => ({
          name: r.trim(),
          quantity: 1,
          condition: "Good",
        }));
      }

      room.isAvailable = row.is_active
        ? row.is_active.toLowerCase() === "true"
        : room.isAvailable;

      await room.save();

      return {
        action: "updated",
        roomId: room._id,
        code: room.roomNumber,
        name: room.name,
      };
    } else {
      // Create new room - need department, using Computer Science as default
      const csDepartment = await Department.findOne({ code: "CS" });
      if (!csDepartment) {
        throw new Error("Default Computer Science department not found");
      }

      room = new Room({
        roomNumber: roomNumber,
        name: row.name || `Room ${roomNumber}`,
        roomType: row.type || "Lecture",
        building: row.building || "Main Building",
        floor: row.floor || "1",
        capacity: parseInt(row.capacity),
        department: csDepartment._id,
        equipment: row.resources
          ? row.resources.split(",").map((r) => ({
              name: r.trim(),
              quantity: 1,
              condition: "Good",
            }))
          : [],
        isAvailable: row.is_active
          ? row.is_active.toLowerCase() === "true"
          : true,
      });

      await room.save();

      return {
        action: "created",
        roomId: room._id,
        code: room.roomNumber,
        name: room.name,
      };
    }
  }

  // Check schedule conflicts (unchanged)
  async checkScheduleConflicts(
    row,
    rowNumber,
    session,
    program,
    semesterNum,
    teacher,
    timeSlot,
    room,
  ) {
    console.log(`Checking conflicts for row ${rowNumber}`);

    const conflicts = {
      teacherConflicts: [],
      roomConflicts: [],
      validationErrors: [],
    };

    try {
      // Check for teacher conflicts
      if (teacher && session && semesterNum && timeSlot && row.day) {
        // Find timetables for this session and semester
        const timetables = await Timetable.find({
          academicSession: session._id,
          semester: semesterNum,
          status: { $ne: "archived" },
        })
          .populate({
            path: "schedule.courseAllocation",
            populate: [{ path: "teacher" }, { path: "course" }],
          })
          .populate("schedule.timeSlot");

        for (const timetable of timetables) {
          for (const entry of timetable.schedule) {
            if (
              entry.day === row.day &&
              entry.timeSlot &&
              timeSlot &&
              entry.timeSlot._id.toString() === timeSlot._id.toString()
            ) {
              if (
                entry.courseAllocation &&
                entry.courseAllocation.teacher &&
                entry.courseAllocation.teacher._id.toString() ===
                  teacher._id.toString()
              ) {
                conflicts.teacherConflicts.push({
                  row: rowNumber,
                  teacher: teacher.email,
                  timetable: timetable.name,
                  course: entry.courseAllocation.course?.code || "Unknown",
                  day: row.day,
                  timeSlot: timeSlot.name,
                  message: `Teacher ${teacher.name} already has ${entry.courseAllocation.course?.code || "a class"} at ${row.day} ${timeSlot.name} in ${timetable.name}`,
                });
              }
            }
          }
        }
      }

      // Check for room conflicts
      if (room && session && semesterNum && timeSlot && row.day) {
        const timetables = await Timetable.find({
          academicSession: session._id,
          semester: semesterNum,
          status: { $ne: "archived" },
        })
          .populate("schedule.room")
          .populate("schedule.timeSlot")
          .populate({
            path: "schedule.courseAllocation",
            populate: [{ path: "course" }],
          });

        for (const timetable of timetables) {
          for (const entry of timetable.schedule) {
            if (
              entry.day === row.day &&
              entry.timeSlot &&
              timeSlot &&
              entry.timeSlot._id.toString() === timeSlot._id.toString() &&
              entry.room &&
              entry.room._id.toString() === room._id.toString()
            ) {
              conflicts.roomConflicts.push({
                row: rowNumber,
                room: room.roomNumber || room.code,
                timetable: timetable.name,
                course: entry.courseAllocation?.course?.code || "Unknown",
                day: row.day,
                timeSlot: timeSlot.name,
                message: `Room ${room.roomNumber || room.code} is already booked for ${entry.courseAllocation?.course?.code || "a class"} at ${row.day} ${timeSlot.name} in ${timetable.name}`,
              });
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error checking conflicts for row ${rowNumber}:`, error);
      conflicts.validationErrors.push({
        row: rowNumber,
        message: `Conflict check error: ${error.message}`,
      });
    }

    console.log(`Conflict check results for row ${rowNumber}:`, {
      teacherConflicts: conflicts.teacherConflicts.length,
      roomConflicts: conflicts.roomConflicts.length,
    });

    return conflicts;
  }

  // Run post-upload conflict detection (unchanged)
  async runPostUploadConflictDetection(timetableIds, uploadId, userId) {
    const conflicts = [];

    try {
      console.log(
        `Running post-upload conflict detection for ${timetableIds.length} timetables`,
      );

      for (const timetableId of timetableIds) {
        const timetable = await Timetable.findById(timetableId)
          .populate({
            path: "schedule.courseAllocation",
            populate: [{ path: "teacher" }, { path: "course" }],
          })
          .populate("schedule.room")
          .populate("schedule.timeSlot");

        if (!timetable) continue;

        console.log(
          `Checking timetable ${timetable.name} with ${timetable.schedule.length} entries`,
        );

        const teacherSchedule = {};
        const roomSchedule = {};

        // Detect conflicts
        for (const entry of timetable.schedule) {
          if (!entry.timeSlot) continue;

          const timeKey = `${entry.day}-${entry.timeSlot._id}`;

          // Teacher conflicts
          if (entry.courseAllocation?.teacher) {
            const teacherKey = `${timeKey}-${entry.courseAllocation.teacher._id}`;
            if (teacherSchedule[teacherKey]) {
              // Create conflict document
              const conflictData = {
                type: "teacher_schedule",
                conflictType: "teacher_schedule",
                severity: "critical",
                description: `Teacher ${entry.courseAllocation.teacher.name} has overlapping classes on ${entry.day} at ${entry.timeSlot.name}`,
                timetable: timetable._id,
                scheduleEntry: entry._id,
                teacher: entry.courseAllocation.teacher._id,
                detectionSource: "csv_upload",
                status: "detected",
                detectedBy: userId,
                uploadReference: uploadId,
              };

              // Remove undefined fields
              Object.keys(conflictData).forEach(
                (key) =>
                  conflictData[key] === undefined && delete conflictData[key],
              );

              const conflict = new Conflict(conflictData);
              await conflict.save();
              conflicts.push(conflict);
              console.log(`Created teacher conflict: ${conflict.description}`);
            } else {
              teacherSchedule[teacherKey] = true;
            }
          }

          // Room conflicts
          if (entry.room) {
            const roomKey = `${timeKey}-${entry.room._id}`;
            if (roomSchedule[roomKey]) {
              const conflictData = {
                type: "room_occupancy",
                conflictType: "room_occupancy",
                severity: "high",
                description: `Room ${entry.room.roomNumber || entry.room.code} is double-booked on ${entry.day} at ${entry.timeSlot.name}`,
                timetable: timetable._id,
                scheduleEntry: entry._id,
                room: entry.room._id,
                detectionSource: "csv_upload",
                status: "detected",
                detectedBy: userId,
                uploadReference: uploadId,
              };

              Object.keys(conflictData).forEach(
                (key) =>
                  conflictData[key] === undefined && delete conflictData[key],
              );

              const conflict = new Conflict(conflictData);
              await conflict.save();
              conflicts.push(conflict);
              console.log(`Created room conflict: ${conflict.description}`);
            } else {
              roomSchedule[roomKey] = true;
            }
          }
        }
      }

      console.log(`Created ${conflicts.length} conflicts in total`);
    } catch (error) {
      console.error("Error in post-upload conflict detection:", error);
    }

    return conflicts;
  }

  // Check immediate conflicts (unchanged)
  async checkImmediateConflicts(timetableId, entryId) {
    const conflicts = [];

    try {
      const timetable = await Timetable.findById(timetableId)
        .populate({
          path: "schedule.courseAllocation",
          populate: [{ path: "teacher" }, { path: "course" }],
        })
        .populate("schedule.room")
        .populate("schedule.timeSlot");

      if (!timetable) return conflicts;

      // Check for teacher conflicts within same timetable
      const teacherSchedule = {};
      for (const entry of timetable.schedule) {
        if (!entry.courseAllocation?.teacher || !entry.timeSlot) continue;

        const key = `${entry.day}-${entry.timeSlot._id.toString()}`;
        const teacherKey = `${key}-${entry.courseAllocation.teacher._id.toString()}`;

        if (teacherSchedule[teacherKey]) {
          // Found conflict
          conflicts.push({
            type: "teacher_conflict",
            message: `Teacher ${entry.courseAllocation.teacher.name} has multiple classes at ${entry.day} ${entry.timeSlot.name}`,
            severity: "critical",
            entryId: entry._id,
          });
        } else {
          teacherSchedule[teacherKey] = true;
        }
      }

      // Check for room conflicts
      const roomSchedule = {};
      for (const entry of timetable.schedule) {
        if (!entry.room || !entry.timeSlot) continue;

        const key = `${entry.day}-${entry.timeSlot._id.toString()}`;
        const roomKey = `${key}-${entry.room._id.toString()}`;

        if (roomSchedule[roomKey]) {
          conflicts.push({
            type: "room_conflict",
            message: `Room ${entry.room.roomNumber || entry.room.code} is double-booked at ${entry.day} ${entry.timeSlot.name}`,
            severity: "high",
            entryId: entry._id,
          });
        } else {
          roomSchedule[roomKey] = true;
        }
      }
    } catch (error) {
      console.error("Error in immediate conflict check:", error);
    }

    return conflicts;
  }

  // Generate result files (using temp directory)
  async generateResultFiles(uploadRecord, results) {
    const resultFiles = {};

    // Generate error report if there are errors
    if (results.errors.length > 0) {
      const errorFilePath = path.join(
        this.resultsDir,
        `errors-${uploadRecord.filename}`,
      );

      const csvWriter = createObjectCsvWriter({
        path: errorFilePath,
        header: [
          { id: "row", title: "Row" },
          { id: "error", title: "Error" },
          { id: "data", title: "Row Data" },
        ],
      });

      const errorData = results.errors.map((error) => ({
        row: error.row,
        error: error.error,
        data: JSON.stringify(error.data),
      }));

      await csvWriter.writeRecords(errorData);

      // Note: These URLs are for reference only - files are temporary
      resultFiles.errorReportUrl = `/api/csv/download-error-report/${uploadRecord._id}`;
    }

    // Generate success report if there are successes
    if (results.successes.length > 0) {
      const successFilePath = path.join(
        this.resultsDir,
        `success-${uploadRecord.filename}`,
      );

      const csvWriter = createObjectCsvWriter({
        path: successFilePath,
        header: [
          { id: "row", title: "Row" },
          { id: "action", title: "Action" },
          { id: "details", title: "Details" },
          { id: "data", title: "Row Data" },
        ],
      });

      const successData = results.successes.map((success) => ({
        row: success.row,
        action: success.result.action,
        details: JSON.stringify(success.result),
        data: JSON.stringify(success.data),
      }));

      await csvWriter.writeRecords(successData);

      resultFiles.resultFileUrl = `/api/csv/download-success-report/${uploadRecord._id}`;
    }

    return resultFiles;
  }

  // Update upload status
  async updateUploadStatus(uploadId, status, progress, additionalData = {}) {
    const updateData = {
      status,
      progress,
      ...additionalData,
    };

    if (status === "processing" && !additionalData.processingStartedAt) {
      updateData.processingStartedAt = new Date();
    }

    if (
      status === "completed" ||
      status === "failed" ||
      status === "partial_success"
    ) {
      updateData.processingCompletedAt = new Date();
    }

    await CSVUpload.findByIdAndUpdate(uploadId, updateData);
  }

  // Add error to upload record
  async addErrorToUpload(uploadId, row, column, value, error, message) {
    const upload = await CSVUpload.findById(uploadId);
    if (upload) {
      await upload.addError(row, column, value, error, message);
    }
  }

  // Add success to upload record
  async addSuccessToUpload(uploadId, recordId, row, details) {
    const upload = await CSVUpload.findById(uploadId);
    if (upload) {
      await upload.addSuccess(recordId, row, details);
    }
  }

  // Finalize upload
  async finalizeUpload(uploadId, results, resultFiles) {
    const status =
      results.failed > 0 && results.successful > 0
        ? "partial_success"
        : results.failed > 0
          ? "failed"
          : "completed";

    await CSVUpload.findByIdAndUpdate(uploadId, {
      status,
      progress: 100,
      totalRecords: results.total,
      processedRecords: results.total,
      successfulRecords: results.successful,
      failedRecords: results.failed,
      resultFileUrl: resultFiles.resultFileUrl,
      errorReportUrl: resultFiles.errorReportUrl,
      processingCompletedAt: new Date(),
      summary: `Processed ${results.total} records: ${results.successful} successful, ${results.failed} failed`,
    });
  }

  // Get upload user
  async getUploadUser(uploadId) {
    const upload = await CSVUpload.findById(uploadId).populate("uploadedBy");
    return upload.uploadedBy._id;
  }

  // Get CSV template (unchanged)
  getCSVTemplate(uploadType) {
    const template = this.templates[uploadType];
    if (!template) {
      throw new Error(`No template found for upload type: ${uploadType}`);
    }

    // Create sample data for template
    const sampleData = {};
    template.columns.forEach((column) => {
      switch (column) {
        case "academic_session_code":
          sampleData[column] = "FALL-2024-2025";
          break;
        case "semester":
          sampleData[column] = "5";
          break;
        case "program_code":
          sampleData[column] = "BSCS";
          break;
        case "course_code":
          sampleData[column] = "CS-301";
          break;
        case "teacher_email":
          sampleData[column] = "teacher@university.edu";
          break;
        case "section_code":
          sampleData[column] = "A";
          break;
        case "day":
          sampleData[column] = "Monday";
          break;
        case "time_slot_name":
          sampleData[column] = "08:30-09:30";
          break;
        case "credit_hours":
          sampleData[column] = "3";
          break;
        case "contact_hours_per_week":
          sampleData[column] = "3";
          break;
        case "max_students":
          sampleData[column] = "50";
          break;
        case "is_lab":
          sampleData[column] = "false";
          break;
        case "room_code":
          sampleData[column] = "CL-101";
          break;
        case "name":
          sampleData[column] = "John Doe";
          break;
        case "email":
          sampleData[column] = "john@university.edu";
          break;
        case "employee_id":
          sampleData[column] = "EMP-001";
          break;
        case "department_code":
          sampleData[column] = "CS";
          break;
        case "capacity":
          sampleData[column] = "50";
          break;
        case "code":
          sampleData[column] = "CL-101";
          break;
        default:
          sampleData[column] = "Sample Value";
      }
    });

    return {
      columns: template.columns,
      required: template.required,
      description: template.description,
      sampleData: [sampleData],
    };
  }

  // Download template as CSV (unchanged)
  async downloadTemplate(uploadType) {
    const template = this.getCSVTemplate(uploadType);

    // Create CSV content
    let csvContent = template.columns.join(",") + "\n";
    template.sampleData.forEach((row) => {
      const rowData = template.columns.map((col) => `"${row[col] || ""}"`);
      csvContent += rowData.join(",") + "\n";
    });

    return {
      filename: `template_${uploadType}.csv`,
      content: csvContent,
      mimeType: "text/csv",
    };
  }

  // Debug teacher lookup (unchanged)
  async debugTeacherLookup(email) {
    console.log("\n=== DEBUG TEACHER LOOKUP ===");
    console.log("Looking for teacher with email:", email);

    const normalizedEmail = email.trim().toLowerCase();
    console.log("Normalized email:", normalizedEmail);

    // Try different queries
    const queries = [
      { email: normalizedEmail },
      { email: normalizedEmail, role: "Teacher" },
      { email: normalizedEmail, role: "Teacher", status: "Approved" },
      {
        email: normalizedEmail,
        role: "Teacher",
        status: { $in: ["Approved", "Pending"] },
      },
    ];

    for (let i = 0; i < queries.length; i++) {
      const query = queries[i];
      const teacher = await User.findOne(query);
      console.log(`Query ${i + 1}:`, JSON.stringify(query));
      console.log(
        `Result:`,
        teacher ? `Found: ${teacher.name} (${teacher.status})` : "Not found",
      );
    }

    // Check all teachers in database
    const allTeachers = await User.find({ role: "Teacher" });
    console.log("\nAll teachers in DB:");
    allTeachers.forEach((t) => {
      console.log(`- ${t.name}: ${t.email} (Status: ${t.status})`);
    });

    console.log("=== END DEBUG ===\n");
  }

  // Validate CSV with debugging (unchanged)
  async validateCSVWithDebugging(fileData, uploadType, userId) {
    console.log("\n=== CSV VALIDATION WITH DEBUGGING ===");

    const rows = [];
    await new Promise((resolve, reject) => {
      const bufferStream = new stream.PassThrough();
      bufferStream.end(fileData.buffer);

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

    console.log(`Total rows: ${rows.length}`);

    // Validate each row with debugging
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 1;

      console.log(`\n--- Row ${rowNumber} ---`);
      console.log("Raw row data:", JSON.stringify(row));

      try {
        // Trim all values
        const trimmedRow = {};
        Object.keys(row).forEach((key) => {
          trimmedRow[key] =
            typeof row[key] === "string" ? row[key].trim() : row[key];
        });

        await this.validateRow(trimmedRow, uploadType, rowNumber);
        console.log(`✅ Row ${rowNumber} validation passed`);
      } catch (error) {
        console.log(`❌ Row ${rowNumber} validation failed:`, error.message);

        // Debug teacher lookup for this row
        if (
          error.message.includes("Teacher not found") &&
          trimmedRow.teacher_email
        ) {
          await this.debugTeacherLookup(trimmedRow.teacher_email);
        }
      }
    }

    console.log("=== END CSV VALIDATION ===\n");
  }
}

// Create and export instance
const csvProcessorService = new CSVProcessorService();
export default csvProcessorService;

// Also export conflictDetectionEngine for use in controller
export { conflictDetectionEngine };
