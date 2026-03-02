const Section = require("../models/Section");
const Program = require("../models/Program");
const Semester = require("../models/Semester");
const AcademicSession = require("../models/AcademicSession");
const Department = require("../models/Department");
const User = require("../models/User");

// @desc    Create a new section
// @route   POST /api/sections
// @access  Admin
exports.createSection = async (req, res) => {
  try {
    const {
      name,
      code,
      program,
      semester,
      academicSession,
      department,
      maxStrength,
      sectionIncharge,
      description,
    } = req.body;

    // Validate program exists and belongs to department
    const programExists = await Program.findOne({
      _id: program,
      department: department,
    });
    if (!programExists) {
      return res.status(400).json({
        message: "Program not found or does not belong to this department",
      });
    }

    // Validate semester exists
    const semesterExists = await Semester.findById(semester);
    if (!semesterExists) {
      return res.status(404).json({
        message: "Semester not found",
      });
    }

    // Validate academic session exists
    const sessionExists = await AcademicSession.findById(academicSession);
    if (!sessionExists) {
      return res.status(404).json({
        message: "Academic session not found",
      });
    }

    // Validate semester belongs to academic session
    if (semesterExists.academicSession.toString() !== academicSession) {
      return res.status(400).json({
        message: "Semester does not belong to the selected academic session",
      });
    }

    // Validate section incharge is a teacher
    if (sectionIncharge) {
      const incharge = await User.findById(sectionIncharge);
      if (!incharge || incharge.role !== "Teacher") {
        return res.status(400).json({
          message: "Section incharge must be a teacher",
        });
      }
    }

    // Check if section with same code exists in same program-semester-session
    const existingSection = await Section.findOne({
      code: code.toUpperCase(),
      program,
      semester,
      academicSession,
    });

    if (existingSection) {
      return res.status(400).json({
        message: `Section ${code} already exists for this program, semester, and session`,
      });
    }

    const section = await Section.create({
      name,
      code: code.toUpperCase(),
      program,
      semester,
      academicSession,
      department,
      maxStrength: maxStrength || 60,
      sectionIncharge,
      description,
    });

    const populatedSection = await Section.findById(section._id)
      .populate("program", "name code")
      .populate("semester", "name semesterNumber")
      .populate("academicSession", "name year sessionType")
      .populate("department", "name code")
      .populate("sectionIncharge", "name email");

    res.status(201).json(populatedSection);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Get all sections
// @route   GET /api/sections
// @access  All authenticated users
exports.getSections = async (req, res) => {
  try {
    const { department, program, semester, academicSession, isActive } =
      req.query;

    let filter = {};

    if (department) filter.department = department;
    if (program) filter.program = program;
    if (semester) filter.semester = semester;
    if (academicSession) filter.academicSession = academicSession;
    if (isActive !== undefined) filter.isActive = isActive === "true";

    const sections = await Section.find(filter)
      .populate("program", "name code")
      .populate("semester", "name semesterNumber")
      .populate("academicSession", "name year sessionType")
      .populate("department", "name code")
      .populate("sectionIncharge", "name email")
      .sort({ academicSession: -1, program: 1, semester: 1, code: 1 });

    res.status(200).json(sections);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Get sections by program and semester
// @route   GET /api/sections/program/:programId/semester/:semesterId
// @access  All authenticated users
exports.getSectionsByProgramAndSemester = async (req, res) => {
  try {
    const sections = await Section.find({
      program: req.params.programId,
      semester: req.params.semesterId,
      isActive: true,
    })
      .populate("program", "name code")
      .populate("semester", "name semesterNumber")
      .populate("academicSession", "name year sessionType")
      .populate("department", "name code")
      .populate("sectionIncharge", "name email")
      .sort({ code: 1 });

    res.status(200).json(sections);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Get sections for a specific academic session
// @route   GET /api/sections/session/:sessionId
// @access  All authenticated users
exports.getSectionsBySession = async (req, res) => {
  try {
    const sections = await Section.find({
      academicSession: req.params.sessionId,
    })
      .populate("program", "name code")
      .populate("semester", "name semesterNumber")
      .populate("academicSession", "name year sessionType")
      .populate("department", "name code")
      .populate("sectionIncharge", "name email")
      .sort({ program: 1, semester: 1, code: 1 });

    res.status(200).json(sections);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Get single section
// @route   GET /api/sections/:id
// @access  All authenticated users
exports.getSectionById = async (req, res) => {
  try {
    const section = await Section.findById(req.params.id)
      .populate("program", "name code")
      .populate("semester", "name semesterNumber")
      .populate("academicSession", "name year sessionType")
      .populate("department", "name code")
      .populate("sectionIncharge", "name email");

    if (!section) {
      return res.status(404).json({
        message: "Section not found",
      });
    }

    // Get students in this section
    const students = await User.find({
      role: "Student",
      section: section._id,
      status: "Approved",
    }).select("name email rollNumber");

    res.status(200).json({
      ...section.toObject(),
      students,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Update section
// @route   PUT /api/sections/:id
// @access  Admin
exports.updateSection = async (req, res) => {
  try {
    const section = await Section.findById(req.params.id);

    if (!section) {
      return res.status(404).json({
        message: "Section not found",
      });
    }

    // Check for duplicate code if code is being updated
    if (req.body.code) {
      const existing = await Section.findOne({
        _id: { $ne: section._id },
        code: req.body.code.toUpperCase(),
        program: req.body.program || section.program,
        semester: req.body.semester || section.semester,
        academicSession: req.body.academicSession || section.academicSession,
      });

      if (existing) {
        return res.status(400).json({
          message:
            "Section code already exists for this program, semester, and session",
        });
      }
    }

    // Validate section incharge is a teacher
    if (req.body.sectionIncharge) {
      const incharge = await User.findById(req.body.sectionIncharge);
      if (!incharge || incharge.role !== "Teacher") {
        return res.status(400).json({
          message: "Section incharge must be a teacher",
        });
      }
    }

    // Validate maxStrength is not less than currentStrength
    if (
      req.body.maxStrength &&
      req.body.maxStrength < section.currentStrength
    ) {
      return res.status(400).json({
        message: `Maximum strength cannot be less than current strength (${section.currentStrength} students)`,
      });
    }

    const updatedSection = await Section.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true,
      },
    )
      .populate("program", "name code")
      .populate("semester", "name semesterNumber")
      .populate("academicSession", "name year sessionType")
      .populate("department", "name code")
      .populate("sectionIncharge", "name email");

    res.status(200).json(updatedSection);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Delete section
// @route   DELETE /api/sections/:id
// @access  Admin
exports.deleteSection = async (req, res) => {
  try {
    const section = await Section.findById(req.params.id);

    if (!section) {
      return res.status(404).json({
        message: "Section not found",
      });
    }

    // Check if section has students
    if (section.currentStrength > 0) {
      return res.status(400).json({
        message: "Cannot delete section with enrolled students",
      });
    }

    await section.deleteOne();

    res.status(200).json({
      message: "Section deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Toggle section active status
// @route   PUT /api/sections/:id/toggle-status
// @access  Admin
exports.toggleSectionStatus = async (req, res) => {
  try {
    const section = await Section.findById(req.params.id);

    if (!section) {
      return res.status(404).json({
        message: "Section not found",
      });
    }

    section.isActive = !section.isActive;
    await section.save();

    const populatedSection = await Section.findById(section._id)
      .populate("program", "name code")
      .populate("semester", "name semesterNumber")
      .populate("academicSession", "name year sessionType");

    res.status(200).json({
      message: `Section ${section.isActive ? "activated" : "deactivated"} successfully`,
      section: populatedSection,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Assign section incharge
// @route   PUT /api/sections/:id/assign-incharge
// @access  Admin
exports.assignSectionIncharge = async (req, res) => {
  try {
    const { teacherId } = req.body;
    const section = await Section.findById(req.params.id);

    if (!section) {
      return res.status(404).json({
        message: "Section not found",
      });
    }

    const teacher = await User.findById(teacherId);
    if (!teacher || teacher.role !== "Teacher") {
      return res.status(400).json({
        message: "Invalid teacher selected",
      });
    }

    section.sectionIncharge = teacherId;
    await section.save();

    const populatedSection = await Section.findById(section._id)
      .populate("program", "name code")
      .populate("semester", "name semesterNumber")
      .populate("academicSession", "name year sessionType")
      .populate("sectionIncharge", "name email");

    res.status(200).json({
      message: "Section incharge assigned successfully",
      section: populatedSection,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Get available teachers for section incharge
// @route   GET /api/sections/available-teachers/:departmentId
// @access  Admin
exports.getAvailableTeachers = async (req, res) => {
  try {
    const teachers = await User.find({
      role: "Teacher",
      status: "Approved",
    })
      .select("name email qualification")
      .sort({ name: 1 });

    res.status(200).json(teachers);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Get section statistics
// @route   GET /api/sections/stats/overview
// @access  Admin
exports.getSectionStats = async (req, res) => {
  try {
    const totalSections = await Section.countDocuments();
    const activeSections = await Section.countDocuments({ isActive: true });
    const sectionsWithIncharge = await Section.countDocuments({
      sectionIncharge: { $ne: null },
    });
    const averageStrength = await Section.aggregate([
      { $group: { _id: null, avgStrength: { $avg: "$currentStrength" } } },
    ]);

    res.status(200).json({
      totalSections,
      activeSections,
      sectionsWithIncharge,
      averageStrength: averageStrength[0]?.avgStrength || 0,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};
