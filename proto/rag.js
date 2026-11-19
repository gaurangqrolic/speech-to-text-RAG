import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_DIR = path.join(__dirname, "..", "kb");
const DB_PATH = path.join(__dirname, "data", "rag.sqlite");

let db = null;

/** Split a Markdown doc into ~1000-char chunks with small overlap. */
function chunk(markdown, file) {
  const title = (markdown.match(/^#\s+(.+)$/m) || [])[1] || file;
  const body = markdown
    .replace(/^#\s+.+$/m, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links -> label
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")     // images
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Keep short lines too — phone numbers and email addresses are often single short paragraphs.
  const paragraphs = body.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const chunks = [];
  let buf = "";
  for (const p of paragraphs) {
    if (buf.length + p.length > 1000 && buf) {
      chunks.push({ file, title, text: buf.trim() });
      buf = buf.slice(-150);
    }
    buf += `\n\n${p.trim()}`;
  }
  if (buf.trim()) chunks.push({ file, title, text: buf.trim() });
  return chunks;
}

/** Build the FTS5 index from the kb/*.md corpus. Fast enough to do at boot. */
export function buildIndex() {
  if (db) db.close();
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(
    "CREATE TABLE chunks (id INTEGER PRIMARY KEY, file TEXT, title TEXT, text TEXT)"
  );
  db.exec(
    "CREATE VIRTUAL TABLE chunks_fts USING fts5(file, title, text, content='chunks', content_rowid='id', tokenize='unicode61')"
  );
  const insert = db.prepare(
    "INSERT INTO chunks (file, title, text) VALUES (?, ?, ?)"
  );
  const files = fs.readdirSync(KB_DIR).filter((f) => f.endsWith(".md") && f !== "README.md");
  let count = 0;
  for (const file of files) {
    const md = fs.readFileSync(path.join(KB_DIR, file), "utf8");
    for (const c of chunk(md, file)) {
      insert.run(c.file, c.title, c.text);
      count++;
    }
  }
  db.exec("INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')");
  return { files: files.length, chunks: count };
}

/** Escape for FTS5 MATCH and turn words into OR-ed prefix terms. */
function ftsQuery(q) {
  const terms = q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2)
    .map((t) => `"${t}"*`);
  return terms.slice(0, 12).join(" OR ");
}

export function search(query, topK = 5, fileFilter = null) {
  if (!db) buildIndex();
  const fts = ftsQuery(query);
  if (!fts) return [];
  const where = fileFilter
    ? "WHERE chunks_fts MATCH ? AND c.file = ?"
    : "WHERE chunks_fts MATCH ?";
  const stmt = db.prepare(
    `SELECT c.file, c.title, c.text, bm25(chunks_fts, 10.0, 3.0, 1.0) AS score
     FROM chunks_fts f JOIN chunks c ON c.id = f.rowid
     ${where} ORDER BY score LIMIT ?`
  );
  const rows = fileFilter ? stmt.all(fts, fileFilter, topK) : stmt.all(fts, topK);
  return rows.map((r) => ({
    file: r.file,
    title: r.title,
    text: r.text.slice(0, 1400),
    score: Number(r.score.toFixed(3)),
  }));
}

export function stats() {
  if (!db) return { indexed: false };
  return {
    indexed: true,
    chunks: db.prepare("SELECT COUNT(*) AS n FROM chunks").get().n,
  };
}
