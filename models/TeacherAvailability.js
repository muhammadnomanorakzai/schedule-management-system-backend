const mongoose = require("mongoose");

const TeacherAvailabilitySchema = new mongoose.Schema(
  {
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    day: {
      type: String,
      enum: [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ],
      required: true,
    },
    slot: {
      type: String,
      enum: [
        "08:30-09:30",
        "09:30-10:30",
        "10:30-11:30",
        "11:30-12:30",
        "12:30-13:30",
        "13:30-14:30",
        "14:30-15:30",
        "15:30-16:30",
        "16:30-17:30",
      ],
      required: true,
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    reason: String,
    date: {
      type: Date,
      required: true,
    },
    semester: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Semester",
    },
    academicSession: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AcademicSession",
    },
  },
  { timestamps: true },
);

// Compound index for unique availability per teacher-day-slot-date
TeacherAvailabilitySchema.index(
  { teacher: 1, day: 1, slot: 1, date: 1 },
  { unique: true },
);

module.exports = mongoose.model(
  "TeacherAvailability",
  TeacherAvailabilitySchema,
);
