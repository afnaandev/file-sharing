// Minimal WebRTC signaling server.
// It never sees file contents — it only relays small JSON messages
// (SDP offers/answers and ICE candidates) between two browsers
// so they can establish a direct peer-to-peer connection.

const { WebSocketServer } = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = __dirname; // index.html lives right next to server.js, no public/ subfolder

const MIME_TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

// This server now does two jobs: serves the static client page (public/index.html)
// AND handles the WebSocket signaling — so you deploy ONE service and get ONE URL.
const server = http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(PUBLIC_DIR, path.normalize(filePath).replace(/^(\.\.[\/\\])+/, ''));

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

// rooms: Map<roomCode, Set<ws>>
const rooms = new Map();

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

wss.on('connection', (ws) => {
  ws.roomCode = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return; // ignore malformed messages
    }

    if (msg.type === 'join') {
      const room = String(msg.room || '').trim();
      if (!room) return;

      let peers = rooms.get(room);
      if (!peers) {
        peers = new Set();
        rooms.set(room, peers);
      }

      if (peers.size >= 2) {
        ws.send(JSON.stringify({ type: 'room-full' }));
        return;
      }

      peers.add(ws);
      ws.roomCode = room;
      log(`Peer joined room "${room}" (${peers.size}/2)`);

      // Tell this peer whether it's first (offerer) or second (answerer)
      ws.send(JSON.stringify({
        type: 'joined',
        initiator: peers.size === 1,
      }));

      // If room is now full, tell both peers they can start
      if (peers.size === 2) {
        for (const peer of peers) {
          peer.send(JSON.stringify({ type: 'ready' }));
        }
      }
      return;
    }

    // Relay signaling messages (offer/answer/ice-candidate) to the other peer in the room
    if (['offer', 'answer', 'ice-candidate'].includes(msg.type)) {
      const peers = rooms.get(ws.roomCode);
      if (!peers) return;
      for (const peer of peers) {
        if (peer !== ws && peer.readyState === peer.OPEN) {
          peer.send(JSON.stringify(msg));
        }
      }
    }
  });

  ws.on('close', () => {
    if (ws.roomCode && rooms.has(ws.roomCode)) {
      const peers = rooms.get(ws.roomCode);
      peers.delete(ws);
      // Let the remaining peer know the other side left
      for (const peer of peers) {
        peer.send(JSON.stringify({ type: 'peer-left' }));
      }
      if (peers.size === 0) rooms.delete(ws.roomCode);
      log(`Peer left room "${ws.roomCode}"`);
    }
  });
});

server.listen(PORT, () => {
  log(`Signaling server listening on port ${PORT}`);
});
