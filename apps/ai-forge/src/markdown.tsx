// A small Markdown reader for the assistant's answers: headings, lists, quotes,
// code blocks (with Copy and Save) and inline bold, italic, code and links.
// It builds React elements, never HTML strings, so nothing in an answer can run.
import { Fragment, type ReactNode } from "react";

export type Block =
  | { t: "code"; lang: string; code: string }
  | { t: "h"; level: number; text: string }
  | { t: "ul" | "ol"; items: string[]; start: number }
  | { t: "quote"; text: string }
  | { t: "p"; text: string }
  | { t: "hr" };

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  const isList = (l: string) => /^\s*([-*+]|\d+[.)])\s+/.test(l);
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*(```+|~~~+)\s*([\w#+.-]*)/);
    if (fence) {
      const close = fence[1];
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith(close)) code.push(lines[i++]);
      i++; // the closing fence (or the end, while an answer is still being written)
      out.push({ t: "code", lang: fence[2].toLowerCase(), code: code.join("\n") });
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push({ t: "h", level: h[1].length, text: h[2].replace(/\s+#+\s*$/, "") }); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push({ t: "hr" }); i++; continue; }
    if (line.startsWith(">")) {
      const q: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) q.push(lines[i++].replace(/^>\s?/, ""));
      out.push({ t: "quote", text: q.join("\n") });
      continue;
    }
    if (isList(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const start = ordered ? parseInt(line.trim(), 10) : 1;
      const items: string[] = [];
      while (i < lines.length && (isList(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (isList(lines[i])) items.push(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, ""));
        else items[items.length - 1] += " " + lines[i].trim();
        i++;
      }
      out.push({ t: ordered ? "ol" : "ul", items, start });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(```|~~~|#{1,6}\s|>)/.test(lines[i]) && !isList(lines[i])) para.push(lines[i++]);
    out.push({ t: "p", text: para.join("\n") });
  }
  return out;
}

/** Inline Markdown to React: `code`, **bold**, *italic* / _italic_ and [links](url) (shown, not followed). */
export function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|\b_[^_\s][^_]*_\b)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const s = m[0];
    if (m[1]) out.push(<code key={k++}>{s.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k++}>{inline(s.slice(2, -2))}</strong>);
    else if (m[3]) out.push(<em key={k++}>{inline(s.slice(1, -1))}</em>);
    else {
      const [, label, url] = s.match(/^\[([^\]]+)\]\(([^)]+)\)$/)!;
      out.push(<span key={k++} className="md-link" title={url}>{label}</span>);
    }
    last = m.index + s.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.map((n, i) => (typeof n === "string" ? <Fragment key={`t${i}`}>{n.split("\n").flatMap((p, j) => (j ? [<br key={j} />, p] : [p]))}</Fragment> : n));
}

/** File extensions for saving a code block. */
const EXT: Record<string, string> = {
  gdscript: "gd", gd: "gd", csharp: "cs", cs: "cs", "c#": "cs", cpp: "cpp", "c++": "cpp", c: "c", h: "h", hpp: "hpp", python: "py", py: "py",
  javascript: "js", js: "js", typescript: "ts", ts: "ts", lua: "lua", rust: "rs", rs: "rs", gml: "gml", json: "json", glsl: "glsl",
  hlsl: "hlsl", shader: "gdshader", gdshader: "gdshader", yaml: "yaml", yml: "yml", xml: "xml", html: "html", css: "css", sh: "sh",
  bash: "sh", powershell: "ps1", ps1: "ps1", md: "md", markdown: "md", text: "txt", txt: "txt", ini: "ini", toml: "toml", cfg: "cfg",
};
export const extFor = (lang: string) => EXT[lang] ?? "txt";

export interface CodeActions {
  onCopy: (code: string) => void;
  onSave: (code: string, lang: string) => void;
  /** Offered on ```text blocks, which the assistant uses for image and 3D prompts. */
  onUsePrompt?: (code: string, target: "image" | "model") => void;
}

export function Markdown(props: { text: string; actions?: CodeActions }) {
  const blocks = parseBlocks(props.text);
  return (
    <div className="md">
      {blocks.map((b, i) => {
        switch (b.t) {
          case "code":
            return (
              <div className="md-code" key={i}>
                <div className="md-code-bar">
                  <span>{b.lang || "code"}</span>
                  <span className="spacer" />
                  {props.actions && (
                    <>
                      {(b.lang === "text" || b.lang === "prompt") && props.actions.onUsePrompt && (
                        <>
                          <button onClick={() => props.actions!.onUsePrompt!(b.code, "image")}>Make image</button>
                          <button onClick={() => props.actions!.onUsePrompt!(b.code, "model")}>Make 3D model</button>
                        </>
                      )}
                      <button onClick={() => props.actions!.onCopy(b.code)}>Copy</button>
                      <button onClick={() => props.actions!.onSave(b.code, b.lang)}>Save…</button>
                    </>
                  )}
                </div>
                <pre><code>{b.code}</code></pre>
              </div>
            );
          case "h": {
            const H = `h${Math.min(6, b.level + 2)}` as "h3";
            return <H key={i}>{inline(b.text)}</H>;
          }
          case "ul":
            return <ul key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>;
          case "ol":
            return <ol key={i} start={b.start}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ol>;
          case "quote":
            return <blockquote key={i}>{inline(b.text)}</blockquote>;
          case "hr":
            return <hr key={i} />;
          default:
            return <p key={i}>{inline(b.text)}</p>;
        }
      })}
    </div>
  );
}
