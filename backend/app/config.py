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

    # WMS upstream URLs. **These are best-effort defaults** — Italian
    # cultural-heritage and geology services move and rename frequently,
    # and some block third-party data-centre IP ranges (Vercel included).
    # Override per-environment via Vercel env vars:
    #   WMS_VINCOLI_URL, WMS_ISPRA_URL, WMS_PCN_URL,
    #   WMS_VINCOLI_LAYER, WMS_ISPRA_LAYER, WMS_PCN_LAYER
    wms_vincoli_url: str = "https://vincoliinrete.beniculturali.it/VincoliInRete/services/Wms"
    wms_vincoli_layer: str = "vir:vincoli_archeologici"

    wms_ispra_url: str = "https://sgi2.isprambiente.it/arcgis/services/Geologia/Carta_geologica_ITA/MapServer/WMSServer"
    wms_ispra_layer: str = "0"

    # PCN's MapServer needs the `?map=` parameter pointing at a specific
    # mapfile. We bake the AGEA 2012 ortho default; override to use a
    # different period/area.
    wms_pcn_url: str = "http://wms.pcn.minambiente.it/ogc?map=/ms_ofs/Ortofoto/Ortofoto_AGEA_2012.map"
    wms_pcn_layer: str = "OI.ORTOIMMAGINI.2012"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
settings.work_dir.mkdir(parents=True, exist_ok=True)
