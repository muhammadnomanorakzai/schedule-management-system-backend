import mongoose from "mongoose";

const courseAllocationSchema = new mongoose.Schema(
  {
    academicSession: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AcademicSession",
      required: true,
      index: true,
    },

    semester: {
      type: Number,
      required: true,
      min: 1,
      max: 8,
    },

    program: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Program",
      required: true,
    },

    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },

    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    section: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Section",
      required: true,
    },

    isLab: {
      type: Boolean,
      default: false,
    },

    labTeacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    creditHours: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },

    contactHoursPerWeek: {
      type: Number,
      required: true,
      min: 1,
      max: 20,
    },

    status: {
      type: String,
      enum: ["draft", "approved", "active", "completed", "cancelled"],
      default: "draft",
    },

    maxStudents: {
      type: Number,
      default: 50,
    },

    currentEnrollment: {
      type: Number,
      default: 0,
    },

    notes: {
      type: String,
      trim: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    approvalDate: {
      type: Date,
    },
  },
  { timestamps: true },
);

/* ================= Indexes ================= */

// Prevent duplicate active allocations
courseAllocationSchema.index(
  { academicSession: 1, semester: 1, course: 1, section: 1 },
  { unique: true },
);

courseAllocationSchema.index({ teacher: 1, academicSession: 1, semester: 1 });
courseAllocationSchema.index({ program: 1, semester: 1 });

const CourseAllocation = mongoose.model(
  "CourseAllocation",
  courseAllocationSchema,
);

export default CourseAllocation;
