import * as cheerio from "cheerio";

// Turns a fetched page into the two things the pipeline needs: text for the model to read,
// and links for the crawler to rank. Pure function, no network.

export const DEFAULT_MAX_TEXT_CHARS = 6_000;
const MAX_LINK_TEXT_CHARS = 120;
const MIN_MAIN_CONTENT_CHARS = 200;

export interface PageLink {
  /** Absolute, http(s) only, fragment removed. */
  url: string;
  /** Anchor text, or the aria-label / title / image alt when the anchor has none. */
  text: string;
  /** True when every occurrence sits in a nav, header or footer. */
  inNav: boolean;
}

export interface CleanedPage {
  url: string;
  title: string;
  /** From og:site_name or application-name. The company name must never come from the hostname. */
  siteName: string;
  description: string;
  text: string;
  truncated: boolean;
  links: PageLink[];
}

// Never content: code, embeds, and markup the browser does not render.
const NON_CONTENT = "script, style, noscript, template, svg, iframe, object, embed, canvas";

// Text a visitor cannot see is where instructions aimed at a model get planted, so it is
// dropped before anything else reads the page. This catches inline styles and attributes;
// text hidden by a stylesheet rule is not detectable without rendering (see README).
const HIDDEN_ATTRIBUTES = '[hidden], [aria-hidden="true"], input[type="hidden"]';
const HIDDEN_CLASSES = ".hidden, .d-none, .invisible";
const HIDDEN_STYLE =
  /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?![.\d])|font-size\s*:\s*0(?![.\d])|(?:left|top|text-indent)\s*:\s*-\d{3,}/i;

// Boilerplate repeated on every page. Its links are kept (that is where "Careers" lives);
// its text is not.
const CHROME = "nav, footer, aside, form";
const BLOCKS = "p, div, section, article, li, tr, br, h1, h2, h3, h4, h5, h6, blockquote, pre, dt, dd";

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

export function cleanHtml(
  html: string,
  pageUrl: string,
  options: { maxTextChars?: number } = {},
): CleanedPage {
  const $ = cheerio.load(html);
  const meta = (selector: string) => collapse($(selector).first().attr("content") ?? "");

  const title = collapse($("title").first().text());
  const siteName =
    meta('meta[property="og:site_name"]') || meta('meta[name="application-name"]');
  const description =
    meta('meta[name="description"]') || meta('meta[property="og:description"]');

  // <base href> changes what relative links mean.
  let base = pageUrl;
  const baseHref = $("base[href]").first().attr("href");
  if (baseHref) {
    try {
      base = new URL(baseHref, pageUrl).href;
    } catch {
      // A malformed <base> is ignored.
    }
  }

  $(NON_CONTENT).remove();
  $(`${HIDDEN_ATTRIBUTES}, ${HIDDEN_CLASSES}`).remove();
  $("[style]")
    .filter((_, el) => HIDDEN_STYLE.test($(el).attr("style") ?? ""))
    .remove();
  $.root()
    .find("*")
    .addBack()
    .contents()
    .filter((_, node) => node.type === "comment")
    .remove();

  // Links first, while nav and footer are still in the document.
  const links = new Map<string, PageLink>();
  $("a[href]").each((_, el) => {
    const anchor = $(el);
    let url: URL;
    try {
      url = new URL(anchor.attr("href")!.trim(), base);
    } catch {
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    url.hash = "";

    const text = collapse(
      anchor.text() ||
        anchor.attr("aria-label") ||
        anchor.attr("title") ||
        anchor.find("img[alt]").first().attr("alt") ||
        "",
    ).slice(0, MAX_LINK_TEXT_CHARS);
    const inNav = anchor.closest("nav, header, footer").length > 0;

    const existing = links.get(url.href);
    if (!existing) {
      links.set(url.href, { url: url.href, text, inNav });
    } else {
      if (!existing.text) existing.text = text;
      existing.inNav = existing.inNav && inNav;
    }
  });

  $(CHROME).remove();
  // A <header> inside the article is usually its title block, so only site headers go.
  $("header")
    .filter((_, el) => $(el).closest("main, article").length === 0)
    .remove();

  // Prefer the page's own main content when it is marked up and substantial.
  const main = $("main, article, [role='main']").first();
  const root = main.length && collapse(main.text()).length >= MIN_MAIN_CONTENT_CHARS ? main : $("body");

  // .text() runs elements together, so mark block boundaries and headings first.
  root.find("h1, h2, h3").each((_, el) => {
    $(el).prepend("## ");
  });
  root.find(BLOCKS).each((_, el) => {
    $(el).append("\n");
  });

  const lines = root
    .text()
    .split("\n")
    .map(collapse)
    .filter((line) => line.length > 0 && line !== "##");

  const maxChars = options.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;
  const kept: string[] = [];
  let length = 0;
  let truncated = false;
  for (const line of lines) {
    if (length + line.length + 1 > maxChars) {
      truncated = true;
      // One enormous line (a page with no block markup) is cut rather than dropped.
      if (kept.length === 0) kept.push(line.slice(0, maxChars));
      break;
    }
    kept.push(line);
    length += line.length + 1;
  }

  return {
    url: pageUrl,
    title,
    siteName,
    description,
    text: kept.join("\n"),
    truncated,
    links: [...links.values()],
  };
}
