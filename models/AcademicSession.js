const mongoose = require("mongoose");

const AcademicSessionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Session name is required"],
      unique: true,
      trim: true,
    },
    year: {
      type: String,
      required: [true, "Academic year is required"],
      match: [/^\d{4}-\d{4}$/, "Year must be in format YYYY-YYYY"],
    },
    sessionType: {
      type: String,
      enum: ["Fall", "Spring"],
      required: [true, "Session type is required"],
    },
    startDate: {
      type: Date,
      required: [true, "Start date is required"],
    },
    endDate: {
      type: Date,
      required: [true, "End date is required"],
    },
    isCurrent: {
      type: Boolean,
      default: false,
    },
    isRegistrationOpen: {
      type: Boolean,
      default: false,
    },
    description: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true },
);

// Ensure only one current session exists
AcademicSessionSchema.pre("save", async function () {
  if (this.isCurrent) {
    await this.constructor.updateMany(
      { _id: { $ne: this._id } },
      { $set: { isCurrent: false } },
    );
  }
});

module.exports = mongoose.model("AcademicSession", AcademicSessionSchema);
