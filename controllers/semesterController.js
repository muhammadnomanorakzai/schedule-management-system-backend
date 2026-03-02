const Semester = require("../models/Semester");
const AcademicSession = require("../models/AcademicSession");

// @desc    Create a new semester
// @route   POST /api/semesters
// @access  Admin
exports.createSemester = async (req, res) => {
  try {
    const { academicSession, semesterNumber, name, startDate, endDate } =
      req.body;

    // Validate dates
    if (new Date(startDate) >= new Date(endDate)) {
      return res.status(400).json({
        message: "End date must be after start date",
      });
    }

    // Check if academic session exists
    const session = await AcademicSession.findById(academicSession);
    if (!session) {
      return res.status(404).json({
        message: "Academic session not found",
      });
    }

    // Validate session-semester mapping
    const validFallSemesters = [1, 3, 5, 7];
    const validSpringSemesters = [2, 4, 6, 8];

    if (
      (session.sessionType === "Fall" &&
        !validFallSemesters.includes(parseInt(semesterNumber))) ||
      (session.sessionType === "Spring" &&
        !validSpringSemesters.includes(parseInt(semesterNumber)))
    ) {
      return res.status(400).json({
        message:
          `Invalid semester number ${semesterNumber} for ${session.sessionType} session. ` +
          `${session.sessionType} can only have semesters: ${
            session.sessionType === "Fall"
              ? validFallSemesters.join(", ")
              : validSpringSemesters.join(", ")
          }`,
      });
    }

    const semester = await Semester.create({
      academicSession,
      semesterNumber,
      name,
      startDate,
      endDate,
    });

    const populatedSemester = await Semester.findById(semester._id).populate(
      "academicSession",
      "name year sessionType",
    );

    res.status(201).json(populatedSemester);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Get all semesters
// @route   GET /api/semesters
// @access  All authenticated users
exports.getSemesters = async (req, res) => {
  try {
    const semesters = await Semester.find()
      .populate("academicSession", "name year sessionType")
      .sort({ "academicSession.year": -1, semesterNumber: 1 });

    res.status(200).json(semesters);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Get semesters by academic session
// @route   GET /api/semesters/session/:sessionId
// @access  All authenticated users
exports.getSemestersBySession = async (req, res) => {
  try {
    const semesters = await Semester.find({
      academicSession: req.params.sessionId,
    })
      .populate("academicSession", "name year sessionType")
      .sort({ semesterNumber: 1 });

    res.status(200).json(semesters);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Get single semester
// @route   GET /api/semesters/:id
// @access  All authenticated users
exports.getSemesterById = async (req, res) => {
  try {
    const semester = await Semester.findById(req.params.id).populate(
      "academicSession",
      "name year sessionType",
    );

    if (!semester) {
      return res.status(404).json({
        message: "Semester not found",
      });
    }

    res.status(200).json(semester);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Update semester
// @route   PUT /api/semesters/:id
// @access  Admin
exports.updateSemester = async (req, res) => {
  try {
    const semester = await Semester.findById(req.params.id);

    if (!semester) {
      return res.status(404).json({
        message: "Semester not found",
      });
    }

    // Validate dates if provided
    if (req.body.startDate && req.body.endDate) {
      if (new Date(req.body.startDate) >= new Date(req.body.endDate)) {
        return res.status(400).json({
          message: "End date must be after start date",
        });
      }
    }

    const updatedSemester = await Semester.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true,
      },
    ).populate("academicSession", "name year sessionType");

    res.status(200).json(updatedSemester);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Delete semester
// @route   DELETE /api/semesters/:id
// @access  Admin
exports.deleteSemester = async (req, res) => {
  try {
    const semester = await Semester.findById(req.params.id);

    if (!semester) {
      return res.status(404).json({
        message: "Semester not found",
      });
    }

    // TODO: Check if semester has courses/sections before deleting

    await semester.deleteOne();

    res.status(200).json({
      message: "Semester deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Toggle semester active status
// @route   PUT /api/semesters/:id/toggle-status
// @access  Admin
exports.toggleSemesterStatus = async (req, res) => {
  try {
    const semester = await Semester.findById(req.params.id);

    if (!semester) {
      return res.status(404).json({
        message: "Semester not found",
      });
    }

    semester.isActive = !semester.isActive;
    await semester.save();

    const populatedSemester = await Semester.findById(semester._id).populate(
      "academicSession",
      "name year sessionType",
    );

    res.status(200).json({
      message: `Semester ${semester.isActive ? "activated" : "deactivated"} successfully`,
      semester: populatedSemester,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Get valid semesters for a session type
// @route   GET /api/semesters/valid/:sessionType
// @access  All authenticated users
exports.getValidSemestersForSession = async (req, res) => {
  try {
    const { sessionType } = req.params;

    if (!["Fall", "Spring"].includes(sessionType)) {
      return res.status(400).json({
        message: "Invalid session type. Must be 'Fall' or 'Spring'",
      });
    }

    const validSemesters = sessionType === "Fall" ? [1, 3, 5, 7] : [2, 4, 6, 8];

    res.status(200).json({
      sessionType,
      validSemesters,
      message: `${sessionType} session can only have semesters: ${validSemesters.join(", ")}`,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};
