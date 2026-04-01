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

class ConflictDetectionEngine {
  async detectConflictsForUpload(recordIds, userId, source, uploadId = null) {
    console.log(
      `Detecting conflicts for upload, User: ${userId}, Source: ${source}, Records: ${recordIds.length}`,
    );

    try {
      // Get the upload record to access row mapping if uploadId is provided
      let rowMap = new Map();
      if (uploadId) {
        const upload = await CSVUpload.findById(uploadId).lean();
        if (upload && upload.successData) {
          upload.successData.forEach((item) => {
            if (item.recordId) {
              rowMap.set(item.recordId.toString(), item.row);
            }
          });
        }
      }

      // Find all relevant timetables with proper population
      const timetables = await Timetable.find({
        _id: { $in: recordIds },
        status: { $ne: "archived" },
      })
        .populate({
          path: "schedule.courseAllocation",
          populate: [
            { path: "teacher", select: "_id name email" },
            { path: "course", select: "_id code name" },
          ],
        })
        .populate("schedule.room", "_id roomNumber code name")
        .populate("schedule.timeSlot", "_id name timeRange")
        .lean();

      console.log(
        `Found ${timetables.length} timetables to check for conflicts`,
      );

      const conflicts = [];
      const bulkOps = [];
      const conflictMap = new Map(); // To avoid duplicate conflicts

      // Build a comprehensive schedule map across ALL timetables
      const teacherScheduleMap = new Map(); // key: teacherId-day-timeSlotId
      const roomScheduleMap = new Map(); // key: roomId-day-timeSlotId

      // First pass: Build maps of ALL existing schedule entries
      for (const timetable of timetables) {
        for (const entry of timetable.schedule) {
          if (!entry.timeSlot) continue;

          const timeKey = `${entry.day}-${entry.timeSlot._id}`;

          // Track teacher schedule
          if (entry.courseAllocation?.teacher) {
            const teacherKey = `${entry.courseAllocation.teacher._id}-${timeKey}`;

            if (!teacherScheduleMap.has(teacherKey)) {
              teacherScheduleMap.set(teacherKey, []);
            }
            teacherScheduleMap.get(teacherKey).push({
              timetableId: timetable._id,
              timetableName: timetable.name || `${timetable._id}`,
              entryId: entry._id,
              course: entry.courseAllocation.course?.code || "Unknown",
              teacher: entry.courseAllocation.teacher,
              day: entry.day,
              timeSlot: entry.timeSlot,
            });
          }

          // Track room schedule
          if (entry.room) {
            const roomKey = `${entry.room._id}-${timeKey}`;

            if (!roomScheduleMap.has(roomKey)) {
              roomScheduleMap.set(roomKey, []);
            }
            roomScheduleMap.get(roomKey).push({
              timetableId: timetable._id,
              timetableName: timetable.name || `${timetable._id}`,
              entryId: entry._id,
              course: entry.courseAllocation?.course?.code || "Unknown",
              room: entry.room,
              day: entry.day,
              timeSlot: entry.timeSlot,
            });
          }
        }
      }

      // Second pass: Detect conflicts (any key with more than one entry)
      for (const [teacherKey, entries] of teacherScheduleMap.entries()) {
        if (entries.length > 1) {
          // Teacher conflict detected
          const [teacherId, day, timeSlotId] = teacherKey.split("-");
          const conflictId = `teacher-${teacherKey}`;

          if (!conflictMap.has(conflictId)) {
            const teacher = entries[0].teacher;
            const timeSlot = entries[0].timeSlot;

            const conflictData = {
              type: "teacher_conflict",
              conflictType: "teacher_schedule",
              severity: "critical",
              description: `Teacher ${teacher.name} has ${entries.length} overlapping classes on ${day} at ${timeSlot.name || timeSlot.timeRange}`,
              timetable: entries[0].timetableId,
              timetableName: entries[0].timetableName,
              day: day,
              timeSlot: timeSlot.name || timeSlot.timeRange,
              teacher: teacher._id,
              teacherName: teacher.name,
              teacherEmail: teacher.email,
              course: entries[0].course,
              existingCourse: entries[1]?.course || "Unknown",
              detectionSource: source,
              detectionMethod: "cross_timetable_check",
              status: "detected",
              detectedBy: userId,
              firstDetectedAt: new Date(),
              lastDetectedAt: new Date(),
              scheduleEntries: entries.map((e) => ({
                entry: e.entryId,
                timetable: e.timetableId,
                day: e.day,
                timeSlot: e.timeSlot._id,
                courseAllocation: e.entryId, // This might need adjustment
                room: null,
              })),
            };

            // Add row numbers if available
            const rowsWithConflicts = [];
            for (const entry of entries) {
              const rowNum = rowMap.get(entry.entryId?.toString());
              if (rowNum) rowsWithConflicts.push(rowNum);
            }

            conflictMap.set(conflictId, conflictData);
            conflicts.push({
              ...conflictData,
              rows: rowsWithConflicts.length > 0 ? rowsWithConflicts : [0],
            });

            bulkOps.push(this.createConflictBulkOp(conflictData));
          }
        }
      }

      for (const [roomKey, entries] of roomScheduleMap.entries()) {
        if (entries.length > 1) {
          // Room conflict detected
          const [roomId, day, timeSlotId] = roomKey.split("-");
          const conflictId = `room-${roomKey}`;

          if (!conflictMap.has(conflictId)) {
            const room = entries[0].room;
            const timeSlot = entries[0].timeSlot;

            const conflictData = {
              type: "room_conflict",
              conflictType: "room_occupancy",
              severity: "high",
              description: `Room ${room.roomNumber || room.code} is double-booked ${entries.length} times on ${day} at ${timeSlot.name || timeSlot.timeRange}`,
              timetable: entries[0].timetableId,
              timetableName: entries[0].timetableName,
              day: day,
              timeSlot: timeSlot.name || timeSlot.timeRange,
              room: room._id,
              roomNumber: room.roomNumber || room.code,
              course: entries[0].course,
              existingCourse: entries[1]?.course || "Unknown",
              teacher: entries[0].teacher?._id,
              teacherName: entries[0].teacher?.name,
              detectionSource: source,
              detectionMethod: "cross_timetable_check",
              status: "detected",
              detectedBy: userId,
              firstDetectedAt: new Date(),
              lastDetectedAt: new Date(),
              scheduleEntries: entries.map((e) => ({
                entry: e.entryId,
                timetable: e.timetableId,
                day: e.day,
                timeSlot: e.timeSlot._id,
                courseAllocation: e.entryId,
                room: room._id,
              })),
            };

            // Add row numbers if available
            const rowsWithConflicts = [];
            for (const entry of entries) {
              const rowNum = rowMap.get(entry.entryId?.toString());
              if (rowNum) rowsWithConflicts.push(rowNum);
            }

            conflictMap.set(conflictId, conflictData);
            conflicts.push({
              ...conflictData,
              rows: rowsWithConflicts.length > 0 ? rowsWithConflicts : [0],
            });

            bulkOps.push(this.createConflictBulkOp(conflictData));
          }
        }
      }

      // Bulk insert all conflicts at once
      if (bulkOps.length > 0) {
        try {
          const result = await Conflict.bulkWrite(bulkOps, { ordered: false });
          console.log(`Created ${result.insertedCount} conflicts in database`);
        } catch (bulkError) {
          console.error("Bulk write error:", bulkError);
          // Fallback: insert one by one
          for (const conflictData of conflicts) {
            try {
              const conflict = new Conflict(conflictData);
              await conflict.save();
            } catch (singleError) {
              console.error(
                "Error saving individual conflict:",
                singleError.message,
              );
            }
          }
        }
      }

      // Format conflicts for frontend response
      const formattedConflicts = conflicts.map((conflict) => ({
        type: conflict.type,
        row: conflict.rows && conflict.rows.length > 0 ? conflict.rows[0] : 0,
        allRows: conflict.rows || [],
        teacher: conflict.teacherName || conflict.teacherEmail,
        room: conflict.roomNumber,
        day: conflict.day,
        timeSlot: conflict.timeSlot,
        message: conflict.description,
        severity: conflict.severity,
        conflicts: conflict.scheduleEntries.map((entry, idx) => ({
          day: conflict.day,
          timeSlot: conflict.timeSlot,
          existingCourse: idx === 0 ? conflict.course : conflict.existingCourse,
          message: conflict.description,
          timetableName: conflict.timetableName,
        })),
      }));

      console.log(`Returning ${formattedConflicts.length} formatted conflicts`);
      return formattedConflicts;
    } catch (error) {
      console.error("Error in conflict detection engine:", error);
      throw error;
    }
  }

  createConflictBulkOp(conflictData) {
    return {
      insertOne: {
        document: {
          type: conflictData.type,
          conflictType: conflictData.conflictType,
          severity: conflictData.severity,
          description: conflictData.description,
          timetable: conflictData.timetable,
          day: conflictData.day,
          timeSlot: conflictData.timeSlot,
          teacher: conflictData.teacher,
          room: conflictData.room,
          course: conflictData.course,
          existingCourse: conflictData.existingCourse,
          detectionSource: conflictData.detectionSource,
          detectionMethod: conflictData.detectionMethod,
          status: conflictData.status,
          detectedBy: conflictData.detectedBy,
          firstDetectedAt: conflictData.firstDetectedAt,
          lastDetectedAt: conflictData.lastDetectedAt,
          scheduleEntries: conflictData.scheduleEntries.map((e) => ({
            entry: e.entry,
            timetable: e.timetable,
            day: e.day,
            timeSlot: e.timeSlot,
            courseAllocation: e.courseAllocation,
            room: e.room,
          })),
        },
      },
    };
  }

  // Helper method to extract row numbers (if stored)
  async getConflictsWithRowNumbers(uploadId) {
    try {
      // Find conflicts related to this upload
      const conflicts = await Conflict.find({
        detectionSource: `csv_upload_${uploadId}`,
      })
        .populate("teacher", "name email")
        .populate("room", "roomNumber code")
        .lean();

      // Try to get row numbers from the upload's success data
      const upload = await CSVUpload.findById(uploadId).lean();

      if (upload && upload.successData) {
        // Create a map of recordId to row number
        const rowMap = new Map();
        upload.successData.forEach((item) => {
          if (item.recordId) {
            rowMap.set(item.recordId.toString(), item.row);
          }
        });

        // Add row numbers to conflicts
        return conflicts.map((conflict) => {
          let rows = [];
          // Try to find row number from schedule entries
          if (conflict.scheduleEntries && conflict.scheduleEntries.length > 0) {
            for (const entry of conflict.scheduleEntries) {
              if (rowMap.has(entry.entry?.toString())) {
                rows.push(rowMap.get(entry.entry.toString()));
              }
            }
          }

          return {
            type:
              conflict.type === "teacher_schedule"
                ? "teacher_conflict"
                : conflict.type,
            row: rows.length > 0 ? rows[0] : 0,
            allRows: rows,
            teacher: conflict.teacher?.name || conflict.teacher?.email,
            room: conflict.room?.roomNumber || conflict.room?.code,
            day: conflict.day,
            timeSlot: conflict.timeSlot,
            message: conflict.description,
            severity: conflict.severity,
            conflicts: [
              {
                day: conflict.day,
                timeSlot: conflict.timeSlot,
                existingCourse: conflict.existingCourse,
                message: conflict.description,
              },
            ],
          };
        });
      }

      return [];
    } catch (error) {
      console.error("Error getting conflicts with row numbers:", error);
      return [];
    }
  }
}

class CSVProcessorService {
  constructor() {
    this.resultsDir = path.join(os.tmpdir(), "csv-results");

    if (!fs.existsSync(this.resultsDir)) {
      fs.mkdirSync(this.resultsDir, { recursive: true });
    }

    this.templates = {
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
    };

    this.conflictDetectionEngine = new ConflictDetectionEngine();
  }

  // Main processing method - OPTIMIZED
  async processCSV(fileData, uploadType, userId, options = {}) {
    console.log(`Processing CSV upload: ${uploadType}, User: ${userId}`);

    // Create upload record
    const uploadRecord = await this.createUploadRecord(
      fileData,
      uploadType,
      userId,
      options,
    );

    try {
      await this.updateUploadStatus(uploadRecord._id, "processing", 0);

      // Parse CSV once
      const rows = await this.parseCSVBuffer(fileData.buffer);

      // Pre-load all reference data
      const referenceData = await this.loadReferenceData(rows);

      // Process all rows with optimized batch operations
      const results = await this.processRowsBatch(
        rows,
        uploadRecord,
        uploadType,
        userId,
        referenceData,
      );

      // Generate result files
      const resultFiles = await this.generateResultFiles(uploadRecord, results);

      await this.finalizeUpload(uploadRecord._id, results, resultFiles);

      // Run conflict detection for processed timetables WITH ROW MAPPING
      if (
        results.processedTimetableIds &&
        results.processedTimetableIds.size > 0
      ) {
        console.log(
          `Running conflict detection for ${results.processedTimetableIds.size} timetables`,
        );
        const conflicts =
          await this.conflictDetectionEngine.detectConflictsForUpload(
            Array.from(results.processedTimetableIds),
            userId,
            `csv_upload_${uploadRecord._id}`,
            uploadRecord._id, // Pass uploadId for row mapping
          );

        // Store conflicts in results
        results.conflicts = conflicts;
      }

      return {
        success: true,
        uploadId: uploadRecord._id,
        results,
        resultFiles,
      };
    } catch (error) {
      console.error("Error processing CSV:", error);

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

  // Parse CSV buffer once
  async parseCSVBuffer(buffer) {
    const rows = [];
    await new Promise((resolve, reject) => {
      const bufferStream = new stream.PassThrough();
      bufferStream.end(buffer);

      bufferStream
        .pipe(csv())
        .on("data", (row) => {
          // Clean row data once
          const cleanedRow = {};
          Object.keys(row).forEach((key) => {
            cleanedRow[key.trim()] =
              typeof row[key] === "string" ? row[key].trim() : row[key];
          });
          rows.push(cleanedRow);
        })
        .on("end", resolve)
        .on("error", reject);
    });
    return rows;
  }

  // Pre-load all reference data in parallel
  async loadReferenceData(rows) {
    console.log("Pre-loading reference data...");

    // Extract unique values from all rows
    const uniqueValues = {
      sessionCodes: new Set(),
      programCodes: new Set(),
      courseCodes: new Set(),
      teacherEmails: new Set(),
      timeSlotNames: new Set(),
      roomCodes: new Set(),
      semesterNumbers: new Set(),
      sectionKeys: new Map(),
    };

    rows.forEach((row) => {
      if (row.academic_session_code)
        uniqueValues.sessionCodes.add(row.academic_session_code.trim());
      if (row.program_code)
        uniqueValues.programCodes.add(row.program_code.trim());
      if (row.course_code) uniqueValues.courseCodes.add(row.course_code.trim());
      if (row.teacher_email)
        uniqueValues.teacherEmails.add(row.teacher_email.trim().toLowerCase());
      if (row.time_slot_name)
        uniqueValues.timeSlotNames.add(row.time_slot_name.trim());
      if (row.room_code)
        uniqueValues.roomCodes.add(row.room_code.trim().toUpperCase());
      if (row.semester)
        uniqueValues.semesterNumbers.add(parseInt(row.semester));

      if (
        row.academic_session_code &&
        row.program_code &&
        row.semester &&
        row.section_code
      ) {
        const key = `${row.academic_session_code.trim()}|${row.program_code.trim()}|${row.semester}|${row.section_code.trim()}`;
        uniqueValues.sectionKeys.set(key, {
          sessionCode: row.academic_session_code.trim(),
          programCode: row.program_code.trim(),
          semester: parseInt(row.semester),
          sectionCode: row.section_code.trim(),
        });
      }
    });

    // Load all data in parallel
    const [
      sessions,
      programs,
      courses,
      teachers,
      timeSlots,
      rooms,
      semesters,
      existingSections,
      existingAllocations,
      existingTimetables,
    ] = await Promise.all([
      AcademicSession.find({
        $or: [
          { code: { $in: Array.from(uniqueValues.sessionCodes) } },
          { name: { $in: Array.from(uniqueValues.sessionCodes) } },
        ],
      }).lean(),

      Program.find({
        code: { $in: Array.from(uniqueValues.programCodes) },
      }).lean(),

      Course.find({
        $or: [
          { code: { $in: Array.from(uniqueValues.courseCodes) } },
          { courseCode: { $in: Array.from(uniqueValues.courseCodes) } },
        ],
      }).lean(),

      User.find({
        email: { $in: Array.from(uniqueValues.teacherEmails) },
        role: "Teacher",
      }).lean(),

      TimeSlot.find({
        $or: [
          { name: { $in: Array.from(uniqueValues.timeSlotNames) } },
          { timeRange: { $in: Array.from(uniqueValues.timeSlotNames) } },
        ],
        isActive: true,
      }).lean(),

      Room.find({
        $or: [
          { roomNumber: { $in: Array.from(uniqueValues.roomCodes) } },
          { code: { $in: Array.from(uniqueValues.roomCodes) } },
        ],
        isAvailable: true,
      }).lean(),

      mongoose
        .model("Semester")
        .find({
          $or: [
            { number: { $in: Array.from(uniqueValues.semesterNumbers) } },
            {
              semesterNumber: { $in: Array.from(uniqueValues.semesterNumbers) },
            },
          ],
        })
        .lean(),

      Section.find().lean(),

      CourseAllocation.find({
        status: { $in: ["approved", "active", "draft"] },
      }).lean(),

      Timetable.find({
        status: { $ne: "archived" },
      }).lean(),
    ]);

    // Create lookup maps for O(1) access
    const sessionMap = new Map();
    sessions.forEach((s) => {
      sessionMap.set(s.code, s);
      if (s.name) sessionMap.set(s.name, s);
    });

    const programMap = new Map(programs.map((p) => [p.code, p]));

    const courseMap = new Map();
    courses.forEach((c) => {
      courseMap.set(c.code, c);
      if (c.courseCode) courseMap.set(c.courseCode, c);
    });

    const teacherMap = new Map(teachers.map((t) => [t.email.toLowerCase(), t]));

    const timeSlotMap = new Map();
    timeSlots.forEach((ts) => {
      timeSlotMap.set(ts.name, ts);
      if (ts.timeRange) timeSlotMap.set(ts.timeRange, ts);
      if (ts.code) timeSlotMap.set(ts.code, ts);
    });

    const roomMap = new Map();
    rooms.forEach((r) => {
      roomMap.set(r.roomNumber, r);
      if (r.code) roomMap.set(r.code, r);
    });

    const semesterMap = new Map();
    semesters.forEach((s) => {
      const key = `${s.academicSession}|${s.number || s.semesterNumber}`;
      semesterMap.set(key, s);
    });

    const sectionMap = new Map();
    existingSections.forEach((s) => {
      const key = `${s.academicSession}|${s.program}|${s.semester}|${s.code}`;
      sectionMap.set(key, s);
    });

    const allocationMap = new Map();
    existingAllocations.forEach((a) => {
      const key = `${a.academicSession}|${a.semester}|${a.program}|${a.course}|${a.teacher}|${a.section}`;
      allocationMap.set(key, a);
    });

    const timetableMap = new Map();
    existingTimetables.forEach((t) => {
      const key = `${t.academicSession}|${t.semester}|${t.program}|${t.section}`;
      timetableMap.set(key, t);
    });

    return {
      sessionMap,
      programMap,
      courseMap,
      teacherMap,
      timeSlotMap,
      roomMap,
      semesterMap,
      sectionMap,
      allocationMap,
      timetableMap,
      sessions,
      programs,
      courses,
      teachers,
      timeSlots,
      rooms,
      semesters,
      existingSections,
      existingAllocations,
      existingTimetables,
    };
  }

  // Process all rows in batches with minimal database operations
  async processRowsBatch(
    rows,
    uploadRecord,
    uploadType,
    userId,
    referenceData,
  ) {
    const results = {
      total: rows.length,
      successful: 0,
      failed: 0,
      errors: [],
      successes: [],
      processedTimetableIds: new Set(),
    };

    // Prepare bulk operations
    const timetableBulkOps = [];
    const allocationBulkOps = [];
    const sectionBulkOps = [];
    const semesterBulkOps = [];
    const timeSlotBulkOps = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 1;

      try {
        // Validate row using reference data
        this.validateRowWithData(row, uploadType, rowNumber, referenceData);

        // Process schedule entry with cached data
        const result = await this.processScheduleEntryOptimized(
          row,
          uploadRecord._id,
          rowNumber,
          userId,
          referenceData,
          {
            timetableBulkOps,
            allocationBulkOps,
            sectionBulkOps,
            semesterBulkOps,
            timeSlotBulkOps,
            processedTimetableIds: results.processedTimetableIds,
          },
        );

        results.successful++;
        results.successes.push({
          row: rowNumber,
          data: row,
          result,
        });

        await this.addSuccessToUpload(
          uploadRecord._id,
          result.recordId || new mongoose.Types.ObjectId(),
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

        await this.addErrorToUpload(
          uploadRecord._id,
          rowNumber,
          "processing",
          JSON.stringify(row),
          error.name || "VALIDATION_ERROR",
          error.message,
        );
      }

      // Update progress every 10 rows
      if (i % 10 === 0) {
        const progress = Math.floor((i / rows.length) * 100);
        await this.updateUploadStatus(uploadRecord._id, "processing", progress);
      }
    }

    // Execute all bulk operations in parallel
    const bulkPromises = [];
    if (semesterBulkOps.length > 0) {
      bulkPromises.push(
        mongoose
          .model("Semester")
          .bulkWrite(semesterBulkOps, { ordered: false }),
      );
    }
    if (timeSlotBulkOps.length > 0) {
      bulkPromises.push(
        TimeSlot.bulkWrite(timeSlotBulkOps, { ordered: false }),
      );
    }
    if (sectionBulkOps.length > 0) {
      bulkPromises.push(Section.bulkWrite(sectionBulkOps, { ordered: false }));
    }
    if (allocationBulkOps.length > 0) {
      bulkPromises.push(
        CourseAllocation.bulkWrite(allocationBulkOps, { ordered: false }),
      );
    }
    if (timetableBulkOps.length > 0) {
      bulkPromises.push(
        Timetable.bulkWrite(timetableBulkOps, { ordered: false }),
      );
    }

    await Promise.all(bulkPromises);

    return results;
  }

  // Optimized schedule entry processor using cached data and bulk operations
  async processScheduleEntryOptimized(
    row,
    uploadId,
    rowNumber,
    userId,
    refData,
    bulkOps,
  ) {
    // Get references from maps (O(1) lookups)
    const session = refData.sessionMap.get(row.academic_session_code);
    if (!session)
      throw new Error(
        `Academic session not found: ${row.academic_session_code}`,
      );

    const program = refData.programMap.get(row.program_code);
    if (!program) throw new Error(`Program not found: ${row.program_code}`);

    const course = refData.courseMap.get(row.course_code);
    if (!course) throw new Error(`Course not found: ${row.course_code}`);

    const teacher = refData.teacherMap.get(row.teacher_email.toLowerCase());
    if (!teacher) throw new Error(`Teacher not found: ${row.teacher_email}`);

    let timeSlot = refData.timeSlotMap.get(row.time_slot_name);
    if (!timeSlot) {
      // Create time slot via bulk operation if not exists
      const newTimeSlot = {
        name: row.time_slot_name,
        timeRange: row.time_slot_name,
        startTime: row.time_slot_name.split("-")[0]?.trim() || "00:00",
        endTime: row.time_slot_name.split("-")[1]?.trim() || "01:00",
        durationMinutes: 60,
        isActive: true,
      };

      const tempId = new mongoose.Types.ObjectId();
      bulkOps.timeSlotBulkOps.push({
        insertOne: { document: newTimeSlot },
      });

      // Use temporary ID for now
      timeSlot = { _id: tempId, name: newTimeSlot.name };
    }

    const semesterNum = parseInt(row.semester);
    const semesterKey = `${session._id}|${semesterNum}`;
    let semester = refData.semesterMap.get(semesterKey);

    if (!semester) {
      // Create semester via bulk operation
      const newSemester = {
        name: `Semester ${semesterNum}`,
        number: semesterNum,
        semesterNumber: semesterNum,
        academicSession: session._id,
        isActive: true,
      };

      const tempId = new mongoose.Types.ObjectId();
      bulkOps.semesterBulkOps.push({
        insertOne: { document: newSemester },
      });

      semester = { _id: tempId };
    }

    const sectionKey = `${session._id}|${program._id}|${semester._id}|${row.section_code}`;
    let section = refData.sectionMap.get(sectionKey);

    if (!section) {
      // Create section via bulk operation
      const newSection = {
        code: row.section_code,
        name: `Section ${row.section_code}`,
        program: program._id,
        semester: semester._id,
        academicSession: session._id,
        maxStudents: 50,
      };

      const tempId = new mongoose.Types.ObjectId();
      bulkOps.sectionBulkOps.push({
        insertOne: { document: newSection },
      });

      section = { _id: tempId, code: newSection.code };
    }

    const allocationKey = `${session._id}|${semesterNum}|${program._id}|${course._id}|${teacher._id}|${section._id}`;
    let allocation = refData.allocationMap.get(allocationKey);

    if (!allocation) {
      // Create allocation via bulk operation
      const newAllocation = {
        academicSession: session._id,
        semester: semesterNum,
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
        createdBy: userId,
      };

      const tempId = new mongoose.Types.ObjectId();
      bulkOps.allocationBulkOps.push({
        insertOne: { document: newAllocation },
      });

      allocation = { _id: tempId };
    }

    const timetableKey = `${session._id}|${semesterNum}|${program._id}|${section._id}`;
    let timetable = refData.timetableMap.get(timetableKey);

    const room = row.room_code
      ? refData.roomMap.get(row.room_code.toUpperCase())
      : null;

    let timetableId;
    if (!timetable) {
      // Create timetable via bulk operation
      timetableId = new mongoose.Types.ObjectId();
      const newTimetable = {
        _id: timetableId,
        name: `${program.code} - Sem ${semesterNum} - ${section.code}`,
        academicSession: session._id,
        semester: semesterNum,
        program: program._id,
        section: section._id,
        schedule: [
          {
            _id: new mongoose.Types.ObjectId(),
            day: row.day,
            timeSlot: timeSlot._id,
            courseAllocation: allocation._id,
            room: room ? room._id : null,
            notes: row.notes || "",
            createdBy: userId,
            createdAt: new Date(),
          },
        ],
        status: "draft",
        createdBy: userId,
      };

      bulkOps.timetableBulkOps.push({
        insertOne: { document: newTimetable },
      });

      // Add to timetableMap for future rows
      refData.timetableMap.set(timetableKey, { _id: timetableId });
    } else {
      timetableId = timetable._id;
      // Add schedule entry to existing timetable
      const scheduleEntryId = new mongoose.Types.ObjectId();
      const updateOp = {
        updateOne: {
          filter: { _id: timetable._id },
          update: {
            $push: {
              schedule: {
                _id: scheduleEntryId,
                day: row.day,
                timeSlot: timeSlot._id,
                courseAllocation: allocation._id,
                room: room ? room._id : null,
                notes: row.notes || "",
                createdBy: userId,
                createdAt: new Date(),
              },
            },
          },
        },
      };
      bulkOps.timetableBulkOps.push(updateOp);
    }

    // Track timetable ID for conflict detection
    bulkOps.processedTimetableIds.add(timetableId.toString());

    return {
      action: timetable ? "updated" : "created",
      recordId: timetableId,
      timetable:
        timetable?.name ||
        `${program.code} - Sem ${semesterNum} - ${section.code}`,
      day: row.day,
      timeSlot: timeSlot.name || row.time_slot_name,
      course: course.code,
      teacher: teacher.email,
      timetableId: timetableId,
    };
  }

  validateRowWithData(row, uploadType, rowNumber, refData) {
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
    if (!validDays.includes(row.day)) {
      throw new Error(`Invalid day: ${row.day} in row ${rowNumber}`);
    }

    // Validate semester
    const semester = parseInt(row.semester);
    if (isNaN(semester) || semester < 1 || semester > 8) {
      throw new Error(`Invalid semester: ${row.semester} in row ${rowNumber}`);
    }

    // Check if references exist in maps
    if (!refData.sessionMap.has(row.academic_session_code)) {
      throw new Error(
        `Academic session not found: ${row.academic_session_code}`,
      );
    }

    if (!refData.programMap.has(row.program_code)) {
      throw new Error(`Program not found: ${row.program_code}`);
    }

    if (!refData.courseMap.has(row.course_code)) {
      throw new Error(`Course not found: ${row.course_code}`);
    }

    if (!refData.teacherMap.has(row.teacher_email.toLowerCase())) {
      throw new Error(`Teacher not found: ${row.teacher_email}`);
    }

    if (
      !refData.timeSlotMap.has(row.time_slot_name) &&
      !row.time_slot_name.includes("-")
    ) {
      throw new Error(`Time slot not found: ${row.time_slot_name}`);
    }

    if (row.room_code && !refData.roomMap.has(row.room_code.toUpperCase())) {
      console.log(
        `Warning: Room not found: ${row.room_code} in row ${rowNumber}`,
      );
    }
  }

  async createUploadRecord(fileData, uploadType, userId, options) {
    const filename = `${Date.now()}-${fileData.originalname}`;

    const uploadRecord = new CSVUpload({
      uploadType,
      filename,
      originalName: fileData.originalname,
      fileSize: fileData.size,
      filePath: null,
      mimeType: fileData.mimetype,
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
    return uploadRecord;
  }

  async updateUploadStatus(uploadId, status, progress, additionalData = {}) {
    const updateData = { status, progress, ...additionalData };
    if (status === "processing" && !additionalData.processingStartedAt) {
      updateData.processingStartedAt = new Date();
    }
    if (["completed", "failed", "partial_success"].includes(status)) {
      updateData.processingCompletedAt = new Date();
    }
    await CSVUpload.findByIdAndUpdate(uploadId, updateData);
  }

  async addErrorToUpload(uploadId, row, column, value, error, message) {
    const upload = await CSVUpload.findById(uploadId);
    if (upload) await upload.addError(row, column, value, error, message);
  }

  async addSuccessToUpload(uploadId, recordId, row, details) {
    const upload = await CSVUpload.findById(uploadId);
    if (upload) await upload.addSuccess(recordId, row, details);
  }

  async generateResultFiles(uploadRecord, results) {
    const resultFiles = {};

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

      await csvWriter.writeRecords(
        results.errors.map((error) => ({
          row: error.row,
          error: error.error,
          data: JSON.stringify(error.data),
        })),
      );

      resultFiles.errorReportUrl = `/api/csv/download-error-report/${uploadRecord._id}`;
    }

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

      await csvWriter.writeRecords(
        results.successes.map((success) => ({
          row: success.row,
          action: success.result.action,
          details: JSON.stringify(success.result),
          data: JSON.stringify(success.data),
        })),
      );

      resultFiles.resultFileUrl = `/api/csv/download-success-report/${uploadRecord._id}`;
    }

    return resultFiles;
  }

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

  getCSVTemplate(uploadType) {
    const template = this.templates[uploadType];
    if (!template) {
      throw new Error(`No template found for upload type: ${uploadType}`);
    }

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
        case "room_code":
          sampleData[column] = "CL-101";
          break;
        case "notes":
          sampleData[column] = "Optional notes";
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

  async downloadTemplate(uploadType) {
    const template = this.getCSVTemplate(uploadType);

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

  async validateRow(row, uploadType, rowNumber) {
    const template = this.templates[uploadType];
    if (!template) {
      throw new Error(`No template found for upload type: ${uploadType}`);
    }

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
  }

  async checkScheduleConflicts(
    row,
    rowNumber,
    session,
    program,
    semesterNum,
    teacher,
    timeSlot,
    room,
    options = {},
  ) {
    const teacherConflicts = [];
    const roomConflicts = [];
    const validationErrors = [];

    console.log(`Checking conflicts for row ${rowNumber}:`, {
      session: session?._id,
      program: program?._id,
      semester: semesterNum,
      teacher: teacher?._id,
      timeSlot: timeSlot?._id,
      room: room?._id,
      day: row.day,
    });

    if (!teacher || !timeSlot || !session || !program || !semesterNum) {
      console.log("Missing required data for conflict check:", {
        hasTeacher: !!teacher,
        hasTimeSlot: !!timeSlot,
        hasSession: !!session,
        hasProgram: !!program,
        hasSemester: !!semesterNum,
      });
      return { teacherConflicts, roomConflicts, validationErrors };
    }

    try {
      // Build query for existing timetables in same session/program/semester
      const query = {
        academicSession: session._id,
        program: program._id,
        semester: semesterNum,
        status: { $ne: "archived" },
      };

      // If options.excludeTimetableIds is provided, exclude those timetables
      if (
        options.excludeTimetableIds &&
        options.excludeTimetableIds.length > 0
      ) {
        query._id = { $nin: options.excludeTimetableIds };
      }

      console.log("Conflict check query:", JSON.stringify(query));

      // Find all relevant timetables
      const timetables = await Timetable.find(query)
        .populate({
          path: "schedule.courseAllocation",
          populate: [
            { path: "teacher", select: "_id name email" },
            { path: "course", select: "_id code name" },
          ],
        })
        .populate("schedule.room", "_id roomNumber code name")
        .populate("schedule.timeSlot", "_id name timeRange")
        .lean();

      console.log(
        `Found ${timetables.length} timetables to check for conflicts`,
      );

      // Check for teacher conflicts
      if (teacher) {
        for (const timetable of timetables) {
          for (const entry of timetable.schedule) {
            if (!entry.timeSlot || !entry.courseAllocation?.teacher) continue;

            // Check if same teacher, same day, same time slot
            if (
              entry.courseAllocation.teacher._id.toString() ===
                teacher._id.toString() &&
              entry.day === row.day &&
              entry.timeSlot._id.toString() === timeSlot._id.toString()
            ) {
              console.log(`Teacher conflict detected in row ${rowNumber}:`, {
                teacher: teacher.email,
                day: row.day,
                timeSlot: timeSlot.name,
              });

              teacherConflicts.push({
                type: "teacher_conflict",
                timetable: timetable.name || `${timetable._id}`,
                day: entry.day,
                timeSlot: entry.timeSlot.name || entry.timeSlot.timeRange,
                existingCourse:
                  entry.courseAllocation.course?.code || "Unknown",
                existingTeacher: entry.courseAllocation.teacher.name,
                message: `Teacher ${teacher.name} already has a class (${entry.courseAllocation.course?.code || "Unknown"}) at this time on ${entry.day}`,
              });
            }
          }
        }
      }

      // Check for room conflicts
      if (room) {
        for (const timetable of timetables) {
          for (const entry of timetable.schedule) {
            if (!entry.timeSlot || !entry.room) continue;

            // Check if same room, same day, same time slot
            if (
              entry.room._id.toString() === room._id.toString() &&
              entry.day === row.day &&
              entry.timeSlot._id.toString() === timeSlot._id.toString()
            ) {
              console.log(`Room conflict detected in row ${rowNumber}:`, {
                room: room.roomNumber || room.code,
                day: row.day,
                timeSlot: timeSlot.name,
              });

              roomConflicts.push({
                type: "room_conflict",
                timetable: timetable.name || `${timetable._id}`,
                day: entry.day,
                timeSlot: entry.timeSlot.name || entry.timeSlot.timeRange,
                existingCourse:
                  entry.courseAllocation?.course?.code || "Unknown",
                message: `Room ${room.roomNumber || room.code} is already booked for ${entry.courseAllocation?.course?.code || "another class"} at this time on ${entry.day}`,
              });
            }
          }
        }
      }

      console.log(`Row ${rowNumber} conflicts found:`, {
        teacherConflicts: teacherConflicts.length,
        roomConflicts: roomConflicts.length,
      });
    } catch (error) {
      console.error("Error checking conflicts:", error);
      validationErrors.push({
        type: "system_error",
        message: error.message,
      });
    }

    return {
      teacherConflicts,
      roomConflicts,
      validationErrors,
    };
  }

  async runPostUploadConflictDetection(timetableIds, uploadId, userId) {
    console.log(
      `Running post-upload conflict detection for ${timetableIds.length} timetables`,
    );

    try {
      if (!timetableIds || timetableIds.length === 0) {
        return [];
      }

      // Use the conflict detection engine with uploadId for row mapping
      const conflicts =
        await this.conflictDetectionEngine.detectConflictsForUpload(
          timetableIds,
          userId,
          `csv_upload_${uploadId}`,
          uploadId,
        );

      console.log(`Post-upload detection found ${conflicts.length} conflicts`);
      return conflicts;
    } catch (error) {
      console.error("Error in post-upload conflict detection:", error);
      return [];
    }
  }
}

const csvProcessorService = new CSVProcessorService();
export default csvProcessorService;
export const conflictDetectionEngine =
  csvProcessorService.conflictDetectionEngine;
