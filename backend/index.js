require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const mongoose = require('mongoose');
const webpush = require('web-push');
const Message = require('./models/message');
const Room = require('./models/room');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const cors = require('cors');

const allowedOrigins = [
  'https://chat-app-indol-gamma.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:5500', // Live Server
];

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, service worker)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: true
}));


// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected...'))
  .catch(err => console.error(err));

// Configure web-push
webpush.setVapidDetails(
  'mailto:sadham070403@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// Track active clients per room
let activeRooms = {}; // { roomName: { clients: [] } }
// Track user subscriptions for push
let userSubscriptions = {}; // { username: [subscriptionObj] }

app.use(express.json());
// Serve frontend static files (HTML, JS, CSS)
app.use(express.static(path.join(__dirname, '../frontend'))); // serve root folder

// Serve public folder (icons, images)
app.use(express.static(path.join(__dirname, '../frontend/public')));

// ✅ Catch-all route at the very bottom
app.get("sw.js", (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/sw.js'));
});

// Save push subscription from client
app.post('/subscribe', (req, res) => {
  // ✅ Manually set CORS headers
  res.setHeader('Access-Control-Allow-Origin', 'https://chat-app-indol-gamma.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const { username, subscription } = req.body;
  if (!username || !subscription) return res.status(400).send('Invalid');

  if (!userSubscriptions[username]) userSubscriptions[username] = [];
  userSubscriptions[username].push(subscription);

  res.status(201).json({ message: 'Subscribed successfully' });
});

wss.on('connection', ws => {
  ws.on('message', async msg => {
    const data = JSON.parse(msg);

    // 1️⃣ Initialize user
    if (data.type === 'init') {
      ws.username = data.username;
      await sendGroupList(ws);
    }

    // 2️⃣ Create Room
    if (data.type === 'createRoom') {
      const roomName = data.room.trim();
      if (!roomName) return;

      try {
        const room = await Room.findOneAndUpdate(
          { name: roomName },
          { $addToSet: { members: ws.username } },
          { upsert: true, new: true }
        );

        if (!activeRooms[roomName]) activeRooms[roomName] = { clients: [] };
        if (!activeRooms[roomName].clients.includes(ws)) activeRooms[roomName].clients.push(ws);

        await sendGroupList(ws);
      } catch (err) {
        console.error('Error creating room:', err.message);
      }
    }

    // 3️⃣ Join Room
    if (data.type === 'join') {
      const roomName = data.room.trim();
      ws.room = roomName;

      try {
        const room = await Room.findOneAndUpdate(
          { name: roomName },
          { $addToSet: { members: ws.username } },
          { upsert: true, new: true }
        );

        if (!activeRooms[roomName]) activeRooms[roomName] = { clients: [] };
        if (!activeRooms[roomName].clients.includes(ws)) activeRooms[roomName].clients.push(ws);

        const history = await Message.find({ room: roomName }).sort({ createdAt: 1 });
        ws.send(JSON.stringify({
          type: 'history',
          messages: history.map(msg => ({
            id: msg._id.toString(),
            type: 'chat',
            username: msg.username,
            message: msg.message,
            timestamp: msg.createdAt.getTime()
          }))
        }));

        broadcast(roomName, { type: 'system', message: `${ws.username} joined the chat` });
        await sendGroupList(ws);
      } catch (err) {
        console.error('Error joining room:', err.message);
      }
    }

    // 4️⃣ Chat Message
    if (data.type === 'message') {
      if (!ws.room) return;

      const newMsg = await Message.create({
        room: ws.room,
        username: ws.username,
        message: data.message,
        time: new Date()
      });

      const msgData = {
        type: 'chat',
        id: newMsg._id.toString(),
        username: ws.username,
        message: data.message,
        time: newMsg.createdAt.getTime()
      };

      broadcast(ws.room, msgData);

      // 🔔 Send push notifications to all other users in room
      const room = await Room.findOne({ name: ws.room });
      if (room) {
        room.members.forEach(user => {
          if (user !== ws.username && userSubscriptions[user]) {
            userSubscriptions[user].forEach(sub => {
              webpush.sendNotification(sub, JSON.stringify({
                title: `New message from ${ws.username}`,
                body: data.message,
                icon: '/icon.png'
              })).catch(err => console.error('Push error:', err));
            });
          }
        });
      }
    }

    // 5️⃣ Delete message
    if (data.type === 'delete') {
      if (!ws.room) return;
      await Message.findByIdAndDelete(data.id);
      broadcast(ws.room, { type: 'delete', id: data.id });
    }

    // 6️⃣ Delete Room
    if (data.type === 'deleteGroup') {
      const roomName = data.room;
      const room = await Room.findOne({ name: roomName });
      if (!room) return;

      if (activeRooms[roomName]) {
        activeRooms[roomName].clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'system', message: `Group "${roomName}" has been deleted.` }));
            client.room = null;
          }
        });
        delete activeRooms[roomName];
      }

      await Room.deleteOne({ name: roomName });
      await Message.deleteMany({ room: roomName });

      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.username) sendGroupList(client);
      });
    }
  });

  ws.on('close', () => {
    if (!ws.room || !activeRooms[ws.room]) return;
    activeRooms[ws.room].clients = activeRooms[ws.room].clients.filter(c => c !== ws);
    broadcast(ws.room, { type: 'system', message: `${ws.username} left the chat` });
  });
});

// Broadcast to all clients in a room
function broadcast(room, data) {
  if (!activeRooms[room]) return;
  activeRooms[room].clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(data));
  });
}

// Send groups for a user
async function sendGroupList(ws) {
  const userRooms = await Room.find({ members: ws.username });
  ws.send(JSON.stringify({ type: 'joinedGroups', groups: userRooms.map(r => r.name) }));
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
