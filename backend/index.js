require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const mongoose = require('mongoose');
const cors = require('cors');
const webpush = require('web-push');
const Message = require('./models/message');
const Room = require('./models/room');

const app = express();
const server = http.createServer(app);

// ✅ Define allowed origins once
const allowedOrigins = [
  'https://chat-app-indol-gamma.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:5500'
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
};


// ✅ Socket.io setup
const { Server } = require('socket.io');
const io = new Server(server, {
  cors: corsOptions
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));
app.use(express.static(path.join(__dirname, '../frontend/public')));

// MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected...'))
  .catch(err => console.error(err));

// Web Push
webpush.setVapidDetails(
  'mailto:sadham070403@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// Push subscriptions storage
let userSubscriptions = {};


// ✅ Preflight for /subscribe
app.options('/subscribe', cors(corsOptions), (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'https://chat-app-indol-gamma.vercel.app');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    return res.sendStatus(204);
});

// ✅ Subscribe endpoint with CORS
app.post('/subscribe', cors(corsOptions), (req, res) => {
  const origin = req.headers.origin;
    res.setHeader('Access-Control-Allow-Origin', 'https://chat-app-indol-gamma.vercel.app');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

  const { username, subscription } = req.body;
  if (!username || !subscription) {
    return res.status(400).send('Invalid');
  }

  if (!userSubscriptions[username]) {
    userSubscriptions[username] = [];
  }
  
  const exists = userSubscriptions[username].some(sub => sub.endpoint === subscription.endpoint);
  if (!exists) {
    userSubscriptions[username].push(subscription);
  }

  return res.status(201).json({ message: 'Subscribed successfully' });
});

// Socket.io logic
let activeRooms = {}; // { roomName: [socket.id, ...] }

io.on('connection', (socket) => {
  console.log('✅ Socket connected:', socket.id);

  // Initialize user
  socket.on('init', async (username) => {
    socket.username = username;
    try {
      const userRooms = await Room.find({ members: username });
      socket.emit('joinedGroups', userRooms.map(r => r.name));
    } catch (err) {
      console.log('init error:', err);
    }
  });

  // Create room
  socket.on('createRoom', async (roomName) => {
    if (!roomName) return;
    try {
      await Room.findOneAndUpdate(
        { name: roomName },
        { $addToSet: { members: socket.username } },
        { upsert: true, new: true }
      );

      if (!activeRooms[roomName]) activeRooms[roomName] = new Set();
      activeRooms[roomName].add(socket.id);

      const userRooms = await Room.find({ members: socket.username });
      socket.emit('joinedGroups', userRooms.map(r => r.name));
    } catch (err) {
      console.log('createRoom error:', err);
    }
  });

  // Join room
  socket.on('join', async (roomName) => {
    if (!roomName) return;
    try {
      socket.room = roomName;
      await socket.join(roomName); // ensure the socket joins the socket.io room

      await Room.findOneAndUpdate(
        { name: roomName },
        { $addToSet: { members: socket.username } },
        { upsert: true, new: true }
      );

      if (!activeRooms[roomName]) activeRooms[roomName] = new Set();
      activeRooms[roomName].add(socket.id);

      const history = await Message.find({ room: roomName }).sort({ createdAt: 1 });
      socket.emit('history', history.map(msg => ({
        id: msg._id.toString(),
        username: msg.username,
        message: msg.message,
        timestamp: msg.createdAt.getTime()
      })));

      socket.to(roomName).emit('system', `${socket.username} joined the chat`);
    } catch (err) {
      console.log('join error:', err);
    }
  });

  // Chat message
  socket.on('message', async (data) => {
    try {
      console.log("🔹 Incoming message data:", data);

      const msg = data && data.msg;
      const room = (data && data.room) || socket.room;
      const tempId = data && data.tempId;

      console.log("🔹 Parsed -> room:", room, "msg:", msg, "tempId:", tempId);

      if (!room || !msg) {
        console.log("⚠️ Missing room or msg, skipping");
        return;
      }

      // Make sure socket has joined the room on the server side
      await socket.join(room);
      socket.room = room;

      // Persist message
      const newMsg = await Message.create({
        room,
        username: socket.username,
        message: msg,
        time: new Date()
      });

      const msgData = {
        id: newMsg._id.toString(),
        username: socket.username,
        message: msg,
        timestamp: newMsg.createdAt.getTime(),
        tempId: tempId || null
      };

      // Broadcast to everyone in the room
      io.to(room).emit('chat', msgData);

      // Push notifications to room members (except sender)
      const roomDoc = await Room.findOne({ name: room });
      if (roomDoc && roomDoc.members && Array.isArray(roomDoc.members)) {
        roomDoc.members.forEach(user => {
          if (user !== socket.username && userSubscriptions[user]) {
            userSubscriptions[user].forEach(sub => {
              webpush.sendNotification(sub, JSON.stringify({
                title: `New message from ${socket.username}`,
                body: msg,
                icon: '/icon.png'
              })).catch(err => console.error('Push error:', err));
            });
          }
        });
      }
    } catch (err) {
      console.log('message handler error:', err);
    }
  });

  // Delete message
  socket.on('delete', async (data) => {
    try {
      console.log("🔹 Delete request:", data);

      if (!data || !data.id){
        console.log("⚠️ Delete request missing id");
        return;
      } 
      const id = data.id;

      // Delete from DB
      const deleted = await Message.findByIdAndDelete(id);
      console.log("🔹 Deleted from DB:", deleted);
      if (!deleted) return;

      // Broadcast delete to sockets that are actually in the room.
      // If no sockets are in the room right now, no one will receive it (clients reloading should fetch history).
      const roomName = deleted.room;
      // fetchSockets returns sockets in that namespace/room; ensure compatibility with your server version
      const sockets = await io.in(roomName).fetchSockets();
      if (sockets && sockets.length > 0) {
        io.to(roomName).emit('delete', id);
      } else {
        // no active sockets in room; still emit globally so clients that recently joined might pick it up
        io.emit('delete', id);
      }
      console.log("✅ Broadcast delete to room:", deleted.room);
    } catch (err) {
      console.log('delete handler error:', err);
    }
  });

  // Delete room
  socket.on('deleteGroup', async (roomName) => {
    try {
      const room = await Room.findOne({ name: roomName });
      if (!room) return;

      delete activeRooms[roomName];

      await Room.deleteOne({ name: roomName });
      await Message.deleteMany({ room: roomName });

      io.emit('joinedGroups', await Room.find({}).then(r => r.map(r => r.name)));
    } catch (err) {
      console.log('deleteGroup error:', err);
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    try {
      if (socket.room && activeRooms[socket.room]) {
        activeRooms[socket.room].delete(socket.id);
      }
      if (socket.room) socket.to(socket.room).emit('system', `${socket.username} left the chat`);
      console.log('Socket disconnected:', socket.id);
    } catch (err) {
      console.log('disconnect error:', err);
    }
  });
});

const PORT = process.env.PORT || 4500;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
