"""Vercel entrypoint.

Vercel deploys this project as a FastAPI app: it finds `app` here and sends
every request to it with the original path, so FastAPI's own router handles
it. No rewrites and no pinned builder in vercel.json: a catch-all rewrite to
this file would now make FastAPI see the path /api/index for every request,
and the pinned @vercel/python@4.4.0 builder no longer loads.
"""
import os
import sys

# Make the sibling `app/` package importable. Vercel bundles everything in the
# project root that's referenced by the function — we just need it on sys.path.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.main import app  # noqa: E402,F401  — re-exported for the Vercel runtime
