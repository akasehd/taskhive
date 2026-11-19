import { randomBytes } from "node:crypto";
import { tx } from "./db.js";
import { between, needsRebalance, rebalance } from "./position.js";

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const notFound = (what) => new ApiError(404, `${what} not found`);
const forbidden = (msg = "You are not a member of this board") => new ApiError(403, msg);
const inviteCode = () => randomBytes(9).toString("base64url");

const toCard = (c) => ({
  id: c.id, listId: c.list_id, title: c.title, description: c.description, assigneeId: c.assignee_id,
  dueDate: c.due_date, label: c.label, position: c.position, createdAt: c.created_at, updatedAt: c.updated_at,
});
const toList = (l) => ({ id: l.id, boardId: l.board_id, title: l.title, position: l.position });

/**
 * All board logic lives here as synchronous functions over the database.
 * Each mutation returns the event to broadcast, so the HTTP layer stays thin
 * and tests can assert on exactly what other clients will receive.
 */
export function boardService(db) {
  const role = (boardId, userId) => db.prepare("SELECT role FROM members WHERE board_id = ? AND user_id = ?").get(boardId, userId)?.role;

  const requireMember = (boardId, userId) => {
    if (!db.prepare("SELECT 1 FROM boards WHERE id = ?").get(boardId)) throw notFound("Board");
    const r = role(boardId, userId);
    if (!r) throw forbidden();
    return r;
  };
  const requireOwner = (boardId, userId) => {
    if (requireMember(boardId, userId) !== "owner") throw forbidden("Only the board owner can do that");
  };

  const listOf = (listId) => {
    const l = db.prepare("SELECT * FROM lists WHERE id = ?").get(listId);
    if (!l) throw notFound("List");
    return l;
  };
  const cardOf = (cardId) => {
    const c = db.prepare("SELECT c.*, l.board_id FROM cards c JOIN lists l ON l.id = c.list_id WHERE c.id = ?").get(cardId);
    if (!c) throw notFound("Card");
    return c;
  };

  const log = (boardId, userId, message) => {
    const at = Date.now();
    const { lastInsertRowid } = db.prepare("INSERT INTO activity (board_id, user_id, message, created_at) VALUES (?, ?, ?, ?)").run(boardId, userId, message, at);
    return { id: Number(lastInsertRowid), userId, message, createdAt: at };
  };

  /** Computes a position between two neighbours in a parent, rebalancing if needed. */
  const place = (table, parentCol, parentId, beforeId, afterId) => {
    const pos = (id) => (id == null ? null : db.prepare(`SELECT position FROM ${table} WHERE id = ? AND ${parentCol} = ?`).get(id, parentId)?.position ?? null);
    let b = pos(beforeId), a = pos(afterId);
    if (needsRebalance(b, a)) {
      rebalance(db, table, parentCol, parentId);
      b = pos(beforeId);
      a = pos(afterId);
    }
    // Neighbours that no longer exist (deleted concurrently) fall back to the end.
    if (b == null && a == null) {
      const last = db.prepare(`SELECT MAX(position) AS p FROM ${table} WHERE ${parentCol} = ?`).get(parentId).p;
      return last == null ? between(null, null) : between(last, null);
    }
    return between(b, a);
  };

  return {
    listBoards(userId) {
      return db.prepare(
        `SELECT b.id, b.name, m.role, b.created_at AS createdAt,
                (SELECT COUNT(*) FROM members WHERE board_id = b.id) AS memberCount,
                (SELECT COUNT(*) FROM cards c JOIN lists l ON l.id = c.list_id WHERE l.board_id = b.id) AS cardCount
         FROM boards b JOIN members m ON m.board_id = b.id AND m.user_id = ? ORDER BY b.created_at DESC`,
      ).all(userId);
    },

    createBoard(userId, name) {
      return tx(db, () => {
        const { lastInsertRowid } = db.prepare("INSERT INTO boards (name, owner_id, invite_code, created_at) VALUES (?, ?, ?, ?)").run(name, userId, inviteCode(), Date.now());
        const id = Number(lastInsertRowid);
        db.prepare("INSERT INTO members (board_id, user_id, role) VALUES (?, ?, 'owner')").run(id, userId);
        ["To do", "In progress", "Done"].forEach((t, i) => db.prepare("INSERT INTO lists (board_id, title, position) VALUES (?, ?, ?)").run(id, t, (i + 1) * 1024));
        log(id, userId, `created the board`);
        return id;
      });
    },

    getBoard(boardId, userId) {
      const myRole = requireMember(boardId, userId);
      const b = db.prepare("SELECT * FROM boards WHERE id = ?").get(boardId);
      return {
        id: b.id, name: b.name, role: myRole,
        inviteCode: myRole === "owner" ? b.invite_code : undefined,
        lists: db.prepare("SELECT * FROM lists WHERE board_id = ? ORDER BY position, id").all(boardId).map(toList),
        cards: db.prepare("SELECT c.* FROM cards c JOIN lists l ON l.id = c.list_id WHERE l.board_id = ? ORDER BY c.position, c.id").all(boardId).map(toCard),
        members: db.prepare("SELECT u.id, u.name, u.color, m.role FROM members m JOIN users u ON u.id = m.user_id WHERE m.board_id = ? ORDER BY m.role DESC, u.name").all(boardId),
        activity: db.prepare("SELECT id, user_id AS userId, message, created_at AS createdAt FROM activity WHERE board_id = ? ORDER BY id DESC LIMIT 30").all(boardId),
      };
    },

    renameBoard(boardId, userId, name) {
      requireMember(boardId, userId);
      db.prepare("UPDATE boards SET name = ? WHERE id = ?").run(name, boardId);
      return { boardId, events: [{ type: "board.updated", board: { id: boardId, name } }, { type: "activity", item: log(boardId, userId, `renamed the board to "${name}"`) }] };
    },

    deleteBoard(boardId, userId) {
      requireOwner(boardId, userId);
      db.prepare("DELETE FROM boards WHERE id = ?").run(boardId);
      return { boardId, events: [{ type: "board.deleted", boardId }] };
    },

    resetInvite(boardId, userId) {
      requireOwner(boardId, userId);
      const code = inviteCode();
      db.prepare("UPDATE boards SET invite_code = ? WHERE id = ?").run(code, boardId);
      return code;
    },

    join(code, user) {
      const b = db.prepare("SELECT id FROM boards WHERE invite_code = ?").get(code);
      if (!b) throw new ApiError(404, "This invite link is invalid or has been reset");
      if (role(b.id, user.id)) return { boardId: b.id, events: [] };
      db.prepare("INSERT INTO members (board_id, user_id, role) VALUES (?, ?, 'member')").run(b.id, user.id);
      return {
        boardId: b.id,
        events: [
          { type: "member.joined", member: { id: user.id, name: user.name, color: user.color, role: "member" } },
          { type: "activity", item: log(b.id, user.id, "joined the board") },
        ],
      };
    },

    removeMember(boardId, actorId, memberId) {
      const actorRole = requireMember(boardId, actorId);
      if (actorId !== memberId && actorRole !== "owner") throw forbidden("Only the board owner can remove members");
      if (role(boardId, memberId) === "owner") throw new ApiError(400, "The owner can't leave their own board. Delete it instead.");
      db.prepare("DELETE FROM members WHERE board_id = ? AND user_id = ?").run(boardId, memberId);
      db.prepare("UPDATE cards SET assignee_id = NULL WHERE assignee_id = ? AND list_id IN (SELECT id FROM lists WHERE board_id = ?)").run(memberId, boardId);
      return { boardId, events: [{ type: "member.left", userId: memberId }, { type: "activity", item: log(boardId, actorId, actorId === memberId ? "left the board" : "removed a member") }] };
    },

    // ----- lists -----
    createList(boardId, userId, title) {
      requireMember(boardId, userId);
      const position = place("lists", "board_id", boardId, null, null);
      const { lastInsertRowid } = db.prepare("INSERT INTO lists (board_id, title, position) VALUES (?, ?, ?)").run(boardId, title, position);
      const list = toList(db.prepare("SELECT * FROM lists WHERE id = ?").get(lastInsertRowid));
      return { boardId, events: [{ type: "list.created", list }, { type: "activity", item: log(boardId, userId, `added the list "${title}"`) }] };
    },

    renameList(listId, userId, title) {
      const l = listOf(listId);
      requireMember(l.board_id, userId);
      db.prepare("UPDATE lists SET title = ? WHERE id = ?").run(title, listId);
      return { boardId: l.board_id, events: [{ type: "list.updated", list: { ...toList(l), title } }] };
    },

    moveList(listId, userId, { beforeId, afterId }) {
      const l = listOf(listId);
      requireMember(l.board_id, userId);
      return tx(db, () => {
        const position = place("lists", "board_id", l.board_id, beforeId, afterId);
        db.prepare("UPDATE lists SET position = ? WHERE id = ?").run(position, listId);
        const lists = db.prepare("SELECT * FROM lists WHERE board_id = ? ORDER BY position, id").all(l.board_id).map(toList);
        return { boardId: l.board_id, events: [{ type: "lists.reordered", lists }] };
      });
    },

    deleteList(listId, userId) {
      const l = listOf(listId);
      requireMember(l.board_id, userId);
      db.prepare("DELETE FROM lists WHERE id = ?").run(listId);
      return { boardId: l.board_id, events: [{ type: "list.deleted", listId }, { type: "activity", item: log(l.board_id, userId, `deleted the list "${l.title}"`) }] };
    },

    // ----- cards -----
    createCard(listId, userId, title) {
      const l = listOf(listId);
      requireMember(l.board_id, userId);
      const now = Date.now();
      const position = place("cards", "list_id", listId, null, null);
      const { lastInsertRowid } = db.prepare(
        "INSERT INTO cards (list_id, title, position, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(listId, title, position, userId, now, now);
      const card = toCard(db.prepare("SELECT * FROM cards WHERE id = ?").get(lastInsertRowid));
      return { boardId: l.board_id, events: [{ type: "card.created", card }, { type: "activity", item: log(l.board_id, userId, `added "${title}" to ${l.title}`) }] };
    },

    updateCard(cardId, userId, patch) {
      const c = cardOf(cardId);
      requireMember(c.board_id, userId);
      if (patch.assigneeId != null && !role(c.board_id, patch.assigneeId)) throw new ApiError(400, "Assignee must be a board member");
      const next = {
        title: patch.title ?? c.title,
        description: patch.description ?? c.description,
        assignee_id: patch.assigneeId !== undefined ? patch.assigneeId : c.assignee_id,
        due_date: patch.dueDate !== undefined ? patch.dueDate : c.due_date,
        label: patch.label !== undefined ? patch.label : c.label,
      };
      db.prepare("UPDATE cards SET title = ?, description = ?, assignee_id = ?, due_date = ?, label = ?, updated_at = ? WHERE id = ?")
        .run(next.title, next.description, next.assignee_id, next.due_date, next.label, Date.now(), cardId);
      const card = toCard(db.prepare("SELECT * FROM cards WHERE id = ?").get(cardId));
      return { boardId: c.board_id, events: [{ type: "card.updated", card }] };
    },

    moveCard(cardId, userId, { listId, beforeId, afterId }) {
      const c = cardOf(cardId);
      requireMember(c.board_id, userId);
      const target = listOf(listId);
      if (target.board_id !== c.board_id) throw new ApiError(400, "Cards can only move within their board");
      return tx(db, () => {
        const position = place("cards", "list_id", listId, beforeId, afterId);
        db.prepare("UPDATE cards SET list_id = ?, position = ?, updated_at = ? WHERE id = ?").run(listId, position, Date.now(), cardId);
        const card = toCard(db.prepare("SELECT * FROM cards WHERE id = ?").get(cardId));
        const events = [{ type: "card.moved", card }];
        if (c.list_id !== listId) events.push({ type: "activity", item: log(c.board_id, userId, `moved "${c.title}" to ${target.title}`) });
        return { boardId: c.board_id, events };
      });
    },

    deleteCard(cardId, userId) {
      const c = cardOf(cardId);
      requireMember(c.board_id, userId);
      db.prepare("DELETE FROM cards WHERE id = ?").run(cardId);
      return { boardId: c.board_id, events: [{ type: "card.deleted", cardId }, { type: "activity", item: log(c.board_id, userId, `deleted "${c.title}"`) }] };
    },

    isMember: (boardId, userId) => !!role(boardId, userId),
  };
}
