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


def test_progress_view_is_public_and_write_credentials_are_scoped(portal):
    client, _, _ = portal
    item = assignment(client)
    first, first_auth = student(client, item)
    second, second_auth = student(client, item)
    base = f"/api/assignments/{item['id']}"
    assert 'managementToken' not in client.get(base).text
    assert 'students' not in client.get('/api/assignments').text
    assert client.get(base+'/manage').status_code == 200
    assert client.get(base+'/manage', headers=first_auth).status_code == 200
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
    assert first['id'] == again['id'] and first['number'] == again['number']
    with ThreadPoolExecutor(max_workers=6) as pool:
        numbers = list(pool.map(lambda _: student(client, item)[0]['number'], range(12)))
    assert len(set(numbers + [first['number']])) == 13
    assert all(0 <= number <= 99 for number in numbers + [first['number']])


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


def test_help_skip_and_active_time_are_saved_without_time_going_backwards(portal):
    client, _, _ = portal
    item = assignment(client)
    learner, auth = student(client, item)
    path = f"/api/assignments/{item['id']}/students/{learner['id']}"
    body = {'revision': 1, 'activeSeconds': 300, 'answers': [
        {'index': 1, 'correct': True, 'helped': True, 'checks': 1},
        {'index': 2, 'correct': None, 'skipped': True},
    ]}
    response = client.put(path, json=body, headers=auth)
    assert response.status_code == 200
    assert response.json()['activeSeconds'] == 300
    assert response.json()['answers'][0]['helped'] is True
    assert response.json()['answers'][1]['skipped'] is True
    assert client.put(path, json={**body, 'revision': 2, 'activeSeconds': 20}, headers=auth).json()['activeSeconds'] == 300
    assert client.put(path, json={**body, 'revision': 3, 'activeSeconds': -1}, headers=auth).status_code == 422
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
    assert client.get(path).status_code == 404


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
    numbers = [student(client, item)[0]['number'] for _ in range(100)]
    assert set(numbers) == set(range(100))
    assert client.post(f"/api/assignments/{item['id']}/join", json={'credential': secrets.token_urlsafe(32)}).status_code == 409
    assert client.patch(f"/api/assignments/{item['id']}/manage", json={'closed':True}, headers={'Authorization': f"Bearer {item['reference']}"}).status_code == 403


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


def test_plain_activity_links_resolve_one_assignment_without_management_access(portal):
    client, _, _ = portal
    recipe = {'topic':'geometry,number', 'count':3, 'blueprint':'test-blueprint'}
    first = client.post('/api/assignments/resolve', json=recipe)
    second = client.post('/api/assignments/resolve', json=recipe)
    assert first.status_code == 200
    assert first.json()['id'] == second.json()['id']
    assert 'managementToken' not in first.json()
    different = client.post('/api/assignments/resolve', json={**recipe,'blueprint':'different-blueprint'})
    assert different.json()['id'] != first.json()['id']


def test_student_link_opens_questions_without_an_intermediate_page(portal):
    client, _, _ = portal
    item = assignment(client, blueprint='shared-blueprint')
    response = client.get('/a/'+item['id'], follow_redirects=False)
    assert response.status_code == 307
    assert response.headers['location'].startswith('/play?')
    assert 'assignment='+item['id'] in response.headers['location']
    assert 'blueprint=shared-blueprint' in response.headers['location']


def test_assignment_link_and_uuid_find_public_progress_without_identity(portal):
    client, _, _ = portal
    item=assignment(client)
    child,_=student(client,item)
    for query in [item['id'], item['reference'], f"https://seemaths.org/play?assignment={item['id']}&teacher=12345678", f"https://seemaths.org/a/{item['id']}", f"https://seemaths.org/manage/{item['id']}"]:
        response=client.get('/api/assignments',params={'q':query})
        assert response.status_code==200
        assert response.json()['assignments'][0]['id']==item['id']
    public=client.get(f"/api/assignments/{item['id']}/manage").json()
    assert public['students'][0]['number']==child['number']
    assert 'managementToken' not in public and 'teacherNumber' not in public
    assert client.patch(f"/api/assignments/{item['id']}/manage",json={'closed':True}).status_code==403
    assert client.delete(f"/api/assignments/{item['id']}/manage").status_code==403
    assert client.patch(f"/api/assignments/{item['id']}/manage",headers=manage(item),json={'closed':True}).status_code==200
    assert client.get('/api/teachers/12345678').status_code==404
    assert 'teacher=' not in client.get(f"/a/{item['id']}",follow_redirects=False).headers['location']


def test_arcade_recipe_preserves_codes_and_launch_choice(portal):
    client, _, _ = portal
    stages = [{'quode':'number-decimal_order','title':'Decimal order'}]
    item = assignment(client, count=1, topic='number', player='arcade', stages=stages, levelMin=2, levelMax=4)
    recipe = client.get('/api/assignments/'+item['id']).json()['recipe']
    assert recipe['stages'] == stages and recipe['player'] == 'arcade'
    redirect = client.get('/a/'+item['id'], follow_redirects=False).headers['location']
    assert 'player=arcade' in redirect and 'levelMin=2' in redirect and 'stages=' not in redirect
    for changes in [{'stages':None}, {'stages':[]}, {'count':2}, {'mode':'exam'}, {'topic':'geometry'}]:
        response = client.post('/api/assignments', json={**recipe, **changes})
        assert response.status_code == 422, response.text


def test_standard_legacy_resolve_identity_is_unchanged(portal):
    from uuid import uuid5, NAMESPACE_URL
    import json
    client, _, _ = portal
    legacy = dict(topic='random', mode='practice', count=1, levelMin=1, levelMax=5, minutes=30, blueprint=None)
    expected = str(uuid5(NAMESPACE_URL,'seemaths:activity:'+json.dumps(legacy,sort_keys=True)))
    assert client.post('/api/assignments/resolve',json=legacy).json()['id'] == expected
    assert client.post('/api/assignments/resolve',json={**legacy,'player':'standard'}).json()['id'] == expected


def test_four_digit_references_are_unique_and_expire_after_seven_days(portal,monkeypatch):
    client,now,_=portal
    candidates=iter([42,42,43])
    monkeypatch.setattr('app.secrets.randbelow',lambda bound:next(candidates))
    first=assignment(client)
    second=assignment(client)
    assert first['reference']=='0042' and second['reference']=='0043'
    assert first['expiresAt']-first['createdAt']==WEEK
    assert client.get('/api/assignments',params={'ids':first['id']+','+second['id']}).status_code==200
    lookup=client.get('/api/assignments',params={'ids':first['id']+','+second['id']}).json()['assignments']
    assert {a['reference'] for a in lookup}=={'0042','0043'}
    assert 'managementToken' not in str(lookup)
    assert client.get('/api/assignments',params={'ids':'invalid'}).status_code==422
    now[0]+=WEEK
    assert client.get('/api/assignments',params={'ids':first['id']}).json()['assignments']==[]


def test_student_count_means_allocated_ids_even_without_answers_or_after_completion(portal):
    client,_,_=portal
    item=assignment(client)
    path='/api/assignments/'+item['id']
    assert client.get(path).json()['studentCount']==0
    child,auth=student(client,item,'a'*43)
    assert child['answers']==[]
    assert client.get(path).json()['studentCount']==1
    assert student(client,item,'a'*43)[0]['id']==child['id']
    assert client.get('/api/assignments',params={'ids':item['id']}).json()['assignments'][0]['studentCount']==1
    client.put(path+'/students/'+child['id'],headers=auth,json={'revision':1,'answers':[],'completed':True})
    assert client.get('/api/assignments').json()['assignments'][0]['studentCount']==1
    student(client,item,'b'*43)
    assert client.get(path).json()['studentCount']==2


def test_a_stale_tab_cannot_erase_shared_progress(portal):
    client,_,_=portal
    item=assignment(client)
    child,auth=student(client,item)
    path=f"/api/assignments/{item['id']}/students/{child['id']}"
    first=client.put(path,headers=auth,json={'revision':1,'answers':[{'index':1,'correct':None,'skipped':True},{'index':2,'correct':True,'helped':True,'checks':2}]})
    assert first.status_code==200
    stale=client.put(path,headers=auth,json={'revision':2,'answers':[]}).json()
    assert stale['answers']==first.json()['answers']
    corrected=client.put(path,headers=auth,json={'revision':3,'answers':[{'index':1,'correct':True,'checks':1}]}).json()
    assert corrected['answers'][0]['skipped'] is False
    assert corrected['answers'][0]['correct'] is True
    assert corrected['answers'][1]['helped'] is True


def test_exact_four_digit_pin_lookup(portal):
    client, now, _ = portal
    item = assignment(client)
    assert len(item['reference']) == 4
    result = client.get('/api/assignments/' + item['reference'])
    assert result.status_code == 200
    assert result.json()['id'] == item['id']
    assert 'managementToken' not in result.json()
    assert client.get('/api/assignments/123').status_code == 422
    now[0] += WEEK + 1
    assert client.get('/api/assignments/' + item['reference']).status_code == 410


def test_unknown_pin_does_not_create_an_exercise(portal):
    client, _, _ = portal
    assert client.get('/api/assignments/0000').status_code == 404
    assert client.get('/api/assignments').json()['assignments'] == []


def test_official_player_origins_can_join_exercises(tmp_path, monkeypatch):
    monkeypatch.setenv('PORTAL_ORIGIN', 'https://seemaths.org')
    client = TestClient(create_app(str(tmp_path / 'origins.sqlite3')))
    item = assignment(client)
    for origin in ['https://player.seemaths.org', 'https://arcade.seemaths.org']:
        response = client.post(f"/api/assignments/{item['id']}/join", json={'credential': secrets.token_urlsafe(32)}, headers={'Origin': origin})
        assert response.status_code == 200
    assert client.post(f"/api/assignments/{item['id']}/join", json={'credential': secrets.token_urlsafe(32)}, headers={'Origin': 'https://unrelated.example'}).status_code == 403


def test_pin_lookup_preserves_leading_zeroes(portal):
    client, _, database = portal
    item = assignment(client)
    with database.connect() as tx:
        tx.execute('UPDATE assignments SET reference=? WHERE id=?', ('0012', item['id']))
    assert client.get('/api/assignments/0012').json()['id'] == item['id']
