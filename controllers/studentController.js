const User = require("../models/User");
const Program = require("../models/Program");
const Department = require("../models/Department");
const Semester = require("../models/Semester");
const AcademicSession = require("../models/AcademicSession");
const Section = require("../models/Section");

// @desc    Get all students with enhanced details
// @route   GET /api/students
// @access  Admin
exports.getStudents = async (req, res) => {
  try {
    const {
      program,
      department,
      academicSession,
      semester,
      section,
      enrollmentStatus,
      batchYear,
    } = req.query;

    let filter = { role: "Student", status: "Approved" };

    if (program) filter.program = program;
    if (department) filter.department = department;
    if (academicSession) filter.academicSession = academicSession;
    if (semester) filter.currentSemester = semester;
    if (section) filter.section = section;
    if (enrollmentStatus) filter.enrollmentStatus = enrollmentStatus;
    if (batchYear) filter.batchYear = batchYear;

    const students = await User.find(filter)
      .populate("program", "name code")
      .populate("department", "name code")
      .populate("currentSemester", "name semesterNumber")
      .populate("academicSession", "name year")
      .populate("section", "name code")
      .populate("parent", "name email phone")
      .select("-password")
      .sort({ batchYear: -1, rollNumber: 1 });

    res.json(students);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create a student with enhanced details
// @route   POST /api/students
// @access  Admin
exports.createStudent = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      phone,
      address,
      dateOfBirth,
      gender,
      rollNumber,
      admissionNumber,
      admissionDate,
      program,
      department,
      batchYear,
      academicSession,
      currentSemester,
      section,
      parent,
      emergencyContact,
    } = req.body;

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Validate program
    const programExists = await Program.findById(program);
    if (!programExists) {
      return res.status(400).json({ message: "Program not found" });
    }

    // Validate department
    if (department) {
      const deptExists = await Department.findById(department);
      if (!deptExists) {
        return res.status(400).json({ message: "Department not found" });
      }
    }

    // Validate academic session
    if (academicSession) {
      const sessionExists = await AcademicSession.findById(academicSession);
      if (!sessionExists) {
        return res.status(400).json({ message: "Academic session not found" });
      }
    }

    // Validate semester
    if (currentSemester) {
      const semesterExists = await Semester.findById(currentSemester);
      if (!semesterExists) {
        return res.status(400).json({ message: "Semester not found" });
      }
    }

    // Validate section
    if (section) {
      const sectionExists = await Section.findById(section);
      if (!sectionExists) {
        return res.status(400).json({ message: "Section not found" });
      }
    }

    // Validate parent if provided
    if (parent) {
      const parentExists = await User.findById(parent);
      if (!parentExists || parentExists.role !== "Parent") {
        return res.status(400).json({ message: "Invalid parent" });
      }
    }

    const student = await User.create({
      name,
      email,
      password,
      role: "Student",
      phone,
      address,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
      gender,
      rollNumber,
      admissionNumber,
      admissionDate: admissionDate ? new Date(admissionDate) : new Date(),
      program,
      department: department || programExists.department,
      batchYear: batchYear || new Date().getFullYear(),
      academicSession,
      currentSemester,
      section,
      parent,
      emergencyContact,
      status: "Approved",
      approvedAt: new Date(),
      approvedBy: req.user._id,
    });

    const populatedStudent = await User.findById(student._id)
      .populate("program", "name code")
      .populate("department", "name code")
      .populate("currentSemester", "name semesterNumber")
      .populate("academicSession", "name year")
      .populate("section", "name code")
      .populate("parent", "name email phone")
      .select("-password");

    res.status(201).json(populatedStudent);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get student by ID
// @route   GET /api/students/:id
// @access  Admin/Teacher/Student
exports.getStudentById = async (req, res) => {
  try {
    const student = await User.findById(req.params.id)
      .populate("program", "name code duration totalSemesters")
      .populate("department", "name code")
      .populate("currentSemester", "name semesterNumber startDate endDate")
      .populate("academicSession", "name year sessionType")
      .populate("section", "name code sectionIncharge")
      .populate("parent", "name email phone")
      .populate("section.sectionIncharge", "name email")
      .select("-password");

    if (!student || student.role !== "Student") {
      return res.status(404).json({ message: "Student not found" });
    }

    res.json(student);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update student details
// @route   PUT /api/students/:id
// @access  Admin
exports.updateStudent = async (req, res) => {
  try {
    const student = await User.findById(req.params.id);

    if (!student || student.role !== "Student") {
      return res.status(404).json({ message: "Student not found" });
    }

    // Prevent role change
    if (req.body.role && req.body.role !== "Student") {
      return res.status(400).json({ message: "Cannot change student role" });
    }

    // Update allowed fields
    const allowedFields = [
      "name",
      "phone",
      "address",
      "dateOfBirth",
      "gender",
      "rollNumber",
      "admissionNumber",
      "program",
      "department",
      "batchYear",
      "academicSession",
      "currentSemester",
      "section",
      "parent",
      "emergencyContact",
      "enrollmentStatus",
      "registrationStatus",
      "feeStatus",
      "cgpa",
      "completedCredits",
      "totalCredits",
    ];

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        student[field] = req.body[field];
      }
    });

    // Handle date fields
    if (req.body.dateOfBirth) {
      student.dateOfBirth = new Date(req.body.dateOfBirth);
    }
    if (req.body.admissionDate) {
      student.admissionDate = new Date(req.body.admissionDate);
    }

    await student.save();

    const populatedStudent = await User.findById(student._id)
      .populate("program", "name code")
      .populate("department", "name code")
      .populate("currentSemester", "name semesterNumber")
      .populate("academicSession", "name year")
      .populate("section", "name code")
      .populate("parent", "name email phone")
      .select("-password");

    res.json({
      message: "Student updated successfully",
      student: populatedStudent,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete student
// @route   DELETE /api/students/:id
// @access  Admin
exports.deleteStudent = async (req, res) => {
  try {
    const student = await User.findById(req.params.id);

    if (!student || student.role !== "Student") {
      return res.status(404).json({ message: "Student not found" });
    }

    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "Student deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Enroll student in program
// @route   PUT /api/students/:id/enroll
// @access  Admin
exports.enrollStudent = async (req, res) => {
  try {
    const { programId, academicSessionId, semesterId, sectionId } = req.body;
    const student = await User.findById(req.params.id);

    if (!student || student.role !== "Student") {
      return res.status(404).json({ message: "Student not found" });
    }

    // Validate program
    const program = await Program.findById(programId);
    if (!program) {
      return res.status(400).json({ message: "Program not found" });
    }

    // Validate academic session
    const academicSession = await AcademicSession.findById(academicSessionId);
    if (!academicSession) {
      return res.status(400).json({ message: "Academic session not found" });
    }

    // Validate semester
    const semester = await Semester.findById(semesterId);
    if (!semester) {
      return res.status(400).json({ message: "Semester not found" });
    }

    // Validate section (optional)
    if (sectionId) {
      const section = await Section.findById(sectionId);
      if (!section) {
        return res.status(400).json({ message: "Section not found" });
      }
    }

    // Check if student is already enrolled in another program
    if (student.program && student.program.toString() !== programId) {
      return res.status(400).json({
        message: "Student is already enrolled in another program",
      });
    }

    // Update enrollment
    student.program = programId;
    student.department = program.department;
    student.academicSession = academicSessionId;
    student.currentSemester = semesterId;
    student.section = sectionId || null;
    student.batchYear = academicSession.year.split("-")[0];
    student.enrollmentStatus = "Active";
    student.registrationStatus = "Registered";

    await student.save();

    const populatedStudent = await User.findById(student._id)
      .populate("program", "name code")
      .populate("department", "name code")
      .populate("currentSemester", "name semesterNumber")
      .populate("academicSession", "name year")
      .populate("section", "name code")
      .select("-password");

    res.json({
      message: "Student enrolled successfully",
      student: populatedStudent,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update student enrollment status
// @route   PUT /api/students/:id/enrollment-status
// @access  Admin
exports.updateEnrollmentStatus = async (req, res) => {
  try {
    const { enrollmentStatus } = req.body;
    const student = await User.findById(req.params.id);

    if (!student || student.role !== "Student") {
      return res.status(404).json({ message: "Student not found" });
    }

    const validStatuses = [
      "Active",
      "Inactive",
      "Graduated",
      "Suspended",
      "Dropped",
    ];

    if (!validStatuses.includes(enrollmentStatus)) {
      return res.status(400).json({ message: "Invalid enrollment status" });
    }

    student.enrollmentStatus = enrollmentStatus;
    await student.save();

    res.json({
      message: `Enrollment status updated to ${enrollmentStatus}`,
      student: {
        _id: student._id,
        name: student.name,
        enrollmentStatus: student.enrollmentStatus,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Assign student to section
// @route   PUT /api/students/:id/assign-section
// @access  Admin
exports.assignSection = async (req, res) => {
  try {
    const { sectionId } = req.body;
    const student = await User.findById(req.params.id);

    if (!student || student.role !== "Student") {
      return res.status(404).json({ message: "Student not found" });
    }

    // Validate section
    const section = await Section.findById(sectionId);
    if (!section) {
      return res.status(400).json({ message: "Section not found" });
    }

    // Check if section has capacity
    if (section.currentStrength >= section.maxStrength) {
      return res.status(400).json({
        message: "Section is at full capacity",
      });
    }

    // Remove from previous section if any
    if (student.section) {
      const previousSection = await Section.findById(student.section);
      if (previousSection) {
        previousSection.currentStrength = Math.max(
          0,
          previousSection.currentStrength - 1,
        );
        await previousSection.save();
      }
    }

    // Assign to new section
    student.section = sectionId;
    await student.save();

    // Update section strength
    section.currentStrength = (section.currentStrength || 0) + 1;
    await section.save();

    const populatedStudent = await User.findById(student._id)
      .populate("section", "name code")
      .select("-password");

    res.json({
      message: "Student assigned to section successfully",
      student: populatedStudent,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get students by program
// @route   GET /api/students/program/:programId
// @access  Admin/Teacher
exports.getStudentsByProgram = async (req, res) => {
  try {
    const students = await User.find({
      role: "Student",
      program: req.params.programId,
      enrollmentStatus: "Active",
    })
      .populate("program", "name code")
      .populate("currentSemester", "name semesterNumber")
      .populate("section", "name code")
      .select("name email rollNumber batchYear cgpa section")
      .sort({ rollNumber: 1 });

    res.json(students);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get students by section
// @route   GET /api/students/section/:sectionId
// @access  Admin/Teacher
exports.getStudentsBySection = async (req, res) => {
  try {
    const students = await User.find({
      role: "Student",
      section: req.params.sectionId,
      enrollmentStatus: "Active",
    })
      .populate("program", "name code")
      .populate("currentSemester", "name semesterNumber")
      .select("name email rollNumber cgpa")
      .sort({ rollNumber: 1 });

    res.json(students);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get student statistics
// @route   GET /api/students/stats/overview
// @access  Admin
exports.getStudentStats = async (req, res) => {
  try {
    const totalStudents = await User.countDocuments({
      role: "Student",
      status: "Approved",
    });

    const activeStudents = await User.countDocuments({
      role: "Student",
      enrollmentStatus: "Active",
      status: "Approved",
    });

    const enrollmentStats = await User.aggregate([
      { $match: { role: "Student", status: "Approved" } },
      {
        $group: {
          _id: "$enrollmentStatus",
          count: { $sum: 1 },
        },
      },
    ]);

    const programStats = await User.aggregate([
      {
        $match: {
          role: "Student",
          status: "Approved",
          program: { $ne: null },
        },
      },
      {
        $group: {
          _id: "$program",
          count: { $sum: 1 },
          avgCGPA: { $avg: "$cgpa" },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]);

    // Populate program names
    const populatedProgramStats = await Promise.all(
      programStats.map(async (stat) => {
        const program = await Program.findById(stat._id).select("name code");
        return {
          program,
          count: stat.count,
          avgCGPA: stat.avgCGPA ? stat.avgCGPA.toFixed(2) : "0.00",
        };
      }),
    );

    const batchStats = await User.aggregate([
      {
        $match: {
          role: "Student",
          status: "Approved",
          batchYear: { $ne: null },
        },
      },
      {
        $group: {
          _id: "$batchYear",
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: -1 } },
      { $limit: 5 },
    ]);

    res.json({
      totalStudents,
      activeStudents,
      enrollmentStats,
      programStats: populatedProgramStats,
      batchStats,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get available sections for student enrollment
// @route   GET /api/students/available-sections/:programId/:semesterId/:academicSessionId
// @access  Admin
exports.getAvailableSections = async (req, res) => {
  try {
    const { programId, semesterId, academicSessionId } = req.params;

    const sections = await Section.find({
      program: programId,
      semester: semesterId,
      academicSession: academicSessionId,
      isActive: true,
    })
      .select("name code currentStrength maxStrength")
      .sort({ code: 1 });

    // Filter sections with available capacity
    const availableSections = sections.filter(
      (section) => section.currentStrength < section.maxStrength,
    );

    res.json(availableSections);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Bulk import students via CSV
// @route   POST /api/students/bulk-import
// @access  Admin
exports.bulkImportStudents = async (req, res) => {
  try {
    const { students } = req.body; // Array of student objects

    if (!Array.isArray(students) || students.length === 0) {
      return res.status(400).json({ message: "No students provided" });
    }

    const results = {
      total: students.length,
      success: 0,
      failed: 0,
      errors: [],
    };

    for (let i = 0; i < students.length; i++) {
      try {
        const studentData = students[i];

        // Check if student already exists
        const existingStudent = await User.findOne({
          $or: [
            { email: studentData.email },
            { rollNumber: studentData.rollNumber },
            { admissionNumber: studentData.admissionNumber },
          ],
        });

        if (existingStudent) {
          results.errors.push({
            row: i + 1,
            error: `Student already exists: ${studentData.email}`,
          });
          results.failed++;
          continue;
        }

        // Validate required fields
        if (!studentData.name || !studentData.email || !studentData.program) {
          results.errors.push({
            row: i + 1,
            error: "Missing required fields",
          });
          results.failed++;
          continue;
        }

        // Create student
        const student = await User.create({
          ...studentData,
          role: "Student",
          status: "Approved",
          approvedAt: new Date(),
          approvedBy: req.user._id,
          password: studentData.password || "password123", // Default password
        });

        results.success++;
      } catch (error) {
        results.errors.push({
          row: i + 1,
          error: error.message,
        });
        results.failed++;
      }
    }

    res.json({
      message: "Bulk import completed",
      results,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
