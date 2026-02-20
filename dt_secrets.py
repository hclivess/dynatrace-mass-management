"""
Secrets loader - renamed from 'secrets.py' to avoid shadowing
Python's built-in secrets module.
"""

import json
import os
from pathlib import Path


def load_secrets(file: str = "secrets.json") -> dict:
    """Load and validate secrets from JSON file."""
    path = Path(file)
    if not path.exists():
        raise FileNotFoundError(
            f"Secrets file '{file}' not found. "
            f"Copy secrets.template.json to {file} and fill in your credentials."
        )

    with open(path, "r") as f:
        data = json.load(f)

    # Basic validation
    if "account_management" not in data:
        raise ValueError("Missing 'account_management' section in secrets")
    if "environments" not in data:
        raise ValueError("Missing 'environments' section in secrets")

    acct = data["account_management"]
    for key in ("account", "client_id", "secret"):
        if key not in acct:
            raise ValueError(f"Missing 'account_management.{key}' in secrets")

    for i, env in enumerate(data["environments"]):
        for key in ("name", "account", "secret"):
            if key not in env:
                raise ValueError(f"Missing '{key}' in environments[{i}]")

    return data
