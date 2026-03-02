const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const connectDB = require("./config/db");
const multer = require("multer");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// CORS Middleware - Must come BEFORE helmet to work properly
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  process.env.FRONTEND_URL, // Add from environment variable
].filter(Boolean); // Remove undefined values

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// Security Middleware
app.use(
  helmet({
    crossOriginResourcePolicy: false, // Allow CORS
  }),
);

// Rate limiting - 1000 requests per 15 minutes per IP (increased for multiple students)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs (supports ~66 requests/minute)
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

app.use(limiter);

// Body Parser Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const authRoutes = require("./routes/authRoutes");

// Database Connection
connectDB();

// REMOVE THIS LINE - No local file serving needed
// app.use("/uploads", express.static("uploads"));

// Keep reports static serving if needed (for generated reports)
app.use("/reports", express.static(path.join(__dirname, "public/reports")));

app.use("/api/auth", authRoutes);
app.use("/api/approvals", require("./routes/approvalRoutes"));
app.use("/api/classes", require("./routes/classRoutes"));
app.use("/api/students", require("./routes/studentRoutes"));
app.use("/api/teachers", require("./routes/teacherRoutes"));
app.use("/api/subjects", require("./routes/subjectRoutes"));
app.use("/api/departments", require("./routes/departmentRoutes"));
app.use("/api/programs", require("./routes/programRoutes"));
app.use("/api/academic-sessions", require("./routes/academicSessionRoutes"));
app.use("/api/semesters", require("./routes/semesterRoutes"));
app.use("/api/courses", require("./routes/courseRoutes"));
app.use("/api/sections", require("./routes/sectionRoutes"));
app.use("/api/rooms", require("./routes/roomRoutes"));
app.use("/api/course-allocations", require("./routes/courseAllocationRoutes"));
app.use("/api/time-slots", require("./routes/timeSlotRoutes"));
app.use("/api/timetables", require("./routes/timetableRoutes"));
app.use("/api/conflicts", require("./routes/conflictRoutes"));
app.use("/api/csv", require("./routes/csvUploadRoutes"));
app.use("/api/reports", require("./routes/reportRoutes"));

// Root Route - Beautiful Landing Page
app.get("/", (req, res) => {
  res.send("backend is running");
});

// Error Handling Middleware
app.use((err, req, res, next) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  res.status(statusCode);
  res.json({
    message: err.message,
    stack: process.env.NODE_ENV === "production" ? null : err.stack,
  });
});

if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
