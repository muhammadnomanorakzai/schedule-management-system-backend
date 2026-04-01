import mongoose from "mongoose";

const csvUploadSchema = new mongoose.Schema(
  {
    // Upload identification
    uploadType: {
      type: String,
      enum: [
        // "course_allocations",
        // "timetable_entries",
        "schedule_entries",
        // "teachers",
        // "students",
        // "rooms",
        // "courses",
      ],
      required: true,
      index: true,
    },
    filename: {
      type: String,
      required: true,
      trim: true,
    },
    originalName: {
      type: String,
      required: true,
      trim: true,
    },

    // File information
    fileSize: {
      type: Number,
      required: true,
    },
    // Keep filePath for backward compatibility but make it optional
    filePath: {
      type: String,
      required: false,
    },
    mimeType: {
      type: String,
      default: "text/csv",
    },

    // CLOUDINARY FIELDS - REMOVED
    // cloudinaryId: {
    //   type: String,
    //   sparse: true,
    //   index: true,
    // },
    // cloudinaryUrl: {
    //   type: String,
    // },
    // cloudinaryFolder: {
    //   type: String,
    // },

    // Processing status
    status: {
      type: String,
      enum: [
        "uploaded",
        "processing",
        "completed",
        "failed",
        "partial_success",
      ],
      default: "uploaded",
      index: true,
    },
    progress: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },

    // Processing results
    totalRecords: {
      type: Number,
      default: 0,
    },
    processedRecords: {
      type: Number,
      default: 0,
    },
    successfulRecords: {
      type: Number,
      default: 0,
    },
    failedRecords: {
      type: Number,
      default: 0,
    },

    // Error handling
    errors: [
      {
        row: Number,
        column: String,
        value: String,
        error: String,
        message: String,
      },
    ],

    // Success data
    successData: [
      {
        recordId: mongoose.Schema.Types.ObjectId,
        row: Number,
        details: String,
      },
    ],

    // Processing logs
    processingLogs: [
      {
        timestamp: {
          type: Date,
          default: Date.now,
        },
        level: {
          type: String,
          enum: ["info", "warning", "error", "success"],
        },
        message: String,
        details: mongoose.Schema.Types.Mixed,
      },
    ],

    // Validation rules used
    validationRules: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    // Template information
    templateUsed: {
      type: String,
      trim: true,
    },
    templateVersion: {
      type: String,
      default: "1.0",
    },

    // Metadata
    academicSession: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AcademicSession",
      index: true,
    },
    semester: {
      type: Number,
      min: 1,
      max: 8,
      index: true,
    },
    program: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Program",
      index: true,
    },

    // Audit trail
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    processingStartedAt: {
      type: Date,
    },
    processingCompletedAt: {
      type: Date,
    },

    // Summary for quick reference
    summary: {
      type: String,
      trim: true,
    },

    // Download links
    resultFileUrl: {
      type: String,
      trim: true,
    },
    errorReportUrl: {
      type: String,
      trim: true,
    },

    // Additional metadata
    batchId: {
      type: String,
      unique: true,
      sparse: true,
    },
    referenceNumber: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Indexes
csvUploadSchema.index({ status: 1, createdAt: -1 });
csvUploadSchema.index({ uploadedBy: 1, createdAt: -1 });
csvUploadSchema.index({ uploadType: 1, academicSession: 1, semester: 1 });
csvUploadSchema.index({ batchId: 1 });
// Remove cloudinary index
// csvUploadSchema.index({ cloudinaryId: 1 });

// Virtual for processing duration
csvUploadSchema.virtual("processingDuration").get(function () {
  if (!this.processingStartedAt || !this.processingCompletedAt) return null;
  return this.processingCompletedAt - this.processingStartedAt;
});

// Virtual for success rate
csvUploadSchema.virtual("successRate").get(function () {
  if (this.totalRecords === 0) return 0;
  return (this.successfulRecords / this.totalRecords) * 100;
});

// Pre-save middleware for summary and batch ID
csvUploadSchema.pre("save", function () {
  // Generate batch ID if not exists
  if (!this.batchId) {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 5);
    this.batchId = `BATCH-${timestamp}-${random}`.toUpperCase();
  }

  // Generate summary
  if (this.isModified("status") && this.status === "completed") {
    this.summary = `Processed ${this.totalRecords} records: ${this.successfulRecords} successful, ${this.failedRecords} failed`;
  }

  // Generate reference number
  if (!this.referenceNumber) {
    const date = new Date();
    const year = date.getFullYear().toString().substr(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const random = Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, "0");
    this.referenceNumber = `UPL-${year}${month}-${random}`;
  }
});

// Method to add log entry
csvUploadSchema.methods.addLog = function (level, message, details = null) {
  this.processingLogs.push({
    timestamp: new Date(),
    level,
    message,
    details,
  });
  return this.save();
};

// Method to add error
csvUploadSchema.methods.addError = async function (
  row,
  column,
  value,
  errorCode,
  errorMessage,
) {
  this.errors.push({
    row,
    column,
    value,
    error: errorCode,
    message: errorMessage,
  });
  this.failedRecords++;
  this.processedRecords++;
  await this.addLog("error", errorMessage, { row, column, value, errorCode });
  return this.save();
};

// Method to add success
csvUploadSchema.methods.addSuccess = async function (recordId, row, details) {
  this.successData.push({
    recordId,
    row,
    details,
  });
  this.successfulRecords++;
  this.processedRecords++;
  await this.addLog("success", `Row ${row} processed successfully`, {
    recordId,
    details,
  });
  return this.save();
};

// Method to update progress
csvUploadSchema.methods.updateProgress = async function (progress) {
  this.progress = progress;
  return this.save();
};

// Method to update status
csvUploadSchema.methods.updateStatus = async function (
  status,
  additionalData = {},
) {
  this.status = status;

  if (status === "processing" && !this.processingStartedAt) {
    this.processingStartedAt = new Date();
  }

  if (
    status === "completed" ||
    status === "failed" ||
    status === "partial_success"
  ) {
    this.processingCompletedAt = new Date();
  }

  Object.assign(this, additionalData);
  return this.save();
};

// Static method to get upload statistics
csvUploadSchema.statics.getUploadStats = async function (
  userId = null,
  timeRange = "month",
) {
  const match = {};
  if (userId) {
    match.uploadedBy = new mongoose.Types.ObjectId(userId);
  }

  // Set date range
  const now = new Date();
  let startDate = new Date();

  switch (timeRange) {
    case "day":
      startDate.setDate(now.getDate() - 1);
      break;
    case "week":
      startDate.setDate(now.getDate() - 7);
      break;
    case "month":
      startDate.setMonth(now.getMonth() - 1);
      break;
    case "year":
      startDate.setFullYear(now.getFullYear() - 1);
      break;
    default:
      startDate.setMonth(now.getMonth() - 1);
  }

  match.createdAt = { $gte: startDate };

  try {
    const stats = await this.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$uploadType",
          totalUploads: { $sum: 1 },
          totalRecords: { $sum: "$totalRecords" },
          successfulRecords: { $sum: "$successfulRecords" },
          failedRecords: { $sum: "$failedRecords" },
          avgSuccessRate: { $avg: "$successRate" },
        },
      },
      { $sort: { totalUploads: -1 } },
    ]);

    return stats;
  } catch (error) {
    console.error("Error in getUploadStats aggregation:", error);
    return [];
  }
};

// Static method to get recent uploads
csvUploadSchema.statics.getRecentUploads = async function (
  userId = null,
  limit = 10,
) {
  const filter = {};
  if (userId) {
    filter.uploadedBy = userId;
  }

  return this.find(filter)
    .populate("uploadedBy", "name email")
    .sort({ createdAt: -1 })
    .limit(limit);
};

// Static method to get upload summary
csvUploadSchema.statics.getUploadSummary = async function (userId = null) {
  const filter = {};
  if (userId) {
    filter.uploadedBy = userId;
  }

  const totalUploads = await this.countDocuments(filter);
  const successfulUploads = await this.countDocuments({
    ...filter,
    status: { $in: ["completed", "partial_success"] },
  });
  const failedUploads = totalUploads - successfulUploads;
  const successRate =
    totalUploads > 0 ? (successfulUploads / totalUploads) * 100 : 0;

  return {
    totalUploads,
    successfulUploads,
    failedUploads,
    successRate: successRate.toFixed(2),
  };
};

const CSVUpload = mongoose.model("CSVUpload", csvUploadSchema);

export default CSVUpload;
