const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const mongoose = require('mongoose');
const Message = require('./models/message');
const Room = require('./models/room');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/chatapp')
  .then(() => console.log('MongoDB connected...'))
  .catch(err => console.error(err));

// Track active clients per room
let activeRooms = {}; // { roomName: { clients: [] } }

app.use(express.static(path.join(__dirname, 'public')));

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
        // Use findOneAndUpdate with upsert to avoid duplicates
        const room = await Room.findOneAndUpdate(
          { name: roomName },               // query
          { $addToSet: { members: ws.username } }, // add user only if not present
          { upsert: true, new: true }       // create if not exists, return new document
        );

        // Track active clients in memory
        if (!activeRooms[roomName]) activeRooms[roomName] = { clients: [] };
        if (!activeRooms[roomName].clients.includes(ws)) {
          activeRooms[roomName].clients.push(ws);
        }

        // Send updated groups to this user
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

        // Track active clients
        if (!activeRooms[roomName]) activeRooms[roomName] = { clients: [] };
        if (!activeRooms[roomName].clients.includes(ws)) {
          activeRooms[roomName].clients.push(ws);
        }

        // Send chat history
        const history = await Message.find({ room: roomName }).sort({ createdAt: 1 });
        ws.send(JSON.stringify({
          type: 'history',
          messages: history.map(msg => ({
            id: msg._id.toString(),
            type: 'chat',
            username: msg.username,
            message: msg.message,
            timestamp: msg.createdAt.getTime() // send numeric timestamp
          }))
        }));

        // Notify room
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

      broadcast(ws.room, {
        type: 'chat',
        id: newMsg._id.toString(),
        username: ws.username,
        message: data.message,
        time: newMsg.createdAt.getTime()
      });
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

      // Notify connected clients
      if (activeRooms[roomName]) {
        activeRooms[roomName].clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'system', message: `Group "${roomName}" has been deleted.` }));
            client.room = null;
          }
        });
        delete activeRooms[roomName];
      }

      // Delete room and all messages in DB
      await Room.deleteOne({ name: roomName });
      await Message.deleteMany({ room: roomName });

      // Notify all connected clients about updated groups
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.username) sendGroupList(client);
      });
    }
  });

  // Handle disconnect
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

server.listen(3000, () => console.log('Server running on http://localhost:3000'));
