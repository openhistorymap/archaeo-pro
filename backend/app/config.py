from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://archaeo:changeme@db:5432/archaeo"
    uploads_dir: Path = Path("/data/uploads")
    exports_dir: Path = Path("/data/exports")
    libreoffice_bin: str = "libreoffice"
    cors_origins: str = "http://localhost:4200"

    # WMS upstream — defaults are best-known endpoints; override via env if they drift.
    # See memory/reference_italian_data_sources.md for context.
    wms_vincoli_url: str = "https://vincoliinrete.beniculturali.it/VincoliInRete/services/Wms"
    wms_ispra_url: str = "https://sgi2.isprambiente.it/arcgis/services/Geologia/Carta_geologica_ITA/MapServer/WMSServer"
    wms_pcn_url: str = "https://wms.pcn.minambiente.it/ogc"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
settings.uploads_dir.mkdir(parents=True, exist_ok=True)
settings.exports_dir.mkdir(parents=True, exist_ok=True)
