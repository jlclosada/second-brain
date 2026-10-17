import secrets
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://brain:brain@localhost:5432/brain"
    data_dir: Path = Path("./data")

    # Acceso: un único usuario protegido por contraseña.
    app_password: str = "cambia-esta-contraseña"
    # Si no se define, se genera una al azar y se guarda en data/.secret_key
    secret_key: str | None = None
    session_days: int = 30

    # IA (opcional). Sin clave se usa una clasificación básica por reglas.
    anthropic_api_key: str | None = None
    classify_model: str = "claude-haiku-5-5"
    chat_model: str = "claude-haiku-5-5"

    # Embeddings locales y gratuitos. "hash" solo sirve para tests.
    embeddings_provider: str = "fastembed"
    embedding_model: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    embedding_dim: int = 384

    ocr_languages: str = "spa+eng"
    max_upload_mb: int = 100
    worker_poll_seconds: float = 2.0
    static_dir: Path | None = None

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
