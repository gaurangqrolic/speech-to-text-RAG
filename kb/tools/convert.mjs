import fs from "node:fs";
import path from "node:path";
import sanitizeHtml from "sanitize-html";
import { NodeHtmlMarkdown } from "node-html-markdown";

const OUT_DIR = "/home/gaurang/Documents/Projects/speech-to-text-RAG/kb";
fs.mkdirSync(OUT_DIR, { recursive: true });

const URL_BASE = {
  services: "services",
  page: "",
  "case-studies": "case-studies",
};

const posts = JSON.parse(fs.readFileSync("/tmp/opencode/qrolic-kb/selected.json", "utf8"));

function toMarkdown(post) {
  let html = post.content;
  // strip Gutenberg block comments
  html = html.replace(/<!--\s*\/?wp:[^>]*-->/g, "");
  // strip WP shortcodes e.g. [fluentform id="1"]
  html = html.replace(/\[[a-z_][^\]]*\]/gi, "");
  // sanitize: drop script/style/iframe/form junk, keep semantic content
  html = sanitizeHtml(html, {
    allowedTags: [
      "h1", "h2", "h3", "h4", "h5", "h6", "p", "div", "span", "br", "hr",
      "ul", "ol", "li", "strong", "b", "em", "i", "u", "s", "a", "blockquote",
      "pre", "code", "table", "thead", "tbody", "tr", "th", "td", "img", "figure", "figcaption",
    ],
    allowedAttributes: { a: ["href"], img: ["src", "alt"] },
    allowedSchemes: ["http", "https", "mailto"],
  });

  let md = NodeHtmlMarkdown.translate(html, { bulletMarker: "-", keepNewLines: false });
  // drop image-only lines (logo carousels, decorative banners) and anchor TOC lists
  md = md
    .split("\n")
    .filter((line) => !/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(line))
    .filter((line) => !/^\s*-\s*\[[^\]]*\]\(#[^)]*\)\s*$/.test(line))
    .join("\n");
  // collapse excessive blank lines
  md = md.replace(/\n{3,}/g, "\n\n").trim();

  const base = URL_BASE[post.type] ?? "";
  const url = `https://qrolic.com/${base ? base + "/" : ""}${post.slug}/`;
  const header = `# ${post.title}\n\nSource: ${url}\n\n---\n\n`;
  return header + md + "\n";
}

function fileName(post) {
  const prefix =
    post.type === "services" ? "service" :
    post.type === "case-studies" ? "case-study" : "page";
  const name = post.slug
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `${prefix}-${name}.md`;
}

let total = 0;
for (const post of posts) {
  const md = toMarkdown(post);
  const file = path.join(OUT_DIR, fileName(post));
  fs.writeFileSync(file, md);
  total += md.length;
  console.log(`${fileName(post).padEnd(60)} ${String(md.length).padStart(7)} chars`);
}
console.log(`\n${posts.length} files, ${total} chars total -> ${OUT_DIR}`);
