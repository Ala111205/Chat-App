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

// ✅ Create WebSocket connection
let ws = new WebSocket('wss://chat-app-kyp7.onrender.com');

// ✅ Safe send wrapper
function sendWS(data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  } else {
    console.warn("⚠️ WebSocket not open. Skipped:", data);
  }
}

ws.addEventListener('open', () => {
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
  }
});

// ✅ Reconnect on close
ws.addEventListener('close', () => {
  console.warn("🔌 WebSocket closed. Reconnecting in 2s...");
  setTimeout(() => {
    window.location.reload();
  }, 2000);
});

ws.addEventListener('error', err => {
  console.error("⚠️ WebSocket error:", err);
});

// Show join/create form when icon clicked
addRoomIcon.addEventListener('click', () => {
  joinForm.classList.toggle("show");
  groupsEl.classList.toggle("down");
});

// ✅ Single event listener for group click
groupsEl.addEventListener("click", (e) => {
  if (e.target.tagName === "LI") {
    const selectedRoom = e.target.dataset.room;
    currentRoom = selectedRoom;
    messagesEl.innerHTML = '';
    sendWS({ type: 'join', username, room: selectedRoom });

    if (window.innerWidth <= 530) {
      groupList.classList.remove("active");
      chatContainer.classList.add("active");
    }
  }
});

// ✅ Back button for mobile
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
  messagesEl.innerHTML = '';
  sendWS({ type: 'join', username, room: currentRoom });

  joinForm.classList.remove('show');
  groupsEl.classList.toggle("down");
  newRoomInput.value = '';
}
joinRoomBtn.addEventListener('click', joinChat);

// Render groups
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

    delBtn.addEventListener('click', () => {
      sendWS({ type: 'deleteGroup', room: group });
    });

    groupsEl.appendChild(li);
  });
}

// Format time
function formatMessageTime(ts) {
  const date = new Date(ts);
  const now = new Date();

  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  if (isToday) return `Today ${date.toLocaleTimeString()}`;
  else if (isYesterday) return `Yesterday ${date.toLocaleTimeString()}`;
  else return date.toLocaleString();
}

// Render messages
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

      div.addEventListener('contextmenu', e => {
        e.preventDefault();
        btn.classList.add('show');
      });

      document.addEventListener('click', e => {
        if (!div.contains(e.target)) btn.classList.remove('show');
      });

      let pressTimer;
      div.addEventListener('touchstart', () => {
        pressTimer = setTimeout(() => btn.classList.add('show'), 600);
      });
      div.addEventListener('touchend', () => clearTimeout(pressTimer));

      btn.addEventListener('click', () => {
        sendWS({ type: 'delete', id: data.id });
      });
    }
  }

  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Send message
sendBtn.addEventListener('click', sendMessage);
inputEl.addEventListener('keypress', e => {
  if (e.key === 'Enter') sendMessage();
});

function sendMessage() {
  const msg = inputEl.value.trim();
  if (!msg || !currentRoom) return;
  sendWS({ type: 'message', message: msg, room: currentRoom });
  inputEl.value = '';
}
