import re
from pathlib import Path

from telethon import TelegramClient

ENV_PATH = Path("/Server/70-79_Media/77_cinegram/.env")
SESSION_PATH = Path.home() / ".cositeca-telegram.session"


def _read_env(key):
    text = ENV_PATH.read_text()
    match = re.search(rf"^{key}=(.*)$", text, re.MULTILINE)
    if not match:
        raise RuntimeError(f"{key} not found in {ENV_PATH}")
    return match.group(1).strip()


def build_client():
    api_id = int(_read_env("TELEGRAM_API_ID"))
    api_hash = _read_env("TELEGRAM_API_HASH")
    return TelegramClient(str(SESSION_PATH), api_id, api_hash)
