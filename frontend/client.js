// ✅ Socket.io setup
const socket = io("https://chat-app-kyp7.onrender.com", {
  transports: ["websocket", "polling"],
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
// if (Notification.permission !== "granted") Notification.requestPermission();

async function registerSWAndPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  // 1. Register service worker
  const swReg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  // 2. Request notification permission
  if (Notification.permission !== 'granted') {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;
  }

  // 3. Subscribe user
  await subscribeUser(swReg);
}

async function getVapidKey() {
  const resp = await fetch('https://chat-app-kyp7.onrender.com/vapidPublicKey');
  const data = await resp.json();
  return data.key;
}

async function subscribeUser(swReg) {
  try {
    const username = localStorage.getItem('username');
    if (!username) return;

    const vapidKey = await getVapidKey();
    if (!vapidKey) return console.error('❌ VAPID key missing');

    let subscription = await swReg.pushManager.getSubscription();
    if (!subscription) {
      subscription = await swReg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey)
      });
      console.log('✅ New subscription created');
    } else {
      console.log('ℹ️ Existing subscription reused');
    }

    // Only send to backend if endpoint changed
    if (!subscription || subscription.endpoint !== subscription.endpoint) {
      await fetch('https://chat-app-kyp7.onrender.com/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, subscription })
      });
      console.log('✅ Subscription sent to backend');
    }
  } catch (err) {
    console.error('❌ Push subscription failed:', err);
  }
}

// Utility
function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - base64.length % 4) % 4);
  const base64Str = (base64 + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const raw = atob(base64Str);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// Init
window.addEventListener('load', registerSWAndPush);


// ✅ Socket.io event listeners
// Init
socket.on('connect', () => {
  console.log('✅ Socket connected');
  socket.emit('init', username);

  // Only join if currentRoom exists
  if (currentRoom) {
    // Wait a tick to ensure socket is fully connected
    setTimeout(() => socket.emit('join', currentRoom), 100);
  }
});

// Receive groups
socket.on('joinedGroups', (groups) => {
  renderGroups(groups);
});

// Receive chat history
socket.on('history', (messages) => {
  messagesEl.innerHTML = '';
  messages.forEach(msg => {
    renderMessage({
      id: msg.id, // ✅ must be MongoDB _id
      username: msg.username,
      message: msg.message,
      timestamp: msg.timestamp
    });
  });
});

// Receive new message
socket.on('chat', msgData => {
  if (msgData.tempId) {
    const tempMsgEl = document.getElementById(msgData.tempId);
    if (tempMsgEl) tempMsgEl.remove();
  }

  // Render the real message from server
  renderMessage(msgData);
});

// System messages
socket.on('system', msg => renderMessage({ type: 'system', message: msg }));

// ✅ Handle disconnects
socket.on("disconnect", (reason) => {
  console.warn("❌ Disconnected from backend! Reason:", reason);

  renderMessage({ type: 'system', message: "⚠️ You got disconnected from the server." });

  setTimeout(() => {
    console.log("🔄 Attempting to reconnect...");
  }, 2000);
});

// ✅ Listen for delete events
socket.on('messageDeleted', (id) => {
  const el = document.getElementById(id);
  if (el) el.remove();
});

// ✅ Send message
sendBtn.addEventListener('click', sendMessage);
sendBtn.addEventListener('touchend', sendMessage);
inputEl.addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });

function sendMessage() {
  const msg = inputEl.value.trim();
  console.log("✉️ Sending msg:", msg, "room:", currentRoom);
  if (!msg || !currentRoom) return;

  // temporary ID
  const tempId = `temp-${Date.now()}`;

  // Optimistic render
  renderMessage({
    id: tempId,
    username,
    message: msg,
    timestamp: Date.now()
  });

  inputEl.value = '';

  // Send to server
  socket.emit('message', { room: currentRoom, msg, tempId });
}

// ✅ Join/create room
addRoomIcon.addEventListener('click', () => {
  joinForm.classList.toggle("show");
  groupsEl.classList.toggle("down");
});

// ✅ Create/join new room
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
joinRoomBtn.addEventListener('touchend', joinChat); // 👈 mobile tap support

// ✅ Reusable function for joining existing rooms
function handleRoomJoin(e) {
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
}

// ✅ Desktop + Mobile support
groupsEl.addEventListener("click", handleRoomJoin);
groupsEl.addEventListener("touchend", handleRoomJoin);

// ✅ Back button (for mobile view toggle)
function handleBack() {
  if (window.innerWidth <= 530) {
    chatContainer.classList.remove("active");
    groupList.classList.add("active");
  }
}
backBtn.addEventListener("click", handleBack);
backBtn.addEventListener("touchend", handleBack); // 👈 mobile support


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
    li.appendChild(delBtn);

    attachLongPress(li, () => {
      delBtn.classList.add('show');
    });

    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      socket.emit('deleteGroup', group);
      li.remove(); // optimistic
    });

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
                        <div class="messages"><b>${data.message}</b></div>
                     </div>`;

    if (data.username === username) {
      const messageBox = div.querySelector(".messages");

      const btn = document.createElement('button');
      btn.className = 'delete-btn';
      btn.textContent = 'Delete';
      messageBox.appendChild(btn);

      attachLongPress(div, () => {
        btn.classList.add('show');
      });

      btn.addEventListener('click', () => {
        if (!data.id.startsWith("temp-")) {
          socket.emit('deleteMessage', {
            id: data.id,
            room: currentRoom
          });
        }
      });
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

setInterval(() => {
  fetch('https://chat-app-kyp7.onrender.com/ping')
    .then(() => console.log('ping ok'))
    .catch(() => console.log('ping failed'));
}, 240000); // 4 minutes

function attachLongPress(element, onLongPress) {
  let timer;

  // Mobile
  element.addEventListener('touchstart', () => {
    timer = setTimeout(onLongPress, 600);
  });

  element.addEventListener('touchend', () => {
    clearTimeout(timer);
  });

  element.addEventListener('touchmove', () => {
    clearTimeout(timer);
  });

  // Desktop (right click)
  element.addEventListener('contextmenu', e => {
    e.preventDefault();
    onLongPress();
  });
}

document.addEventListener('click', e => {
  document.querySelectorAll('.delete-btn.show').forEach(btn => {
    if (!btn.contains(e.target)) btn.classList.remove('show');
  });
});

document.addEventListener('click', e => {
  document.querySelectorAll('.delete-group-btn.show').forEach(btn => {
    if (!btn.contains(e.target)) btn.classList.remove('show');
  });
});