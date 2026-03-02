const mongoose = require("mongoose");

const ProgramSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Program name is required"],
      trim: true,
    },
    code: {
      type: String,
      required: [true, "Program code is required"],
      uppercase: true,
      trim: true,
      maxlength: 10,
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: [true, "Department is required"],
    },
    duration: {
      type: Number,
      required: [true, "Duration is required"],
      min: 1,
      max: 6,
      default: 4, // Years
    },
    totalSemesters: {
      type: Number,
      required: [true, "Total semesters is required"],
      min: 1,
      max: 12,
      default: 8, // For 4-year program
    },
    degreeType: {
      type: String,
      enum: [
        "Undergraduate",
        "Graduate",
        "Postgraduate",
        "Diploma",
        "Certificate",
      ],
      default: "Undergraduate",
    },
    description: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    yearlyIntake: {
      type: Number,
      min: 1,
      default: 100,
    },
    feesPerSemester: {
      type: Number,
      min: 0,
      default: 0,
    },
  },
  { timestamps: true },
);

// Compound index to ensure unique program code per department
ProgramSchema.index({ code: 1, department: 1 }, { unique: true });

module.exports = mongoose.model("Program", ProgramSchema);
