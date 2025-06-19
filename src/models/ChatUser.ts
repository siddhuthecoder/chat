import mongoose, { Schema, Document, Model } from "mongoose";

export interface IChatUser extends Document {
  _id: mongoose.Types.ObjectId;
  socketIds: string[];
  active: boolean;
  status: "Online" | "Away" | "Busy";
  createdAt: Date;
  lastActive: Date;
  web_device_token?: string;
  mobile_device_token?: string;
  // tenantId: string;
}

const chatUserSchema = new Schema<IChatUser>({
  _id: {
    type: Schema.Types.ObjectId,
    required: true
  },
  socketIds: {
    type: [String],
    default: []
  },
  active: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    default: "Online",
    enum: ["Online", "Away", "Busy"]
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastActive: {
    type: Date,
    default: Date.now
  },
  web_device_token: String,
  mobile_device_token: String,
  // tenantId: {
  //   type: String,
  //   required: true,
  //   index: true
  // }
}, { timestamps: true });

// Create indexes
// chatUserSchema.index({ active: 1, tenantId: 1 });
// chatUserSchema.index({ status: 1, tenantId: 1 });
chatUserSchema.index({ active: 1 });
chatUserSchema.index({ status: 1 });

export { chatUserSchema };

// Function to create a ChatUser model for a specific tenant
export const createChatUserModel = (connection: mongoose.Connection): Model<IChatUser> => {
  return connection.model<IChatUser>('chatusers', chatUserSchema);
};
