import { useEffect, useReducer, useRef } from "react";
import { io } from "socket.io-client";
import { api } from "./api.js";

const byPosition = (a, b) => a.position - b.position || a.id - b.id;
const upsert = (arr, item) => (arr.some((x) => x.id === item.id) ? arr.map((x) => (x.id === item.id ? { ...x, ...item } : x)) : [...arr, item]);

/**
 * Board state is a reducer over server events. The same events update the tab
 * that made the change and every other open tab, so there's one code path.
 */
export function reducer(state, action) {
  switch (action.type) {
    case "loaded":
      return { ...action.board, online: state?.online ?? [], status: "ready" };
    case "error":
      return { ...state, status: "error", error: action.error };
    case "deleted":
      return { ...state, status: "deleted" };
    case "presence":
      return { ...state, online: action.online };
    case "connection":
      return { ...state, connected: action.connected };
  }
  if (!state || state.status !== "ready") return state;
  switch (action.type) {
    case "board.updated":
      return { ...state, name: action.board.name };
    case "list.created":
    case "list.updated":
      return { ...state, lists: upsert(state.lists, action.list).sort(byPosition) };
    case "lists.reordered":
      return { ...state, lists: action.lists };
    case "list.deleted":
      return { ...state, lists: state.lists.filter((l) => l.id !== action.listId), cards: state.cards.filter((c) => c.listId !== action.listId) };
    case "card.created":
    case "card.updated":
    case "card.moved":
      return { ...state, cards: upsert(state.cards, action.card).sort(byPosition) };
    case "card.deleted":
      return { ...state, cards: state.cards.filter((c) => c.id !== action.cardId) };
    case "member.joined":
      return { ...state, members: upsert(state.members, action.member) };
    case "member.left":
      return { ...state, members: state.members.filter((m) => m.id !== action.userId) };
    case "activity":
      return { ...state, activity: [action.item, ...state.activity.filter((a) => a.id !== action.item.id)].slice(0, 30) };
    default:
      return state;
  }
}

export function useBoard(boardId, meId) {
  const [state, dispatch] = useReducer(reducer, { status: "loading", connected: false, online: [] });
  const socketRef = useRef(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api.board(boardId).then(
        (r) => alive && dispatch({ type: "loaded", board: r.board }),
        (e) => alive && dispatch({ type: "error", error: e.status === 403 ? "You're not a member of this board." : e.message }),
      );

    const socket = io({ transports: ["websocket", "polling"] });
    socketRef.current = socket;
    socket.on("connect", () => {
      dispatch({ type: "connection", connected: true });
      // (Re)join the room and reload, so anything missed while offline is picked up.
      socket.emit("board:join", boardId, (res) => {
        if (res?.ok) load();
        else dispatch({ type: "error", error: "You're not a member of this board." });
      });
    });
    socket.on("disconnect", () => dispatch({ type: "connection", connected: false }));
    socket.on("presence", (p) => p.boardId === boardId && dispatch({ type: "presence", online: p.online }));
    socket.on("board:event", (e) => {
      if (e.boardId !== boardId) return;
      if (e.type === "board.deleted" || (e.type === "member.left" && e.userId === meId)) return dispatch({ type: "deleted" });
      dispatch(e);
    });

    return () => {
      alive = false;
      socket.emit("board:leave", boardId);
      socket.close();
    };
  }, [boardId, meId]);

  return [state, dispatch];
}
