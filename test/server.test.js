import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { io as connect } from "socket.io-client";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import { between, needsRebalance } from "../server/position.js";

const open = [];
afterEach(async () => {
  for (const fn of open.splice(0)) await fn();
});

async function setup() {
  const db = openDatabase(":memory:");
  const { http, io } = createApp({ db });
  await new Promise((r) => http.listen(0, r));
  const url = `http://localhost:${http.address().port}`;
  open.push(() => new Promise((r) => { io.close(); http.close(r); }));

  async function user(name = "Ada") {
    const agent = request.agent(http);
    const email = `${name.toLowerCase()}${Math.random().toString(36).slice(2, 7)}@example.com`;
    const res = await agent.post("/api/auth/register").send({ email, name, password: "password123" });
    const cookie = res.headers["set-cookie"][0].split(";")[0];
    return { agent, cookie, user: res.body.user };
  }

  function socketFor(cookie) {
    const s = connect(url, { extraHeaders: { cookie }, transports: ["websocket"], forceNew: true });
    open.push(() => s.close());
    return s;
  }

  return { db, http, user, socketFor };
}

const waitFor = (socket, event, predicate = () => true, ms = 2000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
    const h = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(t);
      socket.off(event, h);
      resolve(payload);
    };
    socket.on(event, h);
  });

describe("positions", () => {
  it("places items between neighbours", () => {
    expect(between(null, null)).toBe(1024);
    expect(between(1024, null)).toBe(2048);
    expect(between(null, 1024)).toBe(0);
    expect(between(1024, 2048)).toBe(1536);
    expect(needsRebalance(1, 1 + 1e-9)).toBe(true);
  });
});

describe("auth", () => {
  it("registers, keeps a session cookie and logs out", async () => {
    const { user } = await setup();
    const { agent } = await user();
    expect((await agent.get("/api/auth/me")).body.user.name).toBe("Ada");
    await agent.post("/api/auth/logout");
    expect((await agent.get("/api/auth/me")).body.user).toBeNull();
    expect((await agent.get("/api/boards")).status).toBe(401);
  });

  it("rejects bad credentials", async () => {
    const { http } = await setup();
    const res = await request(http).post("/api/auth/login").send({ email: "nobody@example.com", password: "x" });
    expect(res.status).toBe(401);
  });
});

describe("boards", () => {
  it("creates a board with default lists", async () => {
    const { user } = await setup();
    const { agent } = await user();
    const { body } = await agent.post("/api/boards").send({ name: "Launch" });
    const board = (await agent.get(`/api/boards/${body.id}`)).body.board;
    expect(board.lists.map((l) => l.title)).toEqual(["To do", "In progress", "Done"]);
    expect(board.role).toBe("owner");
    expect(board.inviteCode).toBeTruthy();
  });

  it("keeps non-members out and lets people join with an invite code", async () => {
    const { user } = await setup();
    const owner = await user("Owner");
    const guest = await user("Guest");
    const { body } = await owner.agent.post("/api/boards").send({ name: "Private" });
    expect((await guest.agent.get(`/api/boards/${body.id}`)).status).toBe(403);

    const { inviteCode } = (await owner.agent.get(`/api/boards/${body.id}`)).body.board;
    expect((await guest.agent.post(`/api/join/${inviteCode}`)).body.boardId).toBe(body.id);
    const seen = (await guest.agent.get(`/api/boards/${body.id}`)).body.board;
    expect(seen.role).toBe("member");
    expect(seen.inviteCode).toBeUndefined();

    // Resetting the code invalidates the old link.
    await owner.agent.post(`/api/boards/${body.id}/invite`);
    const third = await user("Third");
    expect((await third.agent.post(`/api/join/${inviteCode}`)).status).toBe(404);
  });

  it("moves cards between lists and orders them by neighbours", async () => {
    const { user } = await setup();
    const { agent } = await user();
    const { body: { id } } = await agent.post("/api/boards").send({ name: "B" });
    const [todo, doing] = (await agent.get(`/api/boards/${id}`)).body.board.lists;
    const add = async (title) => (await agent.post(`/api/lists/${todo.id}/cards`).send({ title })).body.events[0].card;
    const a = await add("A"), b = await add("B"), c = await add("C");

    // Move C between A and B in the same list.
    await agent.post(`/api/cards/${c.id}/move`).send({ listId: todo.id, beforeId: a.id, afterId: b.id });
    // Move A to the other list.
    await agent.post(`/api/cards/${a.id}/move`).send({ listId: doing.id });

    const board = (await agent.get(`/api/boards/${id}`)).body.board;
    const titles = (listId) => board.cards.filter((x) => x.listId === listId).sort((p, q) => p.position - q.position).map((x) => x.title);
    expect(titles(todo.id)).toEqual(["C", "B"]);
    expect(titles(doing.id)).toEqual(["A"]);
    expect(board.activity[0].message).toBe('moved "A" to In progress');
  });

  it("survives many inserts at the same spot by rebalancing", async () => {
    const { user } = await setup();
    const { agent } = await user();
    const { body: { id } } = await agent.post("/api/boards").send({ name: "B" });
    const [list] = (await agent.get(`/api/boards/${id}`)).body.board.lists;
    const first = (await agent.post(`/api/lists/${list.id}/cards`).send({ title: "first" })).body.events[0].card;
    const last = (await agent.post(`/api/lists/${list.id}/cards`).send({ title: "last" })).body.events[0].card;
    let after = last.id;
    for (let i = 0; i < 60; i++) {
      const card = (await agent.post(`/api/lists/${list.id}/cards`).send({ title: `n${i}` })).body.events[0].card;
      await agent.post(`/api/cards/${card.id}/move`).send({ listId: list.id, beforeId: first.id, afterId: after });
      after = card.id;
    }
    const cards = (await agent.get(`/api/boards/${id}`)).body.board.cards.sort((p, q) => p.position - q.position);
    expect(cards[0].title).toBe("first");
    expect(cards[1].title).toBe("n59");
    expect(cards.at(-1).title).toBe("last");
    expect(new Set(cards.map((c) => c.position)).size).toBe(cards.length);
  });

  it("validates card updates and assignees", async () => {
    const { user } = await setup();
    const owner = await user("Owner");
    const outsider = await user("Outsider");
    const { body: { id } } = await owner.agent.post("/api/boards").send({ name: "B" });
    const [list] = (await owner.agent.get(`/api/boards/${id}`)).body.board.lists;
    const card = (await owner.agent.post(`/api/lists/${list.id}/cards`).send({ title: "Task" })).body.events[0].card;

    expect((await owner.agent.patch(`/api/cards/${card.id}`).send({ label: "pink" })).status).toBe(422);
    expect((await owner.agent.patch(`/api/cards/${card.id}`).send({ assigneeId: outsider.user.id })).status).toBe(400);
    const ok = await owner.agent.patch(`/api/cards/${card.id}`).send({ assigneeId: owner.user.id, label: "green", dueDate: "2026-12-01" });
    expect(ok.body.events[0].card).toMatchObject({ assigneeId: owner.user.id, label: "green", dueDate: "2026-12-01", title: "Task" });
  });

  it("only lets the owner delete a board", async () => {
    const { user } = await setup();
    const owner = await user("Owner");
    const member = await user("Member");
    const { body: { id } } = await owner.agent.post("/api/boards").send({ name: "B" });
    const { inviteCode } = (await owner.agent.get(`/api/boards/${id}`)).body.board;
    await member.agent.post(`/api/join/${inviteCode}`);
    expect((await member.agent.delete(`/api/boards/${id}`)).status).toBe(403);
    expect((await owner.agent.delete(`/api/boards/${id}`)).status).toBe(204);
    expect((await owner.agent.get(`/api/boards/${id}`)).status).toBe(404);
  });
});

describe("realtime", () => {
  it("rejects sockets without a session", async () => {
    const { socketFor } = await setup();
    const s = socketFor("taskhive_session=nope");
    const err = await new Promise((r) => s.on("connect_error", r));
    expect(err.message).toBe("unauthorized");
  });

  it("broadcasts changes and presence to other members", async () => {
    const { user, socketFor } = await setup();
    const owner = await user("Owner");
    const guest = await user("Guest");
    const { body: { id } } = await owner.agent.post("/api/boards").send({ name: "Live" });
    const { inviteCode, lists } = (await owner.agent.get(`/api/boards/${id}`)).body.board;
    await guest.agent.post(`/api/join/${inviteCode}`);

    const ownerSocket = socketFor(owner.cookie);
    const guestSocket = socketFor(guest.cookie);
    expect(await ownerSocket.emitWithAck("board:join", id)).toEqual({ ok: true });
    const presence = waitFor(ownerSocket, "presence", (p) => p.online.length === 2);
    await guestSocket.emitWithAck("board:join", id);
    expect((await presence).online.sort()).toEqual([owner.user.id, guest.user.id].sort());

    const created = waitFor(guestSocket, "board:event", (e) => e.type === "card.created");
    await owner.agent.post(`/api/lists/${lists[0].id}/cards`).send({ title: "Ship it" });
    const event = await created;
    expect(event).toMatchObject({ boardId: id, actorId: owner.user.id, card: { title: "Ship it" } });

    const left = waitFor(ownerSocket, "presence", (p) => p.online.length === 1);
    guestSocket.close();
    expect((await left).online).toEqual([owner.user.id]);
  });

  it("does not let non-members join a board room", async () => {
    const { user, socketFor } = await setup();
    const owner = await user("Owner");
    const outsider = await user("Outsider");
    const { body: { id } } = await owner.agent.post("/api/boards").send({ name: "Secret" });
    const s = socketFor(outsider.cookie);
    expect(await s.emitWithAck("board:join", id)).toEqual({ ok: false, error: "forbidden" });
  });

  it("stops sending updates to removed members", async () => {
    const { user, socketFor } = await setup();
    const owner = await user("Owner");
    const guest = await user("Guest");
    const { body: { id } } = await owner.agent.post("/api/boards").send({ name: "B" });
    const { inviteCode, lists } = (await owner.agent.get(`/api/boards/${id}`)).body.board;
    await guest.agent.post(`/api/join/${inviteCode}`);
    const s = socketFor(guest.cookie);
    await s.emitWithAck("board:join", id);

    const removed = waitFor(s, "board:event", (e) => e.type === "member.left");
    await owner.agent.delete(`/api/boards/${id}/members/${guest.user.id}`);
    await removed;

    let leaked = false;
    s.on("board:event", (e) => { if (e.type === "card.created") leaked = true; });
    await owner.agent.post(`/api/lists/${lists[0].id}/cards`).send({ title: "after removal" });
    await new Promise((r) => setTimeout(r, 150));
    expect(leaked).toBe(false);
  });
});
