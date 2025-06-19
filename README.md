# ops360-chat-backend

Chat service API for real-time messaging.

## Prerequisites

- Node.js >=14  
- MongoDB  
- Azure Key Vault access (for secrets management)

## Setup

1. Clone the repository:
```sh
git clone <repository-url>
cd ops360-chat-backend
```

2. Install dependencies:
```sh
npm install
```

3. Environment Setup:
   - Copy the environment sample file:
   ```sh
   cp env.sample .env
   ```
   - Update the `.env` file with your configuration:
     - `PORT`: Server port (default: 3000)
     - `KEY_VAULT_URL`: Your Azure Key Vault URL
     - `JWT_SECRET`: Secret key for JWT authentication
     - `NOTIFICATION_HUB_NAME`: Azure Notification Hub name
     - `FD_CDN_URL`: CDN URL for attachments
     - `NODE_ENV`: Environment (development, staging, production)

4. Azure Key Vault Setup:
   Ensure these secrets are available in your Key Vault:
   - `mongodb-user`: MongoDB username
   - `mongodb-pwd`: MongoDB password
   - `comms-push-connection-string-backend`: Notification Hub connection string
   - `jwt-secret-key`: JWT secret key

## Running the Application

### Local Development
```sh
npm run local
```
This will start the server with hot-reload using nodemon.

### Development Build
```sh
npm run dev
```
This will compile TypeScript and run the server.

### Staging Environment
```sh
npm run staging
```
This will compile TypeScript and run the server in staging mode.

### Production Environment
```sh
npm run prod
```
This will compile TypeScript and run the server in production mode.

## API Endpoints

- WebSocket endpoints: `/ws/chat`  
- REST endpoints: `/api/chat/*`  

## Environment Variables

The application requires the following environment variables:

| Variable | Description | Required |
|----------|-------------|----------|
| PORT | Server port | No (default: 3000) |
| KEY_VAULT_URL | Azure Key Vault URL | Yes |
| JWT_SECRET | JWT authentication secret | Yes |
| NOTIFICATION_HUB_NAME | Azure Notification Hub name | Yes |
| FD_CDN_URL | CDN URL for attachments | Yes |
| NODE_ENV | Environment (development/staging/production) | No (default: development) |

## Troubleshooting

1. If `nodemon` is not found:
   ```sh
   npm install -g nodemon
   # or use npx
   npx nodemon src/server.ts
   ```

2. If TypeScript compilation fails:
   ```sh
   npm run build
   # Check for any TypeScript errors
   ```

3. If MongoDB connection fails:
   - Verify your Azure Key Vault credentials
   - Check if the MongoDB secrets are properly set in Key Vault
   - Ensure network connectivity to MongoDB Atlas

## Testing

```sh
npm test
```

## Socket Connection Setup

The chat backend uses Socket.IO with tenant-based database connections and authentication middleware.

### Client Connection Example

```javascript
import { io } from 'socket.io-client';

// Connect to socket with authentication and tenant ID
const socket = io('http://localhost:3000', {
  auth: {
    token: 'Bearer YOUR_JWT_TOKEN_HERE' // JWT token from IAM service
  },
  extraHeaders: {
    'x-tenant-id': 'YOUR_TENANT_ID' // Tenant ID for database connection
  }
});

// Alternative connection methods:
// 1. Using query parameters
const socket2 = io('http://localhost:3000?tenantId=YOUR_TENANT_ID', {
  auth: {
    token: 'Bearer YOUR_JWT_TOKEN_HERE'
  }
});

// 2. Using auth object
const socket3 = io('http://localhost:3000', {
  auth: {
    token: 'Bearer YOUR_JWT_TOKEN_HERE',
    tenantId: 'YOUR_TENANT_ID'
  }
});

// Socket event listeners
socket.on('connect', () => {
  console.log('Connected to chat server');
  
  // Join with user data (optional, user data is already available from auth)
  socket.emit('join', {
    _id: 'USER_ID', // Optional, extracted from JWT token
    tenantId: 'TENANT_ID' // Optional, extracted from headers/auth
  });
});

socket.on('disconnect', () => {
  console.log('Disconnected from chat server');
});

// Listen for messages
socket.on('messageSent', (data) => {
  console.log('New message:', data);
});

socket.on('messageRead', (data) => {
  console.log('Message read:', data);
});

socket.on('unreadCountUpdate', (data) => {
  console.log('Unread count updated:', data);
});
```

### Socket Middleware

The socket connection automatically:

1. **Validates JWT Token**: Extracts and validates the JWT token from the connection
2. **Connects to Tenant Database**: Ensures the appropriate tenant database is available
3. **Sets User Context**: Makes user information available in all socket events
4. **Handles Errors**: Provides clear error messages for authentication/database failures

### Available Socket Events

#### Client to Server:
- `join` - Join user to chat rooms
- `startChat` - Start a new chat
- `getMessageHistory` - Get message history for a chat
- `directMessage` - Send a direct message
- `addReaction` - Add reaction to a message
- `markMessageAsRead` - Mark a message as read
- `markAllMessagesAsRead` - Mark all messages in a chat as read
- `updateUnreadCount` - Update unread count for a chat
- `deleteMessage` - Delete a message
- `updateStatus` - Update user status

#### Server to Client:
- `messageSent` - New message received
- `messageRead` - Message marked as read
- `messageReaction` - Message reaction added/removed
- `unreadCountUpdate` - Unread count updated
- `participantStatusUpdate` - Participant status changed
- `messageDeleted` - Message deleted
- `messageHistory` - Message history response

### Error Handling

The socket middleware provides clear error messages for:
- Missing or invalid JWT token
- Missing tenant ID
- Database connection failures
- Authentication failures

### Environment Variables

Make sure to set the following environment variables:
- `PORT` - Server port (default: 3000)
- `MONGODB_URI` - Base MongoDB connection string
- `JWT_SECRET` - JWT secret for token validation
- `IAM_SERVICE_URL` - IAM service URL for token verification