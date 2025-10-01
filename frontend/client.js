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

// ✅ Register Service Worker & subscribe for push notifications
if ('serviceWorker' in navigator && 'PushManager' in window) {
  navigator.serviceWorker.register('/sw.js')
    .then(reg => {
      console.log('Service Worker registered', reg);

      // Request notification permission and subscribe
      if (Notification.permission !== 'granted') {
        Notification.requestPermission().then(permission => {
          if (permission === 'granted') subscribeUser();
        });
      } else {
        subscribeUser();
      }
    })
    .catch(err => console.error('Service Worker failed', err));
}

// ✅ Subscribe user function
async function subscribeUser() {
  const reg = await navigator.serviceWorker.ready;
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array('BEfZW00m0yKwgea53REsjRNgxCzL3wqjJSX7Tbb3VMbgxozgjAad9uormUHaQKPy_NqDpjPbC3NIPh-SPevu0bA')
  });

  // Send subscription to backend
  await fetch('/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, subscription })
  });

  console.log('Subscribed for push notifications');
}

// Helper to convert VAPID key
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
}

// ✅ Safe send wrapper (queues if not open)
function sendWS(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  } else {
    console.warn("⚠️ WebSocket not open. Queued:", data);
    messageQueue.push(data);
  }
}

// ✅ Initialize WS connection
function connectWS() {
  ws = new WebSocket('wss://chat-app-kyp7.onrender.com');

  ws.addEventListener('open', () => {
    console.log("✅ WebSocket connected");

    // Flush queued messages
    while (messageQueue.length > 0) {
      const queued = messageQueue.shift();
      ws.send(JSON.stringify(queued));
    }

    sendWS({ type: 'init', username });

    if (currentRoom) {
      sendWS({ type: 'join', username, room: currentRoom });
    }
  });

  ws.addEventListener('message', event => {
    const data = JSON.parse(event.data);

    if (data.type === 'joinedGroups') {
      renderGroups(data.groups);
    } else if (data.type === 'history') {
      messagesEl.innerHTML = '';
      data.messages.forEach(msg => renderMessage(msg));
    } else if (data.type === 'delete') {
      const msgEl = document.getElementById(data.id);
      if (msgEl) msgEl.remove();
    } else {
      renderMessage(data);

      // 🔔 Show notification for messages from others
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

  ws.addEventListener('error', err => {
    console.error("⚠️ WebSocket error:", err);
  });
}

connectWS();

// ✅ Browser notification
function showNotification(data) {
  if (Notification.permission === "granted") {
    const formattedTime = formatMessageTime(data.timestamp || data.time);

    new Notification(`💬 New message from ${data.username}`, {
      body: `${data.message}\n(${formattedTime})`,
      icon: "/chat-icon.png"
    });
  }
}

// ✅ Send push notification via Service Worker
function sendPushNotification(data) {
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      title: `💬 ${data.username} sent a message`,
      body: data.message,
      icon: "/chat-icon.png"
    });
  }
}

// --- Remaining code: Join/create, group click, back button, renderGroups, formatMessageTime, renderMessage, sendMessage ---

// Show join/create form
addRoomIcon.addEventListener('click', () => {
  joinForm.classList.toggle("show");
  groupsEl.classList.toggle("down");
});

// Group click
groupsEl.addEventListener("click", (e) => {
  if (e.target.tagName === "LI") {
    const selectedRoom = e.target.dataset.room;
    currentRoom = selectedRoom;
    localStorage.setItem('room', selectedRoom);
    messagesEl.innerHTML = '';
    sendWS({ type: 'join', username, room: selectedRoom });

    if (window.innerWidth <= 530) {
      groupList.classList.remove("active");
      chatContainer.classList.add("active");
    }
  }
});

// Back button
backBtn.addEventListener("click", () => {
  if (window.innerWidth <= 530) {
    chatContainer.classList.remove("active");
    groupList.classList.add("active");
  }
});

// Join or create room
function joinChat() {
  const roomName = newRoomInput.value.trim();
  if (!roomName) return;

  sendWS({ type: 'createRoom', room: roomName });

  currentRoom = roomName;
  localStorage.setItem('room', roomName);
  messagesEl.innerHTML = '';
  sendWS({ type: 'join', username, room: currentRoom });

  joinForm.classList.remove('show');
  groupsEl.classList.toggle("down");
  newRoomInput.value = '';
}
joinRoomBtn.addEventListener('click', joinChat);
