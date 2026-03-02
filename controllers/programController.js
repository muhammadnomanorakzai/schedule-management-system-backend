const Program = require("../models/Program");
const Department = require("../models/Department");

// @desc    Create a new program
// @route   POST /api/programs
// @access  Admin
exports.createProgram = async (req, res) => {
  try {
    const {
      name,
      code,
      department,
      duration,
      totalSemesters,
      degreeType,
      description,
      yearlyIntake,
      feesPerSemester,
    } = req.body;

    // Check if department exists
    const deptExists = await Department.findById(department);
    if (!deptExists) {
      return res.status(404).json({
        message: "Department not found",
      });
    }

    // Check if program with same code in same department exists
    const existingProgram = await Program.findOne({
      code: code.toUpperCase(),
      department,
    });

    if (existingProgram) {
      return res.status(400).json({
        message: `Program with code ${code} already exists in this department`,
      });
    }

    const program = await Program.create({
      name,
      code: code.toUpperCase(),
      department,
      duration: duration || 4,
      totalSemesters: totalSemesters || 8,
      degreeType: degreeType || "Undergraduate",
      description,
      yearlyIntake: yearlyIntake || 100,
      feesPerSemester: feesPerSemester || 0,
    });

    const populatedProgram = await Program.findById(program._id).populate(
      "department",
      "name code",
    );

    res.status(201).json(populatedProgram);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Get all programs
// @route   GET /api/programs
// @access  All authenticated users
exports.getPrograms = async (req, res) => {
  try {
    const programs = await Program.find()
      .populate("department", "name code")
      .sort({ name: 1 });

    res.status(200).json(programs);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Get programs by department
// @route   GET /api/programs/department/:deptId
// @access  All authenticated users
exports.getProgramsByDepartment = async (req, res) => {
  try {
    const programs = await Program.find({
      department: req.params.deptId,
      isActive: true,
    })
      .populate("department", "name code")
      .sort({ name: 1 });

    res.status(200).json(programs);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Get single program
// @route   GET /api/programs/:id
// @access  All authenticated users
exports.getProgramById = async (req, res) => {
  try {
    const program = await Program.findById(req.params.id).populate(
      "department",
      "name code hod",
    );

    if (!program) {
      return res.status(404).json({
        message: "Program not found",
      });
    }

    res.status(200).json(program);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Update program
// @route   PUT /api/programs/:id
// @access  Admin
exports.updateProgram = async (req, res) => {
  try {
    const program = await Program.findById(req.params.id);

    if (!program) {
      return res.status(404).json({
        message: "Program not found",
      });
    }

    // Check for duplicate code in same department
    if (req.body.code) {
      const existing = await Program.findOne({
        _id: { $ne: program._id },
        code: req.body.code.toUpperCase(),
        department: req.body.department || program.department,
      });

      if (existing) {
        return res.status(400).json({
          message: "Program code already exists in this department",
        });
      }
    }

    // Update program
    const updatedData = { ...req.body };
    if (updatedData.code) {
      updatedData.code = updatedData.code.toUpperCase();
    }

    const updatedProgram = await Program.findByIdAndUpdate(
      req.params.id,
      updatedData,
      {
        new: true,
        runValidators: true,
      },
    ).populate("department", "name code");

    res.status(200).json(updatedProgram);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Delete program
// @route   DELETE /api/programs/:id
// @access  Admin
exports.deleteProgram = async (req, res) => {
  try {
    const program = await Program.findById(req.params.id);

    if (!program) {
      return res.status(404).json({
        message: "Program not found",
      });
    }

    // TODO: Check if program has students or courses before deleting
    // const hasDependencies = await checkProgramDependencies(program._id);
    // if (hasDependencies) {
    //   return res.status(400).json({
    //     message: "Cannot delete program with existing students or courses",
    //   });
    // }

    await program.deleteOne();

    res.status(200).json({
      message: "Program deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Toggle program active status
// @route   PUT /api/programs/:id/toggle-status
// @access  Admin
exports.toggleProgramStatus = async (req, res) => {
  try {
    const program = await Program.findById(req.params.id);

    if (!program) {
      return res.status(404).json({
        message: "Program not found",
      });
    }

    program.isActive = !program.isActive;
    await program.save();

    res.status(200).json({
      message: `Program ${program.isActive ? "activated" : "deactivated"} successfully`,
      program,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};
