# 🎓 EduManager Backend

The backend service for EduManager, a university timetable and academic scheduling platform. This API manages authentication, approval workflows, academic entities, timetable operations, conflict detection, CSV-based bulk scheduling, reporting, and email notifications.

## 📌 Overview

This backend is built with Node.js, Express, and MongoDB. It exposes REST APIs used by the frontend admin portal and supports deployment as a standalone backend service.

## ✨ Core Features

- JWT-based authentication and protected API routes
- Admin approval workflow for newly registered users
- Role-based authorization for admin, HOD, teacher, and authenticated users
- CRUD operations for departments, programs, sessions, semesters, courses, sections, teachers, rooms, and subjects
- Course allocation and timetable management
- Schedule conflict detection for teacher and room clashes
- Auto-resolution support for selected conflict types
- CSV template generation, validation, upload processing, and retry support
- Error and success report generation for bulk uploads
- Teacher workload, room utilization, and department-wise reporting
- PDF and CSV report exports
- Email notifications for registration and approval events
- Security middleware with Helmet, CORS, cookies, and rate limiting

## 🛠 Tech Stack

### Core

- Node.js
- Express.js
- MongoDB
- Mongoose

### Authentication & Security

- jsonwebtoken
- bcryptjs
- cookie-parser
- helmet
- cors
- express-rate-limit

### File Processing & Reporting

- multer
- csv-parser
- csv-writer
- json2csv
- pdfkit

### Notifications

- nodemailer

### Deployment & Dev Tools

- Vercel
- Nodemon
- dotenv

## 🏗 Project Structure

```bash
backend/
├── api/                  # Vercel serverless entry point
├── config/               # Database connection setup
├── controllers/          # Business logic for each module
├── middleware/           # Auth and role-based access middleware
├── models/               # Mongoose schemas
├── routes/               # Express route modules
├── services/             # CSV processing and conflict detection services
├── utils/                # Email utilities and helpers
├── server.js             # Main Express application
├── package.json
└── vercel.json
```

## ⚙️ Installation & Setup

### 1. Move into the backend folder

```bash
cd backend
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create a `.env` file

```env
PORT=5000
NODE_ENV=development
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
FRONTEND_URL=http://localhost:5173
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your_email_address
EMAIL_PASS=your_email_password_or_app_password
ADMIN_EMAIL=admin@example.com
```

### 4. Run the development server

```bash
npm run dev
```

### 5. Run in production mode

```bash
npm start
```

Default local API URL:

```bash
http://localhost:5000
```

## 🔐 Environment Variables

| Variable | Description |
|---|---|
| `PORT` | Backend server port |
| `NODE_ENV` | Runtime environment |
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | Secret used to sign JWT tokens |
| `FRONTEND_URL` | Allowed frontend origin for CORS and email links |
| `EMAIL_HOST` | SMTP host |
| `EMAIL_PORT` | SMTP port |
| `EMAIL_USER` | SMTP username / sender email |
| `EMAIL_PASS` | SMTP password or app password |
| `ADMIN_EMAIL` | Email that receives approval notifications |

## 🚀 API Modules

Base URL:

```bash
http://localhost:5000/api
```

### Authentication

- `POST /auth/register`
- `POST /auth/login`

### Approvals

- `GET /approvals/pending`
- `GET /approvals/count`
- `GET /approvals/users`
- `PUT /approvals/:id/approve`
- `PUT /approvals/:id/reject`
- `PUT /approvals/:id/update`
- `DELETE /approvals/users/:id`

### Academic Management

- `/teachers`
- `/subjects`
- `/departments`
- `/programs`
- `/academic-sessions`
- `/semesters`
- `/courses`
- `/sections`
- `/rooms`
- `/course-allocations`
- `/time-slots`
- `/timetables`
- `/conflicts`
- `/csv`
- `/reports`

These route groups include list, create, update, delete, assignment, statistics, and workflow endpoints depending on the module.

## 📘 Important Endpoint Groups

### Timetables

- `POST /timetables`
- `PUT /timetables/:id`
- `DELETE /timetables/:id`
- `PUT /timetables/:id/publish`
- `PUT /timetables/:id/approve`
- `PUT /timetables/:id/reject`
- `POST /timetables/:id/schedule`
- `DELETE /timetables/:id/schedule/:entryId`
- `GET /timetables/:id/available-allocations`
- `GET /timetables/:id/matrix`
- `POST /timetables/:id/check-conflicts`

### Conflicts

- `POST /conflicts/detect/:timetableId`
- `POST /conflicts/auto-resolve/:timetableId`
- `POST /conflicts/:id/apply-resolution`
- `PUT /conflicts/bulk-update`
- `PUT /conflicts/:id/status`
- `GET /conflicts/stats`
- `GET /conflicts/critical`
- `GET /conflicts/timetable/:timetableId`
- `GET /conflicts/:id`

### CSV Uploads

- `POST /csv/upload`
- `POST /csv/validate`
- `POST /csv/analyze-conflicts`
- `GET /csv/template/:uploadType`
- `GET /csv/template/:uploadType/download`
- `GET /csv/uploads`
- `GET /csv/uploads/:id`
- `POST /csv/uploads/:id/retry`
- `GET /csv/uploads/:id/schedule-entries`
- `GET /csv/uploads/:id/conflicts`
- `GET /csv/stats`
- `GET /csv/upload-types`
- `GET /csv/download-error-report/:id`
- `GET /csv/download-success-report/:id`

### Reports

- `POST /reports/generate`
- `GET /reports`
- `GET /reports/statistics`
- `GET /reports/:id`
- `GET /reports/download/:id`
- `DELETE /reports/:id`

## 🔄 Backend Workflow

1. A user registers through the frontend.
2. The backend stores the user with `Pending` status.
3. An admin receives an email notification.
4. Approved users can log in and receive a JWT token.
5. Admins configure academic structure and scheduling data.
6. Timetables are created manually or through CSV upload.
7. Conflict detection checks teacher and room scheduling collisions.
8. Reports can be generated as JSON, PDF, or CSV.

## ☁️ Deployment

This backend includes a `vercel.json` file and an `api/index.js` entry for Vercel deployment.

### Vercel Notes

- Entry point: `api/index.js`
- All routes are rewritten to the Express app
- Set all required environment variables in your Vercel project settings

## 🧪 Testing

Automated tests are not currently configured in this backend repository.

## 🖼 Screenshots / Demo

- API base response: Add screenshot here
- Postman collection / Swagger preview: Add screenshot here
- CSV upload result sample: Add screenshot here

## 🔮 Future Improvements

- Add unit and integration tests
- Add API documentation with Swagger or Postman collection export
- Add refresh token support
- Add audit logs for administrative actions
- Add background job processing for heavy report or upload tasks
- Add Docker support for easier environment setup

## 👤 Author

**Muhammad Noman Orakzai**  
GitHub: [Add your GitHub profile link here](https://github.com/your-username)
