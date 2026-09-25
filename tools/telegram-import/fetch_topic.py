import asyncio
import json
import sys

from telegram_client import build_client


async def fetch(group_id, topic_id, out_path):
    client = build_client()
    await client.connect()
    entity = await client.get_entity(group_id)
    items = []
    async for msg in client.iter_messages(entity, reply_to=topic_id, reverse=True):
        if type(msg.media).__name__ == "MessageMediaPhoto":
            items.append({"id": msg.id, "text": msg.message or "", "date": msg.date.isoformat()})
    await client.disconnect()
    with open(out_path, "w") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    print(f"saved {len(items)} items to {out_path}")


if __name__ == "__main__":
    group_id = int(sys.argv[1])
    topic_id = int(sys.argv[2])
    out_path = sys.argv[3]
    asyncio.run(fetch(group_id, topic_id, out_path))
