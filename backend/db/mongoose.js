const mongoose = require('mongoose');

// Cache the connection across serverless function invocations.
// On Vercel, each warm instance reuses the existing connection instead of
// re-connecting on every request.
let cached = global._mongooseCache;
if (!cached) {
  cached = global._mongooseCache = { conn: null, promise: null };
}

async function connectDB() {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose.connect(process.env.MONGO_URI, {
      bufferCommands: false,      // fail fast instead of buffering when not connected
      serverSelectionTimeoutMS: 10000,
    });
  }

  try {
    cached.conn = await cached.promise;
    console.log(`🗄️  MongoDB connected: ${cached.conn.connection.host}`);
  } catch (err) {
    cached.promise = null;        // allow retry on next request
    throw err;
  }

  return cached.conn;
}

module.exports = connectDB;
