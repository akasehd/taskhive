import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext, DragOverlay, PointerSensor, closestCenter, getFirstCollision, pointerWithin, rectIntersection,
  useDroppable, useSensor, useSensors,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, horizontalListSortingStrategy, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api } from "./api.js";
import { useBoard } from "./useBoard.js";
import { navigate, Link } from "./router.jsx";
import { Avatar, Composer, InlineEdit, LABELS, timeAgo } from "./ui.jsx";
import { CardModal } from "./CardModal.jsx";

const cid = (id) => `c${id}`;
const lid = (id) => `l${id}`;
const num = (sid) => Number(String(sid).slice(1));
const isList = (sid) => String(sid).startsWith("l");
// Each list also has a plain drop zone ("d<id>") for its cards, so cards never target the list sortable itself.
const did = (id) => `d${id}`;
const isZone = (sid) => String(sid).startsWith("d");

/** Same rule as the server: midpoint between neighbours, or one step past the end. */
const between = (b, a) => (b == null && a == null ? 1024 : b == null ? a - 1024 : a == null ? b + 1024 : (b + a) / 2);

export function BoardPage({ boardId, me }) {
  const [board, dispatch] = useBoard(boardId, me.id);
  const [columns, setColumns] = useState(null); // card order per list while dragging
  const [activeId, setActiveId] = useState(null);
  const [openCard, setOpenCard] = useState(null);
  const [showActivity, setShowActivity] = useState(false);
  const [toast, setToast] = useState(null);

  // Pointer covers mouse, pen and touch. Keyboard users move cards from the card
  // dialog ("Move to"), which is more predictable than keyboard dragging across lists.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const stateColumns = useMemo(() => {
    if (board.status !== "ready") return {};
    const cols = Object.fromEntries(board.lists.map((l) => [l.id, []]));
    for (const c of board.cards) cols[c.listId]?.push(c.id);
    return cols;
  }, [board]);
  const view = columns ?? stateColumns;
  const cardsById = useMemo(() => new Map(board.cards?.map((c) => [c.id, c])), [board.cards]);
  const membersById = useMemo(() => new Map(board.members?.map((m) => [m.id, m])), [board.members]);

  // Collision detection for multiple lists. After a card jumps to a new list the
  // layout shifts under it, which can make it bounce straight back; holding the
  // last target for one frame prevents that (the approach from dnd-kit's examples).
  const lastOverId = useRef(null);
  const recentlyMoved = useRef(false);
  useEffect(() => {
    requestAnimationFrame(() => { recentlyMoved.current = false; });
  }, [columns]);
  const collisionDetection = useCallback((args) => {
    const activeSid = args.active.id;
    if (isList(activeSid)) {
      return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => isList(c.id)) });
    }
    const cardArgs = { ...args, droppableContainers: args.droppableContainers.filter((c) => !isList(c.id)) };
    const pointer = pointerWithin(cardArgs);
    let overId = getFirstCollision(pointer.length ? pointer : rectIntersection(cardArgs), "id");
    if (overId != null) {
      // Over a list's drop zone: target its closest card when it has any.
      if (isZone(overId)) {
        const ids = (view[num(overId)] ?? []).map(cid);
        if (ids.length) {
          overId = closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => ids.includes(c.id)) })[0]?.id ?? overId;
        }
      }
      lastOverId.current = overId;
      return [{ id: overId }];
    }
    if (recentlyMoved.current) lastOverId.current = activeSid;
    return lastOverId.current ? [{ id: lastOverId.current }] : [];
  }, [view]);

  const flash = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };
  const run = (promise) => promise.catch((e) => flash(e.message));

  if (board.status === "loading") return <div className="center muted">Loading board…</div>;
  if (board.status === "error") return <div className="center"><p className="error">{board.error}</p><Link to="/">Back to boards</Link></div>;
  if (board.status === "deleted") return <div className="center"><p>This board was deleted or you were removed from it.</p><Link to="/">Back to boards</Link></div>;

  const containerOf = (sid) => (isList(sid) || isZone(sid) ? num(sid) : Number(Object.keys(view).find((k) => view[k].includes(num(sid)))));

  const onDragStart = ({ active }) => {
    setActiveId(active.id);
    if (!isList(active.id)) setColumns(structuredClone(stateColumns));
  };

  const onDragOver = ({ active, over }) => {
    if (!over || isList(active.id) || !columns) return;
    const from = containerOf(active.id), to = containerOf(over.id);
    if (!from || !to || from === to) return;
    recentlyMoved.current = true;
    setColumns((cols) => {
      const card = num(active.id);
      const target = cols[to].filter((x) => x !== card);
      const overIndex = isZone(over.id) ? target.length : target.indexOf(num(over.id));
      target.splice(overIndex < 0 ? target.length : overIndex, 0, card);
      return { ...cols, [from]: cols[from].filter((x) => x !== card), [to]: target };
    });
  };

  const onDragEnd = ({ active, over }) => {
    setActiveId(null);
    if (!over) return setColumns(null);

    if (isList(active.id)) {
      const ids = board.lists.map((l) => l.id);
      const from = ids.indexOf(num(active.id));
      const to = ids.indexOf(containerOf(over.id));
      if (from === to || to < 0) return;
      const ordered = arrayMove(board.lists, from, to);
      const before = ordered[to - 1], after = ordered[to + 1];
      const moved = { ...ordered[to], position: between(before?.position, after?.position) };
      dispatch({ type: "lists.reordered", lists: ordered.map((l) => (l.id === moved.id ? moved : l)) });
      run(api.moveList(moved.id, before?.id ?? null, after?.id ?? null));
      return;
    }

    const card = num(active.id);
    const listId = containerOf(active.id);
    let order = [...columns[listId]];
    if (!isZone(over.id) && containerOf(over.id) === listId) order = arrayMove(order, order.indexOf(card), order.indexOf(num(over.id)));
    setColumns(null);

    const i = order.indexOf(card);
    const beforeId = order[i - 1] ?? null, afterId = order[i + 1] ?? null;
    const original = cardsById.get(card);
    const unchanged = original.listId === listId && stateColumns[listId].indexOf(card) === i;
    if (unchanged) return;
    // Optimistic update; the server's broadcast replaces it with the authoritative position.
    const position = between(cardsById.get(beforeId)?.position, cardsById.get(afterId)?.position);
    dispatch({ type: "card.moved", card: { ...original, listId, position } });
    run(api.moveCard(card, listId, beforeId, afterId));
  };

  const inviteLink = board.inviteCode && `${location.origin}/join/${board.inviteCode}`;
  const copyInvite = async () => {
    await navigator.clipboard?.writeText(inviteLink);
    flash("Invite link copied. Anyone with it can join this board.");
  };
  const deleteBoard = async () => {
    if (!confirm(`Delete "${board.name}" and all its cards? This can't be undone.`)) return;
    await run(api.deleteBoard(boardId));
    navigate("/");
  };
  const leaveBoard = async () => {
    if (!confirm(`Leave "${board.name}"?`)) return;
    await run(api.removeMember(boardId, me.id));
    navigate("/");
  };

  const activeCard = activeId && !isList(activeId) ? cardsById.get(num(activeId)) : null;
  const activeList = activeId && isList(activeId) ? board.lists.find((l) => l.id === num(activeId)) : null;

  return (
    <div className="board">
      <div className="board-bar">
        <div className="row gap-s">
          <Link to="/" className="muted small">Boards</Link>
          <span className="muted small">/</span>
          <InlineEdit value={board.name} label="board name" className="board-name" onSave={(name) => run(api.renameBoard(boardId, name))} />
          {!board.connected && <span className="pill warn">Reconnecting…</span>}
        </div>
        <div className="row gap-s wrap">
          <div className="avatars" aria-label="Board members">
            {board.members.map((m) => <Avatar key={m.id} user={m} size={26} dim={!board.online.includes(m.id)} />)}
          </div>
          <span className="muted small hide-sm">{board.online.length} online</span>
          {board.role === "owner" && <button className="btn ghost sm" onClick={copyInvite}>Invite</button>}
          <button className="btn ghost sm" onClick={() => setShowActivity((v) => !v)} aria-pressed={showActivity}>Activity</button>
          {board.role === "owner"
            ? <button className="btn ghost sm danger" onClick={deleteBoard}>Delete</button>
            : <button className="btn ghost sm" onClick={leaveBoard}>Leave</button>}
        </div>
      </div>

      <div className="board-body">
        <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => { setActiveId(null); setColumns(null); }}>
          <SortableContext items={board.lists.map((l) => lid(l.id))} strategy={horizontalListSortingStrategy}>
            <div className="lists">
              {board.lists.map((list) => (
                <SortableList key={list.id} list={list} cardDragging={!!activeId && !isList(activeId)} onRename={(t) => run(api.renameList(list.id, t))} onDelete={() => {
                  if (confirm(`Delete the list "${list.title}" and its cards?`)) run(api.deleteList(list.id));
                }}>
                  <SortableContext items={view[list.id]?.map(cid) ?? []} strategy={verticalListSortingStrategy}>
                    <CardZone listId={list.id}>
                      {view[list.id]?.map((id) => {
                        const card = cardsById.get(id);
                        return card && <SortableCard key={id} card={card} assignee={membersById.get(card.assigneeId)} onOpen={() => setOpenCard(id)} />;
                      })}
                    </CardZone>
                  </SortableContext>
                  <Composer placeholder="Add a card" button="Add card" multiline onSubmit={(title) => run(api.createCard(list.id, title))} />
                </SortableList>
              ))}
              <div className="list new-list">
                <Composer placeholder="Add a list" button="Add list" onSubmit={(title) => run(api.createList(boardId, title))} />
              </div>
            </div>
          </SortableContext>
          <DragOverlay>
            {activeCard && <CardView card={activeCard} assignee={membersById.get(activeCard.assigneeId)} dragging />}
            {activeList && <div className="list overlay"><h2 className="list-title">{activeList.title}</h2></div>}
          </DragOverlay>
        </DndContext>

        {showActivity && (
          <aside className="activity" aria-label="Activity">
            <h2>Activity</h2>
            <ol>
              {board.activity.map((a) => {
                const who = membersById.get(a.userId);
                return (
                  <li key={a.id}>
                    <Avatar user={who ?? { name: "Former member", color: "#888" }} size={22} />
                    <div><strong>{who?.name ?? "Former member"}</strong> {a.message}<div className="muted small">{timeAgo(a.createdAt)}</div></div>
                  </li>
                );
              })}
            </ol>
          </aside>
        )}
      </div>

      {openCard && cardsById.get(openCard) && (
        <CardModal
          card={cardsById.get(openCard)}
          list={board.lists.find((l) => l.id === cardsById.get(openCard).listId)}
          members={board.members}
          onClose={() => setOpenCard(null)}
          onSave={(patch) => run(api.updateCard(openCard, patch))}
          lists={board.lists}
          onMove={(listId, where) => {
            const others = (stateColumns[listId] ?? []).filter((x) => x !== openCard);
            const [beforeId, afterId] = where === "top" ? [null, others[0] ?? null] : [others.at(-1) ?? null, null];
            run(api.moveCard(openCard, listId, beforeId, afterId));
          }}
          onDelete={() => { run(api.deleteCard(openCard)); setOpenCard(null); }}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function CardZone({ listId, children }) {
  const { setNodeRef } = useDroppable({ id: did(listId) });
  return <div className="cards" ref={setNodeRef}>{children}</div>;
}

function SortableList({ list, cardDragging, children, onRename, onDelete }) {
  // While a card is dragged, lists stop being drop targets (their zones take over).
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: lid(list.id), disabled: { draggable: false, droppable: cardDragging } });
  return (
    <section ref={setNodeRef} className={`list${isDragging ? " ghost" : ""}`} style={{ transform: CSS.Translate.toString(transform), transition }} aria-label={list.title}>
      <header className="list-head">
        <button className="handle" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Move list ${list.title}`}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="5" cy="4" r="1.3" /><circle cx="11" cy="4" r="1.3" /><circle cx="5" cy="8" r="1.3" /><circle cx="11" cy="8" r="1.3" /><circle cx="5" cy="12" r="1.3" /><circle cx="11" cy="12" r="1.3" /></svg>
        </button>
        <InlineEdit value={list.title} label="list title" className="list-title" onSave={onRename} />
        <button className="icon-btn" onClick={onDelete} aria-label={`Delete list ${list.title}`}>×</button>
      </header>
      {children}
    </section>
  );
}

function SortableCard({ card, assignee, onOpen }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cid(card.id) });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} {...attributes} {...listeners}
      onClick={onOpen} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      className={isDragging ? "ghost" : ""} aria-label={`Open card: ${card.title}`}>
      <CardView card={card} assignee={assignee} />
    </div>
  );
}

function CardView({ card, assignee, dragging }) {
  const overdue = card.dueDate && card.dueDate < new Date().toISOString().slice(0, 10);
  return (
    <article className={`card${dragging ? " dragging" : ""}`}>
      {card.label && <span className="label" style={{ background: LABELS[card.label].color }}>{LABELS[card.label].name}</span>}
      <p className="card-title">{card.title}</p>
      {(card.dueDate || assignee || card.description) && (
        <div className="card-meta">
          {card.dueDate && <span className={`due${overdue ? " overdue" : ""}`}>{new Date(card.dueDate + "T00:00").toLocaleDateString("en", { month: "short", day: "numeric" })}</span>}
          {card.description && <span className="muted" title="Has description">≡</span>}
          <span className="spacer" />
          {assignee && <Avatar user={assignee} size={22} />}
        </div>
      )}
    </article>
  );
}
