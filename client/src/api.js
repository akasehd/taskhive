/** Thin fetch wrapper: JSON in, JSON out, errors thrown with the server's message. */
async function call(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Request failed (${res.status})`), { status: res.status });
  return data;
}

export const api = {
  me: () => call("GET", "/auth/me"),
  register: (b) => call("POST", "/auth/register", b),
  login: (b) => call("POST", "/auth/login", b),
  logout: () => call("POST", "/auth/logout"),

  boards: () => call("GET", "/boards"),
  createBoard: (name) => call("POST", "/boards", { name }),
  board: (id) => call("GET", `/boards/${id}`),
  renameBoard: (id, name) => call("PATCH", `/boards/${id}`, { name }),
  deleteBoard: (id) => call("DELETE", `/boards/${id}`),
  resetInvite: (id) => call("POST", `/boards/${id}/invite`),
  join: (code) => call("POST", `/join/${code}`),
  removeMember: (boardId, userId) => call("DELETE", `/boards/${boardId}/members/${userId}`),

  createList: (boardId, title) => call("POST", `/boards/${boardId}/lists`, { title }),
  renameList: (id, title) => call("PATCH", `/lists/${id}`, { title }),
  moveList: (id, beforeId, afterId) => call("POST", `/lists/${id}/move`, { beforeId, afterId }),
  deleteList: (id) => call("DELETE", `/lists/${id}`),

  createCard: (listId, title) => call("POST", `/lists/${listId}/cards`, { title }),
  updateCard: (id, patch) => call("PATCH", `/cards/${id}`, patch),
  moveCard: (id, listId, beforeId, afterId) => call("POST", `/cards/${id}/move`, { listId, beforeId, afterId }),
  deleteCard: (id) => call("DELETE", `/cards/${id}`),
};
