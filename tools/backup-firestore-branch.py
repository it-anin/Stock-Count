"""Read-only, consistent Firestore REST backup. Output contains private branch data.

Uses GET requests only. Does not import or execute any production bot.
Example: python tools/backup-firestore-branch.py --branch KKL --read-time
2026-11-08T00:40:00Z --output stock_backup_KKL_before_delete_guard.json
"""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request

ROOT = "https://firestore.googleapis.com/v1/projects/stock-count-1d6e7/databases/(default)/documents/"


def get(path, read_time, params=()):
    query = urllib.parse.urlencode([*params, ("readTime", read_time)])
    try:
        with urllib.request.urlopen(ROOT + path + "?" + query, timeout=45) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise


def collection(path, read_time):
    documents = {}
    token = None
    while True:
        params = [("pageSize", "1000")]
        if token:
            params.append(("pageToken", token))
        page = get(path, read_time, params) or {}
        for document in page.get("documents", []):
            documents[document["name"].rsplit("/", 1)[-1]] = document
        token = page.get("nextPageToken")
        if not token:
            return documents


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--branch", choices=["KKL", "SRC", "SSS"], required=True)
    parser.add_argument("--read-time", required=True, help="UTC RFC3339 timestamp within PITR retention")
    parser.add_argument("--output", required=True)
    parser.add_argument("--include-delete-intents", action="store_true", help="Use only after publishing the delete guard rules")
    options = parser.parse_args()
    output = Path(options.output)
    if not output.name.startswith("stock_backup_"):
        parser.error("Use stock_backup_*.json so the existing .gitignore excludes private data")
    if output.exists():
        parser.error("Output already exists; choose a new name to preserve the previous backup")
    branch = options.branch
    names = [branch, "global_r05"] + [branch + suffix for suffix in (
        "_r01", "_pm", "_adjlot", "_confirm_lock", "_v1_backup",
        "_pharmacy_audit_markers", "_r16_104_meta",
    )]
    documents = {name: get("stock_sessions/" + name, options.read_time) for name in names}
    meta = documents.get(branch + "_r16_104_meta") or {}
    fields = meta.get("fields", {})
    generation = fields.get("generation", {}).get("stringValue")
    chunks = int(fields.get("chunkCount", {}).get("integerValue", "0"))
    if generation:
        for index in range(chunks):
            name = f"{branch}_r16_104_{generation}_{index:04d}"
            documents[name] = get("stock_sessions/" + name, options.read_time)
    result = {
        "__meta__": {"branch": branch, "readTime": options.read_time,
                     "createdAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                     "format": "firestore-rest-typed-v1", "readOnly": True},
        "documents": documents,
        "items": collection("stock_sessions/" + branch + "/items", options.read_time),
        "deleteIntents": collection("stock_sessions/" + branch + "/delete_intents", options.read_time) if options.include_delete_intents else None,
        "auditLog": {},
    }
    day = dt.datetime.fromisoformat(options.read_time.replace("Z", "+00:00")).astimezone(dt.timezone(dt.timedelta(hours=7))).date()
    for offset in range(7):
        key = branch + "_" + str(day - dt.timedelta(days=offset))
        entry = get("stock_audit_log/" + key, options.read_time)
        if entry:
            result["auditLog"][key] = entry
    encoded = (json.dumps(result, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    with output.open("xb") as target:
        target.write(encoded)
    print(json.dumps({"file": str(output.resolve()), "items": len(result["items"]),
                      "readTime": options.read_time, "bytes": len(encoded),
                      "sha256": hashlib.sha256(encoded).hexdigest()}))


if __name__ == "__main__":
    main()
