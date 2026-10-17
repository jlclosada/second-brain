import secrets
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://brain:brain@localhost:5432/brain"
    db_pool_size: int = 10
    data_dir: Path = Path("./data")

    # Acceso: un único dueño. APP_PASSWORD es solo la contraseña inicial;
    # en cuanto se guarda (con hash Argon2) se cambia desde Ajustes.
    app_password: str = "cambia-esta-contraseña"
    # Si no se define, se genera una al azar y se guarda en data/.secret_key
    secret_key: str | None = None
    session_days: int = 30
    # Detrás de un proxy con HTTPS (Tailscale, Caddy…) la cookie se marca Secure.
    cookie_secure: bool | None = None
    login_max_failures: int = 5
    login_window_minutes: int = 15

    timezone: str = "Europe/Madrid"

    # IA (opcional). Sin clave se usa clasificación y captura por reglas.
    anthropic_api_key: str | None = None
    classify_model: str = "claude-haiku-5-5"
    chat_model: str = "claude-opus-5-5"

    # Embeddings locales y gratuitos. "hash" solo sirve para tests.
    embeddings_provider: str = "fastembed"
    embedding_model: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    embedding_dim: int = 384

    ocr_languages: str = "spa+eng"
    max_upload_mb: int = 100
    worker_poll_seconds: float = 2.0
    calendar_sync_minutes: int = 15
    # Contacto que se envía a los servicios de notificaciones push (requisito de VAPID).
    vapid_contact: str = "mailto:admin@localhost"
    static_dir: Path | None = None

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)

    @property
    def files_dir(self) -> Path:
        return self.data_dir / "files"

    @property
    def models_dir(self) -> Path:
        return self.data_dir / "models"

    def signing_key(self) -> str:
        if self.secret_key:
            return self.secret_key
        path = self.data_dir / ".secret_key"
        if not path.exists():
            self.data_dir.mkdir(parents=True, exist_ok=True)
            path.write_text(secrets.token_urlsafe(48))
            path.chmod(0o600)
        return path.read_text().strip()


@lru_cache
def get_settings() -> Settings:
    return Settings()
