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

// ✅ Subscribe route with per-route CORS
const corsOptions = {
  origin: function(origin, callback) {
    // Allow requests with no origin (like Postman)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['POST', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type']
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


app.options('/subscribe', cors(corsOptions)); // Preflight
// ✅ Subscribe endpoint with CORS applied directly
app.post('/subscribe', cors(corsOptions), (req, res) => {
  const { username, subscription } = req.body;
  if (!username || !subscription) return res.status(400).send('Invalid');

  if (!userSubscriptions[username]) userSubscriptions[username] = [];
  userSubscriptions[username].push(subscription);

  res.status(201).json({ message: 'Subscribed successfully' });
});

// Socket.io logic
let activeRooms = {}; // { roomName: [socket.id, ...] }

io.on('connection', (socket) => {
  console.log('✅ Socket connected:', socket.id);

  // Initialize user
  socket.on('init', async (username) => {
    socket.username = username;
    const userRooms = await Room.find({ members: username });
    socket.emit('joinedGroups', userRooms.map(r => r.name));
  });

  // Create room
  socket.on('createRoom', async (roomName) => {
    if (!roomName) return;
    await Room.findOneAndUpdate(
      { name: roomName },
      { $addToSet: { members: socket.username } },
      { upsert: true, new: true }
    );
    if (!activeRooms[roomName]) activeRooms[roomName] = [];
    activeRooms[roomName].push(socket.id);

    const userRooms = await Room.find({ members: socket.username });
    socket.emit('joinedGroups', userRooms.map(r => r.name));
  });

  // Join room
  socket.on('join', async (roomName) => {
    if (!roomName) return;
    socket.room = roomName;

    await Room.findOneAndUpdate(
      { name: roomName },
      { $addToSet: { members: socket.username } },
      { upsert: true, new: true }
    );

    if (!activeRooms[roomName]) activeRooms[roomName] = [];
    if (!activeRooms[roomName].includes(socket.id)) activeRooms[roomName].push(socket.id);

    const history = await Message.find({ room: roomName }).sort({ createdAt: 1 });
    socket.emit('history', history.map(msg => ({
      id: msg._id.toString(),
      username: msg.username,
      message: msg.message,
      timestamp: msg.createdAt.getTime()
    })));

    socket.to(roomName).emit('system', `${socket.username} joined the chat`);
  });

  // Chat message
  socket.on('message', async (msg) => {
    if (!socket.room) return;

    const newMsg = await Message.create({
      room: socket.room,
      username: socket.username,
      message: msg,
      time: new Date()
    });

    const msgData = {
      id: newMsg._id.toString(),
      username: socket.username,
      message: msg,
      time: newMsg.createdAt.getTime()
    };

    // Broadcast in room
    io.to(socket.room).emit('chat', msgData);

    // Push notifications
    const room = await Room.findOne({ name: socket.room });
    if (room) {
      room.members.forEach(user => {
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
  });

  // Delete message
  socket.on('delete', async (id) => {
    if (!socket.room) return;
    await Message.findByIdAndDelete(id);
    io.to(socket.room).emit('delete', id);
  });

  // Delete room
  socket.on('deleteGroup', async (roomName) => {
    const room = await Room.findOne({ name: roomName });
    if (!room) return;

    delete activeRooms[roomName];

    await Room.deleteOne({ name: roomName });
    await Message.deleteMany({ room: roomName });

    io.emit('joinedGroups', await Room.find({}).then(r => r.map(r => r.name)));
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (!socket.room || !activeRooms[socket.room]) return;
    activeRooms[socket.room] = activeRooms[socket.room].filter(id => id !== socket.id);
    socket.to(socket.room).emit('system', `${socket.username} left the chat`);
  });
});

const PORT = process.env.PORT || 4500;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
