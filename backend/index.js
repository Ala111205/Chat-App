require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const webpush = require('web-push');
const { Server } = require('socket.io');

const Subscription = require('./models/subscription');
const Message = require('./models/message');
const Room = require('./models/room');

const app = express();
const server = http.createServer(app);

/* =========================
   CORS (ONE SOURCE OF TRUTH)
========================= */
const allowedOrigins = [
  'https://chat-app-indol-gamma.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:5501',
  'http://127.0.0.1:5502',
];

const corsOptions = {
  origin(origin, cb) {
    // allow same-origin, SSR, curl, uptime monitors
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('CORS BLOCKED'), false);
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());

/* =========================
   BASIC PING (Render / UptimeRobot)
   - Lightweight
   - No DB dependency
========================= */
app.get('/ping', (req, res) => {
  res.status(200).send('pong');
});

/* =========================
   MONGODB (MODERN + SAFE)
========================= */
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000, // fail fast
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      autoIndex: true,
    });

    console.log('✅ MongoDB connected');

    // Wake-check (helps free-tier resume faster after sleep)
    setInterval(async () => {
      try {
        if (mongoose.connection.readyState === 1) {
          await mongoose.connection.db.admin().ping();
          console.log('[PING] MongoDB alive');
        }
      } catch (err) {
        console.warn('[PING] MongoDB ping failed:', err.message);
      }
    }, 60_000);

  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  }
}

connectDB();

/* =========================
   WEB PUSH
========================= */
webpush.setVapidDetails(
  'mailto:sadham070403@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

app.get('/vapidPublicKey', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY });
});

/* =========================
   SUBSCRIBE
========================= */
app.post('/subscribe', async (req, res) => {
  const { username, subscription } = req.body;

  if (!username || !subscription?.endpoint || !subscription?.keys) {
    return res.status(400).json({ error: 'Invalid subscription' });
  }

  await Subscription.findOneAndUpdate(
    { endpoint: subscription.endpoint },
    {
      username,
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      invalid: false,
      updatedAt: new Date()
    },
    { upsert: true }
  );

  res.status(201).json({ ok: true });
});

/* =========================
   SOCKET.IO
========================= */
const io = new Server(server, {
  cors: corsOptions,
  transports: ['websocket', 'polling'],
});

io.on('connection', socket => {
  console.log('🔌 Socket connected:', socket.id);

  socket.on('init', async username => {
    socket.username = username;
    const rooms = await Room.find({ members: username });
    socket.emit('joinedGroups', rooms.map(r => r.name));
  });

  socket.on('join', async roomName => {
    if (!roomName) return;

    await socket.join(roomName);

    await Room.findOneAndUpdate(
      { name: roomName },
      { $addToSet: { members: socket.username } },
      { upsert: true }
    );

    const history = await Message.find({ room: roomName }).sort({ createdAt: 1 });
    socket.emit('history', history.map(m => ({
      id: m._id.toString(),
      username: m.username,
      message: m.message,
      timestamp: m.createdAt.getTime()
    })));
  });

  socket.on('message', async ({ msg, room, tempId }) => {
    if (!msg || !room || !socket.username) return;

    const saved = await Message.create({
      room,
      username: socket.username,
      message: msg
    });

    io.to(room).emit('chat', {
      id: saved._id.toString(),
      username: socket.username,
      message: msg,
      timestamp: saved.createdAt.getTime(),
      tempId
    });

    const roomDoc = await Room.findOne({ name: room });
    if (!roomDoc) return;

    for (const member of roomDoc.members) {
      if (member === socket.username) continue;

      const subs = await Subscription.find({
        username: member,
        invalid: { $ne: true }
      });

      for (const sub of subs) {
        try {
          console.log('[PUSH]', member, sub.endpoint.slice(0, 40));

          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            JSON.stringify({
              title: `💬 New message from ${socket.username}`,
              body: msg,
              icon: 'https://chat-app-kyp7.onrender.com/icon.png',
              url: '/'
            })
          );
        } catch (err) {
          console.error('❌ Push failed:', err.statusCode || err.message);

          // Mark invalid instead of deleting (safer)
          await Subscription.updateOne(
            { _id: sub._id },
            { $set: { invalid: true } }
          );
        }
      }
    }
  });

  socket.on('deleteMessage', async ({ id, username }) => {
    const msg = await Message.findOne({ _id: id, username });
    if (!msg) return;

    await Message.deleteOne({ _id: id });
    io.to(msg.room).emit('messageDeleted', id);
  });

  socket.on('deleteGroup', async roomName => {
    await Room.deleteOne({ name: roomName });
    await Message.deleteMany({ room: roomName });
    io.emit('joinedGroups', (await Room.find({})).map(r => r.name));
  });

  socket.on('disconnect', () => {
    console.log('🔌 Disconnected:', socket.id);
  });
});

/* =========================
   HEALTH (Deep check)
   - Used by dashboards / debugging
========================= */
app.get('/health', (req, res) => {
  const dbState = mongoose.connection.readyState;
  res.status(200).json({
    status: 'ok',
    db:
      dbState === 1 ? 'connected' :
      dbState === 2 ? 'connecting' :
      dbState === 0 ? 'disconnected' : 'unknown',
    time: new Date().toISOString()
  });
});

/* =========================
   START
========================= */
const PORT = process.env.PORT || 4500;
server.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
});