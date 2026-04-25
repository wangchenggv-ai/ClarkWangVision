from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./myopia_dev.db"
    SECRET_KEY: str = "change-this-in-production-very-long-secret-key-here"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    APP_NAME: str = "近视离焦镜管理平台"

    model_config = SettingsConfigDict(env_file=".env")


settings = Settings()
