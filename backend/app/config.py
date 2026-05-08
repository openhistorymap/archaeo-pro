from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Where transient document renders live; cleaned up by /tmp lifecycle.
    work_dir: Path = Path("/tmp/archaeo-pro")
    cors_origins: str = "http://localhost:4200,https://archaeo.pro,https://archeo.pro"

    # Gotenberg PDF microservice — runs separately (LibreOffice can't live on Vercel).
    # See pdf-service/ for deploy config; locally docker-compose brings it up.
    gotenberg_url: str = "http://gotenberg:3000"
    gotenberg_user: str | None = None
    gotenberg_password: str | None = None

    # GitHub OAuth — the *App* secret. Lives only here (Vercel env var), never
    # in the PWA bundle. The PWA still runs PKCE for the front half of the
    # flow; we add the secret server-side because GitHub OAuth Apps require
    # it on /login/oauth/access_token (PKCE alone is GitHub-Apps-only).
    github_client_secret: str | None = None

    # The WMS source catalog is hardcoded in app/services/wms.py and points
    # at PCN-Geoportale (gn.mase.gov.it) per-product mapfiles. The unified
    # `catalogo.map` advertises every layer in GetCapabilities but its
    # mapfile has no top-level projection — GetMap fails with InvalidSRS.
    # Each per-product .map file works correctly with EPSG:3857. To add or
    # change sources, edit services/wms.py.

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
settings.work_dir.mkdir(parents=True, exist_ok=True)
