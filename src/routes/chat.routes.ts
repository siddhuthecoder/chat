import { Router, Request, Response } from "express";
import {
  getUsers,
  getUserChats,
  getChatMessages,
  createChat,
  createMultipleChat,
  createTeamChat,
  deleteChat,
  editMessage,
  exportChat,
  sendMessage,
  exitChat,
  getGroupChats,
  createGroupChat,
  createDirectChat,
  createTeam
} from "../controllers/chat.controller";
import { deleteMessage } from "../controllers/message.controller";
import {
  validateCreateDirectChat,
  validateCreateGroupChat,
  validateCreateTeamChat,
  validateSendMessage,
  validateEditMessage,
  validateDeleteChat,
  validateExitChat,
  validateGetChatMessages
} from "../validations/chat.validation";
import { handleValidationErrors } from "../middleware/validationMiddleware";

const router = Router();

// User routes
router.get("/users", (req: Request, res: Response) => {
  getUsers(req, res);
});

router.get("/users/:userId/chats", (req: Request, res: Response) => {
  
  getUserChats(req, res);
});

// Chat messages routes
router.get("/chats/:chatId/messages/:userId", validateGetChatMessages, handleValidationErrors, (req: Request, res: Response) => {
 
  getChatMessages(req, res);
});

// Chat creation routes
router.post("/chats", (req: Request, res: Response) => {
  createChat(req, res);
});

router.post("/chats/multiple", (req: Request, res: Response) => {
  createMultipleChat(req, res);
});

router.post("/chats/teams", (req: Request, res: Response) => {
  createTeamChat(req, res);
});

// Chat management routes
router.delete("/chats/:chatId/:userId?", validateDeleteChat, handleValidationErrors, (req: Request, res: Response) => {
  deleteChat(req, res);
});

router.put("/chats/:chatId/messages/:messageId", validateEditMessage, handleValidationErrors, (req: Request, res: Response) => {
  editMessage(req, res);
});

router.delete("/messages/:messageId", (req: Request, res: Response) => {
  deleteMessage(req, res);
});

// Message routes
router.post("/messages", validateSendMessage, handleValidationErrors, (req: Request, res: Response) => {
  sendMessage(req, res);
});

// Group chat routes
router.post("/chats/:chatId/exit", validateExitChat, handleValidationErrors, (req: Request, res: Response) => {
  exitChat(req, res);
});

router.get("/chats/group/:userId", (req: Request, res: Response) => {
  getGroupChats(req, res);
});

router.post("/create", validateCreateDirectChat, handleValidationErrors, (req: Request, res: Response) => {
  createDirectChat(req, res);
});

router.post("/create/group", validateCreateGroupChat, handleValidationErrors, (req: Request, res: Response) => {
  createGroupChat(req, res);
});

router.post("/create/team", validateCreateTeamChat, handleValidationErrors, (req: Request, res: Response) => {
  createTeam(req, res);
});

// Export route
router.post("/export", (req: Request, res: Response) => {
  exportChat(req, res);
});

export default router; 