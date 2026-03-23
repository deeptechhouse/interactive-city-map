from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://citymap:citymap@localhost:5433/citymap"
    database_url_sync: str = "postgresql://citymap:citymap@localhost:5433/citymap"
    martin_url: str = "http://localhost:3030"
    s3_endpoint_url: str = "http://localhost:9000"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket_name: str = "citymap-tiles"
    s3_region: str = "us-east-1"
    foursquare_api_key: str = ""
    pelias_url: str = "http://localhost:4000"
    app_env: str = "development"
    app_port: int = 8000
    app_host: str = "0.0.0.0"
    cors_origins: str = "http://localhost:5173,http://localhost:5174"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
