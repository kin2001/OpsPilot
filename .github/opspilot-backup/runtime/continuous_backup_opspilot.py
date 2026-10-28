"""OpsPilot-only encrypted checkpoints. No provider action occurs on import.

Run backup/monitor explicitly; retention application requires a reviewed plan digest.
"""
from contextlib import contextmanager
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile
import threading
import urllib.parse
import urllib.request
import uuid

from backup_runtime import ROOT, ready, restic, environment, version_bytes
from capture_opspilot_checkpoint import TOOLS, go_list, package
from provision_opspilot import dedicated_token, database_password, EXPECTED_ORG
from managed_restore_opspilot import inventory, SOURCE_REF
from hosted_smoke_runtime import read_project_keys, verify_private_directory
from connect_opspilot_b2 import BUCKET_ID

SOURCE = ROOT / '.worktrees/por-28e'
REPORTS = ROOT / '.spec-team/reports/por47-backup-fix'
RUNS = ROOT / '.spec-team/local/continuous-backup'
TAG = 'opspilot-continuous-v1'
ARCHIVE = 'opspilot-continuous.tar'
SNAPSHOT_PATH = r'D:\opspilot-continuous.tar'
MAX_B2 = 100 * 1024 * 1024
MAX_TRANSFER = 20 * 1024 * 1024
EXPECTED_HEAD = '3608204b9d6be3f589d4b086c4a6070531e29a4b'
SCHEMAS = ('public', 'private', 'auth', 'storage', 'supabase_migrations')


def now():
    return dt.datetime.now(dt.timezone.utc)


def command(args, env=None, timeout=180, limit=MAX_TRANSFER):
    child = subprocess.Popen(args, env=env, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    result = {}
    def read(label, stream, bound):
        result[label] = stream.read(bound+1)
        if len(result[label]) > bound:
            child.kill()
    readers = [threading.Thread(target=read, args=('stdout', child.stdout, limit)),
               threading.Thread(target=read, args=('stderr', child.stderr, 65536))]
    for thread in readers: thread.start()
    try:
        child.wait(timeout=timeout)
    finally:
        if child.poll() is None: child.kill()
        child.wait(timeout=10)
        for thread in readers: thread.join(timeout=10)
        child.stdout.close()
        child.stderr.close()
    if any(thread.is_alive() for thread in readers) or len(result.get('stdout', b'')) > limit or len(result.get('stderr', b'')) > 65536:
        raise ValueError('Checkpoint bounded output guard refused subprocess')
    if child.returncode:
        raise ValueError('Checkpoint subprocess failed; private output withheld')
    return result['stdout']


def save(path, value):
    temporary = path.with_suffix('.tmp')
    with temporary.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


@contextmanager
def exclusive(directory):
    # A crash intentionally leaves this lock for explicit journal reconciliation.
    lock = directory / 'active.lock'
    with lock.open('x', encoding='ascii') as stream:
        stream.write(str(os.getpid()))
    try:
        yield
    finally:
        lock.unlink()


def require_settled(directory):
    for path in [*directory.glob('run-*.json'), *directory.glob('retention-run-*.json')]:
        previous = json.loads(path.read_text(encoding='utf-8'))
        if previous.get('status') != 'verified':
            raise ValueError('Prior run requires explicit read-only reconciliation; no duplicate upload')


def validate_objects(rows):
    if len(rows) > 128:
        raise ValueError('Storage count exceeds the bounded capture limit')
    identities = set()
    total = 0
    for row in rows:
        key = row.get('name')
        if row.get('bucket_id') != 'repair-evidence' or not isinstance(key, str) or not key or any(p in ('', '..', '.') for p in key.split('/')) or '\\' in key or ':' in key:
            raise ValueError('Unexpected Storage object identity')
        identity = (row['bucket_id'], key)
        if identity in identities:
            raise ValueError('Duplicate Storage identity')
        identities.add(identity)
        size = row.get('size')
        if type(size) is not int or not 0 < size <= 5242880 or not re.fullmatch('[a-f0-9]{64}', row.get('checksum') or ''):
            raise ValueError('Object lacks a bounded ready checksum')
        total += size
    if total > 10 * 1024 * 1024:
        raise ValueError('Storage transfer limit exceeded')


def require_consistent(before, after):
    if before != after:
        raise ValueError('Source changed during capture; checkpoint refused')


def verify_archive(blob, recovered, files, manifest):
    if recovered != blob:
        raise ValueError('Recovered archive checksum differs')
    with tarfile.open(fileobj=io.BytesIO(recovered)) as tar:
        members = tar.getmembers()
        if len(members) != len(files)+1 or {m.name for m in members} != set(files) | {'manifest.json'} or not all(m.isfile() for m in members):
            raise ValueError('Recovered member inventory differs')
        if json.loads(tar.extractfile('manifest.json').read()) != manifest:
            raise ValueError('Recovered manifest differs')
        for name, data in files.items():
            if tar.extractfile(name).read() != data:
                raise ValueError('Recovered member differs')


def assessment(timestamp, snapshot_start, used, capacity, failed, max_age_hours=24):
    if type(max_age_hours) is not int or max_age_hours not in (24, 168):
        raise ValueError('Only approved daily or synthetic-weekly backup policy is supported')
    if type(used) is not int or type(capacity) is not int or not 0 <= used <= capacity or capacity <= 0:
        raise ValueError('Invalid capacity measurement')
    age = None if snapshot_start is None else (timestamp-snapshot_start).total_seconds()/3600
    if age is not None and age < 0:
        raise ValueError('Future snapshot timestamp')
    reasons = []
    decision = 'continue'
    if age is None or age >= max_age_hours or failed or used/capacity >= .95:
        decision = 'pause'
    elif age >= max_age_hours-1 or used/capacity >= .80:
        decision = 'reduce'
    if age is None: reasons.append('backup_unverified')
    elif age >= max_age_hours: reasons.append('backup_expired')
    elif age >= max_age_hours-1: reasons.append('backup_due')
    if failed: reasons.append('backup_failure_or_unreconciled_run')
    if used/capacity >= .80: reasons.append('backup_capacity')
    return {'decision': decision, 'reasons': reasons, 'backup_age_hours': age,
            'scheduler_stale': age is None or age >= 26, 'quota_percent': used/capacity*100,
            'intake_gate_enforced': False, 'max_backup_age_hours': max_age_hours}


def retention_args():
    return ['forget', '--host', 'opspilot-backup', '--tag', TAG, '--path', SNAPSHOT_PATH,
            '--group-by', 'host,paths', '--keep-daily', '7', '--keep-weekly', '4', '--dry-run', '--json']


def retention_ids(plan, verified_ids):
    if not isinstance(plan, list):
        raise ValueError('Unexpected retention preview shape')
    remove = []
    for group in plan:
        for row in group.get('remove') or []:
            tags = row.get('tags', [])
            if (row.get('id') not in verified_ids or row.get('hostname') != 'opspilot-backup'
                or row.get('paths') != [SNAPSHOT_PATH] or len(tags) != 2 or TAG not in tags
                or len([tag for tag in tags if re.fullmatch(r'run:[0-9]{8}T[0-9]{6}Z-[a-f0-9]{32}', tag)]) != 1):
                raise ValueError('Retention refuses an unknown or protected checkpoint')
            remove.append(row['id'])
    if len(set(remove)) != len(remove):
        raise ValueError('Duplicate retention candidate')
    return sorted(remove)


def database_environment(poolers):
    if len(poolers) != 1 or poolers[0].get('db_host') != 'aws-0-ap-southeast-1.pooler.supabase.com' or poolers[0].get('db_user') != 'postgres.'+SOURCE_REF:
        raise ValueError('Dedicated pooler mismatch')
    credential = ROOT / '.spec-team/local/credentials/por47-opspilot-db-password.dpapi'
    if not credential.is_file() or credential.is_symlink() or credential.parent.is_symlink():
        raise ValueError('Bound source database credential missing or redirected; no regeneration')
    env = {k:v for k,v in environment(os.environ, 'unused', 'unused', 'unused').items() if not k.startswith(('AWS_', 'RESTIC_'))}
    env.update(PGHOST=poolers[0]['db_host'], PGPORT='5432', PGUSER=poolers[0]['db_user'], PGDATABASE='postgres',
        PGPASSWORD=database_password(), PGSSLMODE='verify-full', PGSSLROOTCERT=str(TOOLS/'supabase-prod-ca-2021.crt'), PGCONNECT_TIMEOUT='15',
        PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=180000 -c idle_in_transaction_session_timeout=900000')
    env['PATH'] = str(TOOLS/'pgsql/bin')+';C:/Program Files/Git/usr/bin;C:/Windows/System32'
    return env


def require_migrations(source_files, history):
    from deploy_opspilot import pending_migrations
    migrations = []
    for name, data in sorted(source_files.items()):
        if name.startswith('source/supabase/migrations/'):
            version, label = Path(name).stem.split('_', 1)
            # Deployment reads universal-newline text; retain original checkout bytes in the archive.
            migrations.append((version, label, data.decode('utf-8').replace('\r\n', '\n').replace('\r', '\n')))
    if not migrations or pending_migrations(migrations, history):
        raise ValueError('Remote history must match every current source migration')


def provider():
    connected = json.loads((ROOT/'.spec-team/local/supabase-opspilot-state/connected.json').read_text(encoding='utf-8-sig'))
    if EXPECTED_ORG != 'woyvnmwsxtjesyvdvfkp' or SOURCE_REF != 'lhlizmdhxjspnxadtzsm' or connected.get('profile') != 'opspilot' or connected.get('organization_id') != EXPECTED_ORG:
        raise ValueError('Exact dedicated profile/organization/source required')
    token = dedicated_token()
    def api(path):
        req = urllib.request.Request('https://api.supabase.com/v1/'+path, headers={'Authorization': 'Bearer '+token})
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.load(response)
    def boundary():
        organizations = api('organizations')
        if len(organizations) != 1 or organizations[0]['id'] != EXPECTED_ORG or api('organizations/'+EXPECTED_ORG).get('plan') != 'free':
            raise ValueError('Exact dedicated Free organization required')
        target = json.loads((ROOT/'.spec-team/reports/por47-managed-restore-target.json').read_text())
        projects = api('projects')
        inventory(projects, None if target.get('status') == 'removed' else target)
        source = next(p for p in projects if p['id'] == SOURCE_REF)
        if source.get('status') != 'ACTIVE_HEALTHY':
            raise ValueError('Source not healthy')
        return source
    source = boundary()
    return api, boundary, source


def b2_bytes(authorization):
    storage = authorization['apiInfo']['storageApi']
    req = urllib.request.Request(storage['apiUrl']+'/b2api/v4/b2_list_file_versions',
        data=json.dumps({'bucketId': BUCKET_ID, 'prefix': 'opspilot/', 'maxFileCount': 1000}).encode(),
        headers={'Authorization': authorization['authorizationToken'], 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as response:
        result = json.load(response)
    if result.get('nextFileId') or result.get('nextFileName'):
        raise ValueError('Incomplete B2 inventory; capacity unknown')
    return version_bytes(result['files'])


def capture(api, source, journal, path):
    head = command(['git', '-C', str(SOURCE), 'rev-parse', 'HEAD']).decode().strip()
    if head != EXPECTED_HEAD or command(['git', '-C', str(SOURCE), 'status', '--porcelain', '--', 'supabase']):
        raise ValueError('Reviewed backend source head/bytes changed; reconcile candidate before capture')
    paths = command(['git', '-C', str(SOURCE), 'ls-files', 'supabase/config.toml', 'supabase/migrations', 'supabase/functions']).decode().splitlines()
    source_files = {}
    for name in paths:
        if PurePosixPath(name).is_absolute() or '..' in PurePosixPath(name).parts or '\\' in name or ':' in name or '.env' in Path(name).name:
            raise ValueError('Unsafe release source path')
        source_files['source/'+name] = (SOURCE/name).read_bytes()
    def config():
        return {name: api('projects/'+SOURCE_REF+'/'+name) for name in ('config/auth', 'ssl-enforcement', 'config/database/pooler', 'functions')}
    configuration = config()
    poolers = configuration['config/database/pooler']
    keys = read_project_keys()
    env = database_environment(poolers)
    psql = [str(TOOLS/'pgsql/bin/psql.exe'), '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1']
    holder = subprocess.Popen(psql, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    files = dict(source_files)
    def add(name, data):
        if sum(map(len, files.values()))+len(data) > MAX_TRANSFER:
            raise ValueError('Checkpoint exceeds approved memory/transfer limit')
        files[name] = data
    try:
        journal['snapshot_started_at'] = now().isoformat()
        save(path, journal)
        holder.stdin.write(b'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();\n')
        holder.stdin.flush()
        snapshot = holder.stdout.readline().decode().strip()
        if not re.fullmatch('[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9]+', snapshot):
            raise ValueError('Snapshot export failed')
        journal['postgres_snapshot_id'] = snapshot
        save(path, journal)
        def query(sql, shared=True):
            prefix = "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '"+snapshot+"'; " if shared else ''
            return json.loads(command(psql+['-c', prefix+sql+('; COMMIT;' if shared else '')], env))
        history_sql = "SELECT coalesce(json_agg(t ORDER BY version),'[]') FROM (SELECT version,name,statements FROM supabase_migrations.schema_migrations)t"
        history = query(history_sql)
        require_migrations(source_files, history)
        journal['migration_count'] = len(history)
        object_sql = "SELECT coalesce(json_agg(t ORDER BY bucket_id,name),'[]') FROM (SELECT o.bucket_id,o.name,a.size,a.checksum FROM storage.objects o LEFT JOIN public.attachments a ON a.object_key=o.name AND a.status='ready')t"
        objects = query(object_sql)
        validate_objects(objects)
        role_args = [str(TOOLS/'pgsql/bin/pg_dumpall.exe'), '--no-password', '--roles-only', '--no-role-passwords']
        def role_definitions():
            # New pg_dump versions randomize psql restriction keys on each invocation.
            return re.sub(rb'(?m)^\\(?:un)?restrict [A-Za-z0-9]+\r?\n', b'', command(role_args, env, 180))
        roles = role_definitions()
        add('database/complete-role-definitions.sql', roles)
        env.update(EXTRA_SED='', INCLUDED_SCHEMAS='*', RESERVED_ROLES=go_list('reservedRoles'), ALLOWED_CONFIGS=go_list('allowedConfigs'))
        for kind in ('role', 'schema', 'data'):
            env['EXCLUDED_SCHEMAS'] = go_list('InternalSchemas' if kind == 'schema' else 'excludedSchemas')
            env['EXTRA_FLAGS'] = '' if kind == 'role' else '--snapshot='+snapshot
            if kind == 'data': env['EXTRA_FLAGS'] += ' --exclude-table=storage.buckets_vectors --exclude-table=storage.vector_indexes'
            add('database/'+kind+'.sql', command(['C:/Program Files/Git/bin/bash.exe', '--noprofile', '--norc', str(TOOLS/('dump_'+kind+'.sh'))], env, 180))
        add('database/operational.dump', command([str(TOOLS/'pgsql/bin/pg_dump.exe'), '--no-password', '--format=custom', '--snapshot='+snapshot]+['--schema='+schema for schema in SCHEMAS], env, 180))
        add('database/migration-history.json', json.dumps(history).encode())
        tables = query("SELECT json_agg(json_build_array(schemaname,tablename) ORDER BY schemaname,tablename) FROM pg_tables WHERE schemaname IN ('public','private','auth','storage','supabase_migrations')")
        facts = []
        for schema, table in tables:
            if not all(re.fullmatch('[a-z_][a-z0-9_]*', value) for value in (schema, table)):
                raise ValueError('Unexpected table identifier')
            facts.append(query("SELECT json_build_object('relation','"+schema+'.'+table+"','rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,chr(10) ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex')) FROM \""+schema+'"."'+table+'" t'))
        add('database/row-fingerprints.json', json.dumps(facts).encode())
        for row in objects:
            url = 'https://'+SOURCE_REF+'.supabase.co/storage/v1/object/authenticated/repair-evidence/'+urllib.parse.quote(row['name'], safe='/')
            req = urllib.request.Request(url, headers={'Authorization':'Bearer '+keys['service_role'], 'apikey': keys['service_role']})
            with urllib.request.urlopen(req, timeout=30) as response:
                data = response.read(row['size']+1)
            if len(data) != row['size'] or hashlib.sha256(data).hexdigest() != row['checksum']:
                raise ValueError('Storage bytes differ from snapshot checksum')
            add('storage/repair-evidence/'+row['name'], data)
        add('storage/inventory.json', json.dumps(objects).encode())
        require_consistent({'roles':roles, 'config':configuration, 'objects':objects, 'history':history},
            {'roles':role_definitions(), 'config':config(), 'objects':query(object_sql, False), 'history':query(history_sql, False)})
        for name, data in source_files.items():
            require_consistent(data, (SOURCE/name.removeprefix('source/')).read_bytes())
        if command(['git', '-C', str(SOURCE), 'rev-parse', 'HEAD']).decode().strip() != head or command(['git', '-C', str(SOURCE), 'status', '--porcelain', '--', 'supabase']):
            raise ValueError('Backend release changed during capture')
        holder.stdin.write(b'ROLLBACK;\n\\q\n')
        holder.stdin.flush()
        holder.communicate(timeout=20)
        if holder.returncode: raise ValueError('Snapshot session failed')
    finally:
        if holder.poll() is None:
            holder.kill()
            holder.communicate(timeout=10)
    add('configuration/hosted.json', json.dumps({'project':source, 'configuration':configuration}).encode())
    journal.update(source_head=head, snapshot_completed_at=now().isoformat(), storage_object_count=len(objects))
    metadata = {key:journal[key] for key in ('run_id', 'project_ref', 'organization_id', 'source_head', 'snapshot_started_at', 'snapshot_completed_at', 'migration_count', 'postgres_snapshot_id')}
    metadata['consistency'] = 'Shared PostgreSQL snapshot; immutable ready object checksums and before/after inventory; role/config before-after guard (no global DDL/config lock)'
    blob, manifest = package(files, metadata)
    return blob, manifest, files


def backup(runtime_ready=ready):
    require_settled(RUNS)
    run_id = now().strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex
    path = RUNS/('run-'+run_id+'.json')
    journal = {'run_id':run_id, 'project_ref':SOURCE_REF, 'organization_id':EXPECTED_ORG,
               'status':'pending', 'stage':'preflight', 'started_at':now().isoformat(), 'database_restore_verified':False}
    save(path, journal)
    try:
        api, boundary, source = provider()
        env, authorization = runtime_ready()
        journal['stage'] = 'capture'
        save(path, journal)
        blob, manifest, files = capture(api, source, journal, path)
        boundary()
        env, authorization = runtime_ready()  # Recheck native scope/expiry immediately before the write.
        used = b2_bytes(authorization)
        # Reserve two archive lengths plus 1 MiB for encrypted metadata, indexes and interrupted upload headroom.
        if used+2*len(blob)+1024*1024 > int(MAX_B2*.95):
            raise ValueError('Conservative approved B2 capacity guard refused upload')
        journal.update(stage='upload_pending', archive_bytes=len(blob), archive_sha256=hashlib.sha256(blob).hexdigest(), b2_bytes_before=used)
        save(path, journal)
        result = restic(env, ['backup', '--stdin', '--stdin-filename', ARCHIVE, '--host', 'opspilot-backup', '--tag', TAG, '--tag', 'run:'+run_id, '--json'], blob, timeout=600)
        summaries = [value for line in result.splitlines() if (value:=json.loads(line)).get('message_type') == 'summary']
        if len(summaries) != 1 or not re.fullmatch('[a-f0-9]{64}', summaries[0].get('snapshot_id', '')):
            raise ValueError('Upload outcome requires snapshot reconciliation')
        journal.update(stage='recovery_verification', snapshot_id=summaries[0]['snapshot_id'])
        save(path, journal)
        restic(env, ['check', '--read-data'], timeout=600)
        recovered = restic(env, ['dump', journal['snapshot_id'], '/'+ARCHIVE], timeout=600)
        verify_archive(blob, recovered, files, manifest)
        journal.update(status='verified', stage='complete', completed_at=now().isoformat(), restic_read_data_check='PASS',
            recovered_archive_sha256=hashlib.sha256(recovered).hexdigest(), b2_bytes_after=b2_bytes(authorization))
        save(path, journal)
        print(json.dumps({'status':'verified', 'run_id':run_id, 'snapshot_id':journal['snapshot_id']}))
    except Exception:
        journal.update(status='failed', failed_at=now().isoformat(), reconciliation_required=True)
        save(path, journal)
        raise


def monitor(runtime_ready=ready, max_age_hours=24):
    api, _, _ = provider()
    env, authorization = runtime_ready()
    journals = [json.loads(path.read_text()) for path in RUNS.glob('run-*.json')]
    verified = [value for value in journals if value.get('status') == 'verified']
    snapshots = json.loads(restic(env, ['snapshots', '--json', '--host', 'opspilot-backup', '--tag', TAG, '--path', SNAPSHOT_PATH]))
    live = {row['id'] for row in snapshots}
    verified = [value for value in verified if value['snapshot_id'] in live]
    newest = max(verified, key=lambda value:value['snapshot_started_at']) if verified else None
    pg_env = database_environment(api('projects/'+SOURCE_REF+'/config/database/pooler'))
    sql = """SELECT json_build_object('database_bytes',pg_database_size(current_database()),
        'storage_object_count',(SELECT count(*) FROM storage.objects),
        'storage_metadata_bytes',(SELECT coalesce(sum((metadata->>'size')::bigint),0) FROM storage.objects),
        'storage_missing_size',(SELECT count(*) FROM storage.objects WHERE metadata->>'size' IS NULL),
        'scheduler',(SELECT json_agg(t ORDER BY jobname) FROM (SELECT j.jobname,j.active,
            (SELECT max(d.end_time) FROM cron.job_run_details d WHERE d.jobid=j.jobid AND d.status='succeeded') AS succeeded_at,
            (SELECT d.status FROM cron.job_run_details d WHERE d.jobid=j.jobid ORDER BY d.start_time DESC LIMIT 1) AS latest_status
            FROM cron.job j WHERE jobname IN ('opspilot-maintenance','opspilot-assistant-retention'))t))"""
    measurements = json.loads(command([str(TOOLS/'pgsql/bin/psql.exe'), '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql], pg_env))
    timestamp = now()
    result = assessment(timestamp, dt.datetime.fromisoformat(newest['snapshot_started_at']) if newest else None,
                        b2_bytes(authorization), MAX_B2, any(value.get('status') != 'verified' for value in journals), max_age_hours=max_age_hours)
    scheduler = measurements['scheduler'] or []
    scheduler_known = len(scheduler) == 2 and all(row['active'] and row['succeeded_at'] and row['latest_status'] == 'succeeded' for row in scheduler)
    scheduler_at = min(dt.datetime.fromisoformat(row['succeeded_at']) for row in scheduler) if scheduler_known else None
    if scheduler_at and scheduler_at > timestamp: raise ValueError('Future scheduler measurement')
    result['scheduler_stale'] = scheduler_at is None or (timestamp-scheduler_at).total_seconds() > 26*3600
    if result['scheduler_stale']:
        result['decision'] = 'pause'
        result['reasons'].append('scheduler_overdue_or_unverified')
    result.update(checked_at=timestamp.isoformat(), project_ref=SOURCE_REF, snapshot_id=newest['snapshot_id'] if newest else None,
        measurements=measurements, scheduler_at=scheduler_at.isoformat() if scheduler_at else None,
        scope='backup and conservative B2 budget only', full_operational_assessment='unverified',
        unmeasured=['database_quota_capacity', 'storage_quota_capacity', 'egress_quota', 'email_quota', 'functions_quota', 'ai_quota', 'recovery_headroom_percent', 'required_dependencies_healthy'],
        operational_decision='pause', operational_reason='Required full operational measurements remain unavailable')
    save(REPORTS/('monitor-'+timestamp.strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex+'.json'), result)
    print(json.dumps(result))
    return 1


def retention_plan(apply_digest=None, runtime_ready=ready):
    require_settled(RUNS)
    _, boundary, _ = provider()
    env, _ = runtime_ready()
    verified = [json.loads(path.read_text()) for path in RUNS.glob('run-*.json')]
    if not verified or min((now()-dt.datetime.fromisoformat(value['snapshot_started_at'])).total_seconds() for value in verified) >= 24*3600:
        raise ValueError('A fresh fully verified recurring checkpoint is required first')
    restic(env, ['check', '--read-data'], timeout=600)
    plan = json.loads(restic(env, retention_args()))
    remove = retention_ids(plan, {value['snapshot_id'] for value in verified})
    snapshots = json.loads(restic(env, ['snapshots', '--json']))
    ids = sorted(row['id'] for row in snapshots)
    if not any(value['snapshot_id'] in set(ids)-set(remove) and (now()-dt.datetime.fromisoformat(value['snapshot_started_at'])).total_seconds() < 24*3600 for value in verified):
        raise ValueError('Retention must preserve a live fresh verified checkpoint')
    digest = hashlib.sha256(json.dumps({'inventory':ids, 'remove':remove}, sort_keys=True).encode()).hexdigest()
    # Snapshot IDs/tags remain local; no deletion is performed by this helper.
    result = {'created_at':now().isoformat(), 'policy':'7 daily + 4 weekly', 'applied':False, 'prune':False,
              'protected':'Every checkpoint without exact continuous tag/path and a verified local run remains excluded', 'plan':plan,
              'review_sha256':digest, 'remove_snapshot_ids':remove, 'inventory_snapshot_ids':ids}
    if apply_digest is not None:
        previous = [json.loads(path.read_text()) for path in REPORTS.glob('retention-plan-*.json')]
        if apply_digest != digest or not any(value.get('review_sha256') == digest for value in previous):
            raise ValueError('Retention inventory/preview changed or reviewed plan missing')
        boundary()
        env, _ = runtime_ready()
        journal = {'status':'pending', 'stage':'forget_pending', 'review_sha256':digest, 'remove_snapshot_ids':remove, 'started_at':now().isoformat()}
        path = RUNS/('retention-run-'+uuid.uuid4().hex+'.json')
        save(path, journal)
        # No --prune: encrypted data packs remain; this removes only the reviewed snapshot metadata.
        if remove: restic(env, ['forget', *remove, '--json'], timeout=600)
        remaining = {row['id'] for row in json.loads(restic(env, ['snapshots', '--json']))}
        if remaining != set(ids)-set(remove):
            raise ValueError('Retention outcome requires explicit reconciliation')
        journal.update(status='verified', stage='complete', completed_at=now().isoformat(), prune=False)
        save(path, journal)
        print('Reviewed scoped retention applied and read back; no prune.')
        return
    save(REPORTS/('retention-plan-'+uuid.uuid4().hex+'.json'), result)
    print(json.dumps({'status':'dry_run', 'review_sha256':digest, 'remove_count':len(remove), 'prune':False}))


def main():
    operation = sys.argv[1:]
    apply_digest = operation[1] if len(operation) == 2 and operation[0] == 'retention-apply' and re.fullmatch('[a-f0-9]{64}', operation[1]) else None
    if operation not in (['backup'], ['monitor'], ['retention-plan']) and apply_digest is None:
        raise ValueError('Expected backup, monitor, retention-plan or retention-apply <review-sha256>')
    verify_private_directory(ROOT/'.spec-team/local/credentials')
    if not RUNS.exists():
        raise ValueError('Owner-private continuous-backup journal directory must be provisioned and ACL-verified before activation')
    verify_private_directory(RUNS)
    REPORTS.mkdir(exist_ok=True)
    with exclusive(RUNS):
        if sys.argv[1] == 'backup': backup()
        elif sys.argv[1] == 'monitor': return monitor()
        else: retention_plan(apply_digest)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        print('OpsPilot backup operation stopped; raw provider/credential/database output withheld. Reconcile the exact journal before retry.', file=sys.stderr)
        sys.exit(2)
