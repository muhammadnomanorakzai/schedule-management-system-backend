const mongoose = require("mongoose");

const RoomSchema = new mongoose.Schema(
  {
    roomNumber: {
      type: String,
      required: [true, "Room number is required"],
      uppercase: true,
      trim: true,
      maxlength: 10,
    },
    name: {
      type: String,
      trim: true,
    },
    building: {
      type: String,
      required: [true, "Building name is required"],
      trim: true,
    },
    floor: {
      type: String,
      trim: true,
    },
    roomType: {
      type: String,
      enum: ["Lecture", "Lab", "Conference", "Auditorium", "Seminar"],
      default: "Lecture",
      required: true,
    },
    capacity: {
      type: Number,
      required: [true, "Room capacity is required"],
      min: 1,
      max: 500,
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: [true, "Department is required"],
    },
    equipment: [
      {
        name: String,
        quantity: Number,
        condition: {
          type: String,
          enum: ["Good", "Fair", "Poor", "Needs Repair"],
          default: "Good",
        },
      },
    ],
    facilities: [String],
    isAvailable: {
      type: Boolean,
      default: true,
    },
    isAirConditioned: {
      type: Boolean,
      default: false,
    },
    hasProjector: {
      type: Boolean,
      default: false,
    },
    hasWhiteboard: {
      type: Boolean,
      default: true,
    },
    maintenanceSchedule: {
      lastMaintenance: Date,
      nextMaintenance: Date,
      notes: String,
    },
    description: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true },
);

// Compound index for unique room number in building
RoomSchema.index({ roomNumber: 1, building: 1 }, { unique: true });

// Virtual for full room identifier
RoomSchema.virtual("fullIdentifier").get(function () {
  return `${this.building}-${this.roomNumber}`;
});

// Method to check if room is suitable for a course
RoomSchema.methods.isSuitableForCourse = function (
  courseType,
  requiredCapacity,
) {
  if (this.capacity < requiredCapacity) {
    return false;
  }

  // Lab courses can only be scheduled in Lab rooms
  if (courseType === "Lab" && this.roomType !== "Lab") {
    return false;
  }

  // Lecture rooms can host Theory or Theory+Lab courses
  if (this.roomType === "Lecture" && courseType === "Lab") {
    return false;
  }

  return true;
};

module.exports = mongoose.model("Room", RoomSchema);
