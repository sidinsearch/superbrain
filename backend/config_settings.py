"""
SuperBrain Production Configuration
Production-grade settings for deployment
"""

import os
from typing import Optional
from functools import lru_cache

class Settings:
    """Application settings with sensible production defaults."""
    
    # ──────────────────────────────────────────────────────────────────────────
    # Core Settings
    # ──────────────────────────────────────────────────────────────────────────
    
    # API Configuration
    API_TITLE: str = "SuperBrain API"
    API_VERSION: str = "1.0.0"
    API_DESCRIPTION: str = "AI-powered content analysis and archival system"
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")
    DEBUG: bool = ENVIRONMENT == "development"
    
    # Server
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", 5000))
    WORKERS: int = int(os.getenv("WORKERS", 4))
    
    # ──────────────────────────────────────────────────────────────────────────
    # Database Configuration
    # ──────────────────────────────────────────────────────────────────────────
    
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./superbrain.db")
    DATABASE_PATH: str = os.getenv("DATABASE_PATH", "superbrain.db")
    DATABASE_TIMEOUT: int = int(os.getenv("DATABASE_TIMEOUT", 30))
    
    # SQLite WAL mode for better concurrency
    ENABLE_WAL: bool = True
    
    # ──────────────────────────────────────────────────────────────────────────
    # Security & Authentication
    # ──────────────────────────────────────────────────────────────────────────
    
    # API Key from environment or config file
    SYNC_CODE_FILE: str = os.getenv("SYNC_CODE_FILE", "sync_code.txt")
    API_KEY_HEADER: str = "X-API-Key"
    
    # CORS Configuration
    CORS_ORIGINS: list = [
        "http://localhost",
        "http://localhost:19000",
        "http://localhost:19001",
        "http://localhost:8081",
    ]
    
    # Allow credentials in CORS
    CORS_CREDENTIALS: bool = True
    CORS_METHODS: list = ["*"]
    CORS_HEADERS: list = ["*"]
    
    # ──────────────────────────────────────────────────────────────────────────
    # AI Provider Configuration
    # ──────────────────────────────────────────────────────────────────────────
    
    # Groq API
    GROQ_API_KEY: Optional[str] = os.getenv("GROQ_API_KEY")
    
    # Google Gemini API
    GOOGLE_API_KEY: Optional[str] = os.getenv("GOOGLE_API_KEY")
    
    # OpenRouter API (for model fallback)
    OPENROUTER_API_KEY: Optional[str] = os.getenv("OPENROUTER_API_KEY")
    
    # Whisper Model Configuration
    WHISPER_MODEL: str = os.getenv("WHISPER_MODEL", "base")
    WHISPER_USE_CLOUD: bool = os.getenv("WHISPER_USE_CLOUD", "true").lower() == "true"
    
    # ──────────────────────────────────────────────────────────────────────────
    # Instagram Configuration
    # ──────────────────────────────────────────────────────────────────────────
    
    INSTAGRAM_USERNAME: Optional[str] = os.getenv("INSTAGRAM_USERNAME")
    INSTAGRAM_PASSWORD: Optional[str] = os.getenv("INSTAGRAM_PASSWORD")
    
    # ──────────────────────────────────────────────────────────────────────────
    # File & Storage Configuration
    # ──────────────────────────────────────────────────────────────────────────
    
    # Upload configuration
    UPLOAD_DIR: str = os.getenv("UPLOAD_DIR", "static/uploads")
    TEMP_DIR: str = os.getenv("TEMP_DIR", "temp")
    MAX_UPLOAD_SIZE: int = int(os.getenv("MAX_UPLOAD_SIZE", 50 * 1024 * 1024))  # 50MB
    
    # Allowed file types
    ALLOWED_EXTENSIONS: set = {
        "jpg", "jpeg", "png", "gif", "webp",  # Images
        "mp4", "mov", "avi", "mkv",           # Videos
        "mp3", "wav", "m4a", "aac",          # Audio
    }
    
    # ──────────────────────────────────────────────────────────────────────────
    # Logging Configuration
    # ──────────────────────────────────────────────────────────────────────────
    
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO" if ENVIRONMENT == "production" else "DEBUG")
    LOG_FILE: Optional[str] = os.getenv("LOG_FILE")
    LOG_FORMAT: str = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    
    # ──────────────────────────────────────────────────────────────────────────
    # Performance & Rate Limiting
    # ──────────────────────────────────────────────────────────────────────────
    
    # Rate limiting
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_PER_MINUTE: int = int(os.getenv("RATE_LIMIT_PER_MINUTE", 60))
    
    # Request timeout (seconds)
    REQUEST_TIMEOUT: int = int(os.getenv("REQUEST_TIMEOUT", 60))
    
    # Connection pool size
    CONNECTION_POOL_SIZE: int = int(os.getenv("CONNECTION_POOL_SIZE", 10))
    
    # ──────────────────────────────────────────────────────────────────────────
    # Feature Flags
    # ──────────────────────────────────────────────────────────────────────────
    
    # Feature flags for analytics/monitoring
    ENABLE_METRICS: bool = True
    ENABLE_HEALTH_CHECK: bool = True
    ENABLE_API_DOCS: bool = not (ENVIRONMENT == "production")
    
    # ──────────────────────────────────────────────────────────────────────────
    # Timeouts & Retries
    # ──────────────────────────────────────────────────────────────────────────
    
    # Analysis timeout (seconds)
    ANALYSIS_TIMEOUT: int = int(os.getenv("ANALYSIS_TIMEOUT", 120))
    
    # Retry configuration
    MAX_RETRIES: int = int(os.getenv("MAX_RETRIES", 3))
    RETRY_DELAY: int = int(os.getenv("RETRY_DELAY", 5))
    
    # ──────────────────────────────────────────────────────────────────────────
    # Directories (ensure they exist)
    # ──────────────────────────────────────────────────────────────────────────
    
    @classmethod
    def ensure_dirs(cls):
        """Ensure all required directories exist."""
        for dir_path in [cls.UPLOAD_DIR, cls.TEMP_DIR]:
            os.makedirs(dir_path, exist_ok=True)


class DevelopmentSettings(Settings):
    """Development environment settings."""
    DEBUG: bool = True
    CORS_ORIGINS: list = [
        "*",  # Allow all in development
    ]


class ProductionSettings(Settings):
    """Production environment settings."""
    DEBUG: bool = False
    ENABLE_API_DOCS: bool = False
    # Restrict CORS in production
    CORS_ORIGINS: list = [
        os.getenv("APP_URL", "http://localhost"),
    ]


@lru_cache()
def get_settings() -> Settings:
    """Get settings based on environment."""
    environment = os.getenv("ENVIRONMENT", "development")
    
    if environment == "production":
        return ProductionSettings()
    else:
        return DevelopmentSettings()


# Expose active settings
settings = get_settings()
