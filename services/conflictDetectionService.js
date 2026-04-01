import Conflict from "../models/Conflict.js";
import Timetable from "../models/Timetable.js";
import CourseAllocation from "../models/CourseAllocation.js";
import TimeSlot from "../models/TimeSlot.js";
import Room from "../models/Room.js";
import User from "../models/User.js";
import mongoose from "mongoose";

class ConflictDetectionEngine {
  constructor() {
    this.detectionRules = {
      teacher_schedule: this.detectTeacherConflicts.bind(this),
      room_occupancy: this.detectRoomConflicts.bind(this),
      time_overlap: this.detectTimeConflicts.bind(this),
      student_schedule: this.detectStudentConflicts.bind(this),
      department_constraint: this.detectDepartmentConflicts.bind(this),
      course_requirement: this.detectCourseRequirementConflicts.bind(this),
      teacher_preference: this.detectTeacherPreferenceConflicts.bind(this),
      resource_unavailable: this.detectResourceConflicts.bind(this),
      back_to_back: this.detectBackToBackConflicts.bind(this),
      max_daily_hours: this.detectMaxHoursConflicts.bind(this),
    };
  }

  // Main detection method
  async detectConflicts(timetableId, userId, options = {}) {
    const startTime = Date.now();

    try {
      const timetable = await Timetable.findById(timetableId)
        .populate({
          path: "schedule.timeSlot",
          select:
            "startTime endTime slotType durationMinutes name isActive availableDays",
        })
        .populate({
          path: "schedule.courseAllocation",
          populate: [
            { path: "teacher", select: "name email employeeId department" },
            { path: "course", select: "code name creditHours department" },
            { path: "section", select: "name code" },
          ],
        })
        .populate({
          path: "schedule.room",
          select: "name code type capacity isActive",
        });

      if (!timetable) {
        throw new Error("Timetable not found");
      }

      // Clear old unresolved conflicts if requested
      if (options.clearOldConflicts) {
        await Conflict.deleteMany({
          timetable: timetableId,
          status: { $in: ["detected", "reviewed"] },
        });
      }

      const allConflicts = [];

      // Run all detection rules
      for (const [ruleName, detectionFunction] of Object.entries(
        this.detectionRules,
      )) {
        try {
          const ruleConflicts = await detectionFunction(timetable);
          if (ruleConflicts && ruleConflicts.length > 0) {
            allConflicts.push(...ruleConflicts);
          }
        } catch (ruleError) {
          console.error(`Error in detection rule ${ruleName}:`, ruleError);
          // Continue with other rules even if one fails
        }
      }

      // Save detected conflicts
      const savedConflicts = [];
      for (const conflict of allConflicts) {
        try {
          const savedConflict = await this.saveConflict({
            ...conflict,
            timetable: timetableId,
            detectedBy: userId,
            detectionMethod: options.detectionMethod || "manual",
            detectionSource: options.detectionSource || "system_check",
          });
          savedConflicts.push(savedConflict);
        } catch (saveError) {
          console.error("Error saving conflict:", saveError);
        }
      }

      const detectionTime = Date.now() - startTime;

      return {
        success: true,
        conflicts: savedConflicts,
        summary: {
          totalConflicts: savedConflicts.length,
          detectionTimeMs: detectionTime,
          byType: this.groupConflictsByType(savedConflicts),
          bySeverity: this.groupConflictsBySeverity(savedConflicts),
        },
      };
    } catch (error) {
      console.error("Error in conflict detection:", error);
      return {
        success: false,
        error: error.message,
        conflicts: [],
      };
    }
  }

  // 1. Teacher Schedule Conflicts
  async detectTeacherConflicts(timetable) {
    const conflicts = [];
    const teacherSchedule = {};

    for (const entry of timetable.schedule) {
      if (!entry.courseAllocation?.teacher) continue;
      if (!entry.timeSlot) continue; // Skip if no time slot

      const teacherId = entry.courseAllocation.teacher._id.toString();
      const key = `${entry.day}-${entry.timeSlot._id}`;

      if (!teacherSchedule[teacherId]) {
        teacherSchedule[teacherId] = {};
      }

      if (teacherSchedule[teacherId][key]) {
        // Teacher conflict found
        const existingEntry = teacherSchedule[teacherId][key];

        conflicts.push({
          conflictType: "teacher_schedule",
          severity: "critical",
          description: `Teacher ${entry.courseAllocation.teacher.name} has overlapping classes`,
          detailedMessage: `Teacher is scheduled for ${entry.courseAllocation.course?.code || "Unknown"} and ${existingEntry.courseAllocation.course?.code || "Unknown"} at the same time`,
          scheduleEntries: [
            {
              entry: entry._id,
              timetable: timetable._id,
              day: entry.day,
              timeSlot: entry.timeSlot?._id,
              courseAllocation: entry.courseAllocation._id,
              room: entry.room?._id,
            },
            {
              entry: existingEntry._id,
              timetable: timetable._id,
              day: existingEntry.day,
              timeSlot: existingEntry.timeSlot?._id,
              courseAllocation: existingEntry.courseAllocation._id,
              room: existingEntry.room?._id,
            },
          ],
          detectedData: {
            teacher: teacherId,
            teacherName: entry.courseAllocation.teacher.name,
            timeSlot: entry.timeSlot?._id,
            day: entry.day,
          },
          suggestedResolutions: await this.suggestTeacherConflictResolutions(
            entry,
            existingEntry,
            timetable,
          ),
        });
      } else {
        teacherSchedule[teacherId][key] = entry;
      }
    }

    return conflicts;
  }

  // 2. Room Occupancy Conflicts
  async detectRoomConflicts(timetable) {
    const conflicts = [];
    const roomSchedule = {};

    for (const entry of timetable.schedule) {
      if (!entry.room) continue;
      if (!entry.timeSlot) continue; // Skip if no time slot

      const roomId = entry.room._id.toString();
      const key = `${entry.day}-${entry.timeSlot._id}`;

      if (!roomSchedule[roomId]) {
        roomSchedule[roomId] = {};
      }

      if (roomSchedule[roomId][key]) {
        // Room conflict found
        const existingEntry = roomSchedule[roomId][key];

        conflicts.push({
          conflictType: "room_occupancy",
          severity: "high",
          description: `Room ${entry.room.code || entry.room.name} is double-booked`,
          detailedMessage: `Room is booked for ${entry.courseAllocation?.course?.code || "Unknown"} and ${existingEntry.courseAllocation?.course?.code || "Unknown"} at the same time`,
          scheduleEntries: [
            {
              entry: entry._id,
              timetable: timetable._id,
              day: entry.day,
              timeSlot: entry.timeSlot?._id,
              courseAllocation: entry.courseAllocation?._id,
              room: entry.room._id,
            },
            {
              entry: existingEntry._id,
              timetable: timetable._id,
              day: existingEntry.day,
              timeSlot: existingEntry.timeSlot?._id,
              courseAllocation: existingEntry.courseAllocation?._id,
              room: existingEntry.room._id,
            },
          ],
          detectedData: {
            room: roomId,
            roomCode: entry.room.code || entry.room.name,
            timeSlot: entry.timeSlot?._id,
            day: entry.day,
          },
          suggestedResolutions: await this.suggestRoomConflictResolutions(
            entry,
            existingEntry,
            timetable,
          ),
        });
      } else {
        roomSchedule[roomId][key] = entry;
      }
    }

    return conflicts;
  }

  // 3. Time Overlap Conflicts (same course at same time)
  async detectTimeConflicts(timetable) {
    const conflicts = [];
    const courseSchedule = {};

    for (const entry of timetable.schedule) {
      if (!entry.courseAllocation?.course) continue;
      if (!entry.timeSlot) continue; // Skip if no time slot

      const courseId = entry.courseAllocation.course._id.toString();
      const key = `${entry.day}-${entry.timeSlot._id}`;

      if (!courseSchedule[courseId]) {
        courseSchedule[courseId] = {};
      }

      if (courseSchedule[courseId][key]) {
        // Time conflict found for same course
        conflicts.push({
          conflictType: "time_overlap",
          severity: "high",
          description: `Course ${entry.courseAllocation.course.code} scheduled multiple times`,
          detailedMessage: `Course appears in schedule at overlapping times`,
          scheduleEntries: [
            {
              entry: entry._id,
              timetable: timetable._id,
              day: entry.day,
              timeSlot: entry.timeSlot?._id,
              courseAllocation: entry.courseAllocation._id,
              room: entry.room?._id,
            },
          ],
          detectedData: {
            course: courseId,
            courseCode: entry.courseAllocation.course.code,
            timeSlot: entry.timeSlot?._id,
            day: entry.day,
          },
        });
      } else {
        courseSchedule[courseId][key] = entry;
      }
    }

    return conflicts;
  }

  // 4. Student Schedule Conflicts (through section enrollment)
  async detectStudentConflicts(timetable) {
    const conflicts = [];
    // This requires student enrollment data
    // For now, we'll check for section-level conflicts
    return conflicts;
  }

  // 5. Department Constraint Conflicts
  async detectDepartmentConflicts(timetable) {
    const conflicts = [];

    for (const entry of timetable.schedule) {
      if (!entry.courseAllocation?.teacher?.department) continue;
      if (!entry.courseAllocation?.course?.department) continue;

      const teacherDept = entry.courseAllocation.teacher.department.toString();
      const courseDept = entry.courseAllocation.course.department.toString();

      if (teacherDept !== courseDept) {
        conflicts.push({
          conflictType: "department_constraint",
          severity: "medium",
          description: `Teacher and course department mismatch`,
          detailedMessage: `Teacher from department ${teacherDept} assigned to course from department ${courseDept}`,
          scheduleEntries: [
            {
              entry: entry._id,
              timetable: timetable._id,
              day: entry.day,
              timeSlot: entry.timeSlot?._id,
              courseAllocation: entry.courseAllocation._id,
              room: entry.room?._id,
            },
          ],
          detectedData: {
            teacherDepartment: teacherDept,
            courseDepartment: courseDept,
            teacherName: entry.courseAllocation.teacher.name,
            courseCode: entry.courseAllocation.course.code,
          },
        });
      }
    }

    return conflicts;
  }

  // 6. Course Requirement Conflicts (prerequisites, co-requisites)
  async detectCourseRequirementConflicts(timetable) {
    const conflicts = [];
    // Implementation requires course prerequisite data
    return conflicts;
  }

  // 7. Teacher Preference Conflicts
  async detectTeacherPreferenceConflicts(timetable) {
    const conflicts = [];
    // Implementation requires teacher preference data
    return conflicts;
  }

  // 8. Resource Unavailable Conflicts (FIXED)
  async detectResourceConflicts(timetable) {
    const conflicts = [];

    for (const entry of timetable.schedule) {
      // Check room availability - FIXED: Check if entry.room exists
      if (entry.room && entry.room._id) {
        const room = await Room.findById(entry.room._id);
        if (room && !room.isActive) {
          conflicts.push({
            conflictType: "resource_unavailable",
            severity: "high",
            description: `Room ${room.code || room.name} is not active`,
            detailedMessage: `Assigned room is marked as inactive`,
            scheduleEntries: [
              {
                entry: entry._id,
                timetable: timetable._id,
                day: entry.day,
                timeSlot: entry.timeSlot?._id,
                courseAllocation: entry.courseAllocation?._id,
                room: entry.room._id,
              },
            ],
            detectedData: {
              room: room._id,
              roomCode: room.code || room.name,
              roomStatus: room.isActive ? "active" : "inactive",
            },
          });
        }
      }

      // Check time slot availability - FIXED: Check if entry.timeSlot exists
      if (entry.timeSlot && entry.timeSlot._id) {
        const timeSlot = await TimeSlot.findById(entry.timeSlot._id);

        if (timeSlot && !timeSlot.isActive) {
          conflicts.push({
            conflictType: "resource_unavailable",
            severity: "high",
            description: `Time slot ${timeSlot.name} is not active`,
            detailedMessage: `Assigned time slot is marked as inactive`,
            scheduleEntries: [
              {
                entry: entry._id,
                timetable: timetable._id,
                day: entry.day,
                timeSlot: entry.timeSlot._id,
                courseAllocation: entry.courseAllocation?._id,
                room: entry.room?._id,
              },
            ],
            detectedData: {
              timeSlot: timeSlot._id,
              timeSlotName: timeSlot.name,
              timeSlotStatus: timeSlot.isActive ? "active" : "inactive",
            },
          });
        }

        // Check if time slot is available on the scheduled day - FIXED: Check availableDays
        if (
          timeSlot &&
          timeSlot.availableDays &&
          timeSlot.availableDays.length > 0
        ) {
          if (!timeSlot.availableDays.includes(entry.day)) {
            conflicts.push({
              conflictType: "resource_unavailable",
              severity: "critical",
              description: `Time slot not available on ${entry.day}`,
              detailedMessage: `${timeSlot.name} is not available on ${entry.day}. Available days: ${timeSlot.availableDays.join(", ")}`,
              scheduleEntries: [
                {
                  entry: entry._id,
                  timetable: timetable._id,
                  day: entry.day,
                  timeSlot: entry.timeSlot._id,
                  courseAllocation: entry.courseAllocation?._id,
                  room: entry.room?._id,
                },
              ],
              detectedData: {
                timeSlot: timeSlot._id,
                timeSlotName: timeSlot.name,
                scheduledDay: entry.day,
                availableDays: timeSlot.availableDays,
              },
            });
          }
        }
      }
    }

    return conflicts;
  }

  // 9. Back-to-Back Classes Conflicts
  async detectBackToBackConflicts(timetable) {
    const conflicts = [];

    if (!timetable.constraints?.noBackToBackClasses) {
      return conflicts;
    }

    const teacherScheduleByDay = {};

    // Group entries by teacher and day
    for (const entry of timetable.schedule) {
      if (!entry.courseAllocation?.teacher) continue;
      if (!entry.timeSlot) continue; // Skip if no time slot

      const teacherId = entry.courseAllocation.teacher._id.toString();
      const day = entry.day;

      if (!teacherScheduleByDay[teacherId]) {
        teacherScheduleByDay[teacherId] = {};
      }
      if (!teacherScheduleByDay[teacherId][day]) {
        teacherScheduleByDay[teacherId][day] = [];
      }

      teacherScheduleByDay[teacherId][day].push({
        entry,
        timeSlot: entry.timeSlot,
        startTime: this.parseTime(entry.timeSlot.startTime),
        endTime: this.parseTime(entry.timeSlot.endTime),
      });
    }

    // Check for back-to-back classes
    for (const teacherId in teacherScheduleByDay) {
      for (const day in teacherScheduleByDay[teacherId]) {
        const daySchedule = teacherScheduleByDay[teacherId][day];
        daySchedule.sort((a, b) => a.startTime - b.startTime);

        for (let i = 1; i < daySchedule.length; i++) {
          const current = daySchedule[i];
          const previous = daySchedule[i - 1];

          // Check if classes are back-to-back (no gap between end and start)
          if (current.startTime === previous.endTime) {
            conflicts.push({
              conflictType: "back_to_back",
              severity: "medium",
              description: `Teacher has back-to-back classes on ${day}`,
              detailedMessage: `${previous.entry.courseAllocation.course?.code || "Class"} ends at ${previous.timeSlot.endTime}, ${current.entry.courseAllocation.course?.code || "Class"} starts at ${current.timeSlot.startTime}`,
              scheduleEntries: [
                {
                  entry: previous.entry._id,
                  timetable: timetable._id,
                  day: previous.entry.day,
                  timeSlot: previous.entry.timeSlot?._id,
                  courseAllocation: previous.entry.courseAllocation._id,
                  room: previous.entry.room?._id,
                },
                {
                  entry: current.entry._id,
                  timetable: timetable._id,
                  day: current.entry.day,
                  timeSlot: current.entry.timeSlot?._id,
                  courseAllocation: current.entry.courseAllocation._id,
                  room: current.entry.room?._id,
                },
              ],
              detectedData: {
                teacher: teacherId,
                day: day,
                firstClassEnd: previous.timeSlot.endTime,
                secondClassStart: current.timeSlot.startTime,
              },
            });
          }
        }
      }
    }

    return conflicts;
  }

  // 10. Max Daily Hours Conflicts
  async detectMaxHoursConflicts(timetable) {
    const conflicts = [];

    const maxDailyHours = timetable.constraints?.maxDailyHours || 8;

    const teacherHoursByDay = {};

    // Calculate daily hours per teacher
    for (const entry of timetable.schedule) {
      if (!entry.courseAllocation?.teacher) continue;
      if (!entry.timeSlot) continue; // Skip if no time slot

      const teacherId = entry.courseAllocation.teacher._id.toString();
      const day = entry.day;
      const durationMinutes = entry.timeSlot.durationMinutes || 60;
      const durationHours = durationMinutes / 60;

      if (!teacherHoursByDay[teacherId]) {
        teacherHoursByDay[teacherId] = {};
      }
      if (!teacherHoursByDay[teacherId][day]) {
        teacherHoursByDay[teacherId][day] = 0;
      }

      teacherHoursByDay[teacherId][day] += durationHours;
    }

    // Check for max hours violation
    for (const teacherId in teacherHoursByDay) {
      for (const day in teacherHoursByDay[teacherId]) {
        const dailyHours = teacherHoursByDay[teacherId][day];

        if (dailyHours > maxDailyHours) {
          // Find all entries for this teacher on this day
          const teacherDayEntries = timetable.schedule.filter(
            (entry) =>
              entry.courseAllocation?.teacher?._id.toString() === teacherId &&
              entry.day === day,
          );

          conflicts.push({
            conflictType: "max_daily_hours",
            severity: "medium",
            description: `Teacher exceeds ${maxDailyHours} hours on ${day}`,
            detailedMessage: `Teacher has ${dailyHours.toFixed(1)} hours of classes on ${day} (max: ${maxDailyHours})`,
            scheduleEntries: teacherDayEntries.map((entry) => ({
              entry: entry._id,
              timetable: timetable._id,
              day: entry.day,
              timeSlot: entry.timeSlot?._id,
              courseAllocation: entry.courseAllocation._id,
              room: entry.room?._id,
            })),
            detectedData: {
              teacher: teacherId,
              day: day,
              totalHours: dailyHours,
              maxAllowedHours: maxDailyHours,
              excessHours: dailyHours - maxDailyHours,
            },
            suggestedResolutions: await this.suggestMaxHoursResolutions(
              teacherDayEntries,
              timetable,
            ),
          });
        }
      }
    }

    return conflicts;
  }

  // Helper method to parse time string to minutes
  parseTime(timeString) {
    if (!timeString) return 0;
    const [hours, minutes] = timeString.split(":").map(Number);
    return hours * 60 + (minutes || 0);
  }

  // Save conflict to database
  async saveConflict(conflictData) {
    try {
      // Check for existing similar conflicts
      const similarConflicts =
        await Conflict.findSimilarConflicts(conflictData);

      if (similarConflicts.length > 0) {
        // Update existing conflict
        const existingConflict = similarConflicts[0];
        existingConflict.lastDetectedAt = new Date();
        existingConflict.detectedData = {
          ...existingConflict.detectedData,
          ...conflictData.detectedData,
        };
        existingConflict.isRecurring = true;
        await existingConflict.save();
        return existingConflict;
      } else {
        // Create new conflict
        const conflict = new Conflict(conflictData);
        await conflict.save();
        return conflict;
      }
    } catch (error) {
      console.error("Error saving conflict:", error);
      throw error;
    }
  }

  // Suggest resolutions for teacher conflicts
  async suggestTeacherConflictResolutions(entry1, entry2, timetable) {
    const suggestions = [];

    try {
      // Get available time slots
      const allTimeSlots = await TimeSlot.find({ isActive: true }).sort(
        "slotNumber",
      );
      const availableSlots = allTimeSlots.filter((slot) =>
        slot.availableDays?.includes(entry1.day),
      );

      // Suggestion 1: Change time for entry1
      suggestions.push({
        type: "time_change",
        description: `Move ${entry1.courseAllocation?.course?.code || "class"} to different time on ${entry1.day}`,
        priority: 1,
        feasibility: 70,
        impact: "low",
        details: {
          entryId: entry1._id,
          currentTimeSlot: entry1.timeSlot?._id,
          availableTimeSlots: availableSlots.map((slot) => ({
            id: slot._id,
            name: slot.name,
            timeRange: `${slot.startTime}-${slot.endTime}`,
          })),
        },
      });

      // Suggestion 2: Change time for entry2
      suggestions.push({
        type: "time_change",
        description: `Move ${entry2.courseAllocation?.course?.code || "class"} to different time on ${entry2.day}`,
        priority: 2,
        feasibility: 70,
        impact: "low",
        details: {
          entryId: entry2._id,
          currentTimeSlot: entry2.timeSlot?._id,
          availableTimeSlots: availableSlots.map((slot) => ({
            id: slot._id,
            name: slot.name,
            timeRange: `${slot.startTime}-${slot.endTime}`,
          })),
        },
      });

      // Suggestion 3: Change day for entry1
      if (entry1.courseAllocation) {
        const availableDays = [
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
        ];
        const otherDays = availableDays.filter((day) => day !== entry1.day);

        suggestions.push({
          type: "day_change",
          description: `Move ${entry1.courseAllocation.course?.code || "class"} to different day`,
          priority: 3,
          feasibility: 50,
          impact: "medium",
          details: {
            entryId: entry1._id,
            currentDay: entry1.day,
            availableDays: otherDays,
          },
        });
      }
    } catch (error) {
      console.error("Error suggesting teacher conflict resolutions:", error);
    }

    return suggestions;
  }

  // Suggest resolutions for room conflicts
  async suggestRoomConflictResolutions(entry1, entry2, timetable) {
    const suggestions = [];

    try {
      // Get available rooms
      const availableRooms = await Room.find({
        isActive: true,
        capacity: { $gte: entry1.courseAllocation?.maxStudents || 30 },
      }).limit(10);

      // Suggestion 1: Change room for entry1
      if (availableRooms.length > 0) {
        suggestions.push({
          type: "room_change",
          description: `Assign different room to ${entry1.courseAllocation?.course?.code || "class"}`,
          priority: 1,
          feasibility: 80,
          impact: "low",
          details: {
            entryId: entry1._id,
            currentRoom: entry1.room?._id,
            availableRooms: availableRooms.map((room) => ({
              id: room._id,
              code: room.code || room.name,
              name: room.name,
              capacity: room.capacity,
            })),
          },
        });
      }

      // Suggestion 2: Change room for entry2
      if (availableRooms.length > 0) {
        suggestions.push({
          type: "room_change",
          description: `Assign different room to ${entry2.courseAllocation?.course?.code || "class"}`,
          priority: 2,
          feasibility: 80,
          impact: "low",
          details: {
            entryId: entry2._id,
            currentRoom: entry2.room?._id,
            availableRooms: availableRooms.map((room) => ({
              id: room._id,
              code: room.code || room.name,
              name: room.name,
              capacity: room.capacity,
            })),
          },
        });
      }
    } catch (error) {
      console.error("Error suggesting room conflict resolutions:", error);
    }

    return suggestions;
  }

  // Suggest resolutions for max hours conflicts
  async suggestMaxHoursResolutions(entries, timetable) {
    const suggestions = [];

    try {
      // Group entries by course
      const courses = {};
      entries.forEach((entry) => {
        const courseId = entry.courseAllocation?.course?._id;
        if (courseId) {
          if (!courses[courseId]) {
            courses[courseId] = [];
          }
          courses[courseId].push(entry);
        }
      });

      // Suggestion: Move one course to different day
      for (const courseId in courses) {
        if (courses[courseId].length > 0) {
          const entry = courses[courseId][0];
          const availableDays = [
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
          ].filter((day) => day !== entry.day);

          suggestions.push({
            type: "day_change",
            description: `Move ${entry.courseAllocation?.course?.code || "class"} to different day to reduce daily load`,
            priority: 1,
            feasibility: 60,
            impact: "medium",
            details: {
              entryId: entry._id,
              currentDay: entry.day,
              availableDays: availableDays,
              courseCode: entry.courseAllocation?.course?.code,
            },
          });
        }
      }
    } catch (error) {
      console.error("Error suggesting max hours resolutions:", error);
    }

    return suggestions;
  }

  // Group conflicts by type
  groupConflictsByType(conflicts) {
    return conflicts.reduce((groups, conflict) => {
      const type = conflict.conflictType;
      if (!groups[type]) {
        groups[type] = 0;
      }
      groups[type]++;
      return groups;
    }, {});
  }

  // Group conflicts by severity
  groupConflictsBySeverity(conflicts) {
    return conflicts.reduce((groups, conflict) => {
      const severity = conflict.severity;
      if (!groups[severity]) {
        groups[severity] = 0;
      }
      groups[severity]++;
      return groups;
    }, {});
  }

  // Auto-resolve simple conflicts
  async autoResolveConflicts(timetableId, userId, conflictTypes = []) {
    try {
      const timetable = await Timetable.findById(timetableId);
      if (!timetable) {
        throw new Error("Timetable not found");
      }

      const conflicts = await Conflict.find({
        timetable: timetableId,
        status: "detected",
        conflictType: { $in: conflictTypes },
      });

      const resolvedConflicts = [];
      const unresolvedConflicts = [];

      for (const conflict of conflicts) {
        const resolution = await this.attemptAutoResolution(
          conflict,
          timetable,
        );

        if (resolution.success) {
          conflict.status = "auto_resolved";
          conflict.resolutionType = resolution.type;
          conflict.resolutionNotes = resolution.notes;
          conflict.resolvedBy = userId;
          conflict.resolvedAt = new Date();
          await conflict.save();

          // Update timetable if needed
          if (resolution.changes) {
            await this.applyResolutionChanges(timetable, resolution.changes);
          }

          resolvedConflicts.push(conflict);
        } else {
          unresolvedConflicts.push(conflict);
        }
      }

      return {
        success: true,
        resolved: resolvedConflicts.length,
        unresolved: unresolvedConflicts.length,
        resolvedConflicts,
        unresolvedConflicts,
      };
    } catch (error) {
      console.error("Error in auto-resolution:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // Attempt auto-resolution for a conflict
  async attemptAutoResolution(conflict, timetable) {
    switch (conflict.conflictType) {
      case "room_occupancy":
        return await this.autoResolveRoomConflict(conflict, timetable);
      case "resource_unavailable":
        return await this.autoResolveResourceConflict(conflict, timetable);
      default:
        return {
          success: false,
          reason: "Auto-resolution not available for this conflict type",
        };
    }
  }

  // Auto-resolve room conflict
  async autoResolveRoomConflict(conflict, timetable) {
    const { scheduleEntries } = conflict;

    if (!scheduleEntries || scheduleEntries.length !== 2) {
      return { success: false, reason: "Invalid number of entries" };
    }

    try {
      // Get available rooms
      const availableRooms = await Room.find({
        isActive: true,
        _id: { $nin: scheduleEntries.map((e) => e.room).filter(Boolean) },
      }).limit(5);

      if (availableRooms.length === 0) {
        return { success: false, reason: "No available rooms found" };
      }

      // Use first available room
      const newRoom = availableRooms[0];
      const entryIndex = timetable.schedule.findIndex(
        (e) =>
          e._id && e._id.toString() === scheduleEntries[0]?.entry?.toString(),
      );

      if (entryIndex === -1) {
        return { success: false, reason: "Schedule entry not found" };
      }

      return {
        success: true,
        type: "auto_room_change",
        notes: `Automatically assigned room ${newRoom.code || newRoom.name}`,
        changes: {
          entryIndex,
          roomId: newRoom._id,
        },
      };
    } catch (error) {
      console.error("Error auto-resolving room conflict:", error);
      return { success: false, reason: error.message };
    }
  }

  // Auto-resolve resource conflict
  async autoResolveResourceConflict(conflict, timetable) {
    const { detectedData } = conflict;

    if (!detectedData) {
      return { success: false, reason: "No detection data" };
    }

    try {
      if (detectedData.roomStatus === "inactive" && detectedData.room) {
        // Find alternative room
        const availableRooms = await Room.find({
          isActive: true,
          capacity: { $gte: 30 },
        }).limit(5);

        if (availableRooms.length > 0) {
          const newRoom = availableRooms[0];
          const entryIndex = timetable.schedule.findIndex(
            (e) => e.room?._id?.toString() === detectedData.room?.toString(),
          );

          if (entryIndex !== -1) {
            return {
              success: true,
              type: "auto_room_change",
              notes: `Automatically reassigned from inactive room to ${newRoom.code || newRoom.name}`,
              changes: {
                entryIndex,
                roomId: newRoom._id,
              },
            };
          }
        }
      }
    } catch (error) {
      console.error("Error auto-resolving resource conflict:", error);
    }

    return {
      success: false,
      reason: "Cannot auto-resolve this resource conflict",
    };
  }

  // Apply resolution changes to timetable
  async applyResolutionChanges(timetable, changes) {
    if (changes.entryIndex !== undefined && changes.roomId) {
      timetable.schedule[changes.entryIndex].room = changes.roomId;
      timetable.markModified("schedule");
      await timetable.save();
    }
  }

  // Get conflict statistics
  async getConflictStats(timetableId = null) {
    const match = timetableId
      ? { timetable: mongoose.Types.ObjectId(timetableId) }
      : {};

    const stats = await Conflict.aggregate([
      { $match: match },
      {
        $facet: {
          byType: [
            {
              $group: {
                _id: "$conflictType",
                count: { $sum: 1 },
                critical: {
                  $sum: { $cond: [{ $eq: ["$severity", "critical"] }, 1, 0] },
                },
                resolved: {
                  $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] },
                },
              },
            },
            { $sort: { count: -1 } },
          ],
          bySeverity: [
            {
              $group: {
                _id: "$severity",
                count: { $sum: 1 },
              },
            },
          ],
          byStatus: [
            {
              $group: {
                _id: "$status",
                count: { $sum: 1 },
              },
            },
          ],
          resolutionTime: [
            {
              $match: {
                status: "resolved",
                resolvedAt: { $exists: true },
              },
            },
            {
              $project: {
                resolutionTimeHours: {
                  $divide: [
                    { $subtract: ["$resolvedAt", "$createdAt"] },
                    1000 * 60 * 60,
                  ],
                },
              },
            },
            {
              $group: {
                _id: null,
                avgTime: { $avg: "$resolutionTimeHours" },
                maxTime: { $max: "$resolutionTimeHours" },
                minTime: { $min: "$resolutionTimeHours" },
              },
            },
          ],
          recentConflicts: [{ $sort: { createdAt: -1 } }, { $limit: 10 }],
        },
      },
    ]);

    return stats[0];
  }
}

export default new ConflictDetectionEngine();
