require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const webpush = require('web-push');
const { Server } = require('socket.io');

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
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('CORS BLOCKED'), false);
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());

/* =========================
   HEALTH CHECK
========================= */

app.get('/ping', (req, res) => {
  res.status(200).send('pong');
});

/* =========================
   MONGODB
========================= */

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => {
    console.error('❌ MongoDB error:', err);
    process.exit(1);
  });

/* =========================
   WEB PUSH
========================= */

webpush.setVapidDetails(
  'mailto:sadham070403@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// username → subscriptions[]
const userSubscriptions = Object.create(null);

/* =========================
   SUBSCRIBE
========================= */

app.post('/subscribe', (req, res) => {
  const { username, subscription } = req.body;

  if (!username || !subscription) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  if (!userSubscriptions[username]) {
    userSubscriptions[username] = [];
  }

  const exists = userSubscriptions[username]
    .some(sub => sub.endpoint === subscription.endpoint);

  if (!exists) {
    userSubscriptions[username].push(subscription);
    console.log(`✅ Subscription stored for ${username}`);
  }

  res.status(201).json({ ok: true });
});

/* =========================
   SOCKET.IO
========================= */

const io = new Server(server, {
  cors: corsOptions,
  transports: ['websocket', 'polling'],
});

const activeRooms = {};

io.on('connection', socket => {
  console.log('🔌 Socket connected:', socket.id);

  socket.on('init', async username => {
    socket.username = username;
    const rooms = await Room.find({ members: username });
    socket.emit('joinedGroups', rooms.map(r => r.name));
  });

  socket.on('createRoom', async roomName => {
    if (!roomName) return;

    await Room.findOneAndUpdate(
      { name: roomName },
      { $addToSet: { members: socket.username } },
      { upsert: true }
    );

    socket.emit(
      'joinedGroups',
      (await Room.find({ members: socket.username })).map(r => r.name)
    );
  });

  socket.on('join', async roomName => {
    if (!roomName) return;

    socket.room = roomName;
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
    if (!msg || !room) return;

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

    for (const user of roomDoc.members) {
      if (user === socket.username) continue;

      const subs = userSubscriptions[user];
      if (!subs) continue;

      const valid = [];

      for (const sub of subs) {
        try {
          await webpush.sendNotification(
            sub,
            JSON.stringify({
              title: `💬 ${socket.username}`,
              body: msg,
              icon: 'https://chat-app-kyp7.onrender.com/icon.png'
            })
          );
          valid.push(sub);
        } catch (err) {
          console.error('❌ PUSH FAILED', err.statusCode);
        }
      }

      userSubscriptions[user] = valid;
    }
  });

  socket.on('delete', async ({ id }) => {
    if (!id) return;

    const deleted = await Message.findByIdAndDelete(id);
    if (deleted) io.to(deleted.room).emit('delete', id);
  });

  socket.on('deleteGroup', async roomName => {
    await Room.deleteOne({ name: roomName });
    await Message.deleteMany({ room: roomName });
    io.emit('joinedGroups', (await Room.find({})).map(r => r.name));
  });

  socket.on('disconnect', reason => {
    console.log('🔌 Socket disconnected:', reason);
  });
});

/* =========================
   START
========================= */

const PORT = process.env.PORT || 4500;
server.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
});