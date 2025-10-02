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

// ✅ WebSocket & message queue
let ws;
let messageQueue = [];

// ✅ Ask notification permission
if (Notification.permission !== "granted") {
  Notification.requestPermission();
}

// ✅ Register Service Worker & subscribe for push notifications
if ('serviceWorker' in navigator && 'PushManager' in window) {
  navigator.serviceWorker.register('/sw.js')
    .then(reg => {
      console.log('Service Worker registered', reg);
      if (Notification.permission === 'granted') subscribeUser();
    })
    .catch(err => console.error('Service Worker failed', err));
}

// ✅ Subscribe user function for push
async function subscribeUser() {
  const reg = await navigator.serviceWorker.ready;
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array('BEfZW00m0yKwgea53REsjRNgxCzL3wqjJSX7Tbb3VMbgxozgjAad9uormUHaQKPy_NqDpjPbC3NIPh-SPevu0bA')
  });

  await fetch('https://chat-app-kyp7.onrender.com/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, subscription })
  });

  console.log('Subscribed for push notifications');
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

// ✅ Safe send wrapper
function sendWS(data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  else messageQueue.push(data);
}

// ✅ Initialize WS connection
function connectWS() {
  // Automatically choose URL based on environment
  const wsUrl = window.location.hostname === 'localhost'
    ? 'ws://localhost:4500'
    : 'wss://chat-app-kyp7.onrender.com';

  ws = new WebSocket(wsUrl);

  ws.addEventListener('open', () => {
    console.log("✅ WebSocket connected");
    while (messageQueue.length > 0) ws.send(JSON.stringify(messageQueue.shift()));
    sendWS({ type: 'init', username });
    if (currentRoom) sendWS({ type: 'join', username, room: currentRoom });
  });

  ws.addEventListener('message', event => {
    const data = JSON.parse(event.data);

    if (data.type === 'joinedGroups') renderGroups(data.groups);
    else if (data.type === 'history') {
      messagesEl.innerHTML = '';
      data.messages.forEach(msg => renderMessage(msg));
    } else if (data.type === 'delete') {
      const msgEl = document.getElementById(data.id);
      if (msgEl) msgEl.remove();
    } else {
      renderMessage(data);
      if (data.type === "chat" && data.username !== username) {
        showNotification(data);
        sendPushNotification(data);
      }
    }
  });

  ws.addEventListener('close', () => {
    console.warn("🔌 WebSocket closed. Reconnecting in 2s...");
    setTimeout(connectWS, 2000);
  });

  ws.addEventListener('error', err => console.error("⚠️ WebSocket error:", err));
}

connectWS();

// ✅ Browser notification
function showNotification(data) {
  if (Notification.permission === "granted") {
    const formattedTime = formatMessageTime(data.timestamp || data.time);
    new Notification(`💬 New message from ${data.username}`, {
      body: `${data.message}\n(${formattedTime})`,
      icon: "/icon.png"
    });
  }
}

// ✅ Send push via Service Worker
function sendPushNotification(data) {
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      title: `💬 ${data.username} sent a message`,
      body: data.message,
      icon: "chat-icon.png"
    });
  }
}

// ✅ Show join/create form
addRoomIcon.addEventListener('click', () => {
  joinForm.classList.toggle("show");
  groupsEl.classList.toggle("down");
});

// ✅ Group click
groupsEl.addEventListener("click", (e) => {
  const li = e.target.closest("li")
  if (!li) return;
  currentRoom = e.target.dataset.room;
  console.log("Joining room:", currentRoom);
  localStorage.setItem('room', currentRoom);
  messagesEl.innerHTML = '';
  sendWS({ type: 'join', username, room: currentRoom });
  joinForm.classList.remove("show");
  groupsEl.classList.remove("down");
  if (window.innerWidth <= 530) {
    groupList.classList.remove("active");
    chatContainer.classList.add("active");
  }
});

// ✅ Back button
backBtn.addEventListener("click", () => {
  if (window.innerWidth <= 530) {
    chatContainer.classList.remove("active");
    groupList.classList.add("active");
  }
});

// ✅ Join/create room
function joinChat() {
  const roomName = newRoomInput.value.trim();
  if (!roomName) return;
  sendWS({ type: 'createRoom', room: roomName });
  currentRoom = roomName;
  localStorage.setItem('room', currentRoom);
  messagesEl.innerHTML = '';
  sendWS({ type: 'join', username, room: currentRoom });
  joinForm.classList.remove('show');
  groupsEl.classList.toggle("down");
  newRoomInput.value = '';
}
joinRoomBtn.addEventListener('click', joinChat);

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

    delBtn.addEventListener('click', () => sendWS({ type: 'deleteGroup', room: group }));

    groupsEl.appendChild(li);
  });
}

// ✅ Format message time
function formatMessageTime(ts) {
  const date = new Date(ts);
  const now = new Date();

  if (date.toDateString() === now.toDateString()) return `Today ${date.toLocaleTimeString()}`;
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${date.toLocaleTimeString()}`;

  return date.toLocaleString();
}

// ✅ Render messages with delete button for own messages
function renderMessage(data) {
  const div = document.createElement('div');

  if (data.type === 'system') {
    div.className = 'system';
    div.textContent = data.message;
  } else if (data.type === 'chat') {
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

      div.addEventListener('contextmenu', e => { e.preventDefault(); btn.classList.add('show'); });

      document.addEventListener('click', e => { if (!div.contains(e.target)) btn.classList.remove('show'); });

      let pressTimer;
      div.addEventListener('touchstart', () => { pressTimer = setTimeout(() => btn.classList.add('show'), 600); });
      div.addEventListener('touchend', () => clearTimeout(pressTimer));

      btn.addEventListener('click', () => sendWS({ type: 'delete', id: data.id }));
    }
  }

  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ✅ Send message
sendBtn.addEventListener('click', sendMessage);
inputEl.addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });

function sendMessage() {
  const msg = inputEl.value.trim();
  if (!msg || !currentRoom) return;
  sendWS({ type: 'message', message: msg, room: currentRoom });
  inputEl.value = '';
}
