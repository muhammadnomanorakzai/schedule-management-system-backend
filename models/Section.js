const mongoose = require("mongoose");

const SectionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Section name is required"],
      trim: true,
      uppercase: true,
    },
    code: {
      type: String,
      required: [true, "Section code is required"],
      uppercase: true,
      trim: true,
      maxlength: 5,
    },
    program: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Program",
      required: [true, "Program is required"],
    },
    semester: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Semester",
      required: [true, "Semester is required"],
    },
    academicSession: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AcademicSession",
      required: [true, "Academic session is required"],
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: [true, "Department is required"],
    },
    maxStrength: {
      type: Number,
      required: [true, "Maximum strength is required"],
      min: 1,
      max: 100,
      default: 60,
    },
    currentStrength: {
      type: Number,
      default: 0,
      min: 0,
    },
    sectionIncharge: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    description: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true },
);

// Compound index for unique section in program-semester
SectionSchema.index(
  { code: 1, program: 1, semester: 1, academicSession: 1 },
  {
    unique: true,
    message:
      "Section with this code already exists in this program, semester, and session",
  },
);

// Validate that semester belongs to the academic session
SectionSchema.pre("save", async function () {
  const Semester = mongoose.model("Semester");
  const semester = await Semester.findById(this.semester).populate(
    "academicSession",
  );

  if (!semester) {
    throw new Error("Semester not found");
  }

  if (
    semester.academicSession._id.toString() !== this.academicSession.toString()
  ) {
    throw new Error(
      "Semester does not belong to the selected academic session",
    );
  }

  const Program = mongoose.model("Program");
  const program = await Program.findById(this.program);

  if (!program) {
    throw new Error("Program not found");
  }

  if (program.department.toString() !== this.department.toString()) {
    throw new Error("Program does not belong to the selected department");
  }
});

// Update current strength automatically (we'll implement this later with student enrollment)
SectionSchema.methods.updateStrength = async function () {
  const Student = mongoose.model("User");
  const count = await Student.countDocuments({
    role: "Student",
    section: this._id,
    status: "Approved",
  });
  this.currentStrength = count;
  await this.save();
};

module.exports = mongoose.model("Section", SectionSchema);
