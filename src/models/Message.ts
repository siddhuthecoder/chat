import mongoose, { Schema, Document, Model } from "mongoose";
import { getEncryptionSecretsByTenantId } from '../utils/getEncryptionSecrets';
import { decryptDataWithNonce, encryptDataWithNonce, generateCacheKey } from '../services/encryptDecryptAlgorithm';
import { requestContext } from '../utils/requestContext';

interface IAttachment {
  name: string;
  size: number;
  type: string;
  url: string;
  preview?: string;
}

interface IReaction {
  userId: mongoose.Types.ObjectId;
  emoji: string;
}

interface IDeletedFor {
  userId: mongoose.Types.ObjectId;
  deletedAt: Date;
}

export interface IMessage extends Document {
  chatId: mongoose.Types.ObjectId;
  senderId: mongoose.Types.ObjectId;
  body: string;
  type: "text" | "image" | "file" | "recording" | "system";
  attachments: IAttachment[];
  isEdited: boolean;
  reactions: IReaction[];
  replyTo?: mongoose.Types.ObjectId;
  createdAt: Date;
  deletedFor: IDeletedFor[];
  isRecording?: boolean;
  viewers: mongoose.Types.ObjectId[];
  tenantId: string;
}

const attachmentSchema = new Schema<IAttachment>({
  name: { type: String, required: true },
  size: { type: Number, required: true },
  type: { type: String, required: true },
  url: { type: String, required: true },
  preview: String
});

const reactionSchema = new Schema<IReaction>({
  userId: { type: Schema.Types.ObjectId, ref: 'chatusers', required: true },
  emoji: { type: String, required: true }
});

const deletedForSchema = new Schema<IDeletedFor>({
  userId: { type: Schema.Types.ObjectId, required: true },
  deletedAt: { type: Date, required: true }
});

const messageSchema = new Schema<IMessage>({
  chatId: {
    type: Schema.Types.ObjectId,
    ref: 'chats',
    required: true,
    index: true
  },
  senderId: {
    type: Schema.Types.ObjectId,
    ref: 'chatusers',
    required: true
  },
  body: {
    type: String,
    default: ''
  },
  type: {
    type: String,
    enum: ['text', 'image', 'file', 'recording', 'system'],
    default: 'text'
  },
  attachments: [attachmentSchema],
  isEdited: {
    type: Boolean,
    default: false
  },
  reactions: [reactionSchema],
  replyTo: {
    type: Schema.Types.ObjectId,
    ref: 'messages'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  deletedFor: {
    type: [deletedForSchema],
    default: []
  },
  isRecording: {
    type: Boolean,
    default: false
  },
  viewers: [{
    type: Schema.Types.ObjectId,
    ref: 'chatusers'
  }],
  tenantId: {
    type: String,
    required: true,
    index: true
  }
}, { timestamps: true });

// Create indexes
messageSchema.index({ chatId: 1, tenantId: 1 });
messageSchema.index({ senderId: 1, tenantId: 1 });
messageSchema.index({ createdAt: -1 });

// Helper function to encrypt fields
const encryptFields = async (obj: any, salt: string, nonce: string, encryptionPassword: string) => {
  if (!obj) return;

  if (obj.body && typeof obj.body === 'string') {
    obj.body = await encryptDataWithNonce(obj.body, salt, nonce, encryptionPassword);
  }
};

// Helper function to decrypt fields
const decryptFields = async (doc: any, salt: string, nonce: string, encryptionPassword: string) => {
  if (!doc || typeof doc !== 'object') return;

  if (doc.body && typeof doc.body === 'string') {
    const cacheKey = generateCacheKey('body', doc.tenantId, doc._id, 'chats', doc?.updatedAt)
    doc.body = await decryptDataWithNonce(doc.body, nonce, salt, encryptionPassword, cacheKey);
  }
};

// Pre-save hook to encrypt sensitive data
messageSchema.pre<IMessage>('save', async function (next) {
  try {
    const tenantId = requestContext.get().tenantId;
    if (!tenantId) {
      return next();
    }
    const secrets = await getEncryptionSecretsByTenantId(tenantId);
    if (!secrets) {
      return next();
    }
    const { salt, nonce, encryptionPassword } = secrets;

    if (this.isModified('body') && this.body) {
      const encryptedData = await encryptDataWithNonce(this.body, salt, nonce, encryptionPassword);
      this.body = encryptedData;
    }

    next();
  } catch (error) {
    next(error as Error);
  }
});

// Pre-hook for find operations to encrypt query fields
messageSchema.pre(['find', 'findOne', 'findOneAndUpdate', 'updateOne', 'updateMany'], async function (this: any, next) {
  try {
    const tenantId = requestContext.get().tenantId;
    if (!tenantId) {
      return next();
    }
    const secrets = await getEncryptionSecretsByTenantId(tenantId);
    if (!secrets) {
      return next();
    }
    const { salt, nonce, encryptionPassword } = secrets;

    // Encrypt query fields
    await encryptFields(this.getQuery(), salt, nonce, encryptionPassword);

    // Encrypt update fields
    if (this._update) {
      if (this._update.$set) {
        await encryptFields(this._update.$set, salt, nonce, encryptionPassword);
      }

      await encryptFields(this._update, salt, nonce, encryptionPassword);

      if (this._update.$push) {
        if (this._update.$push.$each) {
          for (const item of this._update.$push.$each) {
            await encryptFields(item, salt, nonce, encryptionPassword);
          }
        } else {
          await encryptFields(this._update.$push, salt, nonce, encryptionPassword);
        }
      }

      if (this._update.$addToSet) {
        if (this._update.$addToSet.$each) {
          for (const item of this._update.$addToSet.$each) {
            await encryptFields(item, salt, nonce, encryptionPassword);
          }
        } else {
          await encryptFields(this._update.$addToSet, salt, nonce, encryptionPassword);
        }
      }
    }

    next();
  } catch (error) {
    next(error as Error);
  }
});

// Post-hook for find operations to decrypt result fields
messageSchema.post(['find', 'findOne', 'findOneAndUpdate'], async function (this: any, result, next) {
  if (!result) return next();

  try {
    const tenantId = requestContext.get().tenantId;
    if (!tenantId) {
      return next();
    }
    const secrets = await getEncryptionSecretsByTenantId(tenantId);
    if (!secrets) {
      return next();
    }
    const { salt, nonce, encryptionPassword } = secrets;

    const documents = Array.isArray(result) ? result : [result];
    for (const doc of documents) {
      await decryptFields(doc, salt, nonce, encryptionPassword);
    }

    next();
  } catch (error) {
    console.error('Error decrypting message data:', error);
    next(error as Error);
  }
});

export { messageSchema };

// Function to create a Message model for a specific tenant
export const createMessageModel = (connection: mongoose.Connection): Model<IMessage> => {
  return connection.model<IMessage>('messages', messageSchema);
};
