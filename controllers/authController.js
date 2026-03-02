const User = require("../models/User");
const jwt = require("jsonwebtoken");
const { sendNewApprovalNotification } = require("../utils/emailService");

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "30d" });
};

// Login
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (user && (await user.matchPassword(password))) {
      // Approval check
      if (user.status === "Pending") {
        return res
          .status(403)
          .json({ message: "Your account is pending admin approval." });
      }
      if (user.status === "Rejected") {
        return res
          .status(403)
          .json({ message: "Your registration request was rejected." });
      }

      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        token: generateToken(user._id),
      });
    } else {
      res.status(401).json({ message: "Invalid email or password" });
    }
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Register
const registerUser = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    const userExists = await User.findOne({ email });
    if (userExists)
      return res
        .status(400)
        .json({ message: "User already exists with this email" });

    const user = await User.create({
      name,
      email,
      password,
      role: role || "Student",
      status: "Pending",
      requestedAt: new Date(),
    });

    // Notify admin via email
    await sendNewApprovalNotification({
      name: user.name,
      email: user.email,
      requestedAt: user.requestedAt,
    }).catch((err) => console.error("Email failed:", err));

    res.status(201).json({
      message: "Registration submitted successfully! Pending admin approval.",
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
    });
  } catch (error) {
    console.error("Register Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

module.exports = { loginUser, registerUser };
