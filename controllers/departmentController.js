// controllers/departmentController.js
const Department = require("../models/Department");
const User = require("../models/User");

// @desc    Create a new department
// @route   POST /api/departments
// @access  Admin
exports.createDepartment = async (req, res) => {
  try {
    const { name, code, description } = req.body;

    // Check if department with same name or code exists
    const existingDept = await Department.findOne({
      $or: [{ name }, { code }],
    });

    if (existingDept) {
      return res.status(400).json({
        message: "Department with this name or code already exists",
      });
    }

    const department = await Department.create({
      name,
      code,
      description,
      establishedDate: new Date(),
    });

    res.status(201).json({
      success: true,
      data: department,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get all departments
// @route   GET /api/departments
// @access  All authenticated users
exports.getDepartments = async (req, res) => {
  try {
    const departments = await Department.find()
      .populate("hod", "name email")
      .sort({ name: 1 });

    res.json({
      success: true,
      count: departments.length,
      data: departments,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get single department
// @route   GET /api/departments/:id
// @access  All authenticated users
exports.getDepartmentById = async (req, res) => {
  try {
    const department = await Department.findById(req.params.id).populate(
      "hod",
      "name email role",
    );

    if (!department) {
      return res.status(404).json({
        success: false,
        message: "Department not found",
      });
    }

    res.json({
      success: true,
      data: department,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Update department
// @route   PUT /api/departments/:id
// @access  Admin
exports.updateDepartment = async (req, res) => {
  try {
    let department = await Department.findById(req.params.id);

    if (!department) {
      return res.status(404).json({
        success: false,
        message: "Department not found",
      });
    }

    // Check for duplicate name/code
    if (req.body.name || req.body.code) {
      const existing = await Department.findOne({
        $and: [
          { _id: { $ne: department._id } },
          {
            $or: [
              { name: req.body.name || department.name },
              { code: req.body.code || department.code },
            ],
          },
        ],
      });

      if (existing) {
        return res.status(400).json({
          success: false,
          message: "Department with this name or code already exists",
        });
      }
    }

    department = await Department.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    }).populate("hod", "name email");

    res.json({
      success: true,
      data: department,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Delete department
// @route   DELETE /api/departments/:id
// @access  Admin
exports.deleteDepartment = async (req, res) => {
  try {
    const department = await Department.findById(req.params.id);

    if (!department) {
      return res.status(404).json({
        success: false,
        message: "Department not found",
      });
    }

    // Check if department has any programs/teachers (we'll add this later)
    // const hasDependencies = await checkDepartmentDependencies(department._id);
    // if (hasDependencies) {
    //   return res.status(400).json({
    //     success: false,
    //     message: "Cannot delete department with existing programs or teachers",
    //   });
    // }

    await department.deleteOne();

    res.json({
      success: true,
      message: "Department deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Assign HOD to department
// @route   PUT /api/departments/:id/assign-hod
// @access  Admin
exports.assignHOD = async (req, res) => {
  try {
    const { teacherId } = req.body;

    const department = await Department.findById(req.params.id);
    if (!department) {
      return res.status(404).json({
        success: false,
        message: "Department not found",
      });
    }

    const teacher = await User.findById(teacherId);
    if (!teacher || teacher.role !== "Teacher") {
      return res.status(400).json({
        success: false,
        message: "Invalid teacher selected",
      });
    }

    // Remove HOD from previous department if any
    await Department.updateOne({ hod: teacherId }, { $set: { hod: null } });

    department.hod = teacherId;
    await department.save();

    const populatedDept = await Department.findById(department._id).populate(
      "hod",
      "name email",
    );

    res.json({
      success: true,
      data: populatedDept,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
