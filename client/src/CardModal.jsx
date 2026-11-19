import { useEffect, useRef, useState } from "react";
import { LABELS } from "./ui.jsx";

export function CardModal({ card, list, lists, members, onClose, onSave, onMove, onDelete }) {
  const [moveTo, setMoveTo] = useState(card.listId);
  useEffect(() => setMoveTo(card.listId), [card.listId]);
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const dialog = useRef(null);

  // Pick up edits other people make while the dialog is open.
  useEffect(() => setTitle(card.title), [card.title]);
  useEffect(() => setDescription(card.description), [card.description]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const d = dialog.current;
    if (!d.open) d.showModal();
    const close = () => onCloseRef.current();
    d.addEventListener("close", close);
    return () => d.removeEventListener("close", close);
  }, []);
  // Close explicitly rather than relying only on the dialog's async "close" event.
  const closeNow = () => {
    dialog.current?.close();
    onCloseRef.current();
  };

  const saveText = () => {
    const patch = {};
    if (title.trim() && title.trim() !== card.title) patch.title = title.trim();
    if (description !== card.description) patch.description = description;
    if (Object.keys(patch).length) onSave(patch);
  };

  return (
    <dialog ref={dialog} className="modal" aria-labelledby="card-title" onClick={(e) => e.target === dialog.current && closeNow()}>
      <div className="modal-body">
        <div className="row">
          <span className="muted small">In {list?.title}</span>
          <button className="icon-btn" onClick={closeNow} aria-label="Close">×</button>
        </div>
        <input id="card-title" className="modal-title" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveText} aria-label="Card title" />

        <div className="modal-grid">
          <label className="field">Assignee
            <select value={card.assigneeId ?? ""} onChange={(e) => onSave({ assigneeId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Unassigned</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label className="field">Due date
            <input type="date" value={card.dueDate ?? ""} onChange={(e) => onSave({ dueDate: e.target.value || null })} />
          </label>
        </div>

        <div className="move-row">
          <label className="field">Move to
            <select value={moveTo} onChange={(e) => setMoveTo(Number(e.target.value))}>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.title}{l.id === card.listId ? " (current)" : ""}</option>)}
            </select>
          </label>
          <button className="btn ghost sm" onClick={() => onMove(moveTo, "top")}>To top</button>
          <button className="btn ghost sm" onClick={() => onMove(moveTo, "bottom")}>To bottom</button>
        </div>

        <fieldset className="labels">
          <legend className="small">Label</legend>
          {Object.entries(LABELS).map(([key, l]) => (
            <button key={key} className={`label-choice${card.label === key ? " on" : ""}`} style={{ "--c": l.color }} aria-pressed={card.label === key}
              onClick={() => onSave({ label: card.label === key ? null : key })}>{l.name}</button>
          ))}
        </fieldset>

        <label className="field">Description
          <textarea rows={6} value={description} onChange={(e) => setDescription(e.target.value)} onBlur={saveText} placeholder="Add more detail…" />
        </label>

        <div className="row">
          <button className="btn ghost sm danger" onClick={() => confirm("Delete this card?") && onDelete()}>Delete card</button>
          <button className="btn primary sm" onClick={() => { saveText(); closeNow(); }}>Done</button>
        </div>
      </div>
    </dialog>
  );
}
