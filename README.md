# P2P File Share

Browser-to-browser file transfer. Two people open the page, enter the same
room code, and files move **directly between their browsers** using WebRTC —
never uploaded to your server. Works across different networks (home,
office, mobile, different countries) because WebRTC handles NAT traversal.

## How it works

1. Both browsers connect to a small **signaling server** (`server.js`) over
   WebSocket, and join the same "room" using a shared code.
2. The signaling server introduces them to each other by relaying a WebRTC
   handshake (SDP offer/answer + ICE candidates). This is just a few KB of
   text — no file data touches this server.
3. Once the handshake completes, the browsers open a direct
   `RTCDataChannel` to each other (P2P) and stream the file through it in
   64KB chunks, with backpressure handling so large files don't blow up
   memory.
4. The receiving browser reassembles the chunks into a `Blob` and offers it
   as a download — no disk write on your server, no temp storage, no file
   size limit imposed by you.

## Running it locally

```bash
npm install
npm start
```

This starts the signaling server on port 8080. Then open
`public/index.html` in two browser windows (or two different computers) —
you'll need to serve the `public/` folder too, e.g.:

```bash
npx serve public
```

Enter/generate a room code in one window, click Connect, then enter the
**same code** in the other window and click Connect. Once you see "Ready to
send files," drag a file onto the drop zone.

## Deploying it for real cross-network use

- **Signaling server**: deploy `server.js` to any Node host — Render,
  Railway, Fly.io, a small VPS, etc. It's stateless and cheap to run (it
  only relays tiny JSON messages).
- **Client**: host `public/index.html` anywhere static — Vercel, Netlify,
  GitHub Pages, or your own server.
- Update `SIGNALING_URL` in `index.html` to point at your deployed
  signaling server (must be `wss://` if your page is served over `https://`).

## NAT traversal note (important for a real product)

The STUN servers in the code (Google's public ones) let most home/office
routers negotiate a direct connection. But some networks — corporate
firewalls, symmetric NAT, some mobile carriers — block this entirely. For
those cases you need a **TURN server**, which relays the actual file bytes
when a direct P2P path isn't possible (this is what services like Tailscale
and Zoom fall back to). Options:

- Run your own with [coturn](https://github.com/coturn/coturn) (free, self-hosted)
- Use a managed TURN provider (Twilio, Cloudflare Calls, Xirsys, Metered)

Add the TURN credentials to the `ICE_SERVERS` array in `index.html`.

## Ideas for turning this into a full product

- **Multi-file / folder support**: zip client-side before sending, or loop
  `sendFile()` over multiple files (already supported for multiple files
  dropped at once).
- **QR code** for the room link, so mobile-to-desktop is one scan.
- **End-to-end encryption**: WebRTC data channels are already encrypted
  (DTLS) in transit, but you could add an app-level layer if you want
  zero-trust of the signaling server too.
- **Persistent "rooms"/accounts**: pair devices once (like Tailscale) rather
  than re-sharing a code every time — store paired device keys server-side.
- **Progress resumability**: track chunk offsets so an interrupted transfer
  can resume rather than restart.
- **Rate limiting / room expiry** on the signaling server to prevent abuse.
