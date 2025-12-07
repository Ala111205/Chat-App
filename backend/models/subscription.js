const mongoose = require('mongoose');
const SubscriptionSchema = new mongoose.Schema({
  username: String,
  endpoint: String,
  keys: Object
});
module.exports = mongoose.model('Subscription', SubscriptionSchema);
