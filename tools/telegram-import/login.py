import asyncio
import json
import sys
from pathlib import Path

from telethon.errors import SessionPasswordNeededError

from telegram_client import build_client

STATE_PATH = Path.home() / ".cositeca-telegram-login-state.json"


async def send_code(phone):
    client = build_client()
    await client.connect()
    sent = await client.send_code_request(phone)
    STATE_PATH.write_text(json.dumps({"phone": phone, "phone_code_hash": sent.phone_code_hash}))
    await client.disconnect()
    print("code sent")


async def sign_in(code, password=None):
    state = json.loads(STATE_PATH.read_text())
    client = build_client()
    await client.connect()
    try:
        await client.sign_in(phone=state["phone"], code=code, phone_code_hash=state["phone_code_hash"])
    except SessionPasswordNeededError:
        if not password:
            raise
        await client.sign_in(password=password)
    me = await client.get_me()
    await client.disconnect()
    STATE_PATH.unlink(missing_ok=True)
    print(f"logged in as {me.first_name} ({me.id})")


async def sign_in_password(password):
    client = build_client()
    await client.connect()
    await client.sign_in(password=password)
    me = await client.get_me()
    await client.disconnect()
    STATE_PATH.unlink(missing_ok=True)
    print(f"logged in as {me.first_name} ({me.id})")


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "send-code":
        asyncio.run(send_code(sys.argv[2]))
    elif cmd == "sign-in":
        asyncio.run(sign_in(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None))
    elif cmd == "password":
        asyncio.run(sign_in_password(sys.argv[2]))
    else:
        raise SystemExit(f"unknown command: {cmd}")
