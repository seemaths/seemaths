"""For local/non-Supabase schedulers: run every 15 minutes, even with no visitors."""
import os
import time
from app import Database, ROOT

database = Database(os.getenv('DATABASE_URL', str(ROOT / 'data/portal.sqlite3')))
with database.connect() as transaction:
    now = int(time.time())
    transaction.execute('DELETE FROM assignments WHERE expires_at<=?', (now,))
    transaction.execute('DELETE FROM rate_buckets WHERE expires_at<=?', (now,))
print('Expired assignments, progress and rate buckets removed.')
