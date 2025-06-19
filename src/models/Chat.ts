import mongoose, { Schema, Document, Model } from "mongoose";
import { getEncryptionSecretsByTenantId } from '../utils/getEncryptionSecrets';
import { decryptDataWithNonce, encryptDataWithNonce, generateCacheKey } from '../services/encryptDecryptAlgorithm';
import { requestContext } from '../utils/requestContext';

export interface IChat extends Document {
  name?: string;
  participants: mongoose.Types.ObjectId[];
  lastMessage?: mongoose.Types.ObjectId;
  chatType: string;
  createdAt: Date;
  deletedFor: Array<{
    userId: mongoose.Types.ObjectId;
    lastMessageTime: Date;
  }>;
  tenantId: string;
}

const chatSchema = new Schema({
  name: {
    type: String,
  },
  participants: [{
    type: Schema.Types.ObjectId,
    ref: "chatusers",
    required: true
  }],
  lastMessage: {
    type: Schema.Types.ObjectId,
    ref: "messages"
  },
  chatType: {
    type: String,
    default: "Direct",
    enum: ["Direct", "Group", "Team"]
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  deletedFor: [{
    userId: {
      type: Schema.Types.ObjectId,
      required: true
    },
    lastMessageTime: {
      type: Date,
      required: true
    }
  }],
  tenantId: {
    type: String,
    required: true,
    index: true
  }
}, { timestamps: true });

// Create indexes
chatSchema.index({ participants: 1, tenantId: 1 });
chatSchema.index({ chatType: 1, tenantId: 1 });

// Helper function to encrypt fields
const encryptFields = async (obj: any, salt: string, nonce: string, encryptionPassword: string) => {
  if (!obj) return;

  if (obj.name && typeof obj.name === 'string') {
    obj.name = await encryptDataWithNonce(obj.name, salt, nonce, encryptionPassword);
  }
};

// Helper function to decrypt fields
const decryptFields = async (doc: any, salt: string, nonce: string, encryptionPassword: string) => {
  if (!doc || typeof doc !== 'object') return;

  if (doc.name && typeof doc.name === 'string') {
    const cacheKey = generateCacheKey('name', doc.tenantId, doc._id, 'chats', doc?.updatedAt)
    doc.name = await decryptDataWithNonce(doc.name, nonce, salt, encryptionPassword, cacheKey);
  }
};

// Pre-save hook to encrypt sensitive data
chatSchema.pre<IChat>('save', async function (next) {
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

    if (this.isModified('name') && this.name) {
      const encryptedData = await encryptDataWithNonce(this.name, salt, nonce, encryptionPassword);
      this.name = encryptedData;
    }

    next();
  } catch (error) {
    next(error as Error);
  }
});

// Pre-hook for find operations to encrypt query fields
chatSchema.pre(['find', 'findOne', 'findOneAndUpdate', 'updateOne', 'updateMany'], async function (this: any, next) {
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
chatSchema.post(['find', 'findOne', 'findOneAndUpdate'], async function (this: any, result, next) {
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
    console.error('Error decrypting chat data:', error);
    next(error as Error);
  }
});

export { chatSchema };

// Function to create a Chat model for a specific tenant
export const createChatModel = (connection: mongoose.Connection): Model<IChat> => {
  return connection.model<IChat>('chats', chatSchema);
};