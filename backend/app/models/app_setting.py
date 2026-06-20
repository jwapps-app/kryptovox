from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AppSetting(Base):
    """Key/value store for admin-adjustable global settings (e.g. the default
    message retention). Values are stored as strings and parsed by callers."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(String, nullable=False)
