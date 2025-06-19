import { Response } from "express";
import { Types } from "mongoose";
import { io } from "../socket/socketManager";
import { AuthenticatedRequest } from "../types/iamInterfaces";
import { getTenantModels } from "../config/db";

export const deleteMessage = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { messageId } = req.params;
    const { chatId, userId, mode = "forMe" } = req.body;
    const { tenantId } = req;
    let lastVisibleMessage: any = null;

    const { Message, Chat, ChatUser } = await getTenantModels(tenantId as string);

    const message = await Message.findOne({ _id: messageId, chatId, tenantId });

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    if (mode === "forEveryone" && message.senderId.toString() !== userId) {
      return res
        .status(403)
        .json({ error: "Not authorized to delete this message for everyone" });
    }

    if (mode === "forEveryone") {
      await Message.findByIdAndDelete(messageId);

      const chat = await Chat.findById(chatId).populate("participants");
      if (!chat) return;

      for (const participant of chat.participants) {
        const participantId = participant._id.toString();

        lastVisibleMessage = await Message.findOne({
          chatId,
          tenantId,
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

        const participantUser = await ChatUser.findById(participantId);

        if (participantUser?.socketIds?.length) {
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

      lastVisibleMessage = await Message.findOne({
        chatId,
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
        .select("body createdAt")
        .lean();

      if (message.senderId.toString() === userId && lastVisibleMessage) {
        await Chat.findByIdAndUpdate(chatId, {
          lastMessage: lastVisibleMessage._id,
        });
      }

      const user = await ChatUser.findById(userId);
      if (!user) {
        return res.status(200).json({ message: "No User Found" });
      }

      if (user.socketIds?.length) {
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

    res.status(200).json({
      success: true,
      lastMessage: lastVisibleMessage,
    });
  } catch (error) {
    console.error("Error deleting message:", error);
    res.status(500).json({ error: "Error deleting message" });
  }
};
