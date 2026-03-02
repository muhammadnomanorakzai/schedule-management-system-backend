const User = require("../models/User");
const Department = require("../models/Department");
const Course = require("../models/Course");

// @desc    Get all teachers with enhanced details
// @route   GET /api/teachers
// @access  Admin
exports.getTeachers = async (req, res) => {
  try {
    const teachers = await User.find({ role: "Teacher" })
      .populate("department", "name code")
      .populate("assignedCourses.course", "code name creditHours")
      .select("-password")
      .sort({ name: 1 });

    // Calculate current workload for each teacher
    const teachersWithWorkload = teachers.map((teacher) => {
      const assignedHours = teacher.assignedCourses.reduce(
        (sum, assignment) => {
          return sum + (assignment.course?.creditHours || 0);
        },
        0,
      );

      return {
        ...teacher.toObject(),
        currentWorkload: {
          weeklyHours: assignedHours,
          assignedCourses: teacher.assignedCourses.length,
        },
        workloadPercentage:
          teacher.maxWeeklyHours > 0
            ? Math.round((assignedHours / teacher.maxWeeklyHours) * 100)
            : 0,
      };
    });

    res.json(teachersWithWorkload);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create a teacher with enhanced details
// @route   POST /api/teachers
// @access  Admin
exports.createTeacher = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      qualification,
      specialization,
      experience,
      designation,
      department,
      phone,
      address,
      maxWeeklyHours,
    } = req.body;

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Validate department if provided
    if (department) {
      const deptExists = await Department.findById(department);
      if (!deptExists) {
        return res.status(400).json({ message: "Department not found" });
      }
    }

    const teacher = await User.create({
      name,
      email,
      password,
      role: "Teacher",
      qualification,
      specialization,
      experience: experience || 0,
      designation: designation || "Lecturer",
      department,
      phone,
      address,
      maxWeeklyHours: maxWeeklyHours || 18,
      isAvailableForScheduling: true,
      // status: "Approved", // Auto-approve admin-created teachers
      approvedAt: new Date(),
      approvedBy: req.user._id,
    });

    const populatedTeacher = await User.findById(teacher._id)
      .populate("department", "name code")
      .select("-password");

    res.status(201).json(populatedTeacher);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Assign department to teacher
// @route   PUT /api/teachers/:id/assign-department
// @access  Admin
exports.assignDepartment = async (req, res) => {
  try {
    const { departmentId } = req.body;
    const teacher = await User.findById(req.params.id);

    if (!teacher || teacher.role !== "Teacher") {
      return res.status(404).json({ message: "Teacher not found" });
    }

    const department = await Department.findById(departmentId);
    if (!department) {
      return res.status(404).json({ message: "Department not found" });
    }

    teacher.department = departmentId;
    await teacher.save();

    const populatedTeacher = await User.findById(teacher._id)
      .populate("department", "name code")
      .select("-password");

    res.json({
      message: "Department assigned successfully",
      teacher: populatedTeacher,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Assign course to teacher
// @route   PUT /api/teachers/:id/assign-course
// @access  Admin
exports.assignCourse = async (req, res) => {
  try {
    const { courseId } = req.body;
    const teacher = await User.findById(req.params.id);

    if (!teacher || teacher.role !== "Teacher") {
      return res.status(404).json({ message: "Teacher not found" });
    }

    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    // Check if course already assigned
    const alreadyAssigned = teacher.assignedCourses.some(
      (assignment) => assignment.course.toString() === courseId,
    );

    if (alreadyAssigned) {
      return res
        .status(400)
        .json({ message: "Course already assigned to this teacher" });
    }

    // Check teacher's workload
    const currentHours = teacher.currentWorkload?.weeklyHours || 0;
    const newTotalHours = currentHours + course.creditHours;

    if (newTotalHours > teacher.maxWeeklyHours) {
      return res.status(400).json({
        message: `Cannot assign course. Teacher's workload would exceed maximum weekly hours (${teacher.maxWeeklyHours} hrs)`,
      });
    }

    // Assign course
    teacher.assignedCourses.push({
      course: courseId,
      assignedAt: new Date(),
      assignedBy: req.user._id,
    });

    // Update workload
    teacher.currentWorkload = {
      weeklyHours: newTotalHours,
      assignedCourses: teacher.assignedCourses.length,
    };

    await teacher.save();

    const populatedTeacher = await User.findById(teacher._id)
      .populate("department", "name code")
      .populate("assignedCourses.course", "code name creditHours")
      .select("-password");

    res.json({
      message: "Course assigned successfully",
      teacher: populatedTeacher,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Remove course from teacher
// @route   PUT /api/teachers/:id/remove-course/:courseId
// @access  Admin
exports.removeCourse = async (req, res) => {
  try {
    const teacher = await User.findById(req.params.id);

    if (!teacher || teacher.role !== "Teacher") {
      return res.status(404).json({ message: "Teacher not found" });
    }

    const courseIndex = teacher.assignedCourses.findIndex(
      (assignment) => assignment.course.toString() === req.params.courseId,
    );

    if (courseIndex === -1) {
      return res
        .status(404)
        .json({ message: "Course not assigned to this teacher" });
    }

    const course = await Course.findById(req.params.courseId);
    const courseHours = course ? course.creditHours : 0;

    // Remove course
    teacher.assignedCourses.splice(courseIndex, 1);

    // Update workload
    const newHours = Math.max(
      0,
      (teacher.currentWorkload?.weeklyHours || 0) - courseHours,
    );
    teacher.currentWorkload = {
      weeklyHours: newHours,
      assignedCourses: teacher.assignedCourses.length,
    };

    await teacher.save();

    const populatedTeacher = await User.findById(teacher._id)
      .populate("department", "name code")
      .populate("assignedCourses.course", "code name creditHours")
      .select("-password");

    res.json({
      message: "Course removed successfully",
      teacher: populatedTeacher,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update teacher availability
// @route   PUT /api/teachers/:id/availability
// @access  Admin/Teacher
exports.updateAvailability = async (req, res) => {
  try {
    const { availability } = req.body;
    const teacher = await User.findById(req.params.id);

    if (!teacher || teacher.role !== "Teacher") {
      return res.status(404).json({ message: "Teacher not found" });
    }

    // Validate availability structure
    const validDays = [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    const validSlots = [
      "08:30-09:30",
      "09:30-10:30",
      "10:30-11:30",
      "11:30-12:30",
      "12:30-13:30",
      "13:30-14:30",
      "14:30-15:30",
      "15:30-16:30",
      "16:30-17:30",
    ];

    for (const dayAvailability of availability) {
      if (!validDays.includes(dayAvailability.day)) {
        return res
          .status(400)
          .json({ message: `Invalid day: ${dayAvailability.day}` });
      }

      for (const slot of dayAvailability.slots) {
        if (!validSlots.includes(slot)) {
          return res
            .status(400)
            .json({ message: `Invalid time slot: ${slot}` });
        }
      }
    }

    teacher.availability = availability;
    await teacher.save();

    const populatedTeacher = await User.findById(teacher._id)
      .populate("department", "name code")
      .select("-password");

    res.json({
      message: "Availability updated successfully",
      teacher: populatedTeacher,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Toggle teacher scheduling availability
// @route   PUT /api/teachers/:id/toggle-scheduling
// @access  Admin
exports.toggleScheduling = async (req, res) => {
  try {
    const teacher = await User.findById(req.params.id);

    if (!teacher || teacher.role !== "Teacher") {
      return res.status(404).json({ message: "Teacher not found" });
    }

    teacher.isAvailableForScheduling = !teacher.isAvailableForScheduling;
    await teacher.save();

    res.json({
      message: `Teacher ${teacher.isAvailableForScheduling ? "enabled" : "disabled"} for scheduling`,
      teacher: {
        _id: teacher._id,
        name: teacher.name,
        isAvailableForScheduling: teacher.isAvailableForScheduling,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update teacher details
// @route   PUT /api/teachers/:id
// @access  Admin
exports.updateTeacher = async (req, res) => {
  try {
    const teacher = await User.findById(req.params.id);

    if (!teacher) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if user is a Teacher or we're updating a user to become a Teacher
    const isTeacher = teacher.role === "Teacher";
    const becomingTeacher = req.body.role === "Teacher";

    // If user is not a Teacher and not becoming a Teacher, return error
    if (!isTeacher && !becomingTeacher) {
      return res
        .status(400)
        .json({ message: "This endpoint is for teachers only" });
    }

    // If role is being changed to Teacher, update it
    if (becomingTeacher && !isTeacher) {
      teacher.role = "Teacher";
    }

    // Update allowed fields
    const allowedFields = [
      "name",
      "qualification",
      "specialization",
      "experience",
      "designation",
      "department",
      "phone",
      "address",
      "maxWeeklyHours",
    ];

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        teacher[field] = req.body[field];
      }
    });

    await teacher.save();

    const populatedTeacher = await User.findById(teacher._id)
      .populate("department", "name code")
      .populate("assignedCourses.course", "code name creditHours")
      .select("-password");

    res.json({
      message: "Teacher updated successfully",
      teacher: populatedTeacher,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get teachers by department
// @route   GET /api/teachers/department/:departmentId
// @access  Admin
exports.getTeachersByDepartment = async (req, res) => {
  try {
    const teachers = await User.find({
      role: "Teacher",
      department: req.params.departmentId,
      isAvailableForScheduling: true,
      status: "Approved",
    })
      .populate("department", "name code")
      .populate("assignedCourses.course", "code name creditHours")
      .select("-password")
      .sort({ name: 1 });

    res.json(teachers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get available teachers for a course
// @route   GET /api/teachers/available/:courseId/:departmentId
// @access  Admin
exports.getAvailableTeachersForCourse = async (req, res) => {
  try {
    const { courseId, departmentId } = req.params;

    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    // Find teachers in department who can take more work
    const teachers = await User.find({
      role: "Teacher",
      department: departmentId,
      isAvailableForScheduling: true,
      status: "Approved",
    })
      .populate("department", "name code")
      .populate("assignedCourses.course", "code name creditHours")
      .select("-password");

    // Filter teachers who can take this course (not already assigned and within workload)
    const availableTeachers = teachers.filter((teacher) => {
      // Check if already assigned this course
      const alreadyAssigned = teacher.assignedCourses.some(
        (assignment) => assignment.course._id.toString() === courseId,
      );

      if (alreadyAssigned) return false;

      // Check workload capacity
      const currentHours = teacher.currentWorkload?.weeklyHours || 0;
      const newTotalHours = currentHours + course.creditHours;

      return newTotalHours <= teacher.maxWeeklyHours;
    });

    res.json(availableTeachers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get teacher statistics
// @route   GET /api/teachers/stats/overview
// @access  Admin
exports.getTeacherStats = async (req, res) => {
  try {
    const totalTeachers = await User.countDocuments({
      role: "Teacher",
      status: "Approved",
    });
    const availableTeachers = await User.countDocuments({
      role: "Teacher",
      isAvailableForScheduling: true,
      status: "Approved",
    });

    const departmentStats = await User.aggregate([
      {
        $match: {
          role: "Teacher",
          status: "Approved",
          department: { $ne: null },
        },
      },
      {
        $group: {
          _id: "$department",
          count: { $sum: 1 },
          avgExperience: { $avg: "$experience" },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]);

    // Populate department names
    const populatedDeptStats = await Promise.all(
      departmentStats.map(async (stat) => {
        const dept = await Department.findById(stat._id).select("name code");
        return {
          department: dept,
          count: stat.count,
          avgExperience: Math.round(stat.avgExperience || 0),
        };
      }),
    );

    const workloadStats = await User.aggregate([
      { $match: { role: "Teacher", status: "Approved" } },
      {
        $group: {
          _id: null,
          totalAssignedCourses: { $sum: { $size: "$assignedCourses" } },
          avgWorkload: { $avg: "$currentWorkload.weeklyHours" },
          maxWorkload: { $max: "$currentWorkload.weeklyHours" },
        },
      },
    ]);

    res.json({
      totalTeachers,
      availableTeachers,
      departmentStats: populatedDeptStats,
      workloadStats: workloadStats[0] || {},
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete a teacher
// @route   DELETE /api/teachers/:id
// @access  Admin
exports.deleteTeacher = async (req, res) => {
  try {
    const teacher = await User.findById(req.params.id);

    if (!teacher) {
      return res.status(404).json({ message: "Teacher not found" });
    }

    if (teacher.role !== "Teacher") {
      return res.status(400).json({ message: "User is not a teacher" });
    }

    // Check if teacher has assigned courses
    if (teacher.assignedCourses.length > 0) {
      return res.status(400).json({
        message:
          "Cannot delete teacher with assigned courses. Remove courses first.",
      });
    }

    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "Teacher deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
