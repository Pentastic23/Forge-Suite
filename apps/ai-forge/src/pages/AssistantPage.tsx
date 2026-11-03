import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { Button } from "@forge/ui";
import { api, errorText, when, type Chat, type Message, type Mode } from "../api";
import type { Notify, Page } from "../App";
import { extFor, Markdown, type CodeActions } from "../markdown";
import { chatProblem, chatRequest, current, providerLabel, useAI } from "../prefs";
import { MODES, systemPrompt } from "../prompts";

export function AssistantPage(props: { notify: Notify; projectName: string; onUsePrompt: (p: string, t: "image" | "model") => void; onNavigate: (p: Page) => void }) {
  const { notify } = props;
  const ai = useAI();
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatId, setChatId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<{ chatId: number; text: string } | null>(null);
  const [filter, setFilter] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chat = chats.find((c) => c.id === chatId) ?? null;
  const problem = chatProblem(ai);

  const reloadChats = useCallback(async () => {
    const list = await api.chats();
    setChats(list);
    return list;
  }, []);

  useEffect(() => {
    reloadChats().then((list) => { if (list.length) setChatId((id) => id ?? list[0].id); }).catch((e) => notify(errorText(e), true));
  }, [reloadChats, notify]);
  useEffect(() => {
    if (chatId === null) { setMessages([]); return; }
    api.messages(chatId).then(setMessages).catch((e) => notify(errorText(e), true));
  }, [chatId, notify]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages, busy?.text]);

  const newChat = async (mode: Mode = chat?.mode ?? "general") => {
    try {
      const c = await api.chatCreate("New chat", mode);
      await reloadChats();
      setChatId(c.id);
      setMessages([]);
      inputRef.current?.focus();
      return c;
    } catch (e) { notify(errorText(e), true); return null; }
  };

  const send = async (text: string, into?: Chat) => {
    if (busy) return;
    const target = into ?? chat ?? (await newChat());
    if (!target) return;
    const s = current();
    const req = chatRequest(systemPrompt(target.mode, s.brief, s.codex));
    if (text.trim()) {
      setMessages((m) => [...m, { id: -1, role: "user", content: text.trim(), model: "", createdAt: Date.now() }]);
      setDraft("");
    }
    setBusy({ chatId: target.id, text: "" });
    try {
      const sent = await api.chatSend(target.id, text, req, (t) => setBusy((b) => (b ? { ...b, text: b.text + t } : b)));
      if (sent.mock) notify("Test mode: nothing was sent to an AI service");
    } catch (e) {
      notify(errorText(e), true);
    }
    setBusy(null);
    try {
      if (chatIdRef.current === target.id) setMessages(await api.messages(target.id));
      await reloadChats();
    } catch (e) { notify(errorText(e), true); }
  };
  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;

  const retry = async (m: Message) => {
    if (!chat || busy) return;
    await api.chatTruncate(chat.id, m.id);
    setMessages((list) => list.filter((x) => x.id < m.id));
    void send("", chat);
  };
  const edit = async (m: Message) => {
    if (!chat || busy) return;
    await api.chatTruncate(chat.id, m.id);
    setMessages((list) => list.filter((x) => x.id < m.id));
    setDraft(m.content);
    inputRef.current?.focus();
  };
  const remove = async (c: Chat) => {
    if (!window.confirm(`Delete the chat "${c.title}"? This can't be undone.`)) return;
    try {
      await api.chatDelete(c.id);
      const list = await reloadChats();
      if (c.id === chatId) setChatId(list[0]?.id ?? null);
    } catch (e) { notify(errorText(e), true); }
  };
  const rename = async (c: Chat) => {
    const t = window.prompt("Chat name", c.title);
    if (!t?.trim()) return;
    try { await api.chatUpdate(c.id, { title: t }); await reloadChats(); } catch (e) { notify(errorText(e), true); }
  };
  const setMode = async (mode: Mode) => {
    if (!chat) { void newChat(mode); return; }
    try { await api.chatUpdate(chat.id, { mode }); await reloadChats(); } catch (e) { notify(errorText(e), true); }
  };
  const exportChat = async () => {
    if (!chat) return;
    const path = await save({ defaultPath: `${chat.title}.md`, filters: [{ name: "Markdown", extensions: ["md"] }] });
    if (!path) return;
    const md = [`# ${chat.title}`, "", ...messages.flatMap((m) => [`## ${m.role === "user" ? "You" : "AI Forge"}`, "", m.content, ""])].join("\n");
    try { await api.exportText(path, md); notify("Chat saved as Markdown"); } catch (e) { notify(errorText(e), true); }
  };

  const actions: CodeActions = useMemo(() => ({
    onCopy: (code) => { void navigator.clipboard.writeText(code).then(() => notify("Copied")); },
    onSave: async (code, lang) => {
      const ext = extFor(lang);
      const path = await save({ defaultPath: `snippet.${ext}`, filters: [{ name: lang || "Text", extensions: [ext] }, { name: "Any file", extensions: ["*"] }] });
      if (!path) return;
      try { await api.exportText(path, code.endsWith("\n") ? code : code + "\n"); notify(`Saved ${path}`); } catch (e) { notify(errorText(e), true); }
    },
    onUsePrompt: props.onUsePrompt,
  }), [notify, props.onUsePrompt]);

  const shown = filter.trim() ? chats.filter((c) => c.title.toLowerCase().includes(filter.trim().toLowerCase())) : chats;
  const modeInfo = MODES.find((m) => m.key === (chat?.mode ?? "general"))!;
  const streaming = busy && busy.chatId === chatId;

  return (
    <div className="assistant-page">
      <aside className="chat-list">
        <Button variant="primary" onClick={() => void newChat()}>New chat</Button>
        <input className="forge-input" placeholder="Find a chat" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <ul className="list-plain">
          {shown.map((c) => (
            <li key={c.id} className={c.id === chatId ? "on" : undefined}>
              <button className="chat-item" onClick={() => setChatId(c.id)} onDoubleClick={() => void rename(c)} title="Double-click to rename">
                <span className="chat-title">{c.pinned ? "★ " : ""}{c.title}</span>
                <span className="sum">{MODES.find((m) => m.key === c.mode)?.label} · {when(c.updatedAt)}</span>
              </button>
              <button className="icon-btn" title="Delete chat" onClick={() => void remove(c)}>×</button>
            </li>
          ))}
        </ul>
        {!chats.length && <p className="muted small">No chats yet. Ask anything below to start one.</p>}
      </aside>

      <section className="chat-main">
        <header className="chat-head">
          <div className="seg" role="group" aria-label="What this chat is for">
            {MODES.map((m) => (
              <button key={m.key} aria-pressed={(chat?.mode ?? "general") === m.key} title={m.hint} onClick={() => void setMode(m.key)}>{m.label}</button>
            ))}
          </div>
          <span className="spacer" />
          <button className="provider-pill" title="Change in Settings" onClick={() => props.onNavigate("settings")}>{providerLabel(ai.prefs)}</button>
          {chat && <Button variant="ghost" onClick={() => void api.chatUpdate(chat.id, { pinned: !chat.pinned }).then(reloadChats)}>{chat.pinned ? "Unpin" : "Pin"}</Button>}
          {chat && messages.length > 0 && <Button variant="ghost" onClick={() => void exportChat()}>Save as Markdown</Button>}
        </header>

        <div className="chat-scroll">
          {problem && (
            <div className="notice">
              <span>{problem}</span>
              <Button onClick={() => props.onNavigate("settings")}>Open Settings</Button>
            </div>
          )}
          {messages.length === 0 && !streaming && (
            <div className="starters">
              <h2>{modeInfo.label}</h2>
              <p className="muted">{modeInfo.hint} The assistant knows your project brief{ai.codex && ai.brief.useCodex ? ` and ${ai.codex.entries.length} codex entries` : ""}.</p>
              <div className="starter-grid">
                {modeInfo.starters.map((s) => <button key={s} className="starter" onClick={() => { setDraft(s); inputRef.current?.focus(); }}>{s}</button>)}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={m.id + ":" + i} className={`msg ${m.role}`}>
              <div className="msg-who">{m.role === "user" ? "You" : "AI Forge"}{m.role === "assistant" && m.model && m.model !== "example" ? <span className="muted small"> · {m.model}</span> : null}</div>
              {m.role === "user" ? <div className="msg-text">{m.content}</div> : <Markdown text={m.content} actions={actions} />}
              {m.id > 0 && !busy && (
                <div className="msg-tools">
                  <button onClick={() => void navigator.clipboard.writeText(m.content).then(() => notify("Copied"))}>Copy</button>
                  {m.role === "user" && <button onClick={() => void edit(m)}>Edit</button>}
                  {m.role === "assistant" && i === messages.length - 1 && <button onClick={() => void retry(m)}>Try again</button>}
                </div>
              )}
            </div>
          ))}
          {streaming && (
            <div className="msg assistant">
              <div className="msg-who">AI Forge</div>
              {busy.text ? <Markdown text={busy.text} /> : <p className="muted thinking">Thinking…</p>}
            </div>
          )}
          <div ref={endRef} />
        </div>

        <footer className="composer">
          <textarea
            ref={inputRef}
            className="forge-input"
            rows={3}
            placeholder={`Ask about ${props.projectName}… (Enter sends, Shift+Enter for a new line)`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (draft.trim() && !busy && !problem) void send(draft);
              }
            }}
          />
          {busy ? <Button onClick={() => void api.chatStop()}>Stop</Button> : <Button variant="primary" disabled={!draft.trim() || !!problem} onClick={() => void send(draft)}>Send</Button>}
        </footer>
      </section>
    </div>
  );
}
