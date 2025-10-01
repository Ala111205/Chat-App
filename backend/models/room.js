const mongoose = require("mongoose");

const roomSchema = new mongoose.Schema({
  name: { type: String, unique: true },
  members: [String], // usernames of joined users
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Room", roomSchema);
