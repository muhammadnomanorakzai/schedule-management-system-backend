const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    // ================= BASIC =================
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },

    role: {
      type: String,
      enum: ["Admin", "Teacher", "Student", "Parent"],
      required: true,
    },

    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected"],
      default: "Pending",
    },

    requestedAt: { type: Date, default: Date.now },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approvedAt: Date,

    phone: String,
    address: String,
    dateOfBirth: Date,
    gender: {
      type: String,
      enum: ["Male", "Female", "Other"],
    },

    // ================= STUDENT =================
    rollNumber: {
      type: String,
      unique: true,
      sparse: true,
    },
    admissionNumber: {
      type: String,
      unique: true,
      sparse: true,
    },
    admissionDate: Date,

    program: { type: mongoose.Schema.Types.ObjectId, ref: "Program" },
    department: { type: mongoose.Schema.Types.ObjectId, ref: "Department" },
    currentSemester: { type: mongoose.Schema.Types.ObjectId, ref: "Semester" },
    academicSession: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AcademicSession",
    },
    section: { type: mongoose.Schema.Types.ObjectId, ref: "Section" },

    batchYear: Number,
    cgpa: { type: Number, min: 0, max: 4.0, default: 0 },
    completedCredits: { type: Number, default: 0 },
    totalCredits: { type: Number, default: 0 },

    enrollmentStatus: {
      type: String,
      enum: ["Active", "Inactive", "Graduated", "Suspended", "Dropped"],
      default: "Active",
    },

    registrationStatus: {
      type: String,
      enum: ["Registered", "Not Registered", "Partially Registered"],
      default: "Not Registered",
    },

    feeStatus: {
      type: String,
      enum: ["Paid", "Partial", "Pending", "Exempted"],
      default: "Pending",
    },

    parent: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    emergencyContact: {
      name: String,
      relation: String,
      phone: String,
    },

    // ================= PARENT =================
    children: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    // ================= TEACHER =================
    qualification: String,
    specialization: String,
    experience: Number,

    designation: {
      type: String,
      enum: [
        "Lecturer",
        "Assistant Professor",
        "Associate Professor",
        "Professor",
        "HOD",
      ],
      default: "Lecturer",
    },

    maxWeeklyHours: {
      type: Number,
      default: 18,
      min: 0,
      max: 30,
    },

    assignedCourses: [
      {
        course: { type: mongoose.Schema.Types.ObjectId, ref: "Course" },
        assignedAt: { type: Date, default: Date.now },
        assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      },
    ],

    availability: [
      {
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
        },
        slots: [
          {
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
          },
        ],
      },
    ],

    currentWorkload: {
      weeklyHours: { type: Number, default: 0 },
      assignedCourses: { type: Number, default: 0 },
    },

    isAvailableForScheduling: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

// ================= PASSWORD HASH =================
userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// ================= ROLL NUMBER AUTO =================
userSchema.pre("save", async function () {
  if (
    this.role === "Student" &&
    !this.rollNumber &&
    this.program &&
    this.batchYear
  ) {
    const Program = mongoose.model("Program");
    const program = await Program.findById(this.program);

    if (program) {
      const year = this.batchYear % 100;
      const count = await this.constructor.countDocuments({
        program: this.program,
        batchYear: this.batchYear,
      });

      this.rollNumber = `${program.code}-${year}-${String(count + 1).padStart(
        3,
        "0",
      )}`;
    }
  }
});

// ================= METHODS =================
userSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.isAvailable = function (day, slot) {
  if (!this.isAvailableForScheduling) return false;
  const dayAvailability = this.availability.find((a) => a.day === day);
  if (!dayAvailability) return false;
  return dayAvailability.slots.includes(slot);
};

userSchema.methods.canTakeMoreWork = function (hours = 0) {
  return this.currentWorkload.weeklyHours + hours <= this.maxWeeklyHours;
};

// ================= CLEAN JSON =================
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model("User", userSchema);
