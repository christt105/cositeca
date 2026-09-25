from pathlib import Path

from telethon import TelegramClient

from env import read_env

SESSION_PATH = Path.home() / ".cositeca-telegram.session"


def build_client():
    api_id = int(read_env("TELEGRAM_API_ID"))
    api_hash = read_env("TELEGRAM_API_HASH")
    return TelegramClient(str(SESSION_PATH), api_id, api_hash)
