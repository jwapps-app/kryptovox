"""Test bootstrap: set a non-production environment before any app import so the
strong-SECRET_KEY guard doesn't reject the test placeholder."""
import os

os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault(
    "SECRET_KEY", "test-secret-key-not-for-production-0123456789abcdef"
)
