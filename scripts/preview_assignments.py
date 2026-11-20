"""Run the assignment API behind the local website, optionally using a private env file."""
import argparse
import os
from pathlib import Path
import shlex
import sys

parser = argparse.ArgumentParser()
parser.add_argument('--env-file', type=Path)
parser.add_argument('--port', type=int, default=4184)
parser.add_argument('--site-origin', default='http://127.0.0.1:8793')
args = parser.parse_args()
if args.env_file:
    for line in args.env_file.read_text().splitlines():
        if line.strip() and not line.lstrip().startswith('#'):
            key, value = line.removeprefix('export ').split('=', 1)
            parts = shlex.split(value)
            os.environ[key.strip()] = parts[0] if parts else ''
os.environ.update(PORTAL_ENV='development', PORTAL_ORIGIN=args.site_origin, PLAYER_ORIGIN=args.site_origin)
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'assignments-portal'))
import uvicorn
uvicorn.run('app:app', host='127.0.0.1', port=args.port, access_log=False)
