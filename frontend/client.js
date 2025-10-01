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

// Open a single WebSocket connection
const ws = new WebSocket('wss://chat-app-kyp7.onrender.com');

ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ type: 'init', username }));

  if (currentRoom) {
    ws.send(JSON.stringify({ type: 'join', username, room: currentRoom }));
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
    ws.send(JSON.stringify({ type: 'join', username, room: selectedRoom }));

    // Switch layout in mobile view
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

// Reuse joinChat logic for chat.html
function joinChat() {
  const roomName = newRoomInput.value.trim();
  if (!roomName) return;

  ws.send(JSON.stringify({ type: 'createRoom', room: roomName }));

  currentRoom = roomName;
  messagesEl.innerHTML = '';
  ws.send(JSON.stringify({ type: 'join', username, room: currentRoom }));

  joinForm.classList.remove('show');
  groupsEl.classList.toggle("down");
  newRoomInput.value = '';
}

joinRoomBtn.addEventListener('click', joinChat);

// Render the left group sidebar with delete button
function renderGroups(groups) {
  groupsEl.innerHTML = '';

  groups.forEach(group => {
    const li = document.createElement('li');
    li.dataset.room = group;
    li.textContent = group;

    // Group delete button
    const delBtn = document.createElement('button');
    delBtn.textContent = 'Delete';
    delBtn.className = 'delete-group-btn';
    delBtn.style.display = 'none';
    li.appendChild(delBtn);

    // Right-click (desktop) to show delete
    li.addEventListener('contextmenu', e => {
      e.preventDefault();
      delBtn.style.display = 'inline-block';
      delBtn.classList.add('show');
    });

    // Long press (mobile)
    let pressTimer;
    li.addEventListener('touchstart', () => {
      pressTimer = setTimeout(() => {
        delBtn.style.display = 'inline-block';
        delBtn.classList.add('show');
      }, 600);
    });
    li.addEventListener('touchend', () => clearTimeout(pressTimer));

    // Click outside to hide
    document.addEventListener('click', e => {
      if (!li.contains(e.target)) {
        delBtn.classList.remove('show');
        delBtn.style.display = 'none';
      }
    });

    // Delete group on click
    delBtn.addEventListener('click', () => {
      ws.send(JSON.stringify({ type: 'deleteGroup', room: group }));
    });

    groupsEl.appendChild(li);
  });
}

// ✅ Format time for Today / Yesterday
function formatMessageTime(ts) {
  const date = new Date(ts);
  const now = new Date();

  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  if (isToday) {
    return `Today ${date.toLocaleTimeString()}`;
  } else if (isYesterday) {
    return `Yesterday ${date.toLocaleTimeString()}`;
  } else {
    return date.toLocaleString(); // fallback full date
  }
}

// Render messages with delete button for your own messages
function renderMessage(data) {
  const div = document.createElement('div');

  if (data.type === 'system') {
    div.className = 'system';
    div.textContent = data.message;
  } else if (data.type === 'chat') {
    div.className = 'message';
    div.id = data.id;

    const formattedTime = formatMessageTime(data.timestamp || data.time);
    div.innerHTML = `<div style="display:flex; flex-direction:column; justify-content: center; gap:10px">
                        ${data.username} [${formattedTime}]
                        <div class="message"><b>${data.message}</b></div>
                    <div/>`;

    if (data.username === username) {
      const message = div.querySelector(".message")
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
        ws.send(JSON.stringify({ type: 'delete', id: data.id }));
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
  ws.send(JSON.stringify({ type: 'message', message: msg, room: currentRoom }));
  inputEl.value = '';
}
