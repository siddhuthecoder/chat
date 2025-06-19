export interface ServerToClientEvents {
  userJoined: (user: any) => void;
  messageDeleted: (data: {
    messageId: string;
    chatId: string;
    lastMessage?: any;
    mode: any;
  }) => void;
  chatUpdated: (chatId: string, lastMessage: any) => void;
  chatStarted: (chat: any) => void;
  messageSent: (data: { message: any; chatId: string }) => void;
  directMessage: (message: any) => void;
  message: (message: any) => void;
  messageHistory: (data: {
    messages: any[];
    hasMore: boolean;
    total: number;
    currentPage: number;
  }) => void;
  participantStatusUpdate: (data: {
    participantId: any;
    status: string;
    active: boolean;
  }) => void;
  messageEdited: (data: {
    messageId: string;
    chatId: string;
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
        profile_image?: string;
        email?: string;
      };
    } | null;
    userId: string;
  }) => void;
}

export interface ClientToServerEvents {
  join: (userData: any) => void;
  startChat: (data: { userId: string; contact?: any }) => void;
  getMessageHistory: (data: { chatId: string; page: number }) => void;
  directMessage: (data: { chatId: string; content: any }) => void;
  message: (data: { content: string; roomId: string }) => void;
  deleteMessage: (data: { 
    messageId: string; 
    chatId: string; 
    userId: string; 
    mode?: "forMe" | "forEveryone" 
  }) => void;
  updateStatus: (data: { status: string; userId: string }) => void;
  addReaction: (data: {
    messageId: string;
    chatId: string;
    emoji: string;
  }) => void;
}
