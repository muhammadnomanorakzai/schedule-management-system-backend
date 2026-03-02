import CourseAllocation from "../models/CourseAllocation.js";
import User from "../models/User.js";
import Course from "../models/Course.js";
import Program from "../models/Program.js";
import AcademicSession from "../models/AcademicSession.js";
import Section from "../models/Section.js";

// @desc    Create a new course allocation
// @route   POST /api/course-allocations
// @access  Private (Admin, HOD)
export const createCourseAllocation = async (req, res) => {
  try {
    const {
      academicSession,
      semester,
      program,
      course,
      teacher,
      section,
      isLab,
      labTeacher,
      creditHours,
      contactHoursPerWeek,
      maxStudents,
      notes,
    } = req.body;

    // Validate academic session and semester
    const session = await AcademicSession.findById(academicSession);
    if (!session) {
      return res.status(404).json({ message: "Academic session not found" });
    }

    // Check semester validation based on session type
    const validSemesters =
      session.sessionType === "Fall" ? [1, 3, 5, 7] : [2, 4, 6, 8];
    if (!validSemesters.includes(parseInt(semester))) {
      return res.status(400).json({
        message: `Invalid semester for ${session.sessionType} session. Valid semesters: ${validSemesters.join(", ")}`,
      });
    }

    // Check if teacher exists and is a teacher
    const teacherUser = await User.findById(teacher);
    if (!teacherUser || teacherUser.role.toLowerCase() !== "teacher") {
      return res.status(400).json({ message: "Invalid teacher assignment" });
    }

    // Check if course exists
    const courseData = await Course.findById(course);
    if (!courseData) {
      return res.status(404).json({ message: "Course not found" });
    }

    // Check if program exists
    const programData = await Program.findById(program);
    if (!programData) {
      return res.status(404).json({ message: "Program not found" });
    }

    // Check if section exists
    const sectionData = await Section.findById(section);
    if (!sectionData) {
      return res.status(404).json({ message: "Section not found" });
    }

    // Check for duplicate allocation
    const existingAllocation = await CourseAllocation.findOne({
      academicSession,
      semester,
      course,
      section,
      status: { $ne: "cancelled" },
    });

    if (existingAllocation) {
      return res.status(400).json({
        message:
          "Course already allocated to this section in the same semester and session",
      });
    }

    // Check teacher's department matches course department (optional validation)
    if (teacherUser.department && courseData.department) {
      if (
        teacherUser.department.toString() !== courseData.department.toString()
      ) {
        return res.status(400).json({
          message: "Teacher department does not match course department",
        });
      }
    }

    // Create new allocation
    const allocation = new CourseAllocation({
      academicSession,
      semester,
      program,
      course,
      teacher,
      section,
      isLab,
      labTeacher: isLab && labTeacher ? labTeacher : undefined,
      creditHours: creditHours || courseData.creditHours,
      contactHoursPerWeek: contactHoursPerWeek || courseData.contactHours,
      maxStudents: maxStudents || 50,
      notes,
      createdBy: req.user._id,
      status: "draft",
    });

    await allocation.save();

    // Populate references for response
    const populatedAllocation = await CourseAllocation.findById(allocation._id)
      .populate("academicSession", "name year sessionType")
      .populate("program", "name code")
      .populate("course", "code name creditHours")
      .populate("teacher", "name email employeeId")
      .populate("section", "name code")
      .populate("createdBy", "name email");

    res.status(201).json({
      success: true,
      data: populatedAllocation,
      message: "Course allocation created successfully",
    });
  } catch (error) {
    console.error("Error creating course allocation:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Get all course allocations with filters
// @route   GET /api/course-allocations
// @access  Private
export const getAllCourseAllocations = async (req, res) => {
  try {
    const {
      academicSession,
      semester,
      program,
      teacher,
      department,
      status,
      page = 1,
      limit = 20,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    // Build filter object
    const filter = {};

    if (academicSession) filter.academicSession = academicSession;
    if (semester) filter.semester = parseInt(semester);
    if (program) filter.program = program;
    if (teacher) filter.teacher = teacher;
    if (status) filter.status = status;

    // Department filter (through program or teacher)
    if (department) {
      // Find programs in this department
      const programs = await Program.find({ department }).select("_id");
      const programIds = programs.map((p) => p._id);
      filter.program = { $in: programIds };
    }

    // Pagination
    const pageNumber = parseInt(page);
    const pageSize = parseInt(limit);
    const skip = (pageNumber - 1) * pageSize;

    // Sorting
    const sort = {};
    sort[sortBy] = sortOrder === "desc" ? -1 : 1;

    // Get total count
    const total = await CourseAllocation.countDocuments(filter);

    // Get allocations with population
    const allocations = await CourseAllocation.find(filter)
      .populate("academicSession", "name year sessionType")
      .populate("program", "name code department")
      .populate("course", "code name creditHours department")
      .populate("teacher", "name email employeeId department")
      .populate("section", "name code")
      .populate("createdBy", "name email")
      .populate("approvedBy", "name email")
      .sort(sort)
      .skip(skip)
      .limit(pageSize);

    res.json({
      success: true,
      data: allocations,
      pagination: {
        total,
        page: pageNumber,
        pages: Math.ceil(total / pageSize),
        limit: pageSize,
      },
    });
  } catch (error) {
    console.error("Error fetching course allocations:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Get course allocation by ID
// @route   GET /api/course-allocations/:id
// @access  Private
export const getCourseAllocationById = async (req, res) => {
  try {
    const allocation = await CourseAllocation.findById(req.params.id)
      .populate("academicSession", "name year sessionType")
      .populate("program", "name code department")
      .populate("course", "code name creditHours contactHours department")
      .populate("teacher", "name email employeeId department designation")
      .populate("labTeacher", "name email employeeId")
      .populate("section", "name code")
      .populate("createdBy", "name email")
      .populate("approvedBy", "name email");

    if (!allocation) {
      return res.status(404).json({
        success: false,
        message: "Course allocation not found",
      });
    }

    res.json({
      success: true,
      data: allocation,
    });
  } catch (error) {
    console.error("Error fetching course allocation:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Update course allocation
// @route   PUT /api/course-allocations/:id
// @access  Private (Admin, HOD)
export const updateCourseAllocation = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Find allocation
    const allocation = await CourseAllocation.findById(id);
    if (!allocation) {
      return res.status(404).json({
        success: false,
        message: "Course allocation not found",
      });
    }

    // Check if allocation can be updated (not completed/cancelled)
    if (
      allocation.status === "completed" ||
      allocation.status === "cancelled"
    ) {
      return res.status(400).json({
        success: false,
        message: "Cannot update completed or cancelled allocations",
      });
    }

    // If changing teacher, validate new teacher
    if (
      updateData.teacher &&
      updateData.teacher !== allocation.teacher.toString()
    ) {
      const newTeacher = await User.findById(updateData.teacher);
      if (!newTeacher || newTeacher.role !== "teacher") {
        return res.status(400).json({
          message: "Invalid teacher assignment",
        });
      }
    }

    // Update allocation
    Object.assign(allocation, updateData);
    await allocation.save();

    // Get updated allocation with populated data
    const updatedAllocation = await CourseAllocation.findById(id)
      .populate("academicSession", "name year sessionType")
      .populate("program", "name code")
      .populate("course", "code name creditHours")
      .populate("teacher", "name email employeeId")
      .populate("section", "name code");

    res.json({
      success: true,
      data: updatedAllocation,
      message: "Course allocation updated successfully",
    });
  } catch (error) {
    console.error("Error updating course allocation:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Delete/soft delete course allocation
// @route   DELETE /api/course-allocations/:id
// @access  Private (Admin, HOD)
export const deleteCourseAllocation = async (req, res) => {
  try {
    const allocation = await CourseAllocation.findById(req.params.id);

    if (!allocation) {
      return res.status(404).json({
        success: false,
        message: "Course allocation not found",
      });
    }

    // Soft delete by changing status
    allocation.status = "cancelled";
    await allocation.save();

    res.json({
      success: true,
      message: "Course allocation cancelled successfully",
    });
  } catch (error) {
    console.error("Error deleting course allocation:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Approve course allocation
// @route   PUT /api/course-allocations/:id/approve
// @access  Private (Admin, HOD)
export const approveCourseAllocation = async (req, res) => {
  try {
    const allocation = await CourseAllocation.findById(req.params.id);

    if (!allocation) {
      return res.status(404).json({
        success: false,
        message: "Course allocation not found",
      });
    }

    if (allocation.status !== "draft") {
      return res.status(400).json({
        message: "Only draft allocations can be approved",
      });
    }

    allocation.status = "approved";
    allocation.approvedBy = req.user._id;
    allocation.approvalDate = new Date();
    await allocation.save();

    res.json({
      success: true,
      message: "Course allocation approved successfully",
      data: allocation,
    });
  } catch (error) {
    console.error("Error approving course allocation:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Get teacher workload for a semester
// @route   GET /api/course-allocations/teacher-workload/:teacherId
// @access  Private
export const getTeacherWorkload = async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { academicSession, semester } = req.query;

    const filter = {
      teacher: teacherId,
      status: { $in: ["approved", "active"] },
    };

    if (academicSession) filter.academicSession = academicSession;
    if (semester) filter.semester = parseInt(semester);

    const allocations = await CourseAllocation.find(filter)
      .populate("academicSession", "name year sessionType")
      .populate("program", "name code")
      .populate("course", "code name")
      .populate("section", "name code");

    // Calculate total workload
    const totalHours = allocations.reduce(
      (sum, alloc) => sum + alloc.contactHoursPerWeek,
      0,
    );
    const totalCredits = allocations.reduce(
      (sum, alloc) => sum + alloc.creditHours,
      0,
    );

    res.json({
      success: true,
      data: {
        allocations,
        summary: {
          totalCourses: allocations.length,
          totalContactHours: totalHours,
          totalCreditHours: totalCredits,
          averageHoursPerWeek:
            allocations.length > 0 ? totalHours / allocations.length : 0,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching teacher workload:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

// @desc    Get available teachers for a course
// @route   GET /api/course-allocations/available-teachers
// @access  Private
export const getAvailableTeachers = async (req, res) => {
  try {
    const {
      courseId,
      academicSession,
      semester,
      department,
      excludeTeacherId,
    } = req.query;

    // Get course details
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    // Build teacher filter
    const teacherFilter = {
      role: "teacher",
      isApproved: true,
      status: "active",
    };

    // Filter by department if provided, otherwise use course department
    if (department) {
      teacherFilter.department = department;
    } else if (course.department) {
      teacherFilter.department = course.department;
    }

    // Get all teachers in the department
    let teachers = await User.find(teacherFilter)
      .select("name email employeeId department designation qualification")
      .sort("name");

    // Filter out excluded teacher
    if (excludeTeacherId) {
      teachers = teachers.filter(
        (teacher) => teacher._id.toString() !== excludeTeacherId,
      );
    }

    // If session and semester are provided, check workload
    if (academicSession && semester) {
      const allocations = await CourseAllocation.find({
        academicSession,
        semester: parseInt(semester),
        status: { $in: ["approved", "active"] },
      });

      // Calculate current load for each teacher
      const teacherLoadMap = {};
      allocations.forEach((alloc) => {
        const teacherId = alloc.teacher.toString();
        teacherLoadMap[teacherId] =
          (teacherLoadMap[teacherId] || 0) + alloc.contactHoursPerWeek;
      });

      // Add load information to teachers
      teachers = teachers.map((teacher) => {
        const currentLoad = teacherLoadMap[teacher._id.toString()] || 0;
        const availableLoad = 24 - currentLoad; // Max 24 hours per week

        return {
          ...teacher.toObject(),
          currentLoad,
          availableLoad,
          isOverloaded: currentLoad >= 24,
        };
      });

      // Sort by available load (most available first)
      teachers.sort((a, b) => b.availableLoad - a.availableLoad);
    }

    res.json({
      success: true,
      data: teachers,
      count: teachers.length,
    });
  } catch (error) {
    console.error("Error fetching available teachers:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};
