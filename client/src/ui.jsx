import { useEffect, useRef, useState } from "react";

export function Avatar({ user, size = 28, dim = false }) {
  if (!user) return null;
  const initials = user.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span className={`avatar${dim ? " dim" : ""}`} style={{ background: user.color, width: size, height: size, fontSize: size * 0.4 }} title={user.name} aria-label={user.name}>
      {initials}
    </span>
  );
}

/** Text that becomes an input on click. Saves on Enter or blur, cancels on Escape. */
export function InlineEdit({ value, onSave, className = "", label }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef(null);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => { if (editing) ref.current?.select(); }, [editing]);

  if (!editing) {
    return (
      <button className={`inline-edit ${className}`} onClick={() => setEditing(true)} aria-label={`Rename ${label}: ${value}`}>
        {value}
      </button>
    );
  }
  const commit = () => {
    setEditing(false);
    const v = draft.trim();
    if (v && v !== value) onSave(v);
    else setDraft(value);
  };
  return (
    <input
      ref={ref}
      className={`inline-input ${className}`}
      value={draft}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") { setDraft(value); setEditing(false); }
      }}
    />
  );
}

/** A collapsible "add item" form used for lists and cards. */
export function Composer({ placeholder, button, onSubmit, multiline = false }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const ref = useRef(null);
  useEffect(() => { if (open) ref.current?.focus(); }, [open]);

  if (!open) return <button className="composer-open" onClick={() => setOpen(true)}>+ {placeholder}</button>;
  const submit = async (e) => {
    e?.preventDefault();
    const v = text.trim();
    if (!v) return setOpen(false);
    setText("");
    await onSubmit(v);
    ref.current?.focus();
  };
  const Field = multiline ? "textarea" : "input";
  return (
    <form className="composer" onSubmit={submit}>
      <Field
        ref={ref}
        value={text}
        placeholder={placeholder}
        aria-label={placeholder}
        rows={multiline ? 2 : undefined}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (multiline && e.key === "Enter" && !e.shiftKey) submit(e);
        }}
      />
      <div className="row gap-s">
        <button className="btn primary sm" type="submit">{button}</button>
        <button className="btn ghost sm" type="button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

export const LABELS = {
  red: { name: "Urgent", color: "#e03131" },
  amber: { name: "Waiting", color: "#f08c00" },
  green: { name: "Ready", color: "#2f9e44" },
  blue: { name: "Design", color: "#1c7ed6" },
  violet: { name: "Research", color: "#7048e8" },
};

export function timeAgo(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ms).toLocaleDateString("en", { month: "short", day: "numeric" });
}
