const { body, param } = require("express-validator");

// Common validators
const validateChatId = param("chatId")
  .notEmpty()
  .withMessage("Chat ID is required")
  .isMongoId()
  .withMessage("Invalid chat ID format");

const validateUserId = param("userId")
  .optional()
  .isMongoId()
  .withMessage("Invalid user ID format");

const validateMessageId = param("messageId")
  .notEmpty()
  .withMessage("Message ID is required")
  .isMongoId()
  .withMessage("Invalid message ID format");

// Validation rules for creating a direct chat
export const validateCreateDirectChat = [
  
  body("userId")
    .notEmpty()
    .withMessage("Recipient ID is required")
    .isMongoId()
    .withMessage("Invalid recipient ID format"),
  
  body("contact")
    .notEmpty()
    .withMessage("Contact is required")
];

// Validation rules for creating a group chat
export const validateCreateGroupChat = [
  body("name")
    .notEmpty()
    .withMessage("Group name is required")
    .isString()
    .withMessage("Group name must be a string")
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage("Group name must be between 1 and 100 characters"),
  
  body("participants")
    .notEmpty()
    .withMessage("Participants are required")
    .isArray()
    .withMessage("Participants must be an array")
    .custom((value: any) => {
      if (value.length < 0) {
        throw new Error("Group chat must have at least 1 participants");
      }
      return true;
    }),
  
  body("participants.*")
    .isMongoId()
    .withMessage("Invalid participant ID format"),
];

// Validation rules for creating a team chat
export const validateCreateTeamChat = [
  body("recipients")
    .notEmpty()
    .withMessage("Recipients are required")
    .isArray()
    .withMessage("Recipients must be an array")
    .custom((value: any) => {
      if (value.length < 1) {
        throw new Error("Team chat must have at least 1 recipient");
      }
      return true;
    }),
  
  body("recipients.*._id")
    .notEmpty()
    .withMessage("Recipient ID is required")
    .isMongoId()
    .withMessage("Invalid recipient ID format"),
  
  body("recipients.*.firstname")
    .optional()
    .isString()
    .withMessage("Recipient firstname must be a string"),
  
  body("recipients.*.lastname")
    .optional()
    .isString()
    .withMessage("Recipient lastname must be a string"),
  
  body("recipients.*.email")
    .optional()
    .isEmail()
    .withMessage("Recipient email must be a valid email"),
  
  body("userId")
    .notEmpty()
    .withMessage("User ID is required")
    .isMongoId()
    .withMessage("Invalid user ID format"),
];

// Validation rules for sending a message
export const validateSendMessage = [
  body("chatId")
    .notEmpty()
    .withMessage("Chat ID is required")
    .isMongoId()
    .withMessage("Invalid chat ID format"),
  
  body("content")
    .notEmpty()
    .withMessage("Message content is required")
    .isObject()
    .withMessage("Message content must be an object"),
  
  body("content.body")
    .optional()
    .isString()
    .withMessage("Message body must be a string")
    .trim()
    .isLength({ min: 0, max: 5000 })
    .withMessage("Message body must be between 0 and 5000 characters"),
  
  body("content.type")
    .optional()
    .isString()
    .withMessage("Message type must be a string")
    .isIn(["text", "image", "file", "recording", "system"])
    .withMessage("Invalid message type"),
  
  body("content.attachments")
    .optional()
    .isArray()
    .withMessage("Attachments must be an array"),
  
  body("content.attachments.*.name")
    .optional()
    .isString()
    .withMessage("Attachment name must be a string"),
  
  body("content.attachments.*.size")
    .optional()
    .isNumeric()
    .withMessage("Attachment size must be a number"),
  
  body("content.attachments.*.type")
    .optional()
    .isString()
    .withMessage("Attachment type must be a string"),
  
  body("content.attachments.*.url")
    .optional()
    .isString()
    .withMessage("Attachment URL must be a string"),
];

// Validation rules for editing a message
export const validateEditMessage = [
  validateChatId,
  validateMessageId,
  
  body("content")
    .notEmpty()
    .withMessage("Message content is required")
    .isString()
    .withMessage("Message content must be a string")
    .trim()
    .isLength({ min: 0, max: 5000 })
    .withMessage("Message content must be between 0 and 5000 characters"),
  
  body("attachments")
    .optional()
    .isArray()
    .withMessage("Attachments must be an array"),
  
  body("attachments.*.name")
    .optional()
    .isString()
    .withMessage("Attachment name must be a string"),
  
  body("attachments.*.size")
    .optional()
    .isNumeric()
    .withMessage("Attachment size must be a number"),
  
  body("attachments.*.type")
    .optional()
    .isString()
    .withMessage("Attachment type must be a string"),
  
  body("attachments.*.url")
    .optional()
    .isString()
    .withMessage("Attachment URL must be a string"),
];

// Validation rules for deleting a chat
export const validateDeleteChat = [
  validateChatId,
  validateUserId,
];

// Validation rules for exiting a chat
export const validateExitChat = [
  validateChatId,
  
  body("userId")
    .notEmpty()
    .withMessage("User ID is required")
    .isMongoId()
    .withMessage("Invalid user ID format"),
];

// Validation rules for getting chat messages
export const validateGetChatMessages = [
  validateChatId,
  validateUserId,
  
  param("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be between 1 and 100"),
  
  param("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Page must be greater than 0"),
]; 