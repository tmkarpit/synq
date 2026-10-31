import { useEffect, useRef, useState } from 'react';
import { SendHorizontal } from 'lucide-react';
import { LIMITS } from '@/config/app';
import { useRoomStore } from '@/store/roomStore';
import { CLIENT_EVENTS } from '@/services/collab';
import { useRoom } from '@/features/room/RoomContext';

const time = (at) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function ChatView() {
  const { service } = useRoom();
  const chat = useRoomStore((s) => s.chat);
  const selfId = useRoomStore((s) => s.self?.userId);
  const markChatRead = useRoomStore((s) => s.markChatRead);
  const [text, setText] = useState('');
  const listRef = useRef(null);

  useEffect(() => {
    markChatRead();
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chat.length, markChatRead]);

  const send = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    service.emit(CLIENT_EVENTS.chatSend, { text });
    setText('');
  };

  return (
    <div className="flex h-full flex-col">
      <h2 className="ws-section-title">Chat</h2>
      <ol
        ref={listRef}
        className="ws-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-2"
        aria-live="polite"
      >
        {!chat.length && <li className="text-[12px] text-ws-muted">No messages yet. Say hi!</li>}
        {chat.slice(-LIMITS.chatRenderCap).map((m) => (
          <li key={m.id} className="text-[13px]">
            <p className="flex items-baseline gap-2">
              <span className="font-semibold" style={{ color: m.color }}>
                {m.userId === selfId ? 'You' : m.username}
              </span>
              <span className="text-[11px] text-ws-muted">{time(m.at)}</span>
            </p>
            <p className="whitespace-pre-wrap break-words text-ws-text">{m.text}</p>
          </li>
        ))}
      </ol>
      <form onSubmit={send} className="flex shrink-0 gap-1.5 border-t border-ws-border p-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={LIMITS.maxChatLength}
          placeholder="Message the room"
          aria-label="Chat message"
          className="h-7 min-w-0 flex-1 rounded-chrome border border-ws-border bg-ws-editor px-2 text-[13px] text-ws-text outline-none focus:border-ws-accent"
        />
        <button
          type="submit"
          aria-label="Send"
          className="flex h-7 w-7 items-center justify-center rounded-chrome text-ws-muted hover:bg-ws-hover hover:text-ws-text"
        >
          <SendHorizontal size={15} aria-hidden />
        </button>
      </form>
    </div>
  );
}
