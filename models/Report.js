const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        "teacher_workload",
        "room_utilization",
        "department_wise",
        "program_wise",
        "course_wise",
      ],
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    description: String,
    filters: {
      academicSession: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "AcademicSession",
      },
      semester: {
        type: Number,
        min: 1,
        max: 8,
      },
      department: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Department",
      },
      program: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Program",
      },
      dateRange: {
        startDate: Date,
        endDate: Date,
      },
      teacher: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      room: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Room",
      },
    },
    generatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    data: mongoose.Schema.Types.Mixed,
    format: {
      type: String,
      enum: ["json", "csv", "pdf"],
      default: "json",
    },
    filePath: String,
    generatedAt: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "completed",
    },
    isArchived: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for faster queries
reportSchema.index({ type: 1, generatedAt: -1 });
reportSchema.index({ "filters.academicSession": 1 });
reportSchema.index({ generatedBy: 1 });

const Report = mongoose.model("Report", reportSchema);
module.exports = Report;
