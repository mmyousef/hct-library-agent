#!/usr/bin/env python3
"""
HCT Library AI Agent — Web Scraper
====================================
Crawls library website pages and LibGuides URLs,
extracts clean text, and saves as HTML files for ingestion.

Usage:
    python scripts/scrape.py --urls urls.txt --output documents/web/
    python scripts/scrape.py --url https://library.hct.ac.ae/guides --depth 2
    python scripts/scrape.py --libguides https://guides.hct.ac.ae --output documents/guides/

Requirements:
    pip install requests beautifulsoup4 trafilatura

For JavaScript-heavy pages (optional, significantly slower):
    pip install playwright && playwright install chromium

urls.txt format (one URL per line, # for comments):
    # HCT Library main pages
    https://library.hct.ac.ae
    https://library.hct.ac.ae/databases
    https://library.hct.ac.ae/guides/citing-sources
"""

import argparse
import hashlib
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import urljoin, urlparse

# ── CONFIGURATION ──────────────────────────────────────────────────────────────
REQUEST_DELAY = 1.5         # Seconds between requests (be polite)
REQUEST_TIMEOUT = 15        # HTTP timeout in seconds
MAX_PAGES_PER_RUN = 200     # Safety cap
USER_AGENT = 'HCT-Library-AI-Agent/1.0 (Academic Research; contact: library@hct.ac.ae)'
ALLOWED_CONTENT_TYPES = {'text/html', 'application/xhtml+xml'}


# ── HTTP HELPERS ──────────────────────────────────────────────────────────────
def get_session():
    try:
        import requests
        session = requests.Session()
        session.headers.update({'User-Agent': USER_AGENT})
        return session
    except ImportError:
        print("Error: requests not installed. Run: pip install requests", file=sys.stderr)
        sys.exit(1)


def fetch_url(url: str, session) -> tuple[str | None, str | None]:
    """Fetch a URL and return (html_content, final_url). Returns (None, None) on failure."""
    try:
        response = session.get(url, timeout=REQUEST_TIMEOUT, allow_redirects=True)
        response.raise_for_status()
        content_type = response.headers.get('Content-Type', '').split(';')[0].strip()
        if content_type not in ALLOWED_CONTENT_TYPES:
            return None, None
        return response.text, response.url
    except Exception as e:
        print(f"  [warn] Failed to fetch {url}: {e}", file=sys.stderr)
        return None, None


# ── TEXT EXTRACTION ───────────────────────────────────────────────────────────
def extract_content(html: str, url: str) -> tuple[str, str]:
    """
    Extract (title, clean_text) from HTML.
    Tries trafilatura first, then BeautifulSoup.
    """
    title = ''
    text = ''

    # Try trafilatura for clean article extraction
    try:
        import trafilatura
        extracted = trafilatura.extract(html, include_links=False, include_images=False)
        if extracted and len(extracted) > 200:
            text = extracted
    except ImportError:
        pass

    # BeautifulSoup for title and fallback text
    try:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, 'html.parser')
        title_tag = soup.find('title')
        title = title_tag.get_text().strip() if title_tag else urlparse(url).path

        if not text:
            for tag in soup(['script', 'style', 'nav', 'footer', 'header',
                             'aside', 'form', 'button', 'noscript']):
                tag.decompose()
            text = soup.get_text(separator='\n')

    except ImportError:
        if not title:
            title = urlparse(url).path

    # Clean up text
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = re.sub(r' {2,}', ' ', text)
    return title.strip(), text.strip()


def extract_links(html: str, base_url: str, allowed_domain: str) -> list[str]:
    """Extract all same-domain links from HTML."""
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        return []

    soup = BeautifulSoup(html, 'html.parser')
    links = []
    for tag in soup.find_all('a', href=True):
        href = tag['href'].strip()
        if href.startswith('#') or href.startswith('mailto:') or href.startswith('javascript:'):
            continue
        full_url = urljoin(base_url, href)
        parsed = urlparse(full_url)
        if parsed.netloc == allowed_domain and parsed.scheme in ('http', 'https'):
            # Strip fragments and query strings for deduplication
            clean = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
            links.append(clean)
    return list(set(links))


# ── URL FILENAME ──────────────────────────────────────────────────────────────
def url_to_filename(url: str) -> str:
    """Convert a URL to a safe filename."""
    parsed = urlparse(url)
    path = parsed.path.strip('/').replace('/', '_') or 'index'
    path = re.sub(r'[^\w\-.]', '_', path)
    suffix = hashlib.md5(url.encode()).hexdigest()[:6]
    return f"{path}_{suffix}.html"


# ── SCRAPERS ──────────────────────────────────────────────────────────────────
def scrape_url_list(urls: list[str], output_dir: Path, verbose: bool = False) -> int:
    """Scrape a list of specific URLs (no crawling)."""
    session = get_session()
    output_dir.mkdir(parents=True, exist_ok=True)
    saved = 0

    for i, url in enumerate(urls):
        url = url.strip()
        if not url or url.startswith('#'):
            continue
        if verbose:
            print(f"  [{i+1}/{len(urls)}] {url}")

        html, final_url = fetch_url(url, session)
        if not html:
            continue

        title, text = extract_content(html, final_url)
        if len(text) < 100:
            if verbose:
                print(f"    [skip] Too little content ({len(text)} chars)")
            continue

        # Save HTML with metadata comment
        filename = url_to_filename(final_url)
        out_path = output_dir / filename
        out_path.write_text(
            f"<!-- SOURCE: {final_url} -->\n<!-- TITLE: {title} -->\n{html}",
            encoding='utf-8'
        )
        saved += 1
        if verbose:
            print(f"    → Saved: {filename} ({len(text)} chars)")

        time.sleep(REQUEST_DELAY)

    return saved


def crawl_domain(start_url: str, output_dir: Path, max_depth: int = 2,
                 verbose: bool = False) -> int:
    """Breadth-first crawl of a domain starting from start_url."""
    parsed_start = urlparse(start_url)
    allowed_domain = parsed_start.netloc
    session = get_session()
    output_dir.mkdir(parents=True, exist_ok=True)

    visited = set()
    queue = [(start_url, 0)]
    saved = 0

    while queue and saved < MAX_PAGES_PER_RUN:
        url, depth = queue.pop(0)
        clean_url = url.split('#')[0]
        if clean_url in visited:
            continue
        visited.add(clean_url)

        if verbose:
            print(f"  [depth {depth}] {url}")
        else:
            print(f"  Crawling: {url}")

        html, final_url = fetch_url(url, session)
        if not html:
            continue

        title, text = extract_content(html, final_url)
        if len(text) >= 100:
            filename = url_to_filename(final_url)
            out_path = output_dir / filename
            out_path.write_text(
                f"<!-- SOURCE: {final_url} -->\n<!-- TITLE: {title} -->\n{html}",
                encoding='utf-8'
            )
            saved += 1
            if verbose:
                print(f"    → Saved: {filename}")

        # Add child links to queue
        if depth < max_depth:
            links = extract_links(html, final_url, allowed_domain)
            for link in links:
                if link not in visited:
                    queue.append((link, depth + 1))

        time.sleep(REQUEST_DELAY)

    return saved


# ── CLI ───────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='HCT Library Web Scraper')
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--urls', type=Path, help='Text file with one URL per line')
    group.add_argument('--url', help='Single URL to scrape (with optional --depth for crawling)')
    group.add_argument('--libguides', help='LibGuides base URL to crawl')
    parser.add_argument('--output', type=Path, default=Path('documents/web'),
                        help='Output directory (default: documents/web/)')
    parser.add_argument('--depth', type=int, default=1,
                        help='Crawl depth for --url and --libguides (default: 1)')
    parser.add_argument('--verbose', action='store_true')
    args = parser.parse_args()

    print("HCT Library Web Scraper")
    print("=" * 40)

    if args.urls:
        if not args.urls.exists():
            print(f"Error: URLs file not found: {args.urls}", file=sys.stderr)
            sys.exit(1)
        lines = args.urls.read_text(encoding='utf-8').splitlines()
        urls = [l.strip() for l in lines if l.strip() and not l.startswith('#')]
        print(f"URLs to scrape  : {len(urls)}")
        saved = scrape_url_list(urls, args.output, verbose=args.verbose)

    elif args.url:
        print(f"Start URL       : {args.url}")
        print(f"Crawl depth     : {args.depth}")
        saved = crawl_domain(args.url, args.output, max_depth=args.depth,
                             verbose=args.verbose)

    else:  # --libguides
        libguides_url = args.libguides.rstrip('/')
        print(f"LibGuides URL   : {libguides_url}")
        print(f"Crawl depth     : {args.depth}")
        saved = crawl_domain(libguides_url, args.output, max_depth=args.depth,
                             verbose=args.verbose)

    print(f"\nPages saved     : {saved}")
    print(f"Output folder   : {args.output}")
    print(f"\nNext step: python scripts/ingest.py --source {args.output} --output chunks/")


if __name__ == '__main__':
    main()
