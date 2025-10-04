**🗨️ Chat App Messenger**

A real-time full-stack chat application built using **HTML, CSS, JavaScript, Express.js, MongoDB,** and **WebSockets**.
It enables users to create chat rooms, exchange instant messages, and receive **push notifications** even when the browser is closed — powered by **Service Worker** (sw.js) and Push API.

**Live Demo** 👉 https://chat-app-indol-gamma.vercel.app/

**🚀 Features:-**

**👤 User Authentication**

Simple username-based login (no password required).

Prevents duplicate usernames within the same room.

**💬 Chat Rooms**

Create new chat rooms or join existing ones.

Real-time communication with all users in the same room.

Displays a list of available rooms on the left panel.

Each message includes:

Username of sender

Timestamp

Automatic scroll to newest message

**⚙️ Message Management**

Delete messages you sent:

🖱️ Desktop: Right-click a message to delete it.

📱 Mobile: Long-press a message to delete it.

Deletion updates in real time across all connected clients.

**🏠 Room Management**

Delete chat rooms you created.

Once deleted, all associated messages are removed from the database.

**🔔 Push Notifications**

Receive real-time message notifications via the Service Worker (sw.js), even when:

The browser tab is closed.

The user is on another page.

Fully implemented using the Push API and Notification API.

**📱 Responsive UI**

Optimized for all device sizes:

Laptop/Desktop: Split-view layout (Rooms → Left, Messages → Right).

Tablet: Adaptive 2-column layout.

Mobile: Sequential views (Join → Room → Chat).

**💾 Data Persistence**

Messages and rooms stored in MongoDB.

WebSockets ensure synchronization across all clients in real time.
