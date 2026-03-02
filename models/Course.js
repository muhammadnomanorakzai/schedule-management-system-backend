const mongoose = require("mongoose");

const CourseSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, "Course code is required"],
      uppercase: true,
      trim: true,
      maxlength: 10,
    },
    name: {
      type: String,
      required: [true, "Course name is required"],
      trim: true,
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: [true, "Department is required"],
    },
    program: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Program",
      required: [true, "Program is required"],
    },
    semester: {
      type: Number,
      required: [true, "Semester number is required"],
      min: 1,
      max: 8,
    },
    creditHours: {
      type: Number,
      required: [true, "Credit hours are required"],
      min: 1,
      max: 4,
    },
    courseType: {
      type: String,
      enum: ["Theory", "Lab", "Theory+Lab"],
      default: "Theory",
    },
    labHours: {
      type: Number,
      min: 0,
      max: 3,
      default: 0,
      validate: {
        validator: function (value) {
          if (this.courseType === "Lab" && value === 0) {
            return false;
          }
          if (this.courseType === "Theory" && value > 0) {
            return false;
          }
          return true;
        },
        message:
          "Lab hours must be >0 for Lab courses and 0 for Theory courses",
      },
    },
    description: {
      type: String,
      trim: true,
    },
    prerequisites: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Course",
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
    isCore: {
      type: Boolean,
      default: true,
    },
    maxStudents: {
      type: Number,
      min: 1,
      default: 60,
    },
  },
  { timestamps: true },
);

// Compound index for unique course code per program
CourseSchema.index({ code: 1, program: 1 }, { unique: true });

// Validate lab hours based on course type
CourseSchema.pre("save", function () {
  if (this.courseType === "Theory") {
    this.labHours = 0;
  } else if (this.courseType === "Lab" && this.labHours === 0) {
    this.labHours = 2; // Default lab hours
  }
});

module.exports = mongoose.model("Course", CourseSchema);
