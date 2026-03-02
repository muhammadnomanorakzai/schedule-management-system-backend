import mongoose from "mongoose";

const timeSlotSchema = new mongoose.Schema(
  {
    // Slot identification
    slotNumber: {
      type: Number,
      required: [true, "Slot number is required"],
      unique: true,
      min: [1, "Slot number must be at least 1"],
      max: [12, "Slot number cannot exceed 12"],
    },
    name: {
      type: String,
      required: [true, "Slot name is required"],
      trim: true,
      unique: true,
    },

    // Time details
    startTime: {
      type: String,
      required: [true, "Start time is required"],
      match: [
        /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/,
        "Please enter valid time in HH:MM format",
      ],
    },
    endTime: {
      type: String,
      required: [true, "End time is required"],
      match: [
        /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/,
        "Please enter valid time in HH:MM format",
      ],
      validate: {
        validator: function (endTime) {
          const start = this.startTime.split(":").map(Number);
          const end = endTime.split(":").map(Number);
          const startMinutes = start[0] * 60 + start[1];
          const endMinutes = end[0] * 60 + end[1];
          return endMinutes > startMinutes;
        },
        message: "End time must be after start time",
      },
    },

    // Slot type
    slotType: {
      type: String,
      enum: ["theory", "lab", "break", "prayer", "other"],
      default: "theory",
    },

    // Day-wise availability
    availableDays: {
      type: [
        {
          type: String,
          enum: [
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
            "Sunday",
          ],
        },
      ],
      default: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    },

    // Duration in minutes (calculated)
    durationMinutes: {
      type: Number,
      default: 60,
    },

    // Slot category
    category: {
      type: String,
      enum: ["morning", "afternoon", "evening"],
      default: "morning",
    },

    // Slot status
    isActive: {
      type: Boolean,
      default: true,
    },

    // Priority for scheduling
    priority: {
      type: Number,
      min: [1, "Priority must be at least 1"],
      max: [10, "Priority cannot exceed 10"],
      default: 5,
    },

    // Special notes
    notes: {
      type: String,
      trim: true,
    },

    // Metadata
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    lastModifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Virtual for formatted time range
timeSlotSchema.virtual("timeRange").get(function () {
  return `${this.startTime} - ${this.endTime}`;
});

// Virtual for duration in hours
timeSlotSchema.virtual("durationHours").get(function () {
  return (this.durationMinutes / 60).toFixed(1);
});

// Pre-save middleware to calculate duration
timeSlotSchema.pre("save", function () {
  if (this.startTime && this.endTime) {
    const start = this.startTime.split(":").map(Number);
    const end = this.endTime.split(":").map(Number);
    const startMinutes = start[0] * 60 + start[1];
    const endMinutes = end[0] * 60 + end[1];
    this.durationMinutes = endMinutes - startMinutes;

    // Determine category based on start time
    const startHour = start[0];
    if (startHour < 12) {
      this.category = "morning";
    } else if (startHour < 17) {
      this.category = "afternoon";
    } else {
      this.category = "evening";
    }
  }
});

// Static method to get all active slots
timeSlotSchema.statics.getActiveSlots = function () {
  return this.find({ isActive: true }).sort("slotNumber");
};

// Static method to get slots by day
timeSlotSchema.statics.getSlotsByDay = function (day) {
  return this.find({
    isActive: true,
    availableDays: day,
  }).sort("slotNumber");
};

// Static method to create default time slots
timeSlotSchema.statics.createDefaultSlots = async function (createdBy) {
  const defaultSlots = [
    {
      slotNumber: 1,
      name: "08:30-09:30",
      startTime: "08:30",
      endTime: "09:30",
      slotType: "theory",
    },
    {
      slotNumber: 2,
      name: "09:30-10:30",
      startTime: "09:30",
      endTime: "10:30",
      slotType: "theory",
    },
    {
      slotNumber: 3,
      name: "10:30-11:30",
      startTime: "10:30",
      endTime: "11:30",
      slotType: "theory",
    },
    {
      slotNumber: 4,
      name: "11:30-12:30",
      startTime: "11:30",
      endTime: "12:30",
      slotType: "theory",
    },
    {
      slotNumber: 5,
      name: "12:30-01:30",
      startTime: "12:30",
      endTime: "13:30",
      slotType: "break",
      notes: "Lunch Break",
    },
    {
      slotNumber: 6,
      name: "01:30-02:30",
      startTime: "13:30",
      endTime: "14:30",
      slotType: "theory",
    },
    {
      slotNumber: 7,
      name: "02:30-03:30",
      startTime: "14:30",
      endTime: "15:30",
      slotType: "theory",
    },
    {
      slotNumber: 8,
      name: "03:30-04:30",
      startTime: "15:30",
      endTime: "16:30",
      slotType: "theory",
    },
    {
      slotNumber: 9,
      name: "04:30-05:30",
      startTime: "16:30",
      endTime: "17:30",
      slotType: "lab",
      availableDays: ["Monday", "Wednesday", "Friday"],
    },
  ];

  for (const slot of defaultSlots) {
    slot.createdBy = createdBy;
    slot.availableDays = slot.availableDays || [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
    ];
  }

  await this.deleteMany({});
  return this.insertMany(defaultSlots);
};

// Method to check if slot overlaps with another slot
timeSlotSchema.methods.overlapsWith = function (otherSlot) {
  const thisStart = this.startTime.split(":").map(Number);
  const thisEnd = this.endTime.split(":").map(Number);
  const otherStart = otherSlot.startTime.split(":").map(Number);
  const otherEnd = otherSlot.endTime.split(":").map(Number);

  const thisStartMinutes = thisStart[0] * 60 + thisStart[1];
  const thisEndMinutes = thisEnd[0] * 60 + thisEnd[1];
  const otherStartMinutes = otherStart[0] * 60 + otherStart[1];
  const otherEndMinutes = otherEnd[0] * 60 + otherEnd[1];

  return !(
    thisEndMinutes <= otherStartMinutes || thisStartMinutes >= otherEndMinutes
  );
};

const TimeSlot = mongoose.model("TimeSlot", timeSlotSchema);

export default TimeSlot;
