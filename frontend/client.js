// ✅ Socket.io setup
const socket = io("https://chat-app-kyp7.onrender.com", {
  transports: ["websocket"],
  withCredentials: true
});

// ✅ Get DOM elements
const username = localStorage.getItem('username');
if (!username) window.location = 'index.html';

const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('msgInput');
const sendBtn = document.getElementById('sendBtn');

const groupsEl = document.getElementById('groups');
const groupList = document.querySelector('.group-list');
const chatContainer = document.querySelector('.chat-container');
const backBtn = document.getElementById('backBtn');

const addRoomIcon = document.querySelector('.fa-square-plus');
const joinForm = document.getElementById('joinForm');
const newRoomInput = document.getElementById('newRoom');
const joinRoomBtn = document.getElementById('joinRoomBtn');

let currentRoom = localStorage.getItem('room') || null;

// ✅ Notification setup
if (Notification.permission !== "granted") Notification.requestPermission();

if ('serviceWorker' in navigator && 'PushManager' in window) {
  navigator.serviceWorker.register('/sw.js')
    .then(reg => {
      console.log('Service Worker registered', reg);
      if (Notification.permission === 'granted') subscribeUser();
    })
    .catch(err => console.error('Service Worker failed', err));
}

async function subscribeUser() {
  const reg = await navigator.serviceWorker.ready;
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array('BEfZW00m0yKwgea53REsjRNgxCzL3wqjJSX7Tbb3VMbgxozgjAad9uormUHaQKPy_NqDpjPbC3NIPh-SPevu0bA')
  });

  await fetch('https://chat-app-kyp7.onrender.com/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, subscription }),
    credentials: 'include'
  });

  console.log('Subscribed for push notifications');
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

// ✅ Socket.io event listeners
io.on('connection', (socket) => {
  console.log('✅ Socket connected:', socket.id);

  // Initialize user
  socket.on('init', async (username) => {
    socket.username = username;
    const userRooms = await Room.find({ members: username });
    socket.emit('joinedGroups', userRooms.map(r => r.name));
  });

  // Join room
  socket.on('join', async (roomName) => {
    if (!roomName) return;
    socket.room = roomName;
    socket.join(roomName);

    await Room.findOneAndUpdate(
      { name: roomName },
      { $addToSet: { members: socket.username } },
      { upsert: true, new: true }
    );

    // Send chat history immediately
    const history = await Message.find({ room: roomName }).sort({ createdAt: 1 });
    socket.emit('history', history.map(msg => ({
      id: msg._id.toString(),
      username: msg.username,
      message: msg.message,
      timestamp: msg.createdAt.getTime()
    })));

    // Notify others in the room
    socket.to(roomName).emit('system', `${socket.username} joined the chat`);
  });

  // Chat message (real-time)
  socket.on('message', async (data) => {
    const { room, msg } = data;
    if (!room || !msg) return;

    // Save to DB
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
      timestamp: newMsg.createdAt.getTime()
    };

    // Broadcast to everyone in the room
    io.to(room).emit('chat', msgData);

    // Push notifications for other users
    const roomDoc = await Room.findOne({ name: room });
    if (roomDoc) {
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
  });

  // Delete message (real-time)
  socket.on('delete', async (data) => {
    const { room, id } = data;
    if (!room || !id) return;

    await Message.findByIdAndDelete(id);
    io.to(room).emit('delete', id);
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (!socket.room) return;
    socket.to(socket.room).emit('system', `${socket.username} left the chat`);
  });
});


// ✅ Send message
sendBtn.addEventListener('click', sendMessage);
inputEl.addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });

function sendMessage() {
  const msg = inputEl.value.trim();
  if (!msg || !currentRoom) return;
  socket.emit('message', msg); // ✅ fixed (removed currentRoom)
   // ✅ Render immediately (optimistic update)
  const tempMsg = {
    id: `temp-${Date.now()}`,
    username,
    message: msg,
    timestamp: Date.now()
  };
  renderMessage(tempMsg);
  inputEl.value = '';
}

// ✅ Join/create room
addRoomIcon.addEventListener('click', () => {
  joinForm.classList.toggle("show");
  groupsEl.classList.toggle("down");
});

function joinChat() {
  const roomName = newRoomInput.value.trim();
  if (!roomName) return;
  socket.emit('createRoom', roomName);
  currentRoom = roomName;
  localStorage.setItem('room', currentRoom);
  messagesEl.innerHTML = '';
  socket.emit('join', currentRoom);
  joinForm.classList.remove('show');
  groupsEl.classList.remove("down");
  newRoomInput.value = '';
}
joinRoomBtn.addEventListener('click', joinChat);

groupsEl.addEventListener("click", (e) => {
  const li = e.target.closest("li");
  if (!li) return;
  currentRoom = li.dataset.room;
  console.log("Joining room:", currentRoom);
  localStorage.setItem('room', currentRoom);
  messagesEl.innerHTML = '';
  socket.emit('join', currentRoom);
  joinForm.classList.remove("show");
  groupsEl.classList.remove("down");
  if (window.innerWidth <= 530) {
    groupList.classList.remove("active");
    chatContainer.classList.add("active");
  }
});

backBtn.addEventListener("click", () => {
  if (window.innerWidth <= 530) {
    chatContainer.classList.remove("active");
    groupList.classList.add("active");
  }
});

// ✅ Render groups with delete
function renderGroups(groups) {
  groupsEl.innerHTML = '';
  groups.forEach(group => {
    const li = document.createElement('li');
    li.dataset.room = group;
    li.textContent = group;

    const delBtn = document.createElement('button');
    delBtn.textContent = 'Delete';
    delBtn.className = 'delete-group-btn';
    delBtn.style.display = 'none';
    li.appendChild(delBtn);

    li.addEventListener('contextmenu', e => {
      e.preventDefault();
      delBtn.style.display = 'inline-block';
      delBtn.classList.add('show');
    });

    let pressTimer;
    li.addEventListener('touchstart', () => {
      pressTimer = setTimeout(() => {
        delBtn.style.display = 'inline-block';
        delBtn.classList.add('show');
      }, 600);
    });
    li.addEventListener('touchend', () => clearTimeout(pressTimer));

    document.addEventListener('click', e => {
      if (!li.contains(e.target)) {
        delBtn.classList.remove('show');
        delBtn.style.display = 'none';
      }
    });

    delBtn.addEventListener('click', () => socket.emit('deleteGroup', group));

    groupsEl.appendChild(li);
  });
}

// ✅ Render messages with delete
function renderMessage(data) {
  const div = document.createElement('div');

  if (data.type === 'system') {
    div.className = 'system';
    div.textContent = data.message;
  } else {
    div.className = 'message';
    div.id = data.id;
    const formattedTime = formatMessageTime(data.timestamp || data.time);
    div.innerHTML = `<div style="display:flex; flex-direction:column; gap:10px">
                        ${data.username} [${formattedTime}]
                        <div class="message"><b>${data.message}</b></div>
                     </div>`;

    if (data.username === username) {
      const message = div.querySelector(".message");
      const btn = document.createElement('button');
      btn.className = 'delete-btn';
      btn.textContent = 'Delete';
      message.appendChild(btn);

      btn.addEventListener('click', () => {
        // ✅ Optimistic removal
        div.remove();
        // ✅ Tell server
        socket.emit('delete', data.id);
      });

      div.addEventListener('contextmenu', e => { e.preventDefault(); btn.classList.add('show'); });
      document.addEventListener('click', e => { if (!div.contains(e.target)) btn.classList.remove('show'); });

      let pressTimer;
      div.addEventListener('touchstart', () => { pressTimer = setTimeout(() => btn.classList.add('show'), 600); });
      div.addEventListener('touchend', () => clearTimeout(pressTimer));

      btn.addEventListener('click', () => socket.emit('delete', data.id));
    }
  }

  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function formatMessageTime(ts) {
  const date = new Date(ts);
  const now = new Date();

  if (date.toDateString() === now.toDateString()) return `Today ${date.toLocaleTimeString()}`;
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${date.toLocaleTimeString()}`;

  return date.toLocaleString();
}

// ✅ Notifications
function showNotification(data) {
  if (Notification.permission === "granted") {
    const formattedTime = formatMessageTime(data.timestamp || data.time);
    new Notification(`💬 New message from ${data.username}`, {
      body: `${data.message}\n(${formattedTime})`,
      icon: "/icon.png"
    });
  }
}

function sendPushNotification(data) {
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      title: `💬 ${data.username} sent a message`,
      body: data.message,
      icon: "/icon.png"
    });
  }
}
