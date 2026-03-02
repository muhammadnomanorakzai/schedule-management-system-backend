import mongoose from "mongoose";

const conflictSchema = new mongoose.Schema(
  {
    // Conflict identification
    conflictType: {
      type: String,
      enum: [
        "teacher_schedule",
        "room_occupancy",
        "time_overlap",
        "student_schedule",
        "department_constraint",
        "course_requirement",
        "teacher_preference",
        "resource_unavailable",
        "back_to_back",
        "max_daily_hours",
      ],
      required: true,
      index: true,
    },

    // Associated entities
    timetable: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Timetable",
      required: true,
      index: true,
    },
    scheduleEntries: [
      {
        entry: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Timetable.schedule",
        },
        timetable: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Timetable",
        },
        day: String,
        timeSlot: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "TimeSlot",
        },
        courseAllocation: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "CourseAllocation",
        },
        room: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Room",
        },
      },
    ],

    // Conflict details
    severity: {
      type: String,
      enum: ["critical", "high", "medium", "low", "warning"],
      default: "medium",
      index: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    detailedMessage: {
      type: String,
      trim: true,
    },

    // Conflict detection data
    detectedData: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Resolution
    status: {
      type: String,
      enum: ["detected", "reviewed", "resolved", "ignored", "auto_resolved"],
      default: "detected",
      index: true,
    },
    resolutionType: {
      type: String,
      enum: [
        "manual",
        "auto_time_change",
        "auto_room_change",
        "auto_teacher_change",
        "split_class",
        "other",
      ],
      default: "manual",
    },
    resolutionNotes: {
      type: String,
      trim: true,
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    resolvedAt: {
      type: Date,
    },

    // Auto-resolution suggestions
    suggestedResolutions: [
      {
        type: {
          type: String,
          enum: [
            "time_change",
            "room_change",
            "teacher_change",
            "day_change",
            "split",
            "merge",
            "constraint_relax",
          ],
        },
        description: String,
        priority: Number,
        feasibility: {
          type: Number,
          min: 0,
          max: 100,
        },
        impact: {
          type: String,
          enum: ["low", "medium", "high"],
        },
        details: mongoose.Schema.Types.Mixed,
      },
    ],

    // Metadata
    detectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    detectionMethod: {
      type: String,
      enum: ["manual", "scheduled", "real_time", "bulk_check"],
      default: "manual",
    },
    detectionSource: {
      type: String,
      enum: [
        "system_auto",
        "manual_entry",
        "csv_upload",
        "user_request", // ADD THIS
        "api_call",
        "import_process",
        "timetable_generation",
      ],
      default: "system_auto",
    },

    // Recurrence tracking
    isRecurring: {
      type: Boolean,
      default: false,
    },
    recurrencePattern: {
      type: String,
      trim: true,
    },
    firstDetectedAt: {
      type: Date,
      default: Date.now,
    },
    lastDetectedAt: {
      type: Date,
      default: Date.now,
    },

    // Performance metrics
    detectionTimeMs: {
      type: Number,
      default: 0,
    },
    resolutionTimeMs: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Indexes for faster queries
conflictSchema.index({ timetable: 1, status: 1 });
conflictSchema.index({ conflictType: 1, severity: 1 });
conflictSchema.index({ createdAt: -1 });
conflictSchema.index({ "scheduleEntries.timetable": 1 });

// Virtual for conflict age
conflictSchema.virtual("ageInHours").get(function () {
  const now = new Date();
  const createdAt = new Date(this.createdAt);
  const diffMs = now - createdAt;
  return Math.floor(diffMs / (1000 * 60 * 60));
});

// Virtual for resolution time
conflictSchema.virtual("timeToResolveHours").get(function () {
  if (this.status !== "resolved" || !this.resolvedAt) return null;
  const resolvedAt = new Date(this.resolvedAt);
  const createdAt = new Date(this.createdAt);
  const diffMs = resolvedAt - createdAt;
  return Math.floor(diffMs / (1000 * 60 * 60));
});

// Pre-save middleware to update lastDetectedAt
conflictSchema.pre("save", function () {
  if (this.isNew) {
    this.firstDetectedAt = new Date();
    this.lastDetectedAt = new Date();
  } else if (this.isModified("status") && this.status === "resolved") {
    this.resolvedAt = new Date();
    this.resolutionTimeMs = new Date() - new Date(this.createdAt);
  }
});

// Method to check if conflict is still valid
conflictSchema.methods.isStillValid = async function () {
  const Timetable = mongoose.model("Timetable");
  const timetable = await Timetable.findById(this.timetable);

  if (!timetable) return false;

  // Check if all schedule entries still exist
  for (const entryRef of this.scheduleEntries) {
    const entryExists = timetable.schedule.some(
      (entry) => entry._id.toString() === entryRef.entry?.toString(),
    );
    if (!entryExists) return false;
  }

  return true;
};

// Method to get similar conflicts
conflictSchema.statics.findSimilarConflicts = async function (conflictData) {
  const { conflictType, scheduleEntries, timetable } = conflictData;

  return this.find({
    timetable,
    conflictType,
    status: { $in: ["detected", "reviewed"] },
    $or: scheduleEntries.map((entry) => ({
      "scheduleEntries.entry": entry.entry,
    })),
  });
};

const Conflict = mongoose.model("Conflict", conflictSchema);

export default Conflict;
