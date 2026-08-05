import * as cheerio from "cheerio";

/**
 * Readability-lite main-content extractor. Site-agnostic: it scores candidate
 * containers by paragraph-text density (penalizing link-heavy blocks) and uses
 * generic class/id hints that news sites broadly share — never per-site
 * selectors. Then it strips the boilerplate that pollutes article bodies
 * (share bars, "related", "Baca juga", ads, captions).
 */

// Class/id keyword hints shared across most news CMSs (EN + ID).
const POSITIVE = /article|body|content|entry|main|post|text|story|read|detail|isi|konten|artikel|paragraph/i;
const NEGATIVE =
  /comment|combx|contact|foot|masthead|media-?meta|outbrain|promo|related|scroll|share|shoutbox|sidebar|sponsor|shopping|tag|widget|nav|breadcrumb|baca-?juga|terkait|populer|popular|trending|newsletter|banner|advert|\bads?\b|recommend|social|author-?box|byline/i;

const HARD_REMOVE = "script,style,noscript,iframe,svg,template,nav,aside,footer,header,form,button,input,figure figcaption";

// Narrow set of clearly-junk widgets to strip INSIDE the chosen container.
// (Broader NEGATIVE hints only penalize scoring — never delete outright, which
// would nuke content containers on sites that use ambiguous class names.)
const JUNK_INSIDE =
  /share|related|terkait|baca-?juga|rekomendasi|recommend|newsletter|advert|\bads?\b|social|comment|populer|popular|trending|sidebar|widget|promo|banner|paging|pagination/i;

/** Lines of boilerplate that leak into Indonesian/English news bodies. */
const NOISE_LINE =
  /^(baca juga|lihat juga|simak juga|simak video|saksikan|tonton|advertisement|scroll to continue|scroll to resume|iklan|halaman selanjutnya|halaman berikutnya|next page|share this|bagikan|komentar|topik terkait|artikel terkait|berita terkait|\[?video\]?)\b/i;

export interface MainContent {
  html: string;
  textLength: number;
}

export function extractMainContent(rawHtml: string): MainContent | null {
  const $ = cheerio.load(rawHtml);
  $(HARD_REMOVE).remove();

  // Score candidate containers. NEGATIVE hints only PENALIZE — we never delete a
  // container outright before scoring, so an ambiguously-named article body is
  // never accidentally nuked (that was a real bug on CNN).
  let best: { el: cheerio.Cheerio<never>; score: number } | null = null;
  $("article, main, div, section").each((_, el) => {
    const $el = $(el) as unknown as cheerio.Cheerio<never>;
    const ps = $("p", $el);
    if (ps.length < 2) return;
    const text = ps.text().replace(/\s+/g, " ").trim();
    if (text.length < 200) return;
    const linkText = $("a", $el).text().length;
    const sig = `${$(el).attr("class") ?? ""} ${$(el).attr("id") ?? ""}`;
    let score = text.length - linkText * 2 + ps.length * 15;
    if (POSITIVE.test(sig)) score += 200;
    if (NEGATIVE.test(sig) && !POSITIVE.test(sig)) score -= 400;
    if (el.tagName === "article") score += 150;
    if (score > 300 && (!best || score > best.score)) best = { el: $el, score };
  });

  if (!best) return null;
  const chosen = (best as { el: cheerio.Cheerio<never> }).el;

  // Clean inside the chosen container: drop only clearly-junk widgets.
  $("[class],[id]", chosen).each((_, el) => {
    const sig = `${$(el).attr("class") ?? ""} ${$(el).attr("id") ?? ""}`;
    if (JUNK_INSIDE.test(sig)) $(el).remove();
  });
  // Drop "Baca juga"-style inline links (common as <a> or <strong> lead-ins).
  $("a, strong, b", chosen).each((_, el) => {
    if (NOISE_LINE.test($(el).text().trim())) $(el).remove();
  });

  const html = $.html(chosen);
  const textLength = $("p", chosen).text().replace(/\s+/g, " ").trim().length;
  return { html, textLength };
}

/**
 * Post-process the converted markdown body: remove noise lines, a leading
 * heading that just repeats the title, and stray image/link-only lines.
 */
export function cleanArticleMarkdown(md: string, title?: string | null): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let started = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();

    // Skip a leading H1/H2 duplicating the title.
    if (!started && /^#{1,3}\s/.test(t)) {
      const headingText = t.replace(/^#{1,3}\s*/, "").trim();
      if (title && normalize(headingText) === normalize(title)) continue;
    }
    // Drop noise lines anywhere.
    if (NOISE_LINE.test(t.replace(/^[#>*\-\s]+/, ""))) continue;
    // Skip leading chrome (link/image-only, breadcrumbs) until real prose.
    if (!started) {
      if (t === "") continue;
      const stripped = t.replace(/!?\[[^\]]*\]\([^)]*\)/g, "").replace(/[|›>/·—–-]/g, "").trim();
      if (!t.startsWith("#") && stripped.length < 40) continue;
      started = true;
    }
    out.push(line);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}
