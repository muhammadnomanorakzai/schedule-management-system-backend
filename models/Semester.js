const mongoose = require("mongoose");

const SemesterSchema = new mongoose.Schema(
  {
    academicSession: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AcademicSession",
      required: [true, "Academic session is required"],
    },
    semesterNumber: {
      type: Number,
      required: [true, "Semester number is required"],
      min: 1,
      max: 8,
    },
    name: {
      type: String,
      required: [true, "Semester name is required"],
    },
    startDate: {
      type: Date,
      required: [true, "Start date is required"],
    },
    endDate: {
      type: Date,
      required: [true, "End date is required"],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    courses: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Course",
      },
    ],
  },
  { timestamps: true },
);

// Validate session-semester mapping (Fall: 1,3,5,7; Spring: 2,4,6,8)
SemesterSchema.pre("save", async function () {
  const session = await mongoose
    .model("AcademicSession")
    .findById(this.academicSession);

  if (!session) {
    return next(new Error("Academic session not found"));
  }

  const validFallSemesters = [1, 3, 5, 7];
  const validSpringSemesters = [2, 4, 6, 8];

  if (
    (session.sessionType === "Fall" &&
      !validFallSemesters.includes(this.semesterNumber)) ||
    (session.sessionType === "Spring" &&
      !validSpringSemesters.includes(this.semesterNumber))
  ) {
    return next(
      new Error(
        `Invalid semester number ${this.semesterNumber} for ${session.sessionType} session. ` +
          `${session.sessionType} session can only have semesters: ${
            session.sessionType === "Fall"
              ? validFallSemesters.join(", ")
              : validSpringSemesters.join(", ")
          }`,
      ),
    );
  }
});

// Compound unique index
SemesterSchema.index(
  { academicSession: 1, semesterNumber: 1 },
  { unique: true },
);

module.exports = mongoose.model("Semester", SemesterSchema);
