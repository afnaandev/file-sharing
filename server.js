// Minimal WebRTC signaling server.
// It never sees file contents — it only relays small JSON messages
// (SDP offers/answers and ICE candidates) between two browsers
// so they can establish a direct peer-to-peer connection.

const { WebSocketServer } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('P2P file share signaling server is running.\n');
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
