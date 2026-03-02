const Course = require("../models/Course");
const Department = require("../models/Department");
const Program = require("../models/Program");

// @desc    Create a new course
// @route   POST /api/courses
// @access  Admin
exports.createCourse = async (req, res) => {
  try {
    const {
      code,
      name,
      department,
      program,
      semester,
      creditHours,
      courseType,
      labHours,
      description,
      prerequisites,
      isCore,
      maxStudents,
    } = req.body;

    // Validate department exists
    const deptExists = await Department.findById(department);
    if (!deptExists) {
      return res.status(404).json({
        message: "Department not found",
      });
    }

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

    // Check if course with same code in same program exists
    const existingCourse = await Course.findOne({
      code: code.toUpperCase(),
      program,
    });

    if (existingCourse) {
      return res.status(400).json({
        message: `Course with code ${code} already exists in this program`,
      });
    }

    // Validate lab hours
    let finalLabHours = labHours || 0;
    if (courseType === "Lab" && finalLabHours === 0) {
      finalLabHours = 2; // Default for lab courses
    }
    if (courseType === "Theory" && finalLabHours > 0) {
      finalLabHours = 0;
    }

    const course = await Course.create({
      code: code.toUpperCase(),
      name,
      department,
      program,
      semester: parseInt(semester),
      creditHours: parseInt(creditHours),
      courseType,
      labHours: finalLabHours,
      description,
      prerequisites: prerequisites || [],
      isCore: isCore !== undefined ? isCore : true,
      maxStudents: maxStudents || 60,
    });

    const populatedCourse = await Course.findById(course._id)
      .populate("department", "name code")
      .populate("program", "name code")
      .populate("prerequisites", "code name");

    res.status(201).json(populatedCourse);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Get all courses
// @route   GET /api/courses
// @access  All authenticated users
exports.getCourses = async (req, res) => {
  try {
    const { department, program, semester, courseType, isCore } = req.query;

    let filter = {};

    if (department) filter.department = department;
    if (program) filter.program = program;
    if (semester) filter.semester = semester;
    if (courseType) filter.courseType = courseType;
    if (isCore !== undefined) filter.isCore = isCore === "true";

    const courses = await Course.find(filter)
      .populate("department", "name code")
      .populate("program", "name code")
      .populate("prerequisites", "code name")
      .sort({ program: 1, semester: 1, code: 1 });

    res.status(200).json(courses);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Get courses by program
// @route   GET /api/courses/program/:programId
// @access  All authenticated users
exports.getCoursesByProgram = async (req, res) => {
  try {
    const courses = await Course.find({
      program: req.params.programId,
      isActive: true,
    })
      .populate("department", "name code")
      .populate("program", "name code")
      .populate("prerequisites", "code name")
      .sort({ semester: 1, code: 1 });

    res.status(200).json(courses);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Get courses by program and semester
// @route   GET /api/courses/program/:programId/semester/:semester
// @access  All authenticated users
exports.getCoursesByProgramAndSemester = async (req, res) => {
  try {
    const courses = await Course.find({
      program: req.params.programId,
      semester: parseInt(req.params.semester),
      isActive: true,
    })
      .populate("department", "name code")
      .populate("program", "name code")
      .populate("prerequisites", "code name");

    res.status(200).json(courses);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Get single course
// @route   GET /api/courses/:id
// @access  All authenticated users
exports.getCourseById = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id)
      .populate("department", "name code")
      .populate("program", "name code")
      .populate("prerequisites", "code name");

    if (!course) {
      return res.status(404).json({
        message: "Course not found",
      });
    }

    res.status(200).json(course);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Update course
// @route   PUT /api/courses/:id
// @access  Admin
exports.updateCourse = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);

    if (!course) {
      return res.status(404).json({
        message: "Course not found",
      });
    }

    // Check for duplicate code in same program if code is being updated
    if (req.body.code) {
      const existing = await Course.findOne({
        _id: { $ne: course._id },
        code: req.body.code.toUpperCase(),
        program: req.body.program || course.program,
      });

      if (existing) {
        return res.status(400).json({
          message: "Course code already exists in this program",
        });
      }
    }

    // Validate lab hours based on course type
    if (req.body.courseType || req.body.labHours) {
      const courseType = req.body.courseType || course.courseType;
      const labHours = req.body.labHours || course.labHours;

      if (courseType === "Theory" && labHours > 0) {
        req.body.labHours = 0;
      } else if (courseType === "Lab" && labHours === 0) {
        req.body.labHours = 2;
      }
    }

    const updatedCourse = await Course.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true,
      },
    )
      .populate("department", "name code")
      .populate("program", "name code")
      .populate("prerequisites", "code name");

    res.status(200).json(updatedCourse);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Delete course
// @route   DELETE /api/courses/:id
// @access  Admin
exports.deleteCourse = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);

    if (!course) {
      return res.status(404).json({
        message: "Course not found",
      });
    }

    // TODO: Check if course has allocations or students before deleting

    await course.deleteOne();

    res.status(200).json({
      message: "Course deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Toggle course active status
// @route   PUT /api/courses/:id/toggle-status
// @access  Admin
exports.toggleCourseStatus = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);

    if (!course) {
      return res.status(404).json({
        message: "Course not found",
      });
    }

    course.isActive = !course.isActive;
    await course.save();

    const populatedCourse = await Course.findById(course._id)
      .populate("department", "name code")
      .populate("program", "name code");

    res.status(200).json({
      message: `Course ${course.isActive ? "activated" : "deactivated"} successfully`,
      course: populatedCourse,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Get available prerequisites for a course
// @route   GET /api/courses/:id/available-prerequisites
// @access  Admin
exports.getAvailablePrerequisites = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);

    if (!course) {
      return res.status(404).json({
        message: "Course not found",
      });
    }

    // Find courses in same program with lower semester number
    const availableCourses = await Course.find({
      program: course.program,
      semester: { $lt: course.semester },
      _id: { $ne: course._id },
      isActive: true,
    })
      .select("code name semester")
      .sort({ semester: 1, code: 1 });

    res.status(200).json(availableCourses);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};
