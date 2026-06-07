#!/usr/bin/env python3
"""
HCT Library AI Agent — Embedding & Pinecone Indexer
=====================================================
Reads JSONL chunks from ingest.py, generates embeddings via OpenAI,
and upserts them into Pinecone.

Usage:
    export OPENAI_API_KEY="sk-..."
    export PINECONE_API_KEY="..."
    export PINECONE_INDEX_HOST="https://your-index-host.svc.pinecone.io"

    python scripts/embed.py --input chunks/chunks_20260607_120000.jsonl
    python scripts/embed.py --input chunks/ --batch-size 100 --verbose

Requirements:
    pip install openai pinecone-client tiktoken

Pinecone index settings:
    Dimensions : 1536  (text-embedding-3-small)
    Metric     : cosine
    Cloud      : aws / gcp / azure (your choice)
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

# ── CONFIGURATION ──────────────────────────────────────────────────────────────
EMBEDDING_MODEL = 'text-embedding-3-small'
EMBEDDING_DIMS = 1536
PINECONE_NAMESPACE = 'hct-library'
DEFAULT_BATCH_SIZE = 100     # Pinecone upsert batch size
EMBED_BATCH_SIZE = 50        # OpenAI embedding batch size (max 2048 inputs)
RETRY_LIMIT = 3
RETRY_DELAY = 2.0


# ── EMBEDDING ─────────────────────────────────────────────────────────────────
def embed_batch(texts: list[str], client) -> list[list[float]]:
    """Call OpenAI embeddings API for a batch of texts. Returns list of vectors."""
    for attempt in range(RETRY_LIMIT):
        try:
            response = client.embeddings.create(model=EMBEDDING_MODEL, input=texts)
            return [item.embedding for item in response.data]
        except Exception as e:
            if attempt < RETRY_LIMIT - 1:
                print(f"  [retry {attempt+1}] Embedding error: {e}")
                time.sleep(RETRY_DELAY * (attempt + 1))
            else:
                raise


# ── PINECONE UPSERT ────────────────────────────────────────────────────────────
def upsert_batch(vectors: list[dict], index):
    """Upsert a batch of vectors to Pinecone."""
    for attempt in range(RETRY_LIMIT):
        try:
            index.upsert(vectors=vectors, namespace=PINECONE_NAMESPACE)
            return
        except Exception as e:
            if attempt < RETRY_LIMIT - 1:
                print(f"  [retry {attempt+1}] Pinecone upsert error: {e}")
                time.sleep(RETRY_DELAY * (attempt + 1))
            else:
                raise


# ── LOAD CHUNKS ────────────────────────────────────────────────────────────────
def load_chunks(input_path: Path) -> list[dict]:
    """Load chunks from a .jsonl file or all .jsonl files in a directory."""
    chunks = []
    if input_path.is_dir():
        files = sorted(input_path.glob('*.jsonl'))
        if not files:
            print(f"No .jsonl files found in {input_path}", file=sys.stderr)
            sys.exit(1)
        print(f"Found {len(files)} JSONL file(s) in {input_path}")
        for f in files:
            lines = f.read_text(encoding='utf-8').strip().splitlines()
            chunks.extend(json.loads(line) for line in lines if line.strip())
    else:
        lines = input_path.read_text(encoding='utf-8').strip().splitlines()
        chunks.extend(json.loads(line) for line in lines if line.strip())
    return chunks


# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='HCT Library Embedding & Pinecone Indexer')
    parser.add_argument('--input', type=Path, required=True,
                        help='.jsonl chunk file or directory of .jsonl files')
    parser.add_argument('--batch-size', type=int, default=DEFAULT_BATCH_SIZE,
                        help=f'Pinecone upsert batch size (default: {DEFAULT_BATCH_SIZE})')
    parser.add_argument('--dry-run', action='store_true',
                        help='Embed only, do not upsert to Pinecone')
    parser.add_argument('--verbose', action='store_true')
    args = parser.parse_args()

    # ── Check API keys ──
    openai_key = os.environ.get('OPENAI_API_KEY')
    pinecone_key = os.environ.get('PINECONE_API_KEY')
    pinecone_host = os.environ.get('PINECONE_INDEX_HOST')

    if not openai_key:
        print("Error: OPENAI_API_KEY environment variable not set.", file=sys.stderr)
        sys.exit(1)
    if not args.dry_run and (not pinecone_key or not pinecone_host):
        print("Error: PINECONE_API_KEY and PINECONE_INDEX_HOST must be set.", file=sys.stderr)
        print("Use --dry-run to test without Pinecone.", file=sys.stderr)
        sys.exit(1)

    # ── Import clients ──
    try:
        from openai import OpenAI
    except ImportError:
        print("Error: openai not installed. Run: pip install openai", file=sys.stderr)
        sys.exit(1)

    openai_client = OpenAI(api_key=openai_key)

    pinecone_index = None
    if not args.dry_run:
        try:
            from pinecone import Pinecone
        except ImportError:
            print("Error: pinecone-client not installed. Run: pip install pinecone-client", file=sys.stderr)
            sys.exit(1)
        pc = Pinecone(api_key=pinecone_key)
        pinecone_index = pc.Index(host=pinecone_host)

    # ── Load chunks ──
    print("HCT Library Embedding Pipeline")
    print("=" * 40)
    if not args.input.exists():
        print(f"Error: Input not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    chunks = load_chunks(args.input)
    print(f"Chunks loaded   : {len(chunks)}")
    if args.dry_run:
        print("Mode            : DRY RUN (no Pinecone upsert)")
    print()

    start = time.time()
    total_upserted = 0
    total_errors = 0

    # ── Process in embed batches ──
    for i in range(0, len(chunks), EMBED_BATCH_SIZE):
        embed_batch_chunks = chunks[i:i + EMBED_BATCH_SIZE]
        texts = [c['text'] for c in embed_batch_chunks]

        if args.verbose:
            print(f"Embedding chunks {i+1}–{i+len(embed_batch_chunks)} of {len(chunks)}...")

        try:
            embeddings = embed_batch(texts, openai_client)
        except Exception as e:
            print(f"  [ERROR] Embedding failed for batch {i}: {e}", file=sys.stderr)
            total_errors += len(embed_batch_chunks)
            continue

        # Build Pinecone vectors
        vectors = []
        for chunk, embedding in zip(embed_batch_chunks, embeddings):
            vectors.append({
                'id': chunk['id'],
                'values': embedding,
                'metadata': {
                    'text': chunk['text'][:1000],  # Pinecone metadata limit
                    'source': chunk.get('source', ''),
                    'category': chunk.get('category', 'general'),
                    'chunk_index': chunk.get('chunk_index', 0),
                    **{k: v for k, v in chunk.get('metadata', {}).items()
                       if isinstance(v, (str, int, float, bool))},
                }
            })

        # Upsert to Pinecone in batches
        if not args.dry_run:
            for j in range(0, len(vectors), args.batch_size):
                upsert_slice = vectors[j:j + args.batch_size]
                try:
                    upsert_batch(upsert_slice, pinecone_index)
                    total_upserted += len(upsert_slice)
                    if args.verbose:
                        print(f"  Upserted {len(upsert_slice)} vectors to Pinecone")
                except Exception as e:
                    print(f"  [ERROR] Upsert failed: {e}", file=sys.stderr)
                    total_errors += len(upsert_slice)
        else:
            total_upserted += len(vectors)
            if args.verbose:
                print(f"  [dry-run] Would upsert {len(vectors)} vectors")

    elapsed = time.time() - start
    print(f"\nDone in {elapsed:.1f}s")
    print(f"Vectors upserted: {total_upserted}")
    if total_errors:
        print(f"Errors          : {total_errors}")

    if args.dry_run:
        print("\nDry run complete. Re-run without --dry-run to push to Pinecone.")
    else:
        print(f"\nKnowledge base updated. Namespace: '{PINECONE_NAMESPACE}'")
        print("The AI agent will use the new content on the next query.")


if __name__ == '__main__':
    main()
