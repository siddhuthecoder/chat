import mongoose from "mongoose";
import "dotenv/config";
import { chatSchema, IChat } from "../models/Chat";
// import { chatUserSchema, IChatUser } from "../models/ChatUser";
import { IMessage, messageSchema } from "../models/Message";
import { getValueFromKeyVault } from "../services/keyVault";
import { chatUserSchema, IChatUser } from "../models/ChatUser";


const MONGODB_USER = process.env.MONGODB_USER as string;
const MONGODB_PWD = process.env.MONGODB_PWD as string;

interface ITenantModels {
  connection: mongoose.Connection;
  Chat: mongoose.Model<IChat>;
  ChatUser: mongoose.Model<IChatUser>;
  Message: mongoose.Model<IMessage>;
}

// Store connection pool for tenant connections
const connections: { [key: string]: mongoose.Connection } = {};

const modelCache: { [key: string]: ITenantModels } = {};

// Connect to tenant-specific database
export const connectToTenantDB = async (tenantId: string): Promise<mongoose.Connection> => {
  try {

    // Return existing connection if available
    if (connections[tenantId]) {
      return connections[tenantId];
    }

    // Fetch the MongoDB credentials from Key Vault using the service function
    const mongoUsername = await getValueFromKeyVault(MONGODB_USER);
    const mongoPassword = await getValueFromKeyVault(MONGODB_PWD);


    // Encode the username and password if they contain special characters
    const encodedUsername = encodeURIComponent(mongoUsername);
    const encodedPassword = encodeURIComponent(mongoPassword);

    // Construct the tenant-specific database name using sanitized tenant ID
    const dbName = `tenant-${tenantId}`;
    const connectionString = `mongodb+srv://${encodedUsername}:${encodedPassword}@ops-cluster.rl8lx.mongodb.net/${dbName}?retryWrites=true&w=majority`;

    // Connection options
    const options = {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
    };

    // Create a new connection for this tenant
    const connection = mongoose.createConnection(connectionString, options);

    // Set up connection event handlers
    connection.once("open", () => {
      console.log(`Connected to tenant database for tenant: ${tenantId} (DB: ${dbName})`);
    });

    connection.on("disconnected", () => {
      console.log(`Tenant DB ${tenantId} (DB: ${dbName}) disconnected! Attempting to reconnect...`);
      delete modelCache[tenantId];
    });

    // Store the connection in the pool using sanitized tenant ID as key
    connections[tenantId] = connection;

    return connection;
  } catch (error) {
    console.error(`Error connecting to tenant database for ${tenantId}:`, error);
    throw error;
  }
};

// Get tenant connection
export const getTenantConnection = (tenantId: string): mongoose.Connection => {
  if (!connections[tenantId]) {
    throw new Error(`No active connection for tenant: ${tenantId}`);
  }
  return connections[tenantId];
};

// Close all connections
export const closeAllConnections = async (): Promise<void> => {
  try {
    // Close all tenant connections
    for (const key in connections) {
      await connections[key].close();
    }
  } catch (error) {
    console.error('Error closing database connections:', error);
    throw error;
  }
};

// Get tenant models
export const getTenantModels = async (tenantId: string, req?: any) => {
  const actualTenantId = req?.user?.contextTenantId ? req.user.contextTenantId : tenantId;
  try {

    if (modelCache[actualTenantId]) {
      return modelCache[actualTenantId];
    }

    const connection = await connectToTenantDB(actualTenantId);
    const models = {
      Chat: connection.model<IChat>('chats', chatSchema),
      ChatUser: connection.model<IChatUser>('chatusers', chatUserSchema),
      Message: connection.model<IMessage>('messages', messageSchema),
      connection
    };

    // Cache the models 
    modelCache[actualTenantId] = models;
    return models;
  } catch (error) {
    console.error(`Error getting tenant models for ${tenantId}:`, error);
    throw error;
  }
};
