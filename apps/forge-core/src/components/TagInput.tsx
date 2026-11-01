import { useState } from "react";

export function TagInput(props: { tags: string[]; suggestions: string[]; onChange: (tags: string[]) => void }) {
  const [text, setText] = useState("");
  const add = (raw: string) => {
    const parts = raw.split(",").map((t) => t.trim()).filter(Boolean);
    const next = [...props.tags];
    for (const p of parts) if (!next.some((t) => t.toLowerCase() === p.toLowerCase())) next.push(p);
    props.onChange(next);
    setText("");
  };
  return (
    <div>
      {props.tags.length > 0 && (
        <div className="chips" style={{ marginBottom: 6 }}>
          {props.tags.map((t) => (
            <span key={t} className="chip">
              {t}
              <button aria-label={`Remove ${t}`} onClick={() => props.onChange(props.tags.filter((x) => x !== t))}>×</button>
            </span>
          ))}
        </div>
      )}
      <input
        className="forge-input"
        style={{ width: "100%" }}
        list="tag-suggestions"
        placeholder="Add tags, separated by commas"
        value={text}
        onChange={(e) => (e.target.value.endsWith(",") ? add(e.target.value) : setText(e.target.value))}
        onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) { e.preventDefault(); add(text); } }}
        onBlur={() => text.trim() && add(text)}
      />
      <datalist id="tag-suggestions">{props.suggestions.map((s) => <option key={s} value={s} />)}</datalist>
    </div>
  );
}
