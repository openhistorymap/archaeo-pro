"""GitHub OAuth code-for-token relay.

GitHub's token endpoint does not return CORS headers, so a PKCE flow run
entirely in the browser still needs a server-side relay. This endpoint:

  - accepts {client_id, code, redirect_uri, code_verifier} from the PWA
  - forwards them to https://github.com/login/oauth/access_token
  - returns GitHub's JSON response verbatim to the PWA

The backend never persists the token. It's a 60-line proxy and stays
stateless. No auth on this endpoint — the PKCE verifier is what binds the
exchange to a specific browser session.
"""
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

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
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        try:
            r = await client.post(
                GITHUB_TOKEN_URL,
                headers={"Accept": "application/json"},
                data=payload.model_dump(),
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
