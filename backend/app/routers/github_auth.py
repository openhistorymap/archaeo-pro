"""GitHub OAuth code-for-token relay.

The PWA does the PKCE half-flow (redirect + verifier) and posts the
authorization code here. We:

  - accept {client_id, code, redirect_uri, code_verifier} from the PWA
  - inject GITHUB_CLIENT_SECRET server-side (GitHub OAuth Apps require
    it; PKCE-without-secret is GitHub-Apps-only)
  - forward to https://github.com/login/oauth/access_token
  - return GitHub's JSON response verbatim to the PWA

The token never persists server-side. The client_secret never leaves
the backend. PKCE still protects against authorization-code interception
because the verifier binds the exchange to the specific browser session.
"""
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import settings

router = APIRouter(prefix="/auth/github", tags=["auth"])

GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
_TIMEOUT = httpx.Timeout(connect=5.0, read=10.0, write=5.0, pool=5.0)


class ExchangePayload(BaseModel):
    client_id: str
    code: str
    redirect_uri: str
    code_verifier: str


@router.post("/exchange")
async def exchange(payload: ExchangePayload) -> dict:
    if not settings.github_client_secret:
        raise HTTPException(
            status_code=500,
            detail="GITHUB_CLIENT_SECRET is not configured on the server.",
        )

    data = payload.model_dump()
    data["client_secret"] = settings.github_client_secret

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        try:
            r = await client.post(
                GITHUB_TOKEN_URL,
                headers={"Accept": "application/json"},
                data=data,
            )
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"GitHub unreachable: {exc}") from exc

    body = r.json() if r.content else {}
    if r.status_code >= 400 or body.get("error"):
        raise HTTPException(
            status_code=400,
            detail=body.get("error_description") or body.get("error") or f"GitHub returned {r.status_code}",
        )
    return body
