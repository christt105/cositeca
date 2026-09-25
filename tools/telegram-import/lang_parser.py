import re
import unicodedata
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
_LANGUAGES = yaml.safe_load((REPO_ROOT / "languages.yaml").read_text())

SYNONYMS = {
    "espanol": "castellano",
    "spanish": "castellano",
    "english": "ingles",
    "japanese": "japones",
    "french": "frances",
    "catalan": "catalan",
}

SPLIT_RE = re.compile(r",|\by\b|\be\b|/|\+", re.IGNORECASE)
MAX_LEADING_LINES = 4


def _norm(text):
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return text.strip(" .").lower()


def _table(kind):
    return {_norm(name): name for name in _LANGUAGES[kind]}


_AUDIO_TABLE = _table("audio")
_SUBS_TABLE = _table("subs")


def _tokenize(segment):
    segment = segment.replace("(", ",").replace(")", ",")
    for raw in SPLIT_RE.split(segment):
        token = _norm(raw)
        token = SYNONYMS.get(token, token)
        if token:
            yield token


def _extract(segment, table):
    found = []
    for token in _tokenize(segment):
        mapped = "VOSE" if token == "vose" else table.get(token)
        if mapped and mapped not in found:
            found.append(mapped)
    return found


def _resolve_vose(tokens, is_subs_context):
    resolved = []
    for token in tokens:
        if token == "VOSE":
            resolved.append("Castellano" if is_subs_context else "VO")
        else:
            resolved.append(token)
    return [t for i, t in enumerate(resolved) if t not in resolved[:i]]


def _is_pure_language_line(line):
    stripped = re.sub(r"^\s*solo\s+", "", line, flags=re.IGNORECASE)
    tokens = list(_tokenize(stripped))
    if not tokens:
        return False
    return all(t == "vose" or t == "vo" or t in _AUDIO_TABLE for t in tokens)


def parse_languages(text):
    """Best-effort audio/subs extraction from a Telegram post body.

    Handles explicit "Audio:"/"Subtítulos:" lines and short implicit lines
    like "Castellano y VOSE" or "Solo VOSE" near the top of the message.
    Unrecognized wording is dropped rather than guessed.
    """
    audio, subs = [], []
    lines = [l.strip() for l in (text or "").split("\n") if l.strip()]

    for line in lines:
        lower = _norm(line)
        if lower.startswith("audio"):
            segment = line.split(":", 1)[1] if ":" in line else line[len("audio"):]
            audio += _resolve_vose(_extract(segment, _AUDIO_TABLE), is_subs_context=False)
        elif lower.startswith(("subt", "subs")):
            segment = line.split(":", 1)[1] if ":" in line else line
            subs += _resolve_vose(_extract(segment, _SUBS_TABLE), is_subs_context=True)

    if not audio and not subs:
        for line in lines[:MAX_LEADING_LINES]:
            if not _is_pure_language_line(line):
                continue
            segment = re.sub(r"^\s*solo\s+", "", line, flags=re.IGNORECASE)
            tokens = _extract(segment, _AUDIO_TABLE)
            audio = _resolve_vose(tokens, is_subs_context=False)
            if "VOSE" in tokens:
                subs = ["Castellano"]
            break

    dedupe = lambda items: [t for i, t in enumerate(items) if t not in items[:i]]
    return dedupe(audio), dedupe(subs)
