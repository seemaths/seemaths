from concurrent.futures import ThreadPoolExecutor
import secrets
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from app import create_app, WEEK


@pytest.fixture
def portal(tmp_path, monkeypatch):
    monkeypatch.setenv('PORTAL_CRON_SECRET', 'test-cron-secret')
    now = [1800000000]
    app = create_app(str(tmp_path / 'portal.sqlite3'), now=lambda: now[0])
    return TestClient(app), now, app.state.database


def assignment(client, **changes):
    response = client.post('/api/assignments', json={'count': 3, **changes})
    assert response.status_code == 201, response.text
    return response.json()


def student(client, item, key=None):
    key = key or secrets.token_urlsafe(32)
    response = client.post(f"/api/assignments/{item['id']}/join", json={'credential': key})
    assert response.status_code == 200, response.text
    return response.json(), {'Authorization': f'Bearer {key}'}


def manage(item):
    return {'Authorization': f"Bearer {item['managementToken']}"}


def test_private_progress_is_not_public_and_credentials_are_scoped(portal):
    client, _, _ = portal
    item = assignment(client)
    first, first_auth = student(client, item)
    second, second_auth = student(client, item)
    base = f"/api/assignments/{item['id']}"
    assert 'managementToken' not in client.get(base).text
    assert 'students' not in client.get('/api/assignments').text
    assert client.get(base+'/manage').status_code == 403
    assert client.get(base+'/manage', headers=first_auth).status_code == 403
    assert client.get(base+f"/students/{first['id']}", headers=second_auth).status_code == 403
    assert client.delete(base+'/manage', headers=second_auth).status_code == 403
    assert len(client.get(base+'/manage', headers=manage(item)).json()['students']) == 2
    assert client.get(base+f"/students/{second['id']}", headers=second_auth).status_code == 200


def test_join_retries_and_concurrent_number_allocation(portal):
    client, _, _ = portal
    item = assignment(client)
    key = secrets.token_urlsafe(32)
    first, _ = student(client, item, key)
    again, _ = student(client, item, key)
    assert first['id'] == again['id'] and first['number'] == 1
    with ThreadPoolExecutor(max_workers=6) as pool:
        numbers = list(pool.map(lambda _: student(client, item)[0]['number'], range(12)))
    assert sorted(numbers) == list(range(2, 14))


def test_progress_retry_out_of_order_and_completion(portal):
    client, _, _ = portal
    item = assignment(client)
    learner, auth = student(client, item)
    path = f"/api/assignments/{item['id']}/students/{learner['id']}"
    body = {'revision': 2, 'answers': [{'index': 1, 'correct': True}, {'index': 2, 'correct': None}]}
    response = client.put(path, json=body, headers=auth)
    assert response.json()['answered'] == 2 and response.json()['correct'] == 1
    assert client.put(path, json={**body, 'revision': 1, 'answers': []}, headers=auth).json()['answered'] == 2
    assert client.put(path, json={**body, 'answers': []}, headers=auth).json()['answered'] == 2
    finished = client.put(path, json={**body, 'revision': 3, 'completed': True}, headers=auth).json()
    assert finished['completedAt'] is not None
    assert client.put(path, json={'revision': 4, 'answers': []}, headers=auth).json()['answered'] == 2


def test_another_device_cannot_replace_an_in_progress_paper(portal):
    client, _, _ = portal
    item = assignment(client)
    learner, auth = student(client, item)
    path = f"/api/assignments/{item['id']}/students/{learner['id']}"
    body = {'revision': 1, 'answers': [{'index': 1, 'correct': True}], 'attemptId': str(uuid4())}
    assert client.put(path, json=body, headers=auth).status_code == 200
    assert client.put(path, json={**body, 'revision': 2, 'attemptId': str(uuid4()), 'answers': []}, headers=auth).status_code == 409
    assert client.get(path, headers=auth).json()['answered'] == 1


@pytest.mark.parametrize('body', [
    {'revision': 1, 'answers': [{'index': 4, 'correct': True}]},
    {'revision': 1, 'answers': [{'index': 1, 'correct': True}, {'index': 1, 'correct': False}]},
    {'revision': 1, 'answers': [], 'name': 'not permitted'},
    {'revision': 1, 'answers': [{'index': 1, 'correct': 'true'}]},
])
def test_invalid_progress_is_rejected(portal, body):
    client, _, _ = portal
    item = assignment(client)
    learner, auth = student(client, item)
    assert client.put(f"/api/assignments/{item['id']}/students/{learner['id']}", json=body, headers=auth).status_code == 422


def test_close_does_not_interrupt_existing_students_delete_cascades(portal):
    client, _, db = portal
    item = assignment(client)
    learner, auth = student(client, item)
    path = f"/api/assignments/{item['id']}"
    assert client.patch(path+'/manage', json={'closed': True}, headers=manage(item)).status_code == 200
    assert client.post(path+'/join', json={'credential': secrets.token_urlsafe(32)}).status_code == 409
    assert client.put(path+f"/students/{learner['id']}", json={'revision': 1, 'answers': []}, headers=auth).status_code == 200
    assert client.delete(path+'/manage', headers=manage(item)).status_code == 204
    with db.connect() as tx:
        assert tx.execute('SELECT COUNT(*) AS n FROM participants').fetchone()['n'] == 0
    assert client.get(path).status_code == 404


def test_expiry_hides_blocks_writes_then_cleanup_deletes(portal):
    client, now, db = portal
    item = assignment(client)
    learner, auth = student(client, item)
    now[0] += WEEK
    path = f"/api/assignments/{item['id']}"
    assert client.get(path).status_code == 410
    assert client.get('/api/assignments').json()['assignments'] == []
    assert client.get(path+'/manage', headers=manage(item)).status_code == 410
    assert client.put(path+f"/students/{learner['id']}", json={'revision': 1, 'answers': []}, headers=auth).status_code == 410
    assert client.post('/api/maintenance/cleanup').status_code == 403
    assert client.post('/api/maintenance/cleanup', headers={'Authorization': 'Bearer test-cron-secret'}).status_code == 200
    with db.connect() as tx:
        assert tx.execute('SELECT COUNT(*) AS n FROM assignments').fetchone()['n'] == 0
        assert tx.execute('SELECT COUNT(*) AS n FROM participants').fetchone()['n'] == 0


def test_limits_and_cross_origin_requests(portal):
    client, _, _ = portal
    assert client.post('/api/assignments', json={'count': 100}).status_code == 422
    assert client.post('/api/assignments', json={'levelMin': 5, 'levelMax': 1}).status_code == 422
    assert client.post('/api/assignments', json={'email': 'not collected'}).status_code == 422
    assert client.post('/api/assignments', content=b' '*16385).status_code == 413
    assert client.post('/api/assignments', json={}, headers={'Origin': 'https://another-site.example'}).status_code == 403
    for _ in range(30):
        assignment(client)
    assert client.post('/api/assignments', json={}).status_code == 429


def test_max_students_and_management_references_are_not_keys(portal):
    client, _, db = portal
    item = assignment(client)
    with db.connect() as tx:
        tx.execute('UPDATE assignments SET next_number=100 WHERE id=?', (item['id'],))
    assert student(client, item)[0]['number'] == 100
    assert client.post(f"/api/assignments/{item['id']}/join", json={'credential': secrets.token_urlsafe(32)}).status_code == 409
    assert client.get(f"/api/assignments/{item['id']}/manage", headers={'Authorization': f"Bearer {item['reference']}"}).status_code == 403


def test_page_headers_and_search(portal):
    client, _, _ = portal
    item = assignment(client, topic='geometry')
    assert client.get('/api/assignments?q=geometry').json()['assignments'][0]['id'] == item['id']
    assert client.get('/api/assignments?q='+item['reference'][:4]+'-'+item['reference'][4:]).json()['assignments'][0]['id'] == item['id']
    page = client.get('/assignments')
    assert page.status_code == 200
    assert page.headers['referrer-policy'] == 'no-referrer'
    assert "frame-ancestors 'none'" in page.headers['content-security-policy']
    assert 'managementToken' not in page.text
