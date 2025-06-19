import { Document, Types } from "mongoose";

export interface IUser extends Document {
  username: string;
  socketId: string;
  active?: boolean;
  createdAt: Date;
  lastActive: Date;
}

export interface IMessage extends Document {
  content: string;
  userId: Types.ObjectId;
  roomId?: Types.ObjectId;
  chatId?: Types.ObjectId;
  type: "room" | "direct";
  createdAt: Date;
}

export interface IChat extends Document {
  participants: Types.ObjectId[];
  lastMessage?: Types.ObjectId;
  createdAt: Date;
}

export interface ServerToClientEvents {
  userJoined: (data: { user: IUser }) => void;
  messageDeleted: (data: {
    messageId: string;
    chatId: string;
    lastMessage: any;
    mode: "forMe" | "forEveryone";
  }) => void;
  chatUpdated: (chatId: string, newLastMessage: any) => void;
  chatStarted: (chat: IChat) => void;
  messageSent: (data: { message: any; chatId: string }) => void;
  directMessage: (data: { chatId: string; message: IMessage }) => void;
  message: (message: any) => void;
  messageHistory: (data: {
    messages: any[];
    hasMore: boolean;
    total: number;
    currentPage: number;
  }) => void;
  participantStatusUpdate: (data: {
    participantId: string;
    status: string;
    active: boolean;
  }) => void;
  messageEdited: (data: {
    chatId: string;
    messageId: string;
    content: string;
    attachments: any[];
    lastMessage: any;
  }) => void;
  messageReaction: (data: {
    messageId: string;
    chatId: string;
    reaction: {
      userId: string;
      emoji: string;
      user: {
        _id: any;
        displayName: string;
        photoURL?: string;
      };
    } | null;
    userId: string;
  }) => void;
}

export interface ClientToServerEvents {
  join: (data: { username: string }) => void;
  startChat: (data: { userId: string; contact?: any }) => void;
  directMessage: (data: { chatId: string; content: any }) => void;
  message: (data: { content: string; roomId: string }) => void;
  deleteMessage: (data: { 
    messageId: string; 
    chatId: string; 
    userId: string; 
    mode?: "forMe" | "forEveryone" 
  }) => void;
  updateStatus: (data: { status: string; userId: string }) => void;
  getMessageHistory: (data: { chatId: string; page: number }) => void;
  markMessageAsRead: (data: { messageId: string; chatId: string; userId: string }) => void;
  markAllMessagesAsRead: (data: { chatId: string; userId: string }) => void;
  updateUnreadCount: (data: { chatId: string; userId: string }) => void;
  addReaction: (data: { messageId: string; chatId: string; emoji: string }) => void;
}
