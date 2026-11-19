# TaskHive

Real-time kanban boards for small teams. Drag cards between lists, and everyone on the board sees the change instantly, without refreshing.

- **Boards, lists and cards** with drag and drop for both cards and lists (mouse, pen and touch)
- **Live sync** over WebSockets: every create, edit, move and delete appears in every open browser
- **Presence**: see which members are on the board right now
- **Invite links** that the owner can copy and reset at any time, plus member removal and leaving a board
- **Card details**: description, assignee, due date with overdue highlighting, colour labels, and a keyboard-friendly "Move to" control
- **Activity feed** of who did what
- **Accounts** with scrypt-hashed passwords and HttpOnly session cookies, shared by the REST API and the WebSocket handshake

## Quick start

Requires Node.js 22.13 or newer (it uses the built-in `node:sqlite`, so there's nothing native to compile).

```bash
npm install
npm run dev
```

This starts the API on port 3001 and the Vite dev server on http://localhost:5173, which proxies `/api` and `/socket.io` to the API. Create an account, make a board, then open the invite link in a different browser profile to see changes sync between two users.

For production:

```bash
npm run build      # builds the client into dist/
NODE_ENV=production PORT=3000 npm start
```

The server serves the built client and the API from one origin.

## How it works

### One write path, one update path

Every mutation is a REST call. The server applies it in SQLite and returns a list of **events** (`card.moved`, `list.created`, `member.joined` and so on), then broadcasts those same events to the board's Socket.IO room. The client keeps board state in a reducer over those events. The tab that made a change and every other tab apply it through the same code, so there's no separate "local" and "remote" path to drift apart.

The dragging tab also applies the move optimistically for instant feedback. The server's broadcast then replaces it with the authoritative position.

### Ordering with fractional positions

Cards and lists have a floating-point `position`. Moving a card sends the ids of its new neighbours, not an index:

```
POST /api/cards/42/move   { "listId": 3, "beforeId": 17, "afterId": 9 }
```

The server places the card at the midpoint of the neighbours' positions, so a move is a single-row update no matter how long the list is. Sending neighbour ids rather than positions means two people dragging at the same moment can't corrupt the order. If repeated inserts at the same spot shrink the gap below floating-point precision, the list is renumbered in the same transaction.

### Realtime security

The WebSocket handshake reads the same session cookie as the API, so unauthenticated sockets are rejected. Joining a board's room requires membership. When a member is removed, the server pulls all of their sockets out of the room immediately, so they stop receiving updates even though their connection stays open.

### Reconnects

If the connection drops, the board shows a "Reconnecting…" badge. On reconnect the client rejoins the room and reloads the board, so it picks up anything that changed while it was offline.

## API

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` | Accounts and sessions |
| GET | `/api/auth/me` | Current user |
| GET, POST | `/api/boards` | Your boards, or create one (with To do, In progress and Done lists) |
| GET, PATCH, DELETE | `/api/boards/:id` | Full board state, rename, delete (owner) |
| POST | `/api/boards/:id/invite` | Reset the invite code (owner) |
| POST | `/api/join/:code` | Join a board with an invite code |
| DELETE | `/api/boards/:id/members/:userId` | Remove a member (owner) or leave |
| POST | `/api/boards/:id/lists` | Add a list |
| PATCH, DELETE | `/api/lists/:id` | Rename or delete a list |
| POST | `/api/lists/:id/move` | Reorder (`beforeId`, `afterId`) |
| POST | `/api/lists/:id/cards` | Add a card |
| PATCH, DELETE | `/api/cards/:id` | Edit (`title`, `description`, `assigneeId`, `dueDate`, `label`) or delete |
| POST | `/api/cards/:id/move` | Move (`listId`, `beforeId`, `afterId`) |

Socket.IO events: the client emits `board:join` and `board:leave`; the server emits `board:event` and `presence`.

## Project structure

```
server/
  index.js        Process entry and graceful shutdown
  app.js          Express routes, validation, Socket.IO rooms and presence
  boards.js       Board logic; every mutation returns the events to broadcast
  position.js     Fractional ordering and rebalancing
  auth.js         Password hashing, sessions, cookie parsing for sockets
  db.js           SQLite schema and migrations
client/src/
  useBoard.js     Socket connection plus the event reducer
  BoardPage.jsx   Board UI and drag and drop (dnd-kit)
  CardModal.jsx   Card details dialog
  ...
test/server.test.js  API and realtime tests with real sockets
```

## Testing

```bash
npm test
```

The tests start the real server on a random port with an in-memory database, and cover authentication, membership and invite codes, ordering and rebalancing under many inserts, validation, owner-only actions, rejecting unauthenticated sockets, broadcasting changes and presence between two users, and cutting off removed members.

## Deployment

TaskHive is one Node process with a SQLite file, which suits a small VPS, Render, Fly.io or Railway with a persistent volume. Set `NODE_ENV=production`, `PORT`, and `DATABASE_PATH` pointing at the volume. Presence is kept in memory, so run a single instance. Scaling out means adding the Socket.IO Redis adapter and moving to Postgres.

| Variable | Default | |
|---|---|---|
| `PORT` | `3001` | |
| `DATABASE_PATH` | `./data/taskhive.db` | |
| `NODE_ENV` | | `production` enables secure cookies |
| `INSECURE_COOKIES` | | Set to `1` to test a production build over plain http on localhost |

## License

MIT © Raymond Pingol Blanco Jr.
