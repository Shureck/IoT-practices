// Markdown с подсветкой C++ (контент практик — доверенный, пишется авторами курса).
import { Marked } from 'marked';
import { useMemo } from 'react';

const KW = new Set(['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return', 'const', 'static',
  'volatile', 'struct', 'class', 'public', 'private', 'enum', 'typedef', 'auto', 'true', 'false', 'new', 'this', 'sizeof', 'using', 'namespace',
  'nullptr', 'NULL', 'unsigned', 'signed', 'long', 'short', 'IRAM_ATTR']);
const TY = new Set(['void', 'int', 'float', 'double', 'char', 'bool', 'byte', 'String', 'uint8_t', 'uint16_t', 'uint32_t', 'int8_t', 'int16_t',
  'int32_t', 'size_t', 'boolean', 'word', 'DHT', 'Servo', 'WiFiClient', 'PubSubClient', 'HTTPClient', 'WebServer', 'JsonDocument',
  'DynamicJsonDocument', 'StaticJsonDocument', 'JsonArray', 'JsonObject', 'LiquidCrystal_I2C', 'Adafruit_SSD1306', 'Adafruit_NeoPixel',
  'Preferences', 'IPAddress', 'TaskHandle_t', 'QueueHandle_t', 'SemaphoreHandle_t', 'hw_timer_t', 'HardwareSerial']);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function highlightCpp(code: string): string {
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(^[ \t]*#\w+[^\n]*)|(\b0x[0-9a-fA-F]+\b|\b\d+(?:\.\d+)?[fFuUlL]*\b)|([A-Za-z_]\w*)(\s*\()?/gm;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    out += esc(code.slice(last, m.index));
    last = re.lastIndex;
    if (m[1]) out += `<span class="tok-com">${esc(m[1])}</span>`;
    else if (m[2]) out += `<span class="tok-str">${esc(m[2])}</span>`;
    else if (m[3]) out += `<span class="tok-pp">${esc(m[3])}</span>`;
    else if (m[4]) out += `<span class="tok-num">${esc(m[4])}</span>`;
    else if (m[5]) {
      const w = m[5];
      const cls = KW.has(w) ? 'tok-kw' : TY.has(w) ? 'tok-ty' : m[6] ? 'tok-fn' : '';
      out += cls ? `<span class="${cls}">${esc(w)}</span>` : esc(w);
      if (m[6]) out += esc(m[6]);
    }
  }
  out += esc(code.slice(last));
  return out;
}

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    code(text: string, lang: string | undefined) {
      const body = !lang || /^(cpp|c\+\+|c|arduino|ino)$/i.test(lang) ? highlightCpp(text) : esc(text);
      return `<pre data-lang="${esc(lang ?? '')}"><code>${body}</code></pre>`;
    },
    link(href: string, _title: string | null | undefined, text: string) {
      const ext = /^https?:/.test(href ?? '');
      return `<a href="${esc(href ?? '#')}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${text}</a>`;
    },
  },
});

export function renderMd(src: string): string {
  return marked.parse(src, { async: false }) as string;
}

export function Md({ text, className = '' }: { text: string; className?: string }) {
  const html = useMemo(() => renderMd(text), [text]);
  return <div className={`md ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Строка markdown без абзацев (для целей и подсказок). */
export function MdInline({ text }: { text: string }) {
  const html = useMemo(() => marked.parseInline(text, { async: false }) as string, [text]);
  return <span className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}
