const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  room: String,
  username: String,
  message: String,
  time: String,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Message", messageSchema);
