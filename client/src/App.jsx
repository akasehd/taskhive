import { useEffect, useState } from "react";
import { api } from "./api.js";
import { usePath, navigate, Link } from "./router.jsx";
import { AuthScreen } from "./AuthScreen.jsx";
import { BoardsPage } from "./BoardsPage.jsx";
import { BoardPage } from "./BoardPage.jsx";
import { Avatar } from "./ui.jsx";

export function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out
  const path = usePath();

  useEffect(() => {
    api.me().then((r) => setUser(r.user), () => setUser(null));
  }, []);

  // Accept invite links: /join/<code>
  const joinCode = path.match(/^\/join\/([\w-]+)$/)?.[1];
  const [joinError, setJoinError] = useState(null);
  useEffect(() => {
    if (!user || !joinCode) return;
    api.join(joinCode).then((r) => navigate(`/b/${r.boardId}`, { replace: true }), (e) => setJoinError(e.message));
  }, [user, joinCode]);

  if (user === undefined) return <div className="center muted">Loading…</div>;
  if (!user) return <AuthScreen onAuthed={setUser} inviting={!!joinCode} />;

  const boardId = Number(path.match(/^\/b\/(\d+)$/)?.[1]);
  const signOut = async () => {
    await api.logout();
    setUser(null);
    navigate("/");
  };

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand"><span className="logo" aria-hidden="true" />TaskHive</Link>
        <div className="row gap-s">
          <Avatar user={user} />
          <span className="hide-sm">{user.name}</span>
          <button className="btn ghost sm" onClick={signOut}>Sign out</button>
        </div>
      </header>
      {joinCode ? (
        <div className="center">{joinError ? <p className="error">{joinError} <Link to="/">Back to boards</Link></p> : <p className="muted">Joining board…</p>}</div>
      ) : boardId ? (
        <BoardPage key={boardId} boardId={boardId} me={user} />
      ) : (
        <BoardsPage />
      )}
    </div>
  );
}
