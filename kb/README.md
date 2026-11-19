# Qrolic Knowledge Base (initial test set)

23 Markdown documents extracted from the local qrolic.com WordPress site for use as an
**initial knowledge base** — either uploaded to a Samvaad built-in KB or served through a
custom `/api/kb/search` endpoint.

## Source

- **Site:** `/home/gaurang/Local Sites/qrolic/` (site not running; MySQL not started)
- **Extracted from:** UpdraftPlus DB backup
  `wp-content/updraft/backup_2026-10-08-0422_Qrolic_Technologies_423a407f67cd-db.gz`
  (full dump of `https://qrolic.com`, generated 2026-10-08)
- **Converter:** `sanitize-html` + `node-html-markdown` — the same transform seam used by
  `qrolic-indexer` — with Gutenberg block comments, shortcodes, image carousels and
  anchor-TOC noise removed.

## Contents

| Category | Files | Purpose in testing |
|---|---|---|
| **Company pages** (6) | about-us, contact-us, why-qrolic, services overview, industries overview, home/landing | Greetings, "who are you", contact details, capabilities |
| **Core services** (10) | web-designing, web-development, wordpress-maintenance, wordpress-migration, ecommerce-woocommerce, performance-optimizations, plugin-development, hire-on-demand-developers, headless-wordpress, seo-optimization | "Do you offer X?", pricing/scope questions |
| **Industry verticals** (4) | healthcare, finance-banking, ecommerce, education-LMS | "Have you built websites for my industry?" |
| **Case studies** (3) | website-speed-optimization, wordpress-malware-cleanup, first-pass-airport-booking | "Have you done this before?" proof questions |

~157 KB of clean prose total. The full site has **1,189 published services** and 2,245 blog
posts — this set is deliberately the flagship subset for latency/relevance testing.

## Regenerating / expanding

```bash
node tools/parse.mjs summary                       # inventory of all posts in the dump
node tools/parse.mjs dump <ID...>                  # re-extract selected post IDs -> selected.json
node tools/convert.mjs                             # render selected.json -> kb/*.md
```

`parse.mjs` reads the extracted SQL at `/tmp/opencode/qrolic-kb/posts.sql` (recreate from the
`.gz` with the `awk` extraction shown in the session history if `/tmp` was cleared).
To add more content: run `summary`, pick IDs (e.g. more industry services or case studies),
`dump` them together with the existing IDs, then `convert`.

## Suggested Gujarati test questions

1. તમે શું સેવાઓ આપો છો? *(What services do you offer?)*
2. શું તમે હેલ્થકેર માટે વેબસાઇટ બનાવો છો? *(Do you build healthcare websites?)*
3. મારી વેબસાઇટ ધીમી છે, શું તમે તેને ઝડપી બનાવી શકો છો? *(My site is slow — can you speed it up?)*
4. તમારો સંપર્ક કરવાનો રસ્તો શું છે? *(How do I contact you?)* — expects phone/email/address
5. શું તમે WordPress થી Shopify માઇગ્રેશન કરો છો? *(Do you migrate Shopify → WordPress?)*
6. તમે કયા કેસ સ્ટડી કર્યા છે? *(Which case studies do you have?)*
