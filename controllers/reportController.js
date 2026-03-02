const Report = require("../models/Report");
const AcademicSession = require("../models/AcademicSession");
const User = require("../models/User");
const Department = require("../models/Department");
const Program = require("../models/Program");
const Room = require("../models/Room");
const CourseAllocation = require("../models/CourseAllocation");
const Timetable = require("../models/Timetable");
const mongoose = require("mongoose");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const { Parser } = require("json2csv");

// Helper function to generate teacher workload report
const generateTeacherWorkloadReport = async (filters) => {
  const { academicSession, semester, department, dateRange, teacher } = filters;

  const matchStage = {};

  if (academicSession) {
    matchStage.academicSession = new mongoose.Types.ObjectId(academicSession);
  }

  if (semester) {
    matchStage.semester = semester;
  }

  if (department) {
    matchStage.department = new mongoose.Types.ObjectId(department);
  }

  if (teacher) {
    matchStage.teacher = new mongoose.Types.ObjectId(teacher);
  }

  // Get all course allocations with populated data
  const allocations = await CourseAllocation.aggregate([
    { $match: matchStage },
    {
      $lookup: {
        from: "users",
        localField: "teacher",
        foreignField: "_id",
        as: "teacherInfo",
      },
    },
    { $unwind: "$teacherInfo" },
    {
      $lookup: {
        from: "courses",
        localField: "course",
        foreignField: "_id",
        as: "courseInfo",
      },
    },
    { $unwind: "$courseInfo" },
    {
      $lookup: {
        from: "programs",
        localField: "program",
        foreignField: "_id",
        as: "programInfo",
      },
    },
    { $unwind: "$programInfo" },
    {
      $lookup: {
        from: "departments",
        localField: "department",
        foreignField: "_id",
        as: "departmentInfo",
      },
    },
    { $unwind: "$departmentInfo" },
    {
      $group: {
        _id: "$teacher",
        teacherName: { $first: "$teacherInfo.name" },
        teacherId: { $first: "$teacherInfo.employeeId" },
        departmentName: { $first: "$departmentInfo.name" },
        totalCourses: { $sum: 1 },
        totalCreditHours: { $sum: "$courseInfo.creditHours" },
        courses: {
          $push: {
            courseCode: "$courseInfo.code",
            courseName: "$courseInfo.name",
            creditHours: "$courseInfo.creditHours",
            program: "$programInfo.name",
            semester: "$semester",
            sections: "$sections",
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        teacherId: 1,
        teacherName: 1,
        departmentName: 1,
        totalCourses: 1,
        totalCreditHours: 1,
        averageWorkload: { $divide: ["$totalCreditHours", "$totalCourses"] },
        courses: 1,
      },
    },
    { $sort: { totalCreditHours: -1 } },
  ]);

  // Calculate statistics
  const totalTeachers = allocations.length;
  const totalCreditHours = allocations.reduce(
    (sum, teacher) => sum + teacher.totalCreditHours,
    0,
  );
  const averageWorkload =
    totalTeachers > 0 ? totalCreditHours / totalTeachers : 0;

  return {
    summary: {
      totalTeachers,
      totalCreditHours,
      averageWorkload: parseFloat(averageWorkload.toFixed(2)),
      generationDate: new Date(),
    },
    teachers: allocations,
    filters,
  };
};

// Helper function to generate room utilization report
const generateRoomUtilizationReport = async (filters) => {
  const { academicSession, semester, dateRange, room, dayOfWeek } = filters;

  const matchStage = {};

  if (academicSession) {
    matchStage.academicSession = new mongoose.Types.ObjectId(academicSession);
  }

  if (semester) {
    matchStage.semester = semester;
  }

  if (room) {
    matchStage.room = new mongoose.Types.ObjectId(room);
  }

  if (dayOfWeek) {
    matchStage.dayOfWeek = dayOfWeek;
  }

  // Get timetable slots
  const slots = await Timetable.aggregate([
    { $match: matchStage },
    {
      $lookup: {
        from: "rooms",
        localField: "room",
        foreignField: "_id",
        as: "roomInfo",
      },
    },
    { $unwind: "$roomInfo" },
    {
      $lookup: {
        from: "courseallocations",
        localField: "courseAllocation",
        foreignField: "_id",
        as: "allocationInfo",
      },
    },
    { $unwind: "$allocationInfo" },
    {
      $lookup: {
        from: "courses",
        localField: "allocationInfo.course",
        foreignField: "_id",
        as: "courseInfo",
      },
    },
    { $unwind: "$courseInfo" },
    {
      $lookup: {
        from: "users",
        localField: "allocationInfo.teacher",
        foreignField: "_id",
        as: "teacherInfo",
      },
    },
    { $unwind: "$teacherInfo" },
    {
      $group: {
        _id: "$room",
        roomName: { $first: "$roomInfo.name" },
        roomCode: { $first: "$roomInfo.code" },
        roomType: { $first: "$roomInfo.type" },
        capacity: { $first: "$roomInfo.capacity" },
        totalSlots: { $sum: 1 },
        slots: {
          $push: {
            dayOfWeek: "$dayOfWeek",
            timeSlot: "$timeSlot",
            courseCode: "$courseInfo.code",
            courseName: "$courseInfo.name",
            teacherName: "$teacherInfo.name",
            semester: "$allocationInfo.semester",
            section: "$section",
          },
        },
      },
    },
    {
      $addFields: {
        utilizationRate: {
          $multiply: [
            { $divide: ["$totalSlots", 40] }, // Assuming 40 slots per week maximum
            100,
          ],
        },
      },
    },
    {
      $project: {
        _id: 0,
        roomId: "$_id",
        roomName: 1,
        roomCode: 1,
        roomType: 1,
        capacity: 1,
        totalSlots: 1,
        utilizationRate: { $round: ["$utilizationRate", 2] },
        slots: 1,
      },
    },
    { $sort: { utilizationRate: -1 } },
  ]);

  // Calculate statistics
  const totalRooms = slots.length;
  const totalSlots = slots.reduce((sum, room) => sum + room.totalSlots, 0);
  const averageUtilization =
    totalRooms > 0
      ? slots.reduce((sum, room) => sum + room.utilizationRate, 0) / totalRooms
      : 0;

  return {
    summary: {
      totalRooms,
      totalSlots,
      averageUtilization: parseFloat(averageUtilization.toFixed(2)),
      generationDate: new Date(),
    },
    rooms: slots,
    filters,
  };
};

// Generate department-wise report
const generateDepartmentWiseReport = async (filters) => {
  const { academicSession } = filters;

  const departments = await Department.aggregate([
    {
      $lookup: {
        from: "programs",
        localField: "_id",
        foreignField: "department",
        as: "programs",
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "department",
        as: "teachers",
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "department",
        pipeline: [{ $match: { role: "student" } }],
        as: "students",
      },
    },
    {
      $project: {
        name: 1,
        code: 1,
        hod: 1,
        totalPrograms: { $size: "$programs" },
        totalTeachers: {
          $size: {
            $filter: {
              input: "$teachers",
              as: "teacher",
              cond: { $eq: ["$$teacher.role", "teacher"] },
            },
          },
        },
        totalStudents: { $size: "$students" },
        programs: {
          $map: {
            input: "$programs",
            as: "program",
            in: {
              name: "$$program.name",
              code: "$$program.code",
              duration: "$$program.duration",
              degreeType: "$$program.degreeType",
            },
          },
        },
      },
    },
    { $sort: { name: 1 } },
  ]);

  return {
    summary: {
      totalDepartments: departments.length,
      generationDate: new Date(),
    },
    departments,
  };
};

// Generate PDF report
const generatePDF = async (reportData, reportType) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const fileName = `${reportType}_${Date.now()}.pdf`;
      const filePath = path.join(__dirname, "../public/reports", fileName);
      const writeStream = fs.createWriteStream(filePath);

      doc.pipe(writeStream);

      // Header
      doc
        .fontSize(20)
        .text("University Timetable Management System", { align: "center" });
      doc.moveDown();
      doc
        .fontSize(16)
        .text(`${reportType.replace("_", " ").toUpperCase()} REPORT`, {
          align: "center",
        });
      doc.moveDown();

      // Report metadata
      doc.fontSize(12);
      doc.text(`Generated on: ${new Date().toLocaleString()}`);
      doc.moveDown();

      // Report content based on type
      if (reportType === "teacher_workload") {
        // Teacher workload report content
        doc.fontSize(14).text("SUMMARY", { underline: true });
        doc.fontSize(12);
        doc.text(`Total Teachers: ${reportData.summary.totalTeachers}`);
        doc.text(`Total Credit Hours: ${reportData.summary.totalCreditHours}`);
        doc.text(
          `Average Workload: ${reportData.summary.averageWorkload} credit hours`,
        );
        doc.moveDown();

        // Teacher details
        reportData.teachers.forEach((teacher, index) => {
          doc
            .fontSize(14)
            .text(
              `${index + 1}. ${teacher.teacherName} (${teacher.teacherId})`,
              { underline: true },
            );
          doc.fontSize(12);
          doc.text(`Department: ${teacher.departmentName}`);
          doc.text(`Total Courses: ${teacher.totalCourses}`);
          doc.text(`Total Credit Hours: ${teacher.totalCreditHours}`);
          doc.text(
            `Average: ${teacher.averageWorkload} credit hours per course`,
          );
          doc.moveDown();

          teacher.courses.forEach((course) => {
            doc.text(
              `  • ${course.courseCode} - ${course.courseName} (${course.creditHours} credits)`,
            );
            doc.text(
              `    Program: ${course.program}, Semester: ${course.semester}`,
            );
          });
          doc.moveDown();
        });
      } else if (reportType === "room_utilization") {
        // Room utilization report content
        doc.fontSize(14).text("SUMMARY", { underline: true });
        doc.fontSize(12);
        doc.text(`Total Rooms: ${reportData.summary.totalRooms}`);
        doc.text(`Total Slots: ${reportData.summary.totalSlots}`);
        doc.text(
          `Average Utilization: ${reportData.summary.averageUtilization}%`,
        );
        doc.moveDown();

        // Room details
        reportData.rooms.forEach((room, index) => {
          doc
            .fontSize(14)
            .text(`${index + 1}. ${room.roomName} (${room.roomCode})`, {
              underline: true,
            });
          doc.fontSize(12);
          doc.text(`Type: ${room.roomType}, Capacity: ${room.capacity}`);
          doc.text(`Total Slots: ${room.totalSlots}`);
          doc.text(`Utilization Rate: ${room.utilizationRate}%`);
          doc.moveDown();
        });
      }

      doc.end();

      writeStream.on("finish", () => {
        resolve({
          fileName,
          filePath: `/reports/${fileName}`,
        });
      });

      writeStream.on("error", reject);
    } catch (error) {
      reject(error);
    }
  });
};

// Generate CSV report
const generateCSV = async (reportData, reportType) => {
  try {
    let fields = [];
    let data = [];

    if (reportType === "teacher_workload") {
      fields = [
        "teacherId",
        "teacherName",
        "departmentName",
        "totalCourses",
        "totalCreditHours",
        "averageWorkload",
      ];
      data = reportData.teachers;
    } else if (reportType === "room_utilization") {
      fields = [
        "roomId",
        "roomName",
        "roomCode",
        "roomType",
        "capacity",
        "totalSlots",
        "utilizationRate",
      ];
      data = reportData.rooms;
    }

    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(data);

    const fileName = `${reportType}_${Date.now()}.csv`;
    const filePath = path.join(__dirname, "../public/reports", fileName);

    fs.writeFileSync(filePath, csv);

    return {
      fileName,
      filePath: `/reports/${fileName}`,
      csvData: csv,
    };
  } catch (error) {
    throw error;
  }
};

// Main report generation controller
exports.generateReport = async (req, res) => {
  try {
    const { type, filters, format = "json" } = req.body;
    const userId = req.user.id;

    let reportData;
    let title = "";

    // Generate report based on type
    switch (type) {
      case "teacher_workload":
        reportData = await generateTeacherWorkloadReport(filters);
        title = `Teacher Workload Report - ${new Date().toLocaleDateString()}`;
        break;

      case "room_utilization":
        reportData = await generateRoomUtilizationReport(filters);
        title = `Room Utilization Report - ${new Date().toLocaleDateString()}`;
        break;

      case "department_wise":
        reportData = await generateDepartmentWiseReport(filters);
        title = `Department-wise Report - ${new Date().toLocaleDateString()}`;
        break;

      default:
        return res.status(400).json({
          success: false,
          message: "Invalid report type",
        });
    }

    let fileInfo = null;

    // Generate file if format is not JSON
    if (format !== "json") {
      if (format === "pdf") {
        fileInfo = await generatePDF(reportData, type);
      } else if (format === "csv") {
        fileInfo = await generateCSV(reportData, type);
      }
    }

    // Save report metadata to database
    const report = new Report({
      type,
      title,
      description: `Generated ${type.replace("_", " ")} report`,
      filters,
      generatedBy: userId,
      data: reportData,
      format,
      filePath: fileInfo?.filePath || null,
      status: "completed",
    });

    await report.save();

    res.status(200).json({
      success: true,
      message: "Report generated successfully",
      data: {
        reportId: report._id,
        title: report.title,
        type: report.type,
        format: report.format,
        generatedAt: report.generatedAt,
        data: format === "json" ? reportData : null,
        fileUrl: fileInfo?.filePath || null,
        downloadUrl: fileInfo ? `/api/reports/download/${report._id}` : null,
      },
    });
  } catch (error) {
    console.error("Error generating report:", error);
    res.status(500).json({
      success: false,
      message: "Error generating report",
      error: error.message,
    });
  }
};

// Get all generated reports
exports.getAllReports = async (req, res) => {
  try {
    const { type, startDate, endDate, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const query = {};

    if (type) {
      query.type = type;
    }

    if (startDate || endDate) {
      query.generatedAt = {};
      if (startDate) query.generatedAt.$gte = new Date(startDate);
      if (endDate) query.generatedAt.$lte = new Date(endDate);
    }

    const reports = await Report.find(query)
      .populate("generatedBy", "name email")
      .populate("filters.academicSession", "name")
      .populate("filters.department", "name")
      .populate("filters.program", "name")
      .sort({ generatedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Report.countDocuments(query);

    res.status(200).json({
      success: true,
      data: reports,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching reports:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching reports",
      error: error.message,
    });
  }
};

// Get single report
exports.getReportById = async (req, res) => {
  try {
    const { id } = req.params;

    const report = await Report.findById(id)
      .populate("generatedBy", "name email")
      .populate("filters.academicSession", "name")
      .populate("filters.department", "name")
      .populate("filters.program", "name")
      .populate("filters.teacher", "name employeeId")
      .populate("filters.room", "name code");

    if (!report) {
      return res.status(404).json({
        success: false,
        message: "Report not found",
      });
    }

    res.status(200).json({
      success: true,
      data: report,
    });
  } catch (error) {
    console.error("Error fetching report:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching report",
      error: error.message,
    });
  }
};

// Download report file
exports.downloadReport = async (req, res) => {
  try {
    const { id } = req.params;

    const report = await Report.findById(id);

    if (!report || !report.filePath) {
      return res.status(404).json({
        success: false,
        message: "Report file not found",
      });
    }

    const filePath = path.join(__dirname, "../public", report.filePath);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: "File not found on server",
      });
    }

    const fileName = `${report.type}_${report.generatedAt.toISOString().split("T")[0]}.${report.format}`;

    res.download(filePath, fileName);
  } catch (error) {
    console.error("Error downloading report:", error);
    res.status(500).json({
      success: false,
      message: "Error downloading report",
      error: error.message,
    });
  }
};

// Delete report
exports.deleteReport = async (req, res) => {
  try {
    const { id } = req.params;

    const report = await Report.findById(id);

    if (!report) {
      return res.status(404).json({
        success: false,
        message: "Report not found",
      });
    }

    // Delete file if exists
    if (report.filePath) {
      const filePath = path.join(__dirname, "../public", report.filePath);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    await Report.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: "Report deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting report:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting report",
      error: error.message,
    });
  }
};

// Get report statistics
exports.getReportStatistics = async (req, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const statistics = await Report.aggregate([
      {
        $match: {
          generatedAt: { $gte: thirtyDaysAgo },
        },
      },
      {
        $group: {
          _id: "$type",
          count: { $sum: 1 },
          lastGenerated: { $max: "$generatedAt" },
        },
      },
      {
        $project: {
          type: "$_id",
          count: 1,
          lastGenerated: 1,
          _id: 0,
        },
      },
    ]);

    const totalReports = statistics.reduce((sum, stat) => sum + stat.count, 0);

    res.status(200).json({
      success: true,
      data: {
        totalReports,
        byType: statistics,
        last30Days: true,
      },
    });
  } catch (error) {
    console.error("Error fetching report statistics:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching report statistics",
      error: error.message,
    });
  }
};
