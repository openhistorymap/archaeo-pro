"""Vercel entrypoint.

Vercel's @vercel/python builder treats files under api/ as serverless functions.
We expose the FastAPI application as `app`; the vercel.json rewrites every
incoming path to this file so FastAPI's own router handles it.
"""
import os
import sys

# Make the sibling `app/` package importable. Vercel bundles everything in the
# project root that's referenced by the function — we just need it on sys.path.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.main import app  # noqa: E402,F401  — re-exported for the Vercel runtime
