"""Initial empty OpsPilot checkpoint, using official Supabase export scripts and restic."""
import datetime
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile
import urllib.error
import urllib.request
from backup_runtime import ROOT, ready, restic, environment,version_bytes
from provision_opspilot import dedicated_token, database_password, EXPECTED_ORG, inspect_project
from connect_opspilot_b2 import BUCKET_ID

REF = 'lhlizmdhxjspnxadtzsm'
SOURCE = ROOT / '.worktrees/accepted-main'
ACCEPTED_HEAD = '126122f6cee3c61de843664ab74c9d463805c37f'
TOOLS = ROOT / '.spec-team/local/tools'

def fingerprints(env):
    psql = [str(TOOLS / 'pgsql/bin/psql.exe'), '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c']
    generated = command(psql + ["SELECT format('SELECT %L AS relation, count(*) AS rows, encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(t)::text, chr(10) ORDER BY to_jsonb(t)::text), %L), ''UTF8'')), ''hex'') AS digest FROM %I.%I t', schemaname||'.'||tablename, '', schemaname, tablename) FROM pg_tables WHERE schemaname IN ('public','auth','storage') ORDER BY schemaname,tablename"], env).decode().splitlines()
    data = json.loads(command(psql + ['SELECT json_agg(q ORDER BY relation) FROM (' + ' UNION ALL '.join(generated) + ') q'], env))
    security = json.loads(command(psql + ["SELECT jsonb_build_object('schemas',(SELECT jsonb_agg(jsonb_build_array(nspname,pg_get_userbyid(nspowner),nspacl::text) ORDER BY nspname) FROM pg_namespace WHERE nspname IN ('public','auth','storage')),'relations',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relkind,pg_get_userbyid(c.relowner),c.relacl::text,c.relrowsecurity,c.relforcerowsecurity) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p','v','m','S','f')),'functions',(SELECT jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),pg_get_userbyid(p.proowner),p.proacl::text,pg_get_functiondef(p.oid)) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','auth','storage')),'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN ('public','auth','storage')),'column_acls',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,a.attname,a.attacl::text) ORDER BY n.nspname,c.relname,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','storage') AND a.attacl IS NOT NULL))"], env))
    return {'data': data, 'security': security}

def package(files, metadata):
    if sum(map(len, files.values())) > 20 * 1024 * 1024:
        raise ValueError('Initial checkpoint exceeds the approved 20 MiB transfer guard')
    for name in files:
        if not name or name == 'manifest.json' or PurePosixPath(name).is_absolute() or '..' in PurePosixPath(name).parts or ':' in name or '\\' in name:
            raise ValueError('Unsafe checkpoint member name')
    manifest = {**metadata, 'files': {name: {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()} for name, data in files.items()}}
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w') as tar:
        for name, data in {**files, 'manifest.json': json.dumps(manifest, sort_keys=True).encode()}.items():
            info = tarfile.TarInfo(name); info.size = len(data); info.mode = 0o600
            tar.addfile(info, io.BytesIO(data))
    return output.getvalue(), manifest

def command(args, env=None, timeout=90):
    result = subprocess.run(args, env=env, cwd=ROOT, capture_output=True, timeout=timeout)
    if result.returncode:
        label = Path(args[-1]).name if Path(args[0]).name == 'bash.exe' else Path(args[0]).name
        reason = next((marker for marker in ('No such file or directory', 'command not found', 'permission denied', 'syntax error', 'certificate verify failed') if marker in result.stderr.decode(errors='replace')), 'output withheld')
        raise ValueError('Checkpoint subprocess failed at ' + label + ': ' + reason)
    return result.stdout

def go_list(name):
    text = (TOOLS / 'supabase-dump.go').read_text()
    block = re.search(r'\b' + name + r' = \[\]string\{(.*?)\n\s*\}', text, re.S).group(1)
    entries = re.findall(r'"([A-Za-z0-9_.*]+)"', '\n'.join(line.split('//')[0] for line in block.splitlines()))
    if not entries:
        raise ValueError('Official export constants unavailable')
    return '|'.join(entries)

def main():
    journal = ROOT / '.spec-team/reports/por47-initial-checkpoint.json'
    if journal.exists():
        raise ValueError('Existing checkpoint journal requires reconciliation; no duplicate upload')
    env, authorization = ready()
    connected = json.loads((ROOT / '.spec-team/local/supabase-opspilot-state/connected.json').read_text(encoding='utf-8-sig'))
    if connected.get('organization_id') != EXPECTED_ORG or connected.get('profile') != 'opspilot':
        raise ValueError('Dedicated Supabase account receipt mismatch')
    token = dedicated_token()
    def api(path, body=None):
        req = urllib.request.Request('https://api.supabase.com/v1/' + path, data=None if body is None else json.dumps(body).encode(), headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=30) as response: return json.load(response)
        except urllib.error.HTTPError as error:
            raise ValueError('Dedicated Supabase read refused (HTTP ' + str(error.code) + '); no account fallback') from None
    organizations = api('organizations')
    if len(organizations) != 1 or organizations[0]['id'] != EXPECTED_ORG or api('organizations/' + EXPECTED_ORG).get('plan') != 'free':
        raise ValueError('Dedicated free organization mismatch')
    projects = api('projects')
    if len(projects) != 1 or projects[0]['id'] != REF or projects[0]['organization_id'] != EXPECTED_ORG:
        raise ValueError('Dedicated project inventory mismatch')
    baseline = inspect_project(api, projects[0], REF)
    auth = api('projects/' + REF + '/config/auth')
    ssl_config = api('projects/' + REF + '/ssl-enforcement')
    poolers = api('projects/' + REF + '/config/database/pooler')
    if len(poolers) != 1 or poolers[0].get('db_host') != 'aws-0-ap-southeast-1.pooler.supabase.com' or poolers[0].get('db_user') != 'postgres.' + REF:
        raise ValueError('Dedicated pooler mismatch')
    if command(['git', '-C', str(SOURCE), 'rev-parse', 'HEAD']).decode().strip() != ACCEPTED_HEAD or command(['git', '-C', str(SOURCE), 'status', '--porcelain']):
        raise ValueError('Accepted source must remain clean and pinned')
    credential = ROOT / '.spec-team/local/credentials/por47-opspilot-db-password.dpapi'
    if not credential.exists(): raise ValueError('Bound database password missing; no regeneration')
    pg_env = environment(os.environ, 'unused', 'unused', 'unused')
    pg_env = {k: v for k, v in pg_env.items() if not k.startswith(('AWS_', 'RESTIC_'))}
    pg_env.update(PGHOST=poolers[0]['db_host'], PGPORT='5432', PGUSER=poolers[0]['db_user'], PGDATABASE='postgres', PGPASSWORD=database_password(), PGSSLMODE='verify-full', PGSSLROOTCERT=str(TOOLS / 'supabase-prod-ca-2021.crt'), PGCONNECT_TIMEOUT='15', PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=180000')
    pg_env['PATH'] = str(TOOLS / 'pgsql/bin') + ';C:/Program Files/Git/usr/bin;C:/Windows/System32'
    pg_env.update(EXTRA_FLAGS='', EXTRA_SED='', INCLUDED_SCHEMAS='*', RESERVED_ROLES=go_list('reservedRoles'), ALLOWED_CONFIGS=go_list('allowedConfigs'))
    files = {}
    for kind in ('role', 'schema', 'data'):
        pg_env['EXCLUDED_SCHEMAS'] = go_list('InternalSchemas' if kind == 'schema' else 'excludedSchemas')
        pg_env['EXTRA_FLAGS'] = '--exclude-table=storage.buckets_vectors --exclude-table=storage.vector_indexes' if kind == 'data' else ''
        files['database/' + kind + '.sql'] = command(['C:/Program Files/Git/bin/bash.exe', '--noprofile', '--norc', str(TOOLS / ('dump_' + kind + '.sh'))], pg_env)
    files['database/public.dump'] = command([str(TOOLS / 'pgsql/bin/pg_dump.exe'), '--no-password', '--format=custom', '--schema=public', '--no-owner', '--no-privileges'], pg_env)
    files['database/core.dump'] = command([str(TOOLS / 'pgsql/bin/pg_dump.exe'), '--no-password', '--format=custom', '--schema=public', '--schema=auth', '--schema=storage'], pg_env)
    files['database/complete-role-definitions.sql'] = command([str(TOOLS / 'pgsql/bin/pg_dumpall.exe'), '--no-password', '--roles-only', '--no-role-passwords'], pg_env)
    files['database/core-fingerprints.json'] = json.dumps(fingerprints(pg_env), sort_keys=True).encode()
    after = inspect_project(api, projects[0], REF)
    if baseline != after: raise ValueError('Source changed during initial checkpoint')
    files['configuration/hosted.json'] = json.dumps({'project': projects[0], 'auth': auth, 'ssl': ssl_config, 'pooler': poolers, 'storage_objects': 0, 'baseline': baseline}).encode()
    paths = command(['git', '-C', str(SOURCE), 'ls-files', 'supabase/config.toml', 'supabase/migrations', 'supabase/functions']).decode().splitlines()
    for name in paths:
        if '.env' in Path(name).name or PurePosixPath(name).is_absolute() or '..' in PurePosixPath(name).parts: raise ValueError('Unexpected source configuration path')
        files['source/' + name] = (SOURCE / name).read_bytes()
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    vendor = {name: hashlib.sha256((TOOLS / name).read_bytes()).hexdigest() for name in ('supabase-dump.go', 'dump_role.sh', 'dump_schema.sh', 'dump_data.sh')}
    blob, manifest = package(files, {'project_ref': REF, 'organization_id': EXPECTED_ORG, 'source_head': ACCEPTED_HEAD, 'created_at': now, 'storage_object_count': 0, 'database_version': baseline['server_version'], 'export_recipe': 'Supabase CLI official filtered role/schema/data scripts; managed service schemas supplied by Supabase restore destination', 'vendor_sha256': vendor})
    # Initial small checkpoint only; broader recurring retention/capacity controls are a separate gate.
    storage = authorization['apiInfo']['storageApi']
    req = urllib.request.Request(storage['apiUrl'] + '/b2api/v4/b2_list_file_versions', data=json.dumps({'bucketId': BUCKET_ID, 'prefix': 'opspilot/', 'maxFileCount': 1000}).encode(), headers={'Authorization': authorization['authorizationToken'], 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as response: inventory = json.load(response)
    if inventory.get('nextFileId') or inventory.get('nextFileName') or version_bytes(inventory['files']) + len(blob) > 100 * 1024 * 1024:
        raise ValueError('Initial backup capacity guard refused upload')
    receipt = {'status': 'upload_pending', 'project_ref': REF, 'source_head': ACCEPTED_HEAD, 'created_at': now, 'archive_bytes': len(blob), 'archive_sha256': hashlib.sha256(blob).hexdigest(), 'files': manifest['files'], 'storage_object_count': 0, 'database_restore_verified': False}
    journal.write_text(json.dumps(receipt, indent=2) + '\n')
    output = restic(env, ['backup', '--stdin', '--stdin-filename', 'opspilot-initial-checkpoint.tar', '--host', 'opspilot-backup', '--tag', 'initial-predeployment', '--json'], blob)
    summaries = [json.loads(line) for line in output.splitlines() if json.loads(line).get('message_type') == 'summary']
    if len(summaries) != 1 or not summaries[0].get('snapshot_id'): raise ValueError('Upload outcome requires snapshot reconciliation')
    receipt.update(status='uploaded_encrypted', snapshot_id=summaries[0]['snapshot_id'])
    journal.write_text(json.dumps(receipt, indent=2) + '\n')
    restic(env, ['check', '--read-data'])
    recovered = restic(env, ['dump', receipt['snapshot_id'], '/opspilot-initial-checkpoint.tar'])
    if hashlib.sha256(recovered).hexdigest() != receipt['archive_sha256']: raise ValueError('Encrypted recovery checksum mismatch')
    with tarfile.open(fileobj=io.BytesIO(recovered)) as tar:
        if set(tar.getnames()) != set(files) | {'manifest.json'}: raise ValueError('Recovered member inventory mismatch')
        for name, data in files.items():
            if tar.extractfile(name).read() != data: raise ValueError('Recovered member checksum mismatch')
    receipt.update(status='encrypted_upload_and_archive_recovery_verified', restic_read_data_check='PASS', recovered_archive_sha256=hashlib.sha256(recovered).hexdigest())
    journal.write_text(json.dumps(receipt, indent=2) + '\n')
    print('Encrypted initial checkpoint uploaded and fully downloaded/decrypted; archive and every member checksum match. Database restore remains a separate check.')

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(str(error) if isinstance(error, ValueError) else 'Checkpoint stopped; raw output withheld. Reconcile saved upload journal before retry.', file=sys.stderr)
        sys.exit(1)
