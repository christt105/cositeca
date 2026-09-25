import time
import urllib.parse
import urllib.request
import json

from env import read_env


class TmdbClient:
    def __init__(self):
        self.api_key = read_env("TMDB_API_KEY")
        self.use_bearer = self.api_key.startswith("eyJ")

    def _get(self, path, params):
        params = dict(params, language="es-ES")
        url = f"https://api.themoviedb.org/3{path}?" + urllib.parse.urlencode(params)
        headers = {}
        if self.use_bearer:
            headers["Authorization"] = f"Bearer {self.api_key}"
        else:
            url += f"&api_key={self.api_key}"
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req) as res:
            return json.loads(res.read())

    def search(self, kind, query, year=None):
        params = {"query": query}
        if year:
            params["year" if kind == "movie" else "first_air_date_year"] = year
        return self._get(f"/search/{kind}", params).get("results", [])

    def details(self, kind, tmdb_id):
        return self._get(f"/{kind}/{tmdb_id}", {})


_client = None


def get_client():
    global _client
    if _client is None:
        _client = TmdbClient()
    return _client


def search_with_retry(kind, query, year=None, tries=3):
    client = get_client()
    for attempt in range(tries):
        try:
            return client.search(kind, query, year)
        except Exception:
            if attempt == tries - 1:
                raise
            time.sleep(1.5)


def details_with_retry(kind, tmdb_id, tries=3):
    client = get_client()
    for attempt in range(tries):
        try:
            return client.details(kind, tmdb_id)
        except Exception:
            if attempt == tries - 1:
                raise
            time.sleep(1.5)
