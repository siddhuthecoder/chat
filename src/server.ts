import { createServer } from "http";
import { Server } from "socket.io";
import mongoose from "mongoose";
import dotenv from "dotenv";
import app from "./app";
import { setupSocket } from "./socket/socketManager";
import { closeAllConnections } from "./config/db";

dotenv.config();

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: [
      "Content-Type", 
      "Authorization", 
      "x-tenant-id", 
      "x-context-id",
      "Accept",
      "Origin",
      "X-Requested-With"
    ]
  },
  transports: ["polling", "websocket"],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  connectTimeout: 45000
});

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Closing connections...');
  await closeAllConnections();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received. Closing connections...');
  await closeAllConnections();
  process.exit(0);
});

setupSocket(io);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
