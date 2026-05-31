import { body, query, param, validationResult } from "express-validator";

export const validateChatRequest = [
  body("query")
    .trim()
    .notEmpty().withMessage("Query is required")
    .isLength({ max: 1000 }).withMessage("Query must be under 1000 characters")
    .escape(),
  body("sessionId")
    .optional()
    .isString()
    .isLength({ max: 100 }),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "Invalid request", details: errors.array() });
    }
    next();
  },
];

export const validatePartNumber = [
  param("partNumber")
    .trim()
    .notEmpty()
    .matches(/^[A-Z0-9]{4,20}$/i).withMessage("Invalid part number format"),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "Invalid part number", details: errors.array() });
    }
    next();
  },
];

export const validateSearchQuery = [
  query("q")
    .trim()
    .notEmpty().withMessage("Search query is required")
    .isLength({ max: 200 }),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 20 })
    .toInt(),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "Invalid search parameters", details: errors.array() });
    }
    next();
  },
];
