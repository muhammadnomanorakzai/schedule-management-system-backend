const AcademicSession = require("../models/AcademicSession");
const Semester = require("../models/Semester");

// @desc    Create a new academic session
// @route   POST /api/academic-sessions
// @access  Admin
exports.createAcademicSession = async (req, res) => {
  try {
    const { name, year, sessionType, startDate, endDate, description } =
      req.body;

    // Validate dates
    if (new Date(startDate) >= new Date(endDate)) {
      return res.status(400).json({
        message: "End date must be after start date",
      });
    }

    // Validate year format
    if (!/^\d{4}-\d{4}$/.test(year)) {
      return res.status(400).json({
        message: "Year must be in format YYYY-YYYY",
      });
    }

    // Check if session with same name exists
    const existingSession = await AcademicSession.findOne({
      $or: [{ name }, { year, sessionType }],
    });

    if (existingSession) {
      return res.status(400).json({
        message: "Academic session with this name or year already exists",
      });
    }

    const academicSession = await AcademicSession.create({
      name,
      year,
      sessionType,
      startDate,
      endDate,
      description,
    });

    res.status(201).json(academicSession);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Get all academic sessions
// @route   GET /api/academic-sessions
// @access  All authenticated users
exports.getAcademicSessions = async (req, res) => {
  try {
    const sessions = await AcademicSession.find().sort({
      year: -1,
      sessionType: 1,
    });
    res.status(200).json(sessions);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Get current academic session
// @route   GET /api/academic-sessions/current
// @access  All authenticated users
exports.getCurrentSession = async (req, res) => {
  try {
    const currentSession = await AcademicSession.findOne({
      isCurrent: true,
    });

    if (!currentSession) {
      return res.status(404).json({
        message: "No current academic session found",
      });
    }

    res.status(200).json(currentSession);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Update academic session
// @route   PUT /api/academic-sessions/:id
// @access  Admin
exports.updateAcademicSession = async (req, res) => {
  try {
    const session = await AcademicSession.findById(req.params.id);

    if (!session) {
      return res.status(404).json({
        message: "Academic session not found",
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

    const updatedSession = await AcademicSession.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true,
      },
    );

    res.status(200).json(updatedSession);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Delete academic session
// @route   DELETE /api/academic-sessions/:id
// @access  Admin
exports.deleteAcademicSession = async (req, res) => {
  try {
    const session = await AcademicSession.findById(req.params.id);

    if (!session) {
      return res.status(404).json({
        message: "Academic session not found",
      });
    }

    // Check if session has semesters
    const hasSemesters = await Semester.exists({
      academicSession: session._id,
    });

    if (hasSemesters) {
      return res.status(400).json({
        message: "Cannot delete academic session with existing semesters",
      });
    }

    await session.deleteOne();

    res.status(200).json({
      message: "Academic session deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Set session as current
// @route   PUT /api/academic-sessions/:id/set-current
// @access  Admin
exports.setCurrentSession = async (req, res) => {
  try {
    const session = await AcademicSession.findById(req.params.id);

    if (!session) {
      return res.status(404).json({
        message: "Academic session not found",
      });
    }

    // This will trigger the pre-save hook to make only this session current
    session.isCurrent = true;
    await session.save();

    res.status(200).json({
      message: "Session set as current successfully",
      session,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Toggle registration status
// @route   PUT /api/academic-sessions/:id/toggle-registration
// @access  Admin
exports.toggleRegistration = async (req, res) => {
  try {
    const session = await AcademicSession.findById(req.params.id);

    if (!session) {
      return res.status(404).json({
        message: "Academic session not found",
      });
    }

    session.isRegistrationOpen = !session.isRegistrationOpen;
    await session.save();

    res.status(200).json({
      message: `Registration ${session.isRegistrationOpen ? "opened" : "closed"} successfully`,
      session,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};
