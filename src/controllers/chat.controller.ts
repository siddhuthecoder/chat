import { Request, Response } from "express";
import { Types } from "mongoose";
import { io } from "../socket/socketManager";
import jsPDF from "jspdf";
import { AuthenticatedRequest } from "../types/iamInterfaces";
import { getUserDetails } from "../services/iamService";
import sendPushNotification from "../utils/pushService";
import { getTenantModels } from "../config/db";


const populateParticipantsWithDetails = async (participants: any[], tenantId: string) => {
  try {
    if (!participants || !Array.isArray(participants) || participants.length === 0) {

      return [];
    }

    // Use individual getUserDetails calls in a loop with better error handling
    const mergedParticipants = await Promise.all(
      participants.map(async (participant: any, index: number) => {
        try {
          const userDetails = await getUserDetails(participant._id.toString(), tenantId);

          if (userDetails) {
            const merged = {
              ...participant,
              ...userDetails,
            };



            return merged;
          }


          return participant;
        } catch (error) {
          console.error(`🔍 [populateParticipantsWithDetails] Error fetching details for participant ${participant._id}:`, error);
          return participant;
        }
      })
    );



    return mergedParticipants;
  } catch (error) {
    console.error("🔍 [populateParticipantsWithDetails] Error populating participants with details:", error);
    return participants;
  }
};

export const getUsers = async (req: AuthenticatedRequest, res: Response) => {

  try {
    const { tenantId } = req;

    const { ChatUser } = await getTenantModels(req.tenantId!);


    const users = await ChatUser.find().lean();



    const populatedUsers = await Promise.all(
      users.map(async (user: any, index: number) => {
        try {

          const userDetails = await getUserDetails(user._id.toString(), tenantId as string);


          if (userDetails) {
            const merged = {
              ...user,
              ...userDetails
            };

            return merged;
          }

          return user;
        } catch (error) {
          console.error(`Error fetching details for user ${user._id}:`, error);
          return user;
        }
      })
    );



    res.json({ contacts: populatedUsers });
  } catch (error) {
    console.error("Error in getUsers:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const getUserChats = async (req: AuthenticatedRequest, res: Response) => {

  try {
    const { userId } = req.params;
    const { tenantId } = req;


    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const { tab = "", search = "" } = req.query as {
      tab?: string;
      search?: string;
    };

    if (!Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: "Invalid user ID" });
    }



    const { Chat, Message } = await getTenantModels(tenantId as string);

    const allChatsForCount = await Chat.find({
      participants: userId,
      tenantId
    })
      .populate("participants")
      .lean();

    const unreadCounts = {
      all: 0,
      group: 0,
      team: 0,
      direct: 0,
    };

    const chatsWithUnread = new Set();

    await Promise.all(
      allChatsForCount.map(async (chat: any) => {
        const hasUnreadMessages = await Message.exists({
          chatId: chat._id,
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

        if (hasUnreadMessages) {
          chatsWithUnread.add(chat._id.toString());
          unreadCounts.all += 1;

          switch (chat.chatType) {
            case "Group":
              unreadCounts.group += 1;
              break;
            case "Team":
              unreadCounts.team += 1;
              break;
            case "Direct":
              unreadCounts.direct += 1;
              break;
          }
        }
      })
    );

    const query: any = {
      participants: userId,
      tenantId
    };

    if (tab) {
      query.chatType = tab;
    }

    if (search) {
      const userDetails = await getUserDetails(userId, tenantId as string);
      if (userDetails && userDetails._id) {
        query.$or = [
          { name: { $regex: search, $options: "i" } },
          { participants: { $in: [userDetails._id] } }
        ];
      }
    }

    const allChats = await Chat.find(query)
      .populate("participants", "status active socketIds")
      .populate("lastMessage")
      .lean();

    const filteredChats = await Promise.all(
      allChats.map(async (chat: any, chatIndex: number) => {




        chat.participants = await populateParticipantsWithDetails(
          chat.participants,
          tenantId as string
        );



        const unreadMessageCount = await Message.countDocuments({
          chatId: chat._id,
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

        chat.unreadCount = unreadMessageCount;

        const lastVisibleMessage: any = await Message.findOne({
          chatId: chat._id,
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
        })
          .sort({ createdAt: -1 })
          .populate("senderId")
          .lean();

        if (lastVisibleMessage?.senderId) {
          lastVisibleMessage.senderId = await getUserDetails(
            lastVisibleMessage.senderId._id.toString(),
            tenantId as string
          );
        }
        chat.lastMessage = lastVisibleMessage || null;

        return chat;
      })
    );

    const visibleChats = filteredChats.filter((chat: any) => {
      const deletedEntry = chat.deletedFor.find(
        (d: any) => d.userId.toString() === userId
      );

      if (!deletedEntry || !chat.lastMessage) {
        return true;
      }

      const deletedTime = new Date(deletedEntry.lastMessageTime).getTime();
      const lastMessageTime = new Date(chat.lastMessage.createdAt).getTime();

      return lastMessageTime > deletedTime;
    });

    visibleChats.sort((a: any, b: any) => {
      const dateA = a.lastMessage?.createdAt
        ? new Date(a.lastMessage.createdAt).getTime()
        : 0;
      const dateB = b.lastMessage?.createdAt
        ? new Date(b.lastMessage.createdAt).getTime()
        : 0;
      return dateB - dateA;
    });

    const totalChats = visibleChats.length;
    const skip = (page - 1) * limit;
    const paginatedChats = visibleChats.slice(skip, skip + limit);

    res.json({
      conversations: paginatedChats,
      pagination: {
        total: totalChats,
        page,
        limit,
        totalPages: Math.ceil(totalChats / limit),
        hasMore: skip + limit < totalChats,
      },
      unreadCounts,
    });
  } catch (error) {
    console.error("Error fetching chats:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const getChatMessages = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { chatId, userId } = req.params;

    const page = parseInt(req.query.page as string) || 1;
    const limit = 20;
    const skip = (page - 1) * limit;

    if (!Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: "Invalid userId" });
    }

    const { Chat, Message } = await getTenantModels(req.tenantId as string);

    const chat: any = await Chat.findOne({
      _id: chatId,
      tenantId: req.tenantId
    })
      .populate("participants", "status active")
      .lean();

    if (!chat) {
      return res.status(404).json({ error: "Chat not found" });
    }

    chat.participants = await populateParticipantsWithDetails(
      chat.participants,
      req.tenantId as string
    );

    const userObjectId = new Types.ObjectId(userId);
    if (!chat.participants.some((p: any) => p._id.toString() === userObjectId.toString())) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const deletedEntry = chat?.deletedFor?.find((d: any) =>
      d.userId.equals(userObjectId)
    );

    let query: any = {
      chatId,
      tenantId: req.tenantId
    };
    if (deletedEntry) {
      query = {
        ...query,
        createdAt: { $gt: deletedEntry.lastMessageTime },
      };
    }

    query = {
      ...query,
      $or: [
        { deletedFor: { $exists: false } },
        { deletedFor: { $size: 0 } },
        { deletedFor: { $not: { $elemMatch: { userId: userObjectId } } } },
      ],
    };

    const totalMessages = await Message.countDocuments(query);

    const messages = await Message.find(query)
      .populate("senderId", "status active")
      .populate("reactions.userId", "status active")
      .populate("replyTo", "body attachments senderId")
      .populate({
        path: "replyTo",
        populate: {
          path: "senderId",
          select: "status active",
        },
      })
      .populate("chatId", "chatType")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const populatedMessages = await Promise.all(
      messages.map(async (message: any) => {
        if (message.senderId) {
          message.senderId = await getUserDetails(
            message.senderId._id.toString(),
            req.tenantId as string
          );
        }
        if (message.reactions?.length) {
          message.reactions = await Promise.all(
            message.reactions.map(async (reaction: any) => {
              if (reaction.userId) {
                reaction.userId = await getUserDetails(
                  reaction.userId._id.toString(),
                  req.tenantId as string
                );
              }
              return reaction;
            })
          );
        }
        if (message.replyTo?.senderId) {
          message.replyTo.senderId = await getUserDetails(
            message.replyTo.senderId._id.toString(),
            req.tenantId as string
          );
        }
        return message;
      })
    );

    res.json({
      messages: populatedMessages.reverse(),
      participants: chat.participants || [],
      hasMore: totalMessages > skip + limit,
      total: totalMessages,
      currentPage: page,
      name: chat.name || "",
      type: chat.chatType || "Direct",
    });
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const createChat = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId, contact, message } = req.body;

    if (!userId || !contact?._id || !message) {
      return res
        .status(400)
        .json({ error: "User ID, contact ID, and message are required" });
    }

    const { Chat, Message, ChatUser } = await getTenantModels(req.tenantId as string);

    let contactUser = await ChatUser.findById(contact._id);
    if (!contactUser) {
      contactUser = await ChatUser.create({
        _id: contact._id,
        tenantId: req.tenantId as string
      });
    }

    let chat: any = await Chat.findOne({
      participants: { $all: [userId, contactUser._id], $size: 2 },
      chatType: "Direct",
      tenantId: req.tenantId
    });

    if (!chat) {
      chat = await Chat.create({
        participants: [userId, contactUser._id],
        lastMessage: null,
        chatType: "Direct",
        tenantId: req.tenantId
      });
    }

    const newMessage: any = await Message.create({
      chatId: chat._id,
      senderId: userId,
      body: String(message.body || ""),
      type: message.type || "text",
      attachments: message.attachments || [],
      tenantId: req.tenantId
    });

    chat.lastMessage = newMessage._id;
    await chat.save();

    const populatedChat: any = await Chat.findById(chat._id)
      .populate<{ participants: any }>(
        "participants",
        "socketIds active status"
      )
      .lean();




    if (populatedChat && populatedChat.participants) {
      populatedChat.participants = await populateParticipantsWithDetails(
        populatedChat.participants,
        req.tenantId as string
      );
    }



    const populatedMessage: any = await Message.findById(newMessage._id)
      .populate("senderId", "status active")
      .populate("reactions.userId", "status active")
      .populate("replyTo")
      .lean();

    if (populatedMessage) {
      if (populatedMessage.senderId) {
        populatedMessage.senderId = await getUserDetails(
          populatedMessage.senderId._id.toString(),
          req.tenantId as string
        );
      }
      if (populatedMessage.reactions?.length) {
        populatedMessage.reactions = await Promise.all(
          populatedMessage.reactions.map(async (reaction: any) => {
            if (reaction.userId) {
              reaction.userId = await getUserDetails(
                reaction.userId._id.toString(),
                req.tenantId as string
              );
            }
            return reaction;
          })
        );
      }
    }

    const otherParticipants = populatedChat.participants.filter(
      (p: any) =>
        p._id.toString() !== userId.toString() &&
        p.socketIds &&
        p.socketIds.length > 0
    );

    otherParticipants.forEach((participant: any) => {
      if (participant.socketIds && participant.socketIds.length > 0) {
        participant.socketIds.forEach((socketId: string) => {
          io.to(socketId).emit("messageSent", {
            message: populatedMessage,
            chatId: chat._id,
          });
        });
      }
    });


    return res.status(200).json({ chat: populatedChat });
  } catch (error) {
    console.error("Error creating chat:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const createMultipleChat = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId, recipients, message, name } = req.body;

    if (!userId || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: "Invalid user or recipients" });
    }
    if (!message || (!message.body && !message.attachments?.length)) {
      return res
        .status(400)
        .json({ error: "Message body or attachments required" });
    }

    const { Chat, Message, ChatUser } = await getTenantModels(req.tenantId as string);

    const user = await ChatUser.findById(userId);

    const recipientIds = await Promise.all(
      recipients.map(async (recipient: any) => {
        let contactUser = await ChatUser.findById(recipient._id);
        if (!contactUser) {
          contactUser = await ChatUser.create({ _id: recipient._id });
        }
        return contactUser._id;
      })
    );

    const participants = [userId, ...recipientIds];
    const isDirect = recipients.length === 1;
    const chatType = isDirect ? "Direct" : "Group";

    let chat: any = await Chat.findOne({
      participants: { $all: participants, $size: participants.length },
      chatType,
      tenantId: req.tenantId
    });

    if (!chat) {
      chat = await Chat.create({
        participants,
        lastMessage: null,
        isGroup: !isDirect,
        chatType,
        name: name && name.trim() !== "" ? name.trim() : undefined,
        tenantId: req.tenantId
      });
    }

    const newMessage = await Message.create({
      chatId: chat._id,
      senderId: userId,
      body: message.body || "",
      type: message.type || "text",
      attachments: message.attachments || [],
      tenantId: req.tenantId
    });

    chat.lastMessage = newMessage._id;
    await chat.save();

    const populatedChat: any = await Chat.findById(chat._id)
      .populate<{ participants: any }>(
        "participants",
        "socketIds active status"
      )
      .lean();

    populatedChat.participants = await populateParticipantsWithDetails(
      populatedChat.participants,
      req.tenantId as string
    );

    const populatedMessage: any = await Message.findById(newMessage._id)
      .populate("senderId", "status active")
      .populate("reactions.userId", "status active")
      .populate("replyTo")
      .lean();

    if (populatedMessage) {
      if (populatedMessage.senderId) {
        populatedMessage.senderId = await getUserDetails(
          populatedMessage.senderId._id.toString(),
          req.tenantId as string
        );
      }
      if (populatedMessage.reactions?.length) {
        populatedMessage.reactions = await Promise.all(
          populatedMessage.reactions.map(async (reaction: any) => {
            if (reaction.userId) {
              reaction.userId = await getUserDetails(
                reaction.userId._id.toString(),
                req.tenantId as string
              );
            }
            return reaction;
          })
        );
      }
    }

    const otherParticipants = populatedChat.participants.filter(
      (p: any) =>
        p._id.toString() !== userId.toString() &&
        p.socketIds &&
        p.socketIds.length > 0
    );

    otherParticipants.forEach((participant: any) => {
      if (participant.socketIds && participant.socketIds.length > 0) {
        participant.socketIds.forEach((socketId: string) => {
          io.to(socketId).emit("messageSent", {
            message: populatedMessage,
            chatId: chat._id,
          });
        });
      }
    });

    return res.status(200).json({ chat: populatedChat, chatId: chat._id.toString() });
  } catch (error) {
    console.error("Error creating group chat:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const createTeamChat = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId, recipients, message } = req.body;

    const { name } = req.body;

    if (!userId || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: "Invalid user or recipients" });
    }

    const { Chat, Message, ChatUser } = await getTenantModels(req.tenantId as string);

    const user = await ChatUser.findById(userId);


    const recipientIds = await Promise.all(
      recipients.map(async (recipient: any) => {
        let contactUser = await ChatUser.findById(recipient._id);
        if (!contactUser) {
          contactUser = await ChatUser.create({ _id: recipient._id });
        }
        return contactUser._id;
      })
    );

    const participants = [userId, ...recipientIds];

    let chat = await Chat.findOne({
      participants: { $all: participants, $size: participants.length },
      name,
      tenantId: req.tenantId
    });

    if (!chat) {
      chat = await Chat.create({
        name,
        participants,
        lastMessage: null,
        isGroup: true,
        chatType: "Team",
        tenantId: req.tenantId
      });

      const newMessage = await Message.create({
        chatId: chat._id,
        senderId: userId,
        body: String(req.body.message.body || ''),
        type: req.body.message.type || 'text',
        attachments: req.body.message.attachments || [],
        tenantId: req.tenantId
      });
      await Chat.findByIdAndUpdate(chat._id, { lastMessage: newMessage._id });

      const populatedMessage: any = await Message.findById(newMessage._id)
        .populate("senderId", "status active")
        .lean();

      if (populatedMessage?.senderId) {
        populatedMessage.senderId = await getUserDetails(populatedMessage.senderId._id.toString(), req.tenantId as string);
      }

      const populatedChat: any = await Chat.findById(chat._id)
        .populate<{ participants: any }>(
          "participants",
          "socketIds active status"
        )
        .lean();

      populatedChat.participants = await populateParticipantsWithDetails(
        populatedChat.participants,
        req.tenantId as string
      );

      const onlineParticipants = populatedChat.participants.filter(
        (p: any) => p.socketIds && p.socketIds.length > 0
      );

      onlineParticipants.forEach((participant: any) => {
        if (participant.socketIds && participant.socketIds.length > 0) {
          participant.socketIds.forEach((socketId: string) => {
            io.to(socketId).emit("messageSent", {
              message: populatedMessage,
              chatId: populatedChat._id,
            });
          });
        }
      });

      return res.status(200).json({ chat: populatedChat });
    }

    const populatedChat: any = await Chat.findById(chat._id)
      .populate<{ participants: any }>(
        "participants",
        "socketIds active status"
      )
      .lean();

    populatedChat.participants = await populateParticipantsWithDetails(
      populatedChat.participants,
      req.tenantId as string
    );



    return res.status(200).json({ chat: populatedChat });
  } catch (error) {
    console.error("Error creating team chat:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const deleteChat = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { chatId, userId } = req.params;
    const bodyUserId = req.body.userId;
    const finalUserId = userId || bodyUserId;

    const { Chat } = await getTenantModels(req.tenantId as string);

    const chat: any = await Chat.findOne({
      _id: chatId,
      tenantId: req.tenantId
    }).populate("lastMessage");

    if (!chat) {
      return res.status(404).json({ error: "Chat not found" });
    }

    if (!chat.participants.some((p: any) => p.toString() === finalUserId)) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const lastMessageTime = chat.lastMessage
      ? chat.lastMessage.createdAt
      : new Date();

    const existingDelete = chat.deletedFor.find(
      (d: any) => d.userId.toString() === finalUserId.toString()
    );

    if (existingDelete) {
      existingDelete.lastMessageTime = lastMessageTime;
    } else {
      chat.deletedFor.push({
        userId: finalUserId,
        lastMessageTime,
      });
    }

    await chat.save();

    return res.status(200).json({ message: "Chat deleted successfully" });
  } catch (error) {
    console.error("Error deleting chat:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const editMessage = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { chatId, messageId } = req.params;
    const { content, attachments } = req.body;

    const { Message, Chat } = await getTenantModels(req.tenantId as string);

    const message = await Message.findOne({
      _id: messageId,
      tenantId: req.tenantId
    });

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    if (message.chatId.toString() !== chatId) {
      return res
        .status(403)
        .json({ error: "Message does not belong to this chat" });
    }

    message.body = String(content || '');
    message.attachments = attachments || [];
    message.isEdited = true;
    await message.save();

    const chat: any = await Chat.findOne({
      _id: chatId,
      tenantId: req.tenantId
    })
      .populate("lastMessage")
      .populate("participants", "socketIds");

    const lastMessage = chat?.lastMessage;

    if (chat) {
      for (const participant of chat.participants) {
        if (participant.socketIds && participant.socketIds.length > 0) {
          participant.socketIds.forEach((socketId: string) => {
            io.to(socketId).emit("messageEdited", {
              chatId,
              messageId,
              content: message.body,
              attachments: message.attachments,
              lastMessage
            });
          });
        }
      }
    }

    return res.status(200).json({ message: "Message edited successfully" });
  } catch (error) {
    console.error("Error editing message:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const exportChat = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { conversationId, userId, timezone } = req.body;

    if (!conversationId || !userId) {
      return res
        .status(400)
        .json({ error: "Missing conversationId or userId" });
    }

    const { Message } = await getTenantModels(req.tenantId as string);

    const messages = await Message.find({
      chatId: conversationId,
      tenantId: req.tenantId
    })
      .sort({ createdAt: 1 })
      .populate("senderId", "status active")
      .lean();

    const populatedMessages = await Promise.all(
      messages.map(async (message: any) => {
        if (message.senderId) {
          message.senderId = await getUserDetails(message.senderId._id.toString(), req.tenantId as string);
        }
        return message;
      })
    );

    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

    if (!messages || messages.length === 0) {
      doc.setFontSize(16);
      doc.text(`Chat Export - Conversation ${conversationId}`, 105, 20, {
        align: "center",
      });
      doc.setFontSize(12);
      doc.text("No messages found for this conversation", 10, 40);
      doc.text("Page 1", 105, 287, { align: "center" });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=chat-${conversationId}.pdf"
      );
      const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
      return res.send(pdfBuffer);
    }

    const leftMargin = 10;
    const rightMargin = 200;
    const maxWidth = 190;
    const lineHeight = 6;
    let yPosition = 20;
    let pageNumber = 1;

    const styles = {
      header: { fontSize: 14, align: "center" },
      messageHeader: { fontSize: 9, color: "#666666" },
      messageBody: { fontSize: 10 },
      attachment: { fontSize: 9, color: "#0066cc" },
      edited: { fontSize: 8, color: "#999999", fontStyle: "italic" },
    };

    doc.setFontSize(styles.header.fontSize);
    doc.text(`Chat Export - Conversation ${conversationId}`, 105, yPosition, {
      align: "center",
    });
    yPosition += 12;

    populatedMessages.forEach((message: any) => {
      const senderName = message.senderId
        ? message.senderId.displayName
        : "Unknown";
      const timestamp = message.createdAt
        ? new Date(message.createdAt).toLocaleString("en-IN", {
          timeZone: timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        })
        : "Unknown Time";

      if (yPosition > 260) {
        doc.setFontSize(9);
        doc.text(`Page ${pageNumber}`, 105, 287, { align: "center" });
        doc.addPage();
        yPosition = 20;
        pageNumber++;
      }

      const isUserMessage =
        message.senderId &&
        message.senderId._id.toString() === userId.toString();
      const xPosition = isUserMessage ? rightMargin - 30 : leftMargin + 30;
      const align = isUserMessage ? "right" : "left";

      doc.setFontSize(styles.messageHeader.fontSize);
      doc.setTextColor(102, 102, 102);
      const headerText = `${senderName} • ${timestamp}`;
      doc.text(headerText, xPosition, yPosition, { align });
      yPosition += 6;

      if (message.type !== "text") {
        const typeIcon =
          {
            image: "image",
            file: "file",
            recording: "audio",
            system: "System",
          }[message.type as "image" | "file" | "recording" | "system"] ||
          "Regular";

        doc.setFontSize(styles.messageBody.fontSize);
        doc.setTextColor(0, 0, 0);
        doc.text(typeIcon, xPosition, yPosition, { align });
        yPosition += 6;
      }

      if (message.body) {
        doc.setFontSize(styles.messageBody.fontSize);
        doc.setTextColor(0, 0, 0);
        const bodyLines = doc.splitTextToSize(message.body, maxWidth - 60);
        doc.text(bodyLines, xPosition, yPosition, { align });
        yPosition += bodyLines.length * lineHeight;
      }

      if (message.attachments && message.attachments.length > 0) {
        message.attachments.forEach((attachment: any) => {
          doc.setFontSize(styles.attachment.fontSize);
          doc.setTextColor(0, 102, 204);
          const attachmentText = `${attachment.name} (${attachment.type}) - ${process.env.FD_CDN_URL}/${attachment.url}`;
          const attachmentLines = doc.splitTextToSize(
            attachmentText,
            maxWidth - 60
          );
          doc.text(attachmentLines, xPosition, yPosition, { align });
          yPosition += attachmentLines.length * lineHeight;
        });
      }

      if (message.isEdited) {
        doc.setFontSize(styles.edited.fontSize);
        doc.setTextColor(153, 153, 153);
        doc.setFont("helvetica", "italic");
        doc.text("(edited)", xPosition, yPosition, { align });
        doc.setFont("helvetica", "normal");
        yPosition += 4;
      }

      yPosition += 8;
    });

    doc.setFontSize(9);
    doc.text(`Page ${pageNumber}`, 105, 287, { align: "center" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=chat-${conversationId}.pdf"
    );
    const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
    res.send(pdfBuffer);
  } catch (error: any) {
    console.error("Error exporting chat:", error);

    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

    doc.setFontSize(16);
    doc.text("Chat Export Error", 105, 20, { align: "center" });
    doc.setFontSize(12);
    doc.text(`Error: ${error.message || "Unknown error occurred"}`, 10, 40);
    doc.text("Page 1", 105, 287, { align: "center" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=chat-error.pdf");
    const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
    res.send(pdfBuffer);
  }
};

export const sendMessage = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { chatId, content } = req.body;
    const userId = content.senderId._id;

    const { Chat, Message, ChatUser } = await getTenantModels(req.tenantId as string);

    const chat: any = await Chat.findOne({
      _id: chatId,
      tenantId: req.tenantId
    }).populate<{
      participants: any[];
    }>("participants", "socketIds displayName active status profile_image");

    if (!chat) {
      return res.status(404).json({ error: "Chat not found" });
    }

    const message = await Message.create({
      body: String(content.body || ''),
      senderId: userId,
      chatId: new Types.ObjectId(chatId),
      type: content.type || 'text',
      attachments: content.attachments || [],
      replyTo: content.replyTo
        ? new Types.ObjectId(content.replyTo)
        : undefined,
      isRecording: content.type === "recording",
      tenantId: req.tenantId
    });

    chat.lastMessage = message._id;
    await chat.save();

    const populatedMessage: any = await Message.findById(message._id)
      .populate("senderId", "status active")
      .populate("reactions.userId", "status active")
      .populate("replyTo")
      .lean();

    if (populatedMessage) {
      if (populatedMessage.senderId) {
        populatedMessage.senderId = await getUserDetails(
          populatedMessage.senderId._id.toString(),
          req.tenantId as string
        );
      }
      if (populatedMessage.reactions?.length) {
        populatedMessage.reactions = await Promise.all(
          populatedMessage.reactions.map(async (reaction: any) => {
            if (reaction.userId) {
              reaction.userId = await getUserDetails(
                reaction.userId._id.toString(),
                req.tenantId as string
              );
            }
            return reaction;
          })
        );
      }
      if (populatedMessage.replyTo?.senderId) {
        populatedMessage.replyTo.senderId = await getUserDetails(
          populatedMessage.replyTo.senderId._id.toString(),
          req.tenantId as string
        );
      }

      const sender: any = await getUserDetails(userId, req.tenantId as string);
      const senderName = sender?.firstname && sender?.lastname
        ? `${sender.firstname} ${sender.lastname}`
        : "Someone";

      for (const participant of chat.participants) {
        if (participant._id.toString() !== userId.toString()) {
          const unreadCount = await Message.countDocuments({
            chatId: chat._id,
            senderId: { $ne: participant._id },
            viewers: { $ne: participant._id },
            $or: [
              { deletedFor: { $exists: false } },
              { deletedFor: { $size: 0 } },
              {
                deletedFor: {
                  $not: {
                    $elemMatch: {
                      userId: new Types.ObjectId(participant._id),
                    },
                  },
                },
              },
            ],
          });

          // Fetch full user details for device tokens
          const participantDetails = await getUserDetails(participant._id.toString(), req.tenantId as string);
          console.log("participant", participantDetails?.web_device_token);
          console.log("participant", participantDetails?.mobile_device_token);

          // Send push notification to the participant
          if (participantDetails?.web_device_token || participantDetails?.mobile_device_token) {
            const chatName = chat.name || (chat.chatType === "Direct" ? senderName : "Group Chat");
            const notificationTitle = `New message from ${senderName}`;
            const notificationBody = content.type === "text"
              ? content.body
              : content.type
                ? `Sent a ${content.type}`
                : "Sent a message";

            try {
              await sendPushNotification({
                title: notificationTitle,
                body: notificationBody,
                data: {
                  chatId: chat._id.toString(),
                  messageId: (message as any)._id.toString(),
                  type: "chat_message",
                  chatType: chat.chatType,
                  chatName,
                },
                deviceHandle: {
                  web_device_token: participantDetails.web_device_token || "",
                  mobile_device_token: participantDetails.mobile_device_token || "",
                },
                attachmentArray: content.attachments,
              });
            } catch (pushError) {
              console.error("Push notification failed for participant:", participant._id, pushError);
              // Continue with other operations even if push notification fails
            }
          }

          if (participant.socketIds && participant.socketIds.length > 0) {
            participant.socketIds.forEach((socketId: string) => {
              io.to(socketId).emit("unreadCountUpdate", {
                chatId: chat._id.toString(),
                count: unreadCount,
              });
            });
          }
        }

        if (participant.socketIds && participant.socketIds.length > 0) {
          participant.socketIds.forEach((socketId: string) => {
            io.to(socketId).emit("messageSent", {
              message: populatedMessage,
              chatId: chatId,
            });
          });
        }
      }
    }

    res.json({ message: populatedMessage });
  } catch (error) {
    console.error("Error sending message:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const exitChat = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { chatId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const { Chat, Message } = await getTenantModels(req.tenantId as string);

    const chat: any = await Chat.findOne({
      _id: chatId,
      tenantId: req.tenantId
    });

    if (!chat) {
      return res.status(404).json({ error: "Chat not found" });
    }

    if (chat.chatType !== "Group") {
      return res.status(400).json({ error: "Can only exit from group chats" });
    }

    chat.participants = chat.participants.filter(
      (p: any) => p.toString() !== userId.toString()
    );

    const exitMessage = await Message.create({
      chatId: chat._id,
      senderId: userId,
      body: `has left the group`,
      type: "system",
      tenantId: req.tenantId
    });

    chat.lastMessage = exitMessage._id;
    await chat.save();

    const populatedChat: any = await Chat.findById(chat._id).populate(
      "participants",
      "socketIds"
    );

    populatedChat.participants.forEach((participant: any) => {
      if (participant.socketIds && participant.socketIds.length > 0) {
        participant.socketIds.forEach((socketId: string) => {
          io.to(socketId).emit("messageSent", {
            message: exitMessage,
            chatId: chat._id,
          });
        });
      }
    });

    return res.status(200).json({ message: "Successfully exited the group" });
  } catch (error) {
    console.error("Error exiting group:", error);
    res.status(500).json({ error: "Failed to exit group" });
  }
};

export const getGroupChats = async (req: AuthenticatedRequest, res: Response) => {
  const { userId } = req.params;

  try {
    const { Chat } = await getTenantModels(req.tenantId as string);

    const chats = await Chat.find({
      chatType: "Group",
      participants: userId,
      tenantId: req.tenantId
    })
      .populate("participants", "status active")
      .lean();

    const populatedChats = await Promise.all(
      chats.map(async (chat: any) => {
        chat.participants = await populateParticipantsWithDetails(
          chat.participants,
          req.tenantId as string
        );
        return chat;
      })
    );

    res.status(200).json({ chats: populatedChats });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Server error" });
  }
};

export const createGroupChat = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, participants, userId } = req.body;

    if (!name || !Array.isArray(participants) || participants.length === 0) {
      return res
        .status(400)
        .json({ error: "Name and participants are required" });
    }
    if (!userId || !Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: "Valid userId is required" });
    }

    if (!participants.includes(userId)) {
      participants.push(userId);
    }

    const { Chat, Message, ChatUser } = await getTenantModels(req.tenantId as string);

    await Promise.all(
      participants.map(async (participantId: string) => {
        const user = await ChatUser.findById(participantId);

        if (!user) {
          await ChatUser.create({
            _id: participantId,
          });
        }
      })
    );

    const chat: any = await Chat.create({
      participants,
      name,
      chatType: "Group",
      lastMessage: null,
      tenantId: req.tenantId
    });


    const systemMessage = await Message.create({
      chatId: chat._id,
      senderId: userId,
      body: `created this group`,
      type: "system",
      tenantId: req.tenantId
    });

    chat.lastMessage = systemMessage._id;
    await chat.save();

    const populatedChat: any = await Chat.findById(chat._id)
      .populate("participants", "socketIds active status")
      .lean();

    populatedChat.participants = await populateParticipantsWithDetails(
      populatedChat.participants,
      req.tenantId as string
    );

    const populatedMessage: any = await Message.findById(systemMessage._id)
      .populate("senderId", "status active")
      .lean();

    if (populatedMessage?.senderId) {
      populatedMessage.senderId = await getUserDetails(
        populatedMessage.senderId._id.toString(),
        req.tenantId as string
      );
    }

    const participantsWithSocket = populatedChat.participants.filter(
      (p: any) => p.socketIds && p.socketIds.length > 0
    );

    participantsWithSocket.forEach((participant: any) => {
      if (participant.socketIds && participant.socketIds.length > 0) {
        participant.socketIds.forEach((socketId: string) => {
          io.to(socketId).emit("messageSent", {
            message: populatedMessage,
            chatId: chat._id,
          });
        });
      }
    });

    return res.status(200).json({ chat: populatedChat });
  } catch (error) {
    console.error("Error creating group chat:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const createDirectChat = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId, contact } = req.body;

    const { Chat, Message, ChatUser } = await getTenantModels(req.tenantId as string);

    const contactUser = await ChatUser.findById(contact._id);
    if (!contactUser) {
      await ChatUser.create({
        _id: contact._id,
      });
    }

    let chat: any;
    chat = await Chat.findOne({
      participants: { $all: [userId, contact._id], $size: 2 },
      chatType: "Direct",
      tenantId: req.tenantId
    });

    if (!chat) {
      chat = await Chat.create({
        participants: [userId, contact._id],
        lastMessage: null,
        chatType: "Direct",
        tenantId: req.tenantId
      });

      const message = await Message.create({
        chatId: chat._id,
        senderId: userId,
        body: "Started this chat",
        type: "system",
        tenantId: req.tenantId
      });

      chat.lastMessage = message._id;
      await chat.save();
    }

    const populatedChat: any = await Chat.findById(chat._id)
      .populate<{ participants: any }>(
        "participants",
        "socketIds active status"
      )
      .lean();

    populatedChat.participants = await populateParticipantsWithDetails(
      populatedChat.participants,
      req.tenantId as string
    );

    return res.status(200).json({ chat: populatedChat });
  } catch (error) {
    console.error("Error creating chat:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const createTeam = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId, name, recipients } = req.body;

    const { Chat, Message, ChatUser } = await getTenantModels(req.tenantId as string);

    let chat: any;
    chat = await Chat.findOne({
      name,
      chatType: "Team",
      tenantId: req.tenantId
    });

    if (!chat) {
      await Promise.all(
        recipients.map(async (recipient: any) => {
          const user = await ChatUser.findById(recipient._id);
          if (!user) {
            await ChatUser.create({
              _id: recipient._id,
              socketIds: [],
            });
          }
          return recipient._id;
        })
      );

      const participants = recipients.map((recipient: any) => recipient._id);

      const creator = await ChatUser.findById(userId);
      if (!creator) {
        await ChatUser.create({
          _id: userId,
        });
      }

      chat = await Chat.create({
        chatType: "Team",
        participants,
        name,
        lastMessage: null,
        tenantId: req.tenantId
      });

      const message = await Message.create({
        chatId: chat._id,
        senderId: userId,
        body: "Started this chat",
        type: "system",
        tenantId: req.tenantId
      });

      chat.lastMessage = message._id;
      await chat.save();
    }

    const populatedChat: any = await Chat.findById(chat._id)
      .populate<{ participants: any }>(
        "participants",
        "socketIds active status"
      )
      .lean();

    populatedChat.participants = await populateParticipantsWithDetails(
      populatedChat.participants,
      req.tenantId as string
    );

    return res.status(200).json({ chat: populatedChat });
  } catch (error) {
    console.error("Error creating team:", error);
    res.status(500).json({ error: "Server error" });
  }
}; 