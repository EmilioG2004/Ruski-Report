import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  ".."
);
const siteRoot = join(repositoryRoot, "docs", "public");
const requiredPages = [
  "index.html",
  "privacy/index.html",
  "support/index.html",
  "community-standards/index.html"
];
const failures = [];
const pageContents = new Map();

for (const page of requiredPages) {
  const pagePath = join(siteRoot, page);
  if (!existsSync(pagePath)) {
    failures.push(`${page}: required page is missing`);
    continue;
  }

  const html = readFileSync(pagePath, "utf8");
  pageContents.set(page, html);
  validateDocument(page, html);
  validateLocalLinks(page, html);
}

validateRequiredCopy();

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`Policy site validation failed: ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Policy site validation passed for ${requiredPages.length} pages.`
  );
}

function validateDocument(page, html) {
  requireMatch(page, html, /<!doctype html>/i, "HTML doctype");
  requireMatch(page, html, /<html\s+lang="en">/i, "English language");
  requireMatch(
    page,
    html,
    /<meta\s+name="viewport"[^>]*>/i,
    "mobile viewport"
  );
  requireMatch(page, html, /<main\s+[^>]*id="content"/i, "main landmark");
  requireMatch(page, html, /class="skip-link"/i, "skip link");

  const headingCount = html.match(/<h1(?:\s|>)/gi)?.length ?? 0;
  if (headingCount !== 1) {
    failures.push(`${page}: expected one h1, found ${headingCount}`);
  }

  const placeholder = /\b(?:todo|tbd|lorem ipsum|replace-me)\b|example\.com/i;
  if (placeholder.test(html)) {
    failures.push(`${page}: contains placeholder text`);
  }
}

function validateLocalLinks(page, html) {
  const currentDirectory = dirname(join(siteRoot, page));
  const hrefs = html.matchAll(/\bhref="([^"]+)"/g);

  for (const [, href] of hrefs) {
    if (
      href.startsWith("#") ||
      href.startsWith("mailto:") ||
      href.startsWith("https://")
    ) {
      continue;
    }

    const hrefPath = href.split(/[?#]/, 1)[0];
    const resolved = normalize(join(currentDirectory, hrefPath));
    const target = extname(resolved) === "" ? join(resolved, "index.html") : resolved;

    if (!target.startsWith(siteRoot) || !existsSync(target)) {
      failures.push(`${page}: broken local link "${href}"`);
    }
  }
}

function validateRequiredCopy() {
  const allPages = [...pageContents.values()].join("\n");
  const privacy = pageContents.get("privacy/index.html") ?? "";
  const support = pageContents.get("support/index.html") ?? "";
  const standards = pageContents.get("community-standards/index.html") ?? "";

  requireMatch(
    "site",
    allPages,
    /ruskisupport@gmail\.com/i,
    "production support email"
  );
  requireMatch(
    "support/index.html",
    support,
    /within three business days/i,
    "support response commitment"
  );
  requireMatch(
    "privacy/index.html",
    privacy,
    /not directed to children under 13/i,
    "minimum-age policy"
  );
  requireMatch(
    "privacy/index.html",
    privacy,
    /retained permanently as the official Ruski archive/i,
    "permanent tournament retention"
  );
  requireMatch(
    "privacy/index.html",
    privacy,
    /Comments are retained indefinitely/i,
    "comment retention"
  );
  requireMatch(
    "privacy/index.html",
    privacy,
    /does not use third-party analytics, advertising SDKs, or\s+cross-app tracking/i,
    "analytics and advertising disclosure"
  );
  requireMatch(
    "community-standards/index.html",
    standards,
    /Report Comment/,
    "reporting instructions"
  );
  requireMatch(
    "community-standards/index.html",
    standards,
    /Block User/,
    "blocking instructions"
  );
}

function requireMatch(page, content, pattern, description) {
  if (!pattern.test(content)) {
    failures.push(`${page}: missing ${description}`);
  }
}
