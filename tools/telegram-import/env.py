import os
import re
from pathlib import Path

ENV_FILE = Path(os.environ.get("COSITECA_ENV_FILE", Path(__file__).resolve().parent / ".env"))


def read_env(key):
    """Read a credential from the environment, falling back to ENV_FILE.

    ENV_FILE defaults to tools/telegram-import/.env (gitignored) and can be
    pointed elsewhere with COSITECA_ENV_FILE.
    """
    if os.environ.get(key):
        return os.environ[key].strip()
    if ENV_FILE.exists():
        match = re.search(rf"^{key}=(.*)$", ENV_FILE.read_text(), re.MULTILINE)
        if match:
            return match.group(1).strip()
    raise RuntimeError(f"{key} not set in the environment nor in {ENV_FILE}")
