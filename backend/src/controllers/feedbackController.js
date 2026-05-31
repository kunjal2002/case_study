import { Router } from "express";
import { body, validationResult } from "express-validator";
import logger from "../utils/logger.js";

const router = Router();

// In-memory feedback store (replace with DB in production)
const feedbackStore = [];

const validateFeedback = [
  body("sessionId").optional().isString().isLength({ max: 100 }),
  body("rating").isInt({ min: 1, max: 5 }).withMessage("Rating must be 1-5"),
  body("message").optional().isString().isLength({ max: 500 }),
  body("query").optional().isString().isLength({ max: 500 }),
];

// POST /api/feedback
router.post("/", validateFeedback, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: "Invalid feedback", details: errors.array() });
  }

  const { sessionId, rating, message, query } = req.body;
  const feedback = {
    id: `fb_${Date.now()}`,
    sessionId: sessionId || "anonymous",
    rating: Number(rating),
    message: message || "",
    query: query || "",
    timestamp: new Date().toISOString(),
  };

  feedbackStore.push(feedback);
  if (feedbackStore.length > 1000) feedbackStore.splice(0, 100); // Keep last 1000

  logger.info(`Feedback received: rating=${rating}, session=${sessionId}`);
  res.status(201).json({ success: true, id: feedback.id });
});

// GET /api/feedback/stats
router.get("/stats", (req, res) => {
  const total = feedbackStore.length;
  const avg = total > 0
    ? feedbackStore.reduce((s, f) => s + f.rating, 0) / total
    : 0;
  res.json({ total, averageRating: Math.round(avg * 10) / 10 });
});

export default router;
