import { Server, Socket } from "socket.io";
import { Types } from "mongoose";
import type { ServerToClientEvents, ClientToServerEvents } from "../types";
import { ensureTenantDatabaseExists } from "../services/tenantDatabaseService";
import { getUserDetailsByToken, getUsersDetailsByToken, verifyToken } from "../services/iamService";
import { getTenantModels as getTenantModelsFromDB } from "../config/db";
import { requestContext } from "../utils/requestContext";

interface SocketData {
  userId?: string;
  tenantId?: string;
  user?: any;
  token?: string;
}

type SocketWithData = Socket<ClientToServerEvents, ServerToClientEvents> & {
  data: SocketData;
};

type SocketEvents = {
  addReaction: (data: {
    messageId: string;
    chatId: string;
    emoji: string;
  }) => void;
  markMessageAsRead: (data: {
    messageId: string;
    chatId: string;
    userId: string;
  }) => void;
  markAllMessagesAsRead: (data: { chatId: string; userId: string }) => void;
  updateUnreadCount: (data: { chatId: string; userId: string }) => void;
} & ClientToServerEvents;

type ServerEvents = {
  messageReaction: (data: {
    messageId: string;
    chatId: string;
    reaction: { userId: string; emoji: string } | null;
    userId: string;
  }) => void;
  messageRead: (data: {
    messageId: string;
    chatId: string;
    userId: string;
    readAt: Date;
    user: {
      _id: string;
      displayName: string;
      profile_image: string;
    };
  }) => void;
  unreadCountUpdate: (data: { chatId: string; count: number }) => void;
} & ServerToClientEvents;

let io: Server<SocketEvents, ServerEvents>;

// Helper function to validate user authentication
const validateSocketAuth = async (socket: SocketWithData): Promise<boolean> => {
  try {
    // Get token from socket.data first, then fallback to auth headers
    let token = socket.data.token;

    if (!token) {
      const authHeader = socket.handshake.auth.token || socket.handshake.headers.authorization;
      if (!authHeader) {
        console.error("No token provided in socket connection");
        return false;
      }

      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
      }

      if (!token) {
        console.error("Invalid token format in socket connection");
        return false;
      }
    }

    const { valid, decoded } = await verifyToken(token);

    if (!valid || !decoded) {
      console.error("Invalid token in socket connection");
      return false;
    }

    // Store token in socket.data for middleware use
    socket.data.token = token;
    // Set token in request context for getUserDetails to use
    requestContext.set({ token });

    // Set user data in socket
    socket.data.userId = decoded.userId;
    socket.data.user = {
      _id: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      ...decoded
    };
    socket.data.tenantId = decoded.tenantId;

    return true;
  } catch (error) {
    console.error("Socket auth validation error:", error);
    return false;
  }
};

// Socket middleware to ensure tenant database connection and user authentication
const socketTenantMiddleware = async (socket: SocketWithData, next: (err?: Error) => void) => {
  try {
    // First validate user authentication
    const isAuthenticated = await validateSocketAuth(socket);
    if (!isAuthenticated) {
      console.error('Socket middleware - Authentication failed');
      return next(new Error("Authentication failed"));
    }

    // Get tenant ID from multiple sources in order of priority
    let tenantId = socket.data.tenantId

    if (!tenantId) {
      console.error("No tenant ID provided in socket connection");
      return next(new Error("Tenant ID is required"));
    }

    // Ensure tenant database exists before proceeding
    const connectionExists = await ensureTenantDatabaseExists(tenantId);
    if (!connectionExists) {
      console.error(`Failed to ensure tenant database exists for ${tenantId}`);
      return next(new Error(`Database connection failed for tenant ${tenantId}`));
    }

    // Set tenant ID in socket data
    socket.data.tenantId = tenantId;

    // Ensure token is set in request context for all subsequent operations
    if (socket.data.token) {
      requestContext.set({
        token: socket.data.token,
        userId: socket.data.userId,
        tenantId: socket.data.tenantId
      });
    }

    next();
  } catch (error) {
    console.error("Socket tenant middleware error:", error);
    next(new Error("Tenant database connection failed"));
  }
};

// Helper function to get tenant-specific models
async function getTenantModels(tenantId: string) {
  // Ensure tenant database exists before getting models
  const connectionExists = await ensureTenantDatabaseExists(tenantId);
  if (!connectionExists) {
    throw new Error(`Failed to ensure tenant database exists for ${tenantId}`);
  }

  // Get models from the tenant database service
  const { Chat, Message, ChatUser } = await getTenantModelsFromDB(tenantId);
  return { Chat, Message, ChatUser };
}

async function getUnreadCount(chatId: string, userId: string, tenantId: string) {
  const { Message } = await getTenantModels(tenantId);
  return Message.countDocuments({
    chatId,
    senderId: { $ne: userId },
    viewers: { $ne: userId },
    tenantId,
    $or: [
      { deletedFor: { $exists: false } },
      { deletedFor: { $size: 0 } },
      {
        deletedFor: {
          $not: {
            $elemMatch: { userId: new Types.ObjectId(userId) },
          },
        },
      },
    ],
  });
}

async function emitUnreadCountUpdate(chatId: string, userId: string, tenantId: string) {
  const count = await getUnreadCount(chatId, userId, tenantId);
  const { ChatUser } = await getTenantModels(tenantId);
  const user = await ChatUser.findById(userId);

  if (user?.socketIds) {
    user.socketIds.forEach((socketId: string) => {
      io.to(socketId).emit("unreadCountUpdate", { chatId, count });
    });
  }
}

export const setupSocket = (socketIo: Server<SocketEvents, ServerEvents>) => {
  io = socketIo;

  // Apply tenant middleware to all connections
  io.use(socketTenantMiddleware);

  io.on("connection", async (socket: SocketWithData) => {
    socket.on("join", async (userData?: { _id?: string; tenantId?: string }) => {
      try {
        // Use authenticated user data from middleware, fallback to event data if provided
        const userId = socket.data.userId || userData?._id;
        const tenantId = socket.data.tenantId || userData?.tenantId;

        if (!userId || !tenantId) {
          console.error("Missing user ID or tenant ID for socket join");
          return;
        }

        const { ChatUser } = await getTenantModels(tenantId);
        let user = await ChatUser.findOne({ _id: userId });

        if (user) {
          if (!user.socketIds.includes(socket.id)) {
            user.socketIds.push(socket.id);
          }
          user.active = true;
          await user.save();

          const { Chat } = await getTenantModels(tenantId);
          const userChats = await Chat.find({
            participants: userId,
            tenantId
          }).lean();

          for (const chat of userChats) {
            const chatId = (chat._id as Types.ObjectId).toString();
            socket.join(chatId);
          }

          io.emit("participantStatusUpdate", {
            participantId: user._id,
            status: user.status,
            active: true,
          });
        } else {
          user = await ChatUser.create({
            _id: userId,
            socketIds: [socket.id],
            tenantId
          });
        }
      } catch (error) {
        console.error("Join error:", error);
      }
    });

    socket.on(
      "startChat",
      async ({ userId, contact }: { userId?: string; contact?: any }) => {
        try {
          // Use authenticated user data from middleware, fallback to event data if provided
          const currentUserId = socket.data.userId || userId;

          if (!currentUserId) {
            console.error("No user ID available for startChat");
            return;
          }

          const { ChatUser, Chat } = await getTenantModels(socket.data.tenantId as string);
          const currentUser = await ChatUser.findOne({ _id: currentUserId });
          let otherUser = await ChatUser.findById(contact?._id);

          if (!currentUser) {
            console.error("Current user not found for socket:", socket.id);
            return;
          }

          if (!otherUser && contact?._id) {
            otherUser = await ChatUser.create({
              _id: contact._id,
              socketIds: [],
              tenantId: socket.data.tenantId
            });
          }

          if (!otherUser) {
            console.error("Other user not found and no contact provided");
            return;
          }

          let chat = await Chat.findOne({
            participants: { $all: [currentUser._id, otherUser._id] },
            tenantId: socket.data.tenantId
          });

          if (!chat) {
            chat = await Chat.create({
              participants: [currentUser._id, otherUser._id],
              tenantId: socket.data.tenantId
            });
          }

          const populatedChat = await Chat.findById(chat._id)
            .populate("participants")
            .lean() as any;

          if (populatedChat) {
            const participantIds = populatedChat.participants.map((p: any) => p._id.toString());
            const participants = await getUsersDetailsByToken(participantIds, socket.data.tenantId as string, socket.data.token);
            populatedChat.participants = participants.map((p: any) => p._id);
          }

          return populatedChat;
        } catch (error) {
          console.error("Start chat error:", error);
        }
      }
    );

    socket.on(
      "getMessageHistory",
      async ({ chatId, page = 1 }: { chatId: string; page: number }) => {
        try {
          const limit = 10 * page;
          const skip = (page - 1) * limit;

          const { Message } = await getTenantModels(socket.data.tenantId as string);
          const totalMessages = await Message.countDocuments({ chatId });

          const messages = await Message.find({ chatId, tenantId: socket.data.tenantId as string })
            .populate("senderId", "status active")
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

          const populatedMessages = await Promise.all(
            messages.map(async (message: any) => {
              if (message.senderId) {
                message.senderId = await getUserDetailsByToken(message.senderId._id.toString(), socket.data.tenantId as string, socket.data.token);
              }
              return message;
            })
          );

          socket.emit("messageHistory", {
            messages: populatedMessages.reverse(),
            hasMore: totalMessages > skip + limit,
            total: totalMessages,
            currentPage: page,
          });
        } catch (error) {
          console.error("Get message history error:", error);
        }
      }
    );

    socket.on(
      "directMessage",
      async ({ chatId, content }: { chatId: string; content: any }) => {
        try {
          const { ChatUser, Chat, Message } = await getTenantModels(socket.data.tenantId as string);
          const user: any = await ChatUser.findOne({ socketIds: socket.id });
          const chat: any = await Chat.findById(chatId)
            .populate<{ participants: any[] }>(
              "participants",
              "socketIds active status"
            )
            .lean();

          if (chat) {
            chat.participants = await getUsersDetailsByToken(chat.participants.map((p: any) => p._id.toString()), socket.data.tenantId as string, socket.data.token);
          }

          if (user && chat) {
            // Join the socket to the chat room if not already joined
            const chatIdStr = chat._id.toString();
            if (!socket.rooms.has(chatIdStr)) {
              socket.join(chatIdStr);
            }

            const message = await Message.create({
              tenantId: socket.data.tenantId as string,
              body: content.body,
              senderId: user._id,
              chatId: new Types.ObjectId(chatId),
              type: content.type,
              attachments: content.attachments,
              replyTo: content.replyTo
                ? new Types.ObjectId(content.replyTo)
                : undefined,
            });

            chat.lastMessage = message._id;
            await chat.save();

            const populatedMessage: any = await Message.findById(message._id)
              .populate("senderId", "status active")
              .populate("replyTo")
              .lean();

            if (populatedMessage) {
              if (populatedMessage.senderId) {
                populatedMessage.senderId = await getUserDetailsByToken(populatedMessage.senderId._id.toString(), socket.data.tenantId as string, socket.data.token);
              }
              if (populatedMessage.replyTo?.senderId) {
                populatedMessage.replyTo.senderId =
                  await getUserDetailsByToken(populatedMessage.replyTo.senderId._id.toString(), socket.data.tenantId as string, socket.data.token);
              }

              const otherParticipants = chat.participants.filter(
                (p: any) => p._id.toString() !== user._id.toString()
              );

              // Send message to all participants
              chat.participants.forEach((p: any) => {
                if (p.socketIds && p.socketIds.length > 0) {
                  p.socketIds.forEach((socketId: string) => {
                    io.to(socketId).emit("messageSent", {
                      message: populatedMessage,
                      chatId: chatId,
                    });
                  });
                }
              });

              // For each recipient, check if they are in the chat and mark as read
              for (const participant of otherParticipants) {
                // Get all sockets for this participant
                const participantSockets = Array.from(
                  io.sockets.sockets.values()
                ).filter((s: any) => participant.socketIds.includes(s.id));

                // Check if any of the participant's sockets are in this chat room
                const chatIdStr = chatId.toString();
                const isParticipantInChat = participantSockets.some((s: any) =>
                  s.rooms.has(chatIdStr)
                );

                if (isParticipantInChat) {
                  // If participant is in chat, mark message as read immediately
                  const userIdObj = new Types.ObjectId(participant._id);

                  // Only add to viewers if not already there
                  if (!message.viewers.some((viewer: any) => viewer.toString() === userIdObj.toString())) {
                    message.viewers.push(userIdObj);
                  }

                  // Get user details for the reader
                  const userDetails = await getUserDetailsByToken(userIdObj.toString(), socket.data.tenantId as string, socket.data.token);
                  if (!userDetails) {
                    continue;
                  }



                  // Emit read status to all participants
                  chat.participants.forEach((p: any) => {
                    if (p.socketIds && p.socketIds.length > 0) {
                      p.socketIds.forEach((socketId: string) => {
                        io.to(socketId).emit("messageRead", {
                          messageId: (message._id as any).toString(),
                          chatId,
                          userId: userIdObj.toString(),
                          readAt: new Date(),
                          user: {
                            _id: userDetails._id,
                            displayName: userDetails.firstname + " " + userDetails.lastname,
                            profile_image: userDetails.profile_image || "",
                          },
                        });
                      });
                    }
                  });
                }

                // Update unread count for this participant
                await emitUnreadCountUpdate(chatId, participant._id.toString(), socket.data.tenantId);
              }

              // Save the message with updated viewers
              await message.save();
            }
          }
        } catch (error) {
          console.error("Direct message error:", error);
        }
      }
    );

    socket.on(
      "message",
      async ({ content, roomId }: { content: string; roomId: string }) => {
        try {
          const { ChatUser, Message } = await getTenantModels(socket.data.tenantId as string);
          const user = await ChatUser.findOne({ socketIds: socket.id });
          if (user) {
            const message = await Message.create({
              content,
              userId: user._id,
              roomId: new Types.ObjectId(roomId),
              type: "room",
              tenantId: socket.data.tenantId
            });

            const populatedMessage: any = await Message.findById(message._id)
              .populate("userId", "status active")
              .lean();

            if (populatedMessage) {
              if (populatedMessage.userId) {
                populatedMessage.userId = await getUserDetailsByToken(populatedMessage.userId._id.toString(), socket.data.tenantId as string, socket.data.token);
              }
              io.to(roomId).emit("message", populatedMessage);
            }
          }
        } catch (error) {
          console.error("Message error:", error);
        }
      }
    );

    socket.on(
      "addReaction",
      async ({
        messageId,
        chatId,
        emoji,
      }: {
        messageId: string;
        chatId: string;
        emoji: string;
      }) => {
        try {
          const { ChatUser, Message } = await getTenantModels(socket.data.tenantId as string);
          const user = await ChatUser.findOne({ socketIds: socket.id }).lean() as any;
          if (!user || !user._id) {
            console.error("User not found");
            return;
          }

          const message = await Message.findById(messageId);
          if (!message) {
            console.error("Message not found");
            return;
          }

          message.reactions = message.reactions.filter(
            (r: any) => r.userId.toString() !== user._id.toString()
          );

          if (emoji) {
            message.reactions.push({
              userId: Types.ObjectId.createFromHexString(user._id.toString()),
              emoji,
            });
          }

          await message.save();

          const { Chat } = await getTenantModels(socket.data.tenantId as string);
          const chat = await Chat.findById(chatId).populate<{
            participants: any[];
          }>("participants", "socketIds");

          if (chat) {
            const userDetails = await getUserDetailsByToken(user._id.toString(), socket.data.tenantId as string, socket.data.token);
            if (!userDetails) return;

            chat.participants.forEach((participant: any) => {
              if (participant.socketIds && participant.socketIds.length > 0) {
                participant.socketIds.forEach((socketId: string) => {
                  io.to(socketId).emit("messageReaction", {
                    messageId,
                    chatId,
                    reaction: emoji
                      ? {
                        userId: user._id.toString(),
                        emoji,
                        user: {
                          _id: userDetails._id,
                          displayName: userDetails.firstname + " " + userDetails.lastname,
                          profile_image: userDetails.profile_image || "",
                        },
                      }
                      : null,
                    userId: user._id.toString(),
                  });
                });
              }
            });
          }
        } catch (error) {
          console.error("Add reaction error:", error);
        }
      }
    );

    socket.on(
      'markMessageAsRead' as keyof ClientToServerEvents,
      async ({ chatId, messageId, userId }: { chatId: string; messageId: string; userId: string }) => {
        try {
          const { Message, Chat, ChatUser } = await getTenantModels(socket.data.tenantId as string);
          const message = await Message.findById(messageId);
          if (!message) return;

          const userIdObj = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;

          const uniqueViewers = new Set(message.viewers.map((viewer: any) => viewer.toString()));

          const chat = await Chat.findById(chatId).populate<{ participants: any[] }>('participants', 'socketIds');
          if (chat) {
            const userDetails = await getUserDetailsByToken(userIdObj.toString(), socket.data.tenantId as string, socket.data.token);
            if (userDetails) {
              chat.participants.forEach(async (participant: any) => {
                const participantUser: any = await ChatUser.findById(participant._id);
                if (participantUser?.socketIds && participantUser.socketIds.length > 0) {
                  participantUser.socketIds.forEach((socketId: string) => {
                    io.to(socketId).emit('messageRead', {
                      messageId,
                      chatId,
                      userId: userIdObj.toString(),
                      readAt: new Date(),
                      user: {
                        _id: userDetails._id,
                        displayName: userDetails.firstname + " " + userDetails.lastname,
                        profile_image: userDetails.profile_image || "",
                      },
                    });
                  });
                }
              });
            }
          }

          // Only update the database if user is not already in viewers
          if (!uniqueViewers.has(userIdObj.toString())) {
            uniqueViewers.add(userIdObj.toString());
            message.viewers = Array.from(uniqueViewers).map((id: any) => new Types.ObjectId(id));
            await message.save();

            // Update unread count for all participants
            if (chat) {
              for (const participant of chat.participants) {
                const unreadCount = await getUnreadCount(chatId, participant._id.toString(), socket.data.tenantId as string);
                const participantUser: any = await ChatUser.findById(participant._id);
                if (participantUser?.socketIds && participantUser.socketIds.length > 0) {
                  participantUser.socketIds.forEach((socketId: string) => {
                    io.to(socketId).emit('unreadCountUpdate', {
                      chatId,
                      count: unreadCount,
                    });
                  });
                }
              }
            }
          }
        } catch (error) {
          console.error('Error marking message as read:', error);
        }
      }
    );

    socket.on(
      "markAllMessagesAsRead" as keyof ClientToServerEvents,
      async ({ chatId, userId }: { chatId: string; userId: string }) => {
        try {
          const { Message, Chat, ChatUser } = await getTenantModels(socket.data.tenantId as string);
          // Update all messages in the chat to mark them as read for this user
          await Message.updateMany(
            {
              chatId,
              senderId: { $ne: userId },
              viewers: { $ne: userId },
            },
            {
              $addToSet: { viewers: userId },
            }
          );

          // Emit unread count update to all participants
          const chat = await Chat.findById(chatId).populate(
            "participants",
            "socketIds"
          );
          if (chat) {
            for (const participant of chat.participants) {
              if (participant._id.toString() !== userId) {
                const unreadCount = await getUnreadCount(
                  chatId,
                  participant._id.toString(),
                  socket.data.tenantId as string
                );
                const participantUser: any = await ChatUser.findById(participant._id);
                if (participantUser?.socketIds && participantUser.socketIds.length > 0) {
                  participantUser.socketIds.forEach((socketId: string) => {
                    io.to(socketId).emit("unreadCountUpdate", {
                      chatId,
                      count: unreadCount,
                    });
                  });
                }
              }
            }
          }
        } catch (error) {
          console.error("Error marking all messages as read:", error);
        }
      }
    );

    socket.on(
      "updateUnreadCount" as keyof ClientToServerEvents,
      async ({ chatId, userId }: { chatId: string; userId: string }) => {
        try {
          await emitUnreadCountUpdate(chatId, userId, socket.data.tenantId as string);
        } catch (error) {
          console.error("Update unread count error:", error);
        }
      }
    );

    socket.on(
      "deleteMessage",
      async ({
        messageId,
        chatId,
        userId,
        mode = "forMe",
      }: {
        messageId: string;
        chatId: string;
        userId: string;
        mode?: "forMe" | "forEveryone";
      }) => {
        try {
          const { Message, Chat, ChatUser } = await getTenantModels(socket.data.tenantId as string);
          const message = await Message.findOne({ _id: messageId, chatId, tenantId: socket.data.tenantId as string });
          if (!message) {
            console.error("Message not found");
            return;
          }

          if (
            mode === "forEveryone" &&
            message.senderId.toString() !== userId
          ) {
            console.error("Not authorized to delete this message for everyone");
            return;
          }

          if (mode === "forEveryone") {
            await Message.findByIdAndDelete(messageId);

            const chat: any = await Chat.findById(chatId).populate(
              "participants"
            );
            if (!chat) return;

            for (const participant of chat.participants) {
              const participantId = participant._id.toString();
              const participantUser: any = await ChatUser.findById(participantId);

              if (participantUser?.socketIds) {
                const lastVisibleMessage = await Message.findOne({
                  chatId,
                  _id: { $ne: messageId },
                  $or: [
                    { deletedFor: { $exists: false } },
                    { deletedFor: { $size: 0 } },
                    {
                      deletedFor: {
                        $not: {
                          $elemMatch: {
                            userId: new Types.ObjectId(participantId),
                          },
                        },
                      },
                    },
                  ],
                })
                  .sort({ createdAt: -1 })
                  .select("body createdAt")
                  .lean();

                participantUser.socketIds.forEach((socketId: string) => {
                  io.to(socketId).emit("messageDeleted", {
                    chatId,
                    messageId,
                    lastMessage: lastVisibleMessage,
                    mode: "forEveryone",
                  });
                });
              }
            }
          } else {
            if (!message.deletedFor) {
              message.deletedFor = [];
            }

            const existingDelete = message.deletedFor.find(
              (d: any) => d.userId.toString() === userId
            );

            if (existingDelete) {
              existingDelete.deletedAt = new Date();
            } else {
              message.deletedFor.push({
                userId: new Types.ObjectId(userId),
                deletedAt: new Date(),
              });
            }

            await message.save();

            const lastVisibleMessage = await Message.findOne({
              chatId,
              $or: [
                { deletedFor: { $exists: false } },
                { deletedFor: { $size: 0 } },
                {
                  deletedFor: {
                    $not: {
                      $elemMatch: { userId: new Types.ObjectId(userId) },
                    },
                  },
                },
              ],
            })
              .sort({ createdAt: -1 })
              .select("body createdAt")
              .lean() as any;

            if (message.senderId.toString() === userId && lastVisibleMessage) {
              await Chat.findByIdAndUpdate(chatId, {
                lastMessage: lastVisibleMessage._id,
              });
            }

            const user: any = await ChatUser.findById(userId);
            if (user?.socketIds) {
              user.socketIds.forEach((socketId: string) => {
                io.to(socketId).emit("messageDeleted", {
                  chatId,
                  messageId,
                  lastMessage: lastVisibleMessage,
                  mode: "forMe",
                });
              });
            }
          }
        } catch (error) {
          console.error("Error deleting message:", error);
        }
      }
    );

    socket.on("disconnect", async () => {
      try {
        const { ChatUser } = await getTenantModels(socket.data.tenantId as string);
        const user: any = await ChatUser.findOne({
          socketIds: { $in: [socket.id] },
        });
        if (user) {
          user.socketIds = user.socketIds.filter(
            (id: string) => id !== socket.id
          );
          user.active = user.socketIds.length > 0;
          if (user.socketIds.length === 0) {
            user.socketIds = [];
          }
          await user.save();

          io.emit("participantStatusUpdate", {
            participantId: user._id,
            status: user.status,
            active: user.active,
          });


        }
      } catch (error) {
        console.error("Disconnect error:", error);
      }
    });

    socket.on(
      "updateStatus",
      async ({ status, userId }: { status: string; userId: string }) => {
        try {
          const { ChatUser } = await getTenantModels(socket.data.tenantId as string);
          const user = await ChatUser.findByIdAndUpdate(
            userId,
            { status },
            { new: true }
          );

          if (user) {
            io.emit("participantStatusUpdate", {
              participantId: user._id,
              status: status,
              active: user.active,
            });
          }
        } catch (error) {
          console.error("Update status error:", error);
        }
      }
    );
  });
};
export { io };
