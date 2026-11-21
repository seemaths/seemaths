"""Account-free assignments. SQLite locally; Supabase PostgreSQL in production."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import sqlite3
import time
from contextlib import contextmanager
from typing import Literal, Optional
from urllib.parse import urlsplit, urlencode, parse_qs
from uuid import UUID, uuid4, uuid5, NAMESPACE_URL

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, model_validator

ROOT = Path(__file__).resolve().parent
WEEK = 7 * 86400


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ArcadeStage(StrictModel):
    quode: str = Field(pattern=r'^(?:algebra|arithmetic|geometry|measurement|number|statistics)-[a-z0-9_]+$')
    title: str = Field(min_length=1, max_length=200)


class Recipe(StrictModel):
    topic: str = Field(default='random', max_length=100)
    mode: Literal['practice', 'exam'] = 'practice'
    count: int = Field(default=10, ge=1, le=99, strict=True)
    levelMin: int = Field(default=1, ge=1, le=5, strict=True)
    levelMax: int = Field(default=5, ge=1, le=5, strict=True)
    minutes: int = Field(default=30, ge=1, le=180, strict=True)
    blueprint: Optional[str] = Field(default=None, pattern=r'^[a-zA-Z0-9_-]{1,100}$')
    player: Literal['standard', 'arcade'] = 'standard'
    stages: Optional[list[ArcadeStage]] = Field(default=None, min_length=1, max_length=99)

    @model_validator(mode='after')
    def levels(self):
        subjects = self.topic.split(',')
        if self.topic != 'random' and (len(set(subjects)) != len(subjects) or any(s not in ('algebra','arithmetic','geometry','measurement','number','statistics') for s in subjects)):
            raise ValueError('Choose a valid maths topic.')
        if self.levelMin > self.levelMax:
            raise ValueError('Minimum level cannot exceed maximum level.')
        if self.player == 'arcade':
            if self.mode != 'practice' or not self.stages or len(self.stages) != self.count:
                raise ValueError('Arcade practice requires one selected code per stage.')
            if self.topic != 'random' and any(s.quode.split('-')[0] not in subjects for s in self.stages):
                raise ValueError('Arcade codes must match the selected topics.')
        elif self.stages is not None:
            raise ValueError('Stage selections belong to Arcade practice.')
        return self


class Join(StrictModel):
    # A browser-generated secret makes join retries idempotent. Never a display number.
    credential: str = Field(pattern=r'^[A-Za-z0-9_-]{43,86}$')


class Answer(StrictModel):
    index: int = Field(ge=1, le=99, strict=True)
    correct: Optional[bool] = Field(default=None, strict=True)
    helped: bool = Field(default=False, strict=True)
    checks: int = Field(default=0, ge=0, le=999, strict=True)
    skipped: bool = Field(default=False, strict=True)


class Progress(StrictModel):
    revision: int = Field(ge=1, le=2147483647, strict=True)
    answers: list[Answer] = Field(max_length=99)
    completed: bool = False
    attemptId: Optional[UUID] = None
    activeSeconds: int = Field(default=0, ge=0, le=604800, strict=True)


class Closing(StrictModel):
    closed: bool


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


class Database:
    def __init__(self, url: str):
        self.url = url
        self.postgres = url.startswith(('postgres://', 'postgresql://'))
        if self.postgres:
            return  # Production schema is installed explicitly through migrations.
        if not self.postgres:
            Path(url).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            for statement in (ROOT / 'schema.sql').read_text().split(';'):
                if statement.strip():
                    db.execute(statement)
            # Upgrade legacy local labels without changing assignment IDs or progress.
            for row in db.execute('SELECT id,reference FROM assignments WHERE length(reference)<>4 ORDER BY created_at,id').fetchall():
                value=int(row['reference'][-4:])
                while db.execute('SELECT id FROM assignments WHERE reference=?',(f'{value:04d}',)).fetchone():
                    value=(value+1)%10000
                db.execute('UPDATE assignments SET reference=? WHERE id=?',(f'{value:04d}',row['id']))
            if 'active_seconds' not in {row['name'] for row in db.execute('PRAGMA table_info(participants)').fetchall()}:
                db.execute('ALTER TABLE participants ADD COLUMN active_seconds INTEGER NOT NULL DEFAULT 0 CHECK (active_seconds BETWEEN 0 AND 604800)')

    @contextmanager
    def connect(self):
        if self.postgres:
            import psycopg
            from psycopg.rows import dict_row
            connection = psycopg.connect(self.url, row_factory=dict_row, prepare_threshold=None)
            connection.execute('SET search_path TO assignments_portal')
        else:
            connection = sqlite3.connect(self.url, timeout=15)
            connection.row_factory = sqlite3.Row
            connection.execute('PRAGMA foreign_keys=ON')
            connection.execute('BEGIN IMMEDIATE')
        class Session:
            def execute(_, sql, params=()):
                return connection.execute(sql.replace('?', '%s') if self.postgres else sql, params)
        try:
            yield Session()
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()


def create_app(database_url=None, now=None, rate_secret=None):
    production = os.getenv('PORTAL_ENV') == 'production'
    database_url = database_url or os.getenv('DATABASE_URL') or str(ROOT / 'data/portal.sqlite3')
    origin = os.getenv('PORTAL_ORIGIN', 'http://127.0.0.1:4180').rstrip('/')
    allowed_origins = {origin, *[value.strip().rstrip('/') for value in os.getenv('PORTAL_ALLOWED_ORIGINS', '').split(',') if value.strip()]}
    player_origin = os.getenv('PLAYER_ORIGIN', 'https://seemaths.org').rstrip('/')
    secret = rate_secret or os.getenv('PORTAL_RATE_SECRET')
    cron_secret = os.getenv('PORTAL_CRON_SECRET', '')
    if production and (not database_url.startswith(('postgres://', 'postgresql://')) or
                       not secret or len(secret) < 32 or len(cron_secret) < 32 or secret == cron_secret or
                       not origin.startswith('https://')):
        raise RuntimeError('Production needs PostgreSQL, HTTPS and separate rate/cron secrets (32+ characters).')
    if urlsplit(player_origin).path not in ('', '/') or urlsplit(player_origin).scheme not in ('https', 'http'):
        raise RuntimeError('PLAYER_ORIGIN must be an HTTP(S) origin without a path.')
    secret = secret or 'local-development-only-rate-secret'
    clock = now or time.time
    db = Database(database_url)
    app = FastAPI(title='See Maths assignments', docs_url=None, redoc_url=None, openapi_url=None)
    app.state.database = db

    def current_time():
        return int(clock())

    def cleanup():
        with db.connect() as tx:
            tx.execute('DELETE FROM assignments WHERE expires_at <= ?', (current_time(),))
            tx.execute('DELETE FROM rate_buckets WHERE expires_at <= ?', (current_time(),))

    def rate(tx, key, limit, seconds):
        window = current_time() // seconds
        hashed = hmac.new(secret.encode(), f'{key}:{window}'.encode(), hashlib.sha256).hexdigest()
        row = tx.execute('INSERT INTO rate_buckets(bucket,count,expires_at) VALUES (?,1,?) '
                         'ON CONFLICT(bucket) DO UPDATE SET count=rate_buckets.count+1 RETURNING count',
                         (hashed, (window+1)*seconds)).fetchone()
        if row['count'] > limit:
            raise HTTPException(429, 'Too many requests. Please try again shortly.', headers={'Retry-After': str(seconds)})

    def peer(request):
        # Deliberately ignore untrusted X-Forwarded-For. Configure trusted proxies at the server.
        return request.client.host if request.client else 'unknown'

    def assignment(tx, assignment_id, lock=False, count_students=False):
        selection='assignments.*,(SELECT COUNT(*) FROM participants WHERE assignment_id=assignments.id) AS student_count' if count_students else '*'
        row = tx.execute('SELECT '+selection+' FROM assignments WHERE id=?' + (' FOR UPDATE' if lock and db.postgres else ''), (str(assignment_id),)).fetchone()
        if row is None:
            raise HTTPException(404, 'Exercise not found or expired.')
        if row['expires_at'] <= current_time():
            raise HTTPException(410, 'This exercise has expired. Its progress is no longer available.')
        return row

    def authorize(request, stored_hash):
        authorization = request.headers.get('authorization', '')
        credential = authorization.removeprefix('Bearer ') if authorization.startswith('Bearer ') else ''
        if not credential or not hmac.compare_digest(digest(credential), stored_hash):
            raise HTTPException(403, 'Open your private link to access this page.')

    def public(row):
        return dict(id=row['id'], reference=row['reference'], recipe=json.loads(row['recipe']),
                    createdAt=row['created_at'], expiresAt=row['expires_at'], closed=bool(row['closed']),
                    studentCount=int(row['student_count']) if 'student_count' in row.keys() else 0)

    def participant(row):
        answers = json.loads(row['answers'])
        return dict(id=row['id'], number=row['number'], startedAt=row['started_at'], updatedAt=row['updated_at'],
                    completedAt=row['completed_at'], revision=row['revision'], answers=answers,
                    answered=sum(not a.get('skipped') or a.get('correct') is not None for a in answers), correct=sum(a['correct'] is True for a in answers), attemptId=row['attempt_id'], activeSeconds=row['active_seconds'])

    @app.middleware('http')
    async def protection(request: Request, call_next):
        # Bound streamed requests too; Content-Length alone is not an effective limit.
        if request.method in ('POST', 'PUT', 'PATCH', 'DELETE'):
            if request.headers.get('origin') and request.headers['origin'] not in allowed_origins:
                return JSONResponse({'detail': 'This request came from another site.'}, status_code=403)
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > 16384:
                    return JSONResponse({'detail': 'Request is too large.'}, status_code=413)
            request._body = bytes(body)
        response = await call_next(request)
        response.headers.update({
            'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
            'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
            'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
            'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; "
                f"img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src {player_origin}; "
                "frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        })
        return response

    @app.get('/api/config')
    def config():
        return {'playerOrigin': player_origin, 'lifetimeDays': 7, 'maxParticipants': 100}

    def create_record(recipe, request, identifier=None, expose_management=True):
        cleanup()
        identifier, credential = identifier or str(uuid4()), secrets.token_urlsafe(32)
        # Numeric references are labels, never authorization credentials.
        reference = f'{secrets.randbelow(10_000):04d}'
        created = current_time()
        with db.connect() as tx:
            if db.postgres:
                tx.execute('SELECT pg_advisory_xact_lock(742001)')
            if not expose_management and tx.execute('SELECT id FROM assignments WHERE id=?', (identifier,)).fetchone():
                rate(tx, 'resolve:'+peer(request), 300, 3600)
                return public(assignment(tx, identifier))
            rate(tx, 'create:'+peer(request), 30, 3600)
            rate(tx, 'global-create', 200, 3600)
            if db.postgres:
                tx.execute('SELECT pg_advisory_xact_lock(742001)')
            if tx.execute('SELECT COUNT(*) AS n FROM assignments WHERE expires_at>?', (created,)).fetchone()['n'] >= 1000:
                raise HTTPException(503, 'Exercises are at capacity. Please try again later.')
            while tx.execute('SELECT id FROM assignments WHERE reference=?', (reference,)).fetchone():
                reference = f'{secrets.randbelow(10_000):04d}'
            tx.execute('INSERT INTO assignments(id,reference,management_hash,recipe,created_at,expires_at) VALUES (?,?,?,?,?,?)',
                       (identifier, reference, digest(credential), recipe.model_dump_json(exclude_none=True), created, created+WEEK))
            result = public(assignment(tx, identifier))
        return {**result, **({'managementToken': credential} if expose_management else {})}

    @app.post('/api/assignments', status_code=201)
    def create(recipe: Recipe, request: Request):
        return create_record(recipe, request)

    @app.post('/api/assignments/resolve')
    def resolve(recipe: Recipe, request: Request):
        # Legacy /play recipe links have no assignment UUID. One recipe/blueprint
        # resolves to one server-allocated assignment, never a teacher credential.
        canonical = recipe.model_dump()
        if recipe.player == 'standard':
            canonical.pop('player')
            canonical.pop('stages')
        identifier = str(uuid5(NAMESPACE_URL, 'seemaths:activity:'+json.dumps(canonical, sort_keys=True)))
        return create_record(recipe, request, identifier, expose_management=False)

    @app.get('/api/assignments')
    def search(request: Request, q: str = '', offset: int = 0, ids: str = ''):
        if len(q) > 2048 or offset < 0 or offset > 10000:
            raise HTTPException(422, 'Invalid search.')
        if ids:
            values=ids.split(',')
            if len(values)>100:
                raise HTTPException(422, 'Look up at most 100 exercises at a time.')
            try:
                identifiers=list({str(UUID(value)) for value in values})
            except ValueError:
                raise HTTPException(422, 'Invalid exercise IDs.')
            with db.connect() as tx:
                rate(tx, 'search:'+peer(request), 90, 60)
                rows=tx.execute('SELECT assignments.*,(SELECT COUNT(*) FROM participants WHERE assignment_id=assignments.id) AS student_count FROM assignments WHERE expires_at>? AND id IN ('+','.join('?' for _ in identifiers)+')', (current_time(),*identifiers)).fetchall()
            return {'assignments':[public(row) for row in rows]}
        query = q.strip()
        if query.startswith(('http://', 'https://', '/')):
            parsed = urlsplit(query)
            query = parse_qs(parsed.query).get('assignment', [''])[0] or parsed.path.rstrip('/').split('/')[-1]
        try:
            identifier = str(UUID(query))
        except ValueError:
            identifier = ''
        term = query.lower().replace('-', '')
        with db.connect() as tx:
            rate(tx, 'search:'+peer(request), 90, 60)
            rows = tx.execute('SELECT assignments.*,(SELECT COUNT(*) FROM participants WHERE assignment_id=assignments.id) AS student_count FROM assignments WHERE expires_at>? AND '
                '(id=? OR reference LIKE ? OR recipe LIKE ?) ORDER BY created_at DESC,id LIMIT 25 OFFSET ?',
                (current_time(), identifier, '%'+term+'%', '%"topic":"'+term+'%', offset)).fetchall()
        return {'assignments': [public(r) for r in rows]}

    @app.get('/api/assignments/{assignment_id}')
    def get_assignment(assignment_id: str, request: Request):
        with db.connect() as tx:
            rate(tx, 'read:'+peer(request), 180, 60)
            if len(assignment_id) == 4 and assignment_id.isascii() and assignment_id.isdigit():
                row = tx.execute('SELECT id FROM assignments WHERE reference=?', (assignment_id,)).fetchone()
                if not row:
                    raise HTTPException(404, 'Exercise not found or expired.')
                assignment_id = row['id']
            else:
                try:
                    assignment_id = str(UUID(assignment_id))
                except ValueError:
                    raise HTTPException(422, 'Enter a four-digit exercise PIN.')
            return public(assignment(tx, assignment_id,count_students=True))

    @app.post('/api/assignments/{assignment_id}/join')
    def join(assignment_id: UUID, body: Join, request: Request):
        with db.connect() as tx:
            # Lock quotas and assignment to allocate numbers atomically across server instances.
            if db.postgres:
                tx.execute('SELECT pg_advisory_xact_lock(742002)')
            row = assignment(tx, assignment_id, lock=True)
            rate(tx, 'join:'+peer(request), 300, 3600)
            hashed = digest(body.credential)
            previous = tx.execute('SELECT * FROM participants WHERE assignment_id=? AND join_hash=?',
                                  (str(assignment_id), hashed)).fetchone()
            if previous:
                return participant(previous)
            if row['closed']:
                raise HTTPException(409, 'This exercise is closed to new students.')
            used_numbers = {p['number'] for p in tx.execute('SELECT number FROM participants WHERE assignment_id=?', (str(assignment_id),)).fetchall()}
            available_numbers = [number for number in range(100) if number not in used_numbers]
            if len(used_numbers) >= 100 or not available_numbers:
                raise HTTPException(409, 'This exercise has reached its student limit.')
            if tx.execute('SELECT COUNT(*) AS n FROM participants').fetchone()['n'] >= 10000:
                raise HTTPException(503, 'Student sessions are at capacity. Please try again later.')
            identifier, timestamp = str(uuid4()), current_time()
            number = secrets.choice(available_numbers)
            tx.execute('INSERT INTO participants(id,assignment_id,number,credential_hash,join_hash,started_at,updated_at) '
                       'VALUES (?,?,?,?,?,?,?)', (identifier, str(assignment_id), number, hashed, hashed, timestamp, timestamp))
            tx.execute('UPDATE assignments SET next_number=next_number+1 WHERE id=?', (str(assignment_id),))
            return participant(tx.execute('SELECT * FROM participants WHERE id=?', (identifier,)).fetchone())

    def get_student(tx, assignment_id, participant_id, request, lock=False):
        assignment_row = assignment(tx, assignment_id)
        student = tx.execute('SELECT * FROM participants WHERE id=? AND assignment_id=?' + (' FOR UPDATE' if lock and db.postgres else ''),
                             (str(participant_id), str(assignment_id))).fetchone()
        if not student:
            raise HTTPException(404, 'Student session not found.')
        authorize(request, student['credential_hash'])
        return assignment_row, student

    @app.get('/api/assignments/{assignment_id}/students/{participant_id}')
    def student_state(assignment_id: UUID, participant_id: UUID, request: Request):
        with db.connect() as tx:
            rate(tx, 'student-read:'+peer(request), 180, 60)
            _, student = get_student(tx, assignment_id, participant_id, request)
            return participant(student)

    @app.put('/api/assignments/{assignment_id}/students/{participant_id}')
    def progress(assignment_id: UUID, participant_id: UUID, body: Progress, request: Request):
        with db.connect() as tx:
            row, student = get_student(tx, assignment_id, participant_id, request, lock=True)
            rate(tx, 'progress:'+student['id'], 60, 60)
            count = json.loads(row['recipe'])['count']
            indices = [a.index for a in body.answers]
            if len(set(indices)) != len(indices) or any(i > count for i in indices):
                raise HTTPException(422, 'Progress contains invalid question numbers.')
            if student['attempt_id'] and body.attemptId and str(body.attemptId) != student['attempt_id'] and not student['completed_at']:
                raise HTTPException(409, 'This student number already has a saved activity. Continue in the original browser, or start as another student.')
            # A second tab's stale snapshot cannot erase already recorded outcomes.
            outcomes={a['index']:a for a in json.loads(student['answers'])}
            for incoming in body.answers:
                answer=incoming.model_dump()
                old=outcomes.get(answer['index'],{})
                correct=True if old.get('correct') is True or answer['correct'] is True else False if old.get('correct') is False or answer['correct'] is False else None
                outcomes[answer['index']]={'index':answer['index'],'correct':correct,'checks':max(old.get('checks',0),answer['checks']),'helped':bool(old.get('helped') or answer['helped']),'skipped':False if correct is True else bool(old.get('skipped') or answer['skipped'])}
            answers=[outcomes[index] for index in sorted(outcomes)]
            # A conditional UPDATE also protects against simultaneous requests on PostgreSQL.
            tx.execute('UPDATE participants SET answers=?,revision=?,updated_at=?,completed_at=?,attempt_id=?,active_seconds=CASE WHEN active_seconds>? THEN active_seconds ELSE ? END '
                       'WHERE id=? AND revision<? AND completed_at IS NULL',
                       (json.dumps(answers, separators=(',', ':')), body.revision,
                        current_time(), current_time() if body.completed else None,
                        str(body.attemptId) if body.attemptId else student['attempt_id'], body.activeSeconds, body.activeSeconds, student['id'], body.revision))
            return participant(tx.execute('SELECT * FROM participants WHERE id=?', (student['id'],)).fetchone())

    @app.get('/api/assignments/{assignment_id}/manage')
    def manage(assignment_id: UUID, request: Request):
        with db.connect() as tx:
            rate(tx, 'manage:'+peer(request), 120, 60)
            row = assignment(tx, assignment_id)
            students = tx.execute('SELECT * FROM participants WHERE assignment_id=? ORDER BY number', (str(assignment_id),)).fetchall()
            return {**public(row), 'studentCount':len(students), 'students': [participant(s) for s in students]}

    @app.patch('/api/assignments/{assignment_id}/manage')
    def close(assignment_id: UUID, body: Closing, request: Request):
        with db.connect() as tx:
            row = assignment(tx, assignment_id)
            authorize(request, row['management_hash'])
            tx.execute('UPDATE assignments SET closed=? WHERE id=?', (int(body.closed), str(assignment_id)))
        return {'closed': body.closed}

    @app.delete('/api/assignments/{assignment_id}/manage', status_code=204)
    def delete(assignment_id: UUID, request: Request):
        with db.connect() as tx:
            row = assignment(tx, assignment_id)
            authorize(request, row['management_hash'])
            tx.execute('DELETE FROM assignments WHERE id=?', (str(assignment_id),))

    @app.post('/api/maintenance/cleanup')
    def scheduled_cleanup(request: Request):
        if not cron_secret:
            raise HTTPException(503, 'Scheduled cleanup is not configured.')
        authorize(request, digest(cron_secret))
        cleanup()
        return {'ok': True}

    app.mount('/assets', StaticFiles(directory=ROOT / 'static'), name='assets')

    @app.get('/a/{assignment_id}')
    def open_student(assignment_id: UUID):
        with db.connect() as tx:
            row = assignment(tx, assignment_id)
            recipe = json.loads(row['recipe'])
        return RedirectResponse('/play?' + urlencode({**{k:v for k,v in recipe.items() if k != 'stages'}, 'assignment': str(assignment_id)}))

    @app.get('/')
    @app.get('/exercises')
    @app.get('/assignments')
    @app.get('/manage/{assignment_id}')
    def page(assignment_id: Optional[str] = None):
        return FileResponse(ROOT / 'static/index.html')

    return app


app = create_app()
