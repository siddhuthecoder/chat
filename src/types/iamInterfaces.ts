import { Request } from 'express';
import mongoose from 'mongoose';

export interface IUser {
    _id: string;
    firstname?: string;
    lastname?: string;
    email: string;
    phone?: string;
    status: "Active" | "Inactive" | "InvitationSent";
    role?: mongoose.Types.ObjectId;
    team: mongoose.Types.ObjectId[];
    location?: mongoose.Types.ObjectId[];
    company: mongoose.Types.ObjectId;
    can_change_permissions: boolean;
    profile_image?: string;
    web_device_token?: string;
    mobile_device_token?: string;
    device_type?: string;
    // Additional fields for chat functionality
    photo_image?: string;
    fullName?: string;
    phoneNumber?: string;
    permissions?: any;
}

export interface IRole {
    _id: string;
    name: string;
    level: number;
    permissions?: Array<{
        module_id: string;
        module_name: string;
        actions: Array<{
            name: string;
            status: boolean;
        }>;
    }>;
}

export interface ITenant {
    _id: string;
    name: string;
    logo?: string;
    domain?: string;
    logo_url: string;
    status: string;
    isActive: boolean;
}

// Custom request interface with authentication data
export interface AuthenticatedRequest extends Request {
    user?: IUser;
    userId?: string;
    tenantId?: string;
    tenant?: {
        _id: string;
        name: string;
    };
    role?: IRole;
    contextTenantId?: string;
} 