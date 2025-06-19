import mongoose from "mongoose";
import { connectToTenantDB, getTenantConnection } from "../config/db";
import { chatSchema } from "../models/Chat";
import { chatUserSchema } from "../models/ChatUser";
import { messageSchema } from "../models/Message";

// Keep track of initialized tenant DBs to avoid redundant schema creation
const initializedTenants = new Set<string>();

// Initialize tenant database with chat-specific models/schemas
export const initializeTenantDB = async (tenantId: string): Promise<mongoose.Connection> => {
    try {
        // Return existing connection if available
        if (initializedTenants.has(tenantId)) {
            return getTenantConnection(tenantId);
        }

        // Get or create the connection
        const connection = await connectToTenantDB(tenantId);

        // Mark this tenant as initialized
        initializedTenants.add(tenantId);

        console.log(`Successfully initialized chat database for tenant: ${tenantId}`);
        return connection;
    } catch (error) {
        console.error(`Error initializing chat tenant database for ${tenantId}:`, error);
        throw error;
    }
};

// Ensure tenant database exists and is initialized
export const ensureTenantDatabaseExists = async (tenantId: string): Promise<boolean> => {
    try {
        await initializeTenantDB(tenantId);
        return true;
    } catch (error) {
        console.error(`Failed to ensure tenant database exists for ${tenantId}:`, error);
        return false;
    }
};

// Reset tenant initialization (useful for testing or re-initialization)
export const resetTenantInitialization = (tenantId: string): void => {
    initializedTenants.delete(tenantId);
    console.log(`Reset initialization for tenant: ${tenantId}`);
};

// Get list of initialized tenants
export const getInitializedTenants = (): string[] => {
    return Array.from(initializedTenants);
}; 