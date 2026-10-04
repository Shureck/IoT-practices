// Общий чат учебных сервисов (chat.iot) — хранится в SQLite.
import type { ChatMessage, ChatStore } from '@esp32lab/sim';
import type { DB } from './db';

const KEEP_PER_ROOM = 500;
const MAX_ROOM = 64;
const MAX_SENDER = 64;
const MAX_CONTENT = 2000;

export class SqliteChat implements ChatStore {
  private sends = 0;
  constructor(private db: DB, private clock: () => Date = () => new Date()) {}

  send(room: string, sender: string, content: string): ChatMessage {
    room = room.slice(0, MAX_ROOM);
    const m = {
      sender: String(sender).slice(0, MAX_SENDER),
      content: String(content).slice(0, MAX_CONTENT),
      time: this.clock().toISOString(),
    };
    const r = this.db.prepare('INSERT INTO chat_messages (room, sender, content, time) VALUES (?, ?, ?, ?)').run(room, m.sender, m.content, m.time);
    // время от времени подрезаем старые сообщения комнаты
    if (++this.sends % 50 === 0) {
      this.db.prepare(`DELETE FROM chat_messages WHERE room = ? AND id <= (
        SELECT id FROM chat_messages WHERE room = ? ORDER BY id DESC LIMIT 1 OFFSET ?)`).run(room, room, KEEP_PER_ROOM);
    }
    return { id: Number(r.lastInsertRowid), ...m };
  }

  list(room: string, afterId: number, limit = 50): ChatMessage[] {
    const rows = this.db.prepare(
      'SELECT id, sender, content, time FROM chat_messages WHERE room = ? AND id > ? ORDER BY id DESC LIMIT ?',
    ).all(room.slice(0, MAX_ROOM), Math.max(0, Math.floor(afterId) || 0), Math.max(1, Math.min(200, Math.floor(limit) || 50))) as ChatMessage[];
    return rows.reverse();
  }
}
