import { useEffect, useState } from "react";
import { api } from "./api.js";
import { Link, navigate } from "./router.jsx";
import { Composer } from "./ui.jsx";

export function BoardsPage() {
  const [boards, setBoards] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.boards().then((r) => setBoards(r.boards), (e) => setError(e.message));
  }, []);

  const create = async (name) => {
    const { id } = await api.createBoard(name);
    navigate(`/b/${id}`);
  };

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Your boards</h1>
          <p className="muted">Boards you own or were invited to. Changes sync live for everyone on the board.</p>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="board-grid">
        {boards?.map((b) => (
          <Link key={b.id} to={`/b/${b.id}`} className="board-tile">
            <strong>{b.name}</strong>
            <span className="muted small">{b.cardCount} cards · {b.memberCount} {b.memberCount === 1 ? "member" : "members"}{b.role === "owner" ? " · Owner" : ""}</span>
          </Link>
        ))}
        <div className="board-tile new">
          <Composer placeholder="New board" button="Create board" onSubmit={create} />
        </div>
      </div>
      {boards?.length === 0 && <p className="muted" style={{ marginTop: 16 }}>Create your first board to get started, or open an invite link a teammate sent you.</p>}
    </main>
  );
}
