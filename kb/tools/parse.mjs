import readline from "node:readline";
import fs from "node:fs";

const ESC = {
  n: "\n", r: "\r", t: "\t", "0": "\0", Z: "\x1a", b: "\b",
  "\\": "\\", "'": "'", '"': '"',
};

function parseInsert(stmt) {
  const vi = stmt.indexOf("VALUES (");
  if (vi === -1) return [];
  let i = vi + 7;
  const rows = [];
  let row = null;

  function parseValue() {
    if (stmt[i] === "'") {
      i++;
      let s = "";
      while (i < stmt.length) {
        const c = stmt[i];
        if (c === "\\") {
          const n = stmt[i + 1];
          s += ESC[n] !== undefined ? ESC[n] : n;
          i += 2;
        } else if (c === "'") {
          i++;
          break;
        } else {
          s += c;
          i++;
        }
      }
      return s;
    }
    let j = i;
    while (j < stmt.length && stmt[j] !== "," && stmt[j] !== ")") j++;
    const tok = stmt.slice(i, j).trim();
    i = j;
    return tok === "NULL" ? null : tok;
  }

  while (i < stmt.length && stmt[i] !== ";") {
    const c = stmt[i];
    if (c === "(") { row = []; i++; continue; }
    if (c === ",") { i++; continue; }
    if (c === ")") { if (row) rows.push(row); row = null; i++; continue; }
    if (c === " " || c === "\n") { i++; continue; }
    row.push(parseValue());
  }
  return rows;
}

const mode = process.argv[2] || "summary";
const rl = readline.createInterface({
  input: fs.createReadStream("/tmp/opencode/qrolic-kb/posts.sql"),
  crlfDelay: Infinity,
});

if (mode === "summary") {
const counts = {}; // type|status -> n
const published = []; // {id, type, title, slug, parent, contentLen}

for await (const line of rl) {
  if (line.startsWith("INSERT INTO `wp_posts`")) continue; // header, tuples follow on next lines
  if (!line.startsWith("(")) continue;
  for (const row of parseInsert("VALUES " + line)) {
    const id = row[0];
    const content = row[4] ?? "";
    const title = row[5] ?? "";
    const excerpt = row[6] ?? "";
    const status = row[7] ?? "";
    const slug = row[11] ?? "";
    const parent = Number(row[17] ?? 0);
    const type = row[20] ?? "";
    const key = `${type}|${status}`;
    counts[key] = (counts[key] ?? 0) + 1;
    if (status === "publish") {
      published.push({ id, type, title, slug, parent, excerpt: String(excerpt).slice(0, 120), contentLen: content.length });
    }
  }
}

  console.log("== counts by type|status ==");
  for (const [k, n] of Object.entries(counts).sort()) console.log(`${k}: ${n}`);
  const byType = {};
  for (const p of published) (byType[p.type] ??= []).push(p);
  console.log("\n== published posts by type ==");
  for (const [type, list] of Object.entries(byType).sort()) {
    console.log(`\n--- ${type} (${list.length}) ---`);
    for (const p of list) console.log(`${p.id}\t${p.slug}\t(parent:${p.parent})\t${p.title.slice(0, 80)}`);
  }
} else if (mode === "dump") {
  // dump full rows of given IDs as JSON
  const ids = new Set(process.argv.slice(3).map(Number));
  const out = [];
  const rl2 = readline.createInterface({
    input: fs.createReadStream("/tmp/opencode/qrolic-kb/posts.sql"),
    crlfDelay: Infinity,
  });
  for await (const line of rl2) {
    if (line.startsWith("INSERT INTO `wp_posts`")) continue;
    if (!line.startsWith("(")) continue;
    for (const row of parseInsert("VALUES " + line)) {
      if (ids.has(Number(row[0]))) {
        out.push({
          id: Number(row[0]),
          date: row[2],
          content: row[4],
          title: row[5],
          excerpt: row[6],
          status: row[7],
          slug: row[11],
          modified: row[14],
          parent: Number(row[17]),
          type: row[20],
        });
      }
    }
  }
  fs.writeFileSync("/tmp/opencode/qrolic-kb/selected.json", JSON.stringify(out, null, 2));
  console.log(`dumped ${out.length} posts -> /tmp/opencode/qrolic-kb/selected.json`);
}
