import express from "express";
import cookieParser from "cookie-parser";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { Server } from "socket.io";
import { z } from "zod";
import { authService, publicUser, COOKIE, cookieOptions, readCookie } from "./auth.js";
import { boardService, ApiError } from "./boards.js";

const id = z.coerce.number().int().positive();
const text = (max) => z.string().trim().min(1).max(max);
const schemas = {
  register: z.object({ email: z.email().transform((e) => e.toLowerCase()), name: text(60), password: z.string().min(8).max(128) }),
  login: z.object({ email: z.email().transform((e) => e.toLowerCase()), password: z.string().min(1) }),
  name: z.object({ name: text(80) }),
  title: z.object({ title: text(200) }),
  move: z.object({ beforeId: id.nullable().default(null), afterId: id.nullable().default(null) }),
  moveCard: z.object({ listId: id, beforeId: id.nullable().default(null), afterId: id.nullable().default(null) }),
  card: z.object({
    title: text(200).optional(),
    description: z.string().max(5000).optional(),
    assigneeId: id.nullable().optional(),
    dueDate: z.iso.date().nullable().optional(),
    label: z.enum(["red", "amber", "green", "blue", "violet"]).nullable().optional(),
  }),
};

const parse = (schema, value) => {
  const r = schema.safeParse(value ?? {});
  if (!r.success) throw new ApiError(422, r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return r.data;
};

/**
 * Creates the HTTP server, REST API and Socket.IO realtime layer.
 * Every mutation goes through REST; the resulting events are broadcast to
 * everyone in the board's room, including the sender's other tabs.
 */
export function createApp({ db, secureCookies = false, clientDir }) {
  const app = express();
  const http = createServer(app);
  const io = new Server(http, { serveClient: false });
  const auth = authService(db);
  const boards = boardService(db);

  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));
  app.use(cookieParser());

  const api = express.Router();
  const authed = (req, _res, next) => {
    req.user = auth.userForToken(req.cookies[COOKIE]);
    if (!req.user) return next(new ApiError(401, "Please sign in"));
    next();
  };

  /** Runs a mutation, broadcasts its events, responds with them. */
  const emit = (result, req) => {
    for (const event of result.events) io.to(`board:${result.boardId}`).emit("board:event", { ...event, boardId: result.boardId, actorId: req.user.id });
    return result;
  };

  // ----- auth -----
  api.post("/auth/register", async (req, res) => {
    const body = parse(schemas.register, req.body);
    const user = await auth.register(body);
    if (!user) throw new ApiError(409, "An account with this email already exists");
    res.cookie(COOKIE, auth.createSession(user.id), cookieOptions(secureCookies)).status(201).json({ user: publicUser(user) });
  });
  api.post("/auth/login", async (req, res) => {
    const user = await auth.login(parse(schemas.login, req.body));
    if (!user) throw new ApiError(401, "Email or password is incorrect");
    res.cookie(COOKIE, auth.createSession(user.id), cookieOptions(secureCookies)).json({ user: publicUser(user) });
  });
  api.post("/auth/logout", (req, res) => {
    auth.destroySession(req.cookies[COOKIE]);
    res.clearCookie(COOKIE, { path: "/" }).status(204).end();
  });
  api.get("/auth/me", (req, res) => res.json({ user: publicUser(auth.userForToken(req.cookies[COOKIE])) }));

  // ----- boards -----
  api.get("/boards", authed, (req, res) => res.json({ boards: boards.listBoards(req.user.id) }));
  api.post("/boards", authed, (req, res) => res.status(201).json({ id: boards.createBoard(req.user.id, parse(schemas.name, req.body).name) }));
  api.get("/boards/:id", authed, (req, res) => res.json({ board: boards.getBoard(parse(id, req.params.id), req.user.id) }));
  api.patch("/boards/:id", authed, (req, res) => res.json(emit(boards.renameBoard(parse(id, req.params.id), req.user.id, parse(schemas.name, req.body).name), req)));
  api.delete("/boards/:id", authed, (req, res) => {
    emit(boards.deleteBoard(parse(id, req.params.id), req.user.id), req);
    res.status(204).end();
  });
  api.post("/boards/:id/invite", authed, (req, res) => res.json({ inviteCode: boards.resetInvite(parse(id, req.params.id), req.user.id) }));
  api.post("/join/:code", authed, (req, res) => res.json(emit(boards.join(String(req.params.code), req.user), req)));
  api.delete("/boards/:id/members/:userId", authed, (req, res) => {
    const boardId = parse(id, req.params.id), userId = parse(id, req.params.userId);
    emit(boards.removeMember(boardId, req.user.id, userId), req);
    // Drop the removed user's sockets from the room so they stop receiving updates.
    io.in(`user:${userId}`).socketsLeave(`board:${boardId}`);
    res.status(204).end();
  });

  // ----- lists & cards -----
  api.post("/boards/:id/lists", authed, (req, res) => res.status(201).json(emit(boards.createList(parse(id, req.params.id), req.user.id, parse(schemas.title, req.body).title), req)));
  api.patch("/lists/:id", authed, (req, res) => res.json(emit(boards.renameList(parse(id, req.params.id), req.user.id, parse(schemas.title, req.body).title), req)));
  api.post("/lists/:id/move", authed, (req, res) => res.json(emit(boards.moveList(parse(id, req.params.id), req.user.id, parse(schemas.move, req.body)), req)));
  api.delete("/lists/:id", authed, (req, res) => res.json(emit(boards.deleteList(parse(id, req.params.id), req.user.id), req)));
  api.post("/lists/:id/cards", authed, (req, res) => res.status(201).json(emit(boards.createCard(parse(id, req.params.id), req.user.id, parse(schemas.title, req.body).title), req)));
  api.patch("/cards/:id", authed, (req, res) => res.json(emit(boards.updateCard(parse(id, req.params.id), req.user.id, parse(schemas.card, req.body)), req)));
  api.post("/cards/:id/move", authed, (req, res) => res.json(emit(boards.moveCard(parse(id, req.params.id), req.user.id, parse(schemas.moveCard, req.body)), req)));
  api.delete("/cards/:id", authed, (req, res) => res.json(emit(boards.deleteCard(parse(id, req.params.id), req.user.id), req)));

  api.use((_req, _res, next) => next(new ApiError(404, "Not found")));
  app.use("/api", api);

  // Serve the built client in production (single origin, so cookies just work).
  if (clientDir && existsSync(clientDir)) {
    app.use(express.static(clientDir, { maxAge: "1h", index: false }));
    app.get(/^\/(?!api|socket\.io).*/, (_req, res) => res.sendFile("index.html", { root: clientDir }));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err instanceof ApiError ? err.status : err.type === "entity.parse.failed" ? 400 : 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? "Something went wrong" : err.message });
  });

  // ----- realtime -----
  // presence: boardId -> Map(userId -> { user, sockets })
  const presence = new Map();
  const online = (boardId) => [...(presence.get(boardId)?.values() ?? [])].map((p) => p.user.id);
  const leave = (socket, boardId) => {
    const room = presence.get(boardId);
    const entry = room?.get(socket.data.user.id);
    if (!entry) return;
    entry.sockets.delete(socket.id);
    if (!entry.sockets.size) room.delete(socket.data.user.id);
    socket.leave(`board:${boardId}`);
    io.to(`board:${boardId}`).emit("presence", { boardId, online: online(boardId) });
  };

  io.use((socket, next) => {
    const user = auth.userForToken(readCookie(socket.handshake.headers.cookie, COOKIE));
    if (!user) return next(new Error("unauthorized"));
    socket.data.user = publicUser(user);
    socket.data.boards = new Set();
    next();
  });

  io.on("connection", (socket) => {
    socket.join(`user:${socket.data.user.id}`);

    socket.on("board:join", (boardId, ack = () => {}) => {
      boardId = Number(boardId);
      if (!boards.isMember(boardId, socket.data.user.id)) return ack({ ok: false, error: "forbidden" });
      socket.join(`board:${boardId}`);
      socket.data.boards.add(boardId);
      if (!presence.has(boardId)) presence.set(boardId, new Map());
      const room = presence.get(boardId);
      if (!room.has(socket.data.user.id)) room.set(socket.data.user.id, { user: socket.data.user, sockets: new Set() });
      room.get(socket.data.user.id).sockets.add(socket.id);
      io.to(`board:${boardId}`).emit("presence", { boardId, online: online(boardId) });
      ack({ ok: true });
    });

    socket.on("board:leave", (boardId) => {
      leave(socket, Number(boardId));
      socket.data.boards.delete(Number(boardId));
    });

    socket.on("disconnect", () => socket.data.boards.forEach((b) => leave(socket, b)));
  });

  return { app, http, io };
}
