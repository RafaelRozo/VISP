"""
Application configuration loaded from environment variables with sensible
defaults for local development.

All settings are validated at startup via Pydantic ``BaseSettings``.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central configuration for the VISP backend."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # -- Application --
    app_name: str = "VISP API"
    app_version: str = "0.1.0"
    debug: bool = False

    # -- Database --
    database_url: str = "postgresql+asyncpg://visp:visp@localhost:5432/visp"
    sql_echo: bool = False
    db_pool_size: int = 10
    db_max_overflow: int = 20

    # -- Redis --
    redis_url: str = "redis://localhost:6379/0"

    # -- Pagination defaults --
    default_page_size: int = 20
    max_page_size: int = 100

    # -- API --
    api_v1_prefix: str = "/api/v1"

    # -- Stripe --
    stripe_secret_key: str = ""
    stripe_publishable_key: str = ""
    stripe_webhook_secret: str = ""

    # -- Mapbox --
    mapbox_access_token: str = ""

    # -- Firebase Cloud Messaging --
    firebase_service_account_path: str = ""
    firebase_credentials_json: str = ""

    # -- JWT / Auth --
    jwt_secret: str = "visp-dev-secret-change-me"
    jwt_algorithm: str = "HS256"

    # -- WebSocket --
    ws_cors_allowed_origins: str = "*"
    ws_ping_timeout: int = 30
    ws_ping_interval: int = 25


settings = Settings()
