"""Review candidate: trusted Windows cloud adapter for the existing OpsPilot backup.

No local invocation can access credentials or providers. Activation is a separate owner action.
"""
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import smtplib
import ssl
import subprocess
import sys
import tarfile
import types
import urllib.request
import zipfile

SOURCE = 'lhlizmdhxjspnxadtzsm'
ORG = 'woyvnmwsxtjesyvdvfkp'
BACKEND_HEAD = '3608204b9d6be3f589d4b086c4a6070531e29a4b'
EXPIRY = dt.datetime.fromisoformat('2026-11-02T23:35:00+08:00')
PACKAGE = Path(__file__).resolve().parent
MAX_ARCHIVE = 20 * 1024 * 1024
SECRETS = ('OPSPILOT_SUPABASE_TOKEN', 'OPSPILOT_DATABASE_PASSWORD', 'OPSPILOT_ANON_KEY',
           'OPSPILOT_SERVICE_ROLE_KEY', 'OPSPILOT_B2_KEY_ID', 'OPSPILOT_B2_KEY', 'OPSPILOT_RESTIC_PASSWORD')


def digest(value):
    return hashlib.sha256(value).hexdigest()


def check_host(env, now, *, backup=True):
    if (env.get('GITHUB_ACTIONS') != 'true' or env.get('GITHUB_REPOSITORY') != 'kin2001/OpsPilot'
            or env.get('GITHUB_REF') != 'refs/heads/main'
            or env.get('GITHUB_EVENT_NAME') not in ('schedule', 'workflow_dispatch')
            or not re.fullmatch('[a-f0-9]{40}', env.get('GITHUB_SHA', ''))
            or env['GITHUB_SHA'] != env.get('OPSPILOT_APPROVED_OPERATOR_SHA')
            or env.get('OPSPILOT_CLOUD_ENABLED') != 'true'
            or not re.fullmatch('[0-9]+', env.get('GITHUB_RUN_ID', ''))
            or now.tzinfo is None or (backup and now >= EXPIRY)):
        raise ValueError('Cloud approval, trusted default branch, exact commit or unexpired authority missing')


def check_pooler(rows):
    if len(rows) != 1 or rows[0].get('db_host') != 'aws-0-ap-southeast-1.pooler.supabase.com' or rows[0].get('db_user') != 'postgres.' + SOURCE:
        raise ValueError('Only the dedicated OpsPilot source pooler is permitted')


def verify_recovered(blob):
    if not 0 < len(blob) <= MAX_ARCHIVE:
        raise ValueError('Recovered archive size outside approved scope')
    files = {}
    with tarfile.open(fileobj=io.BytesIO(blob)) as archive:
        for member in archive:
            name = member.name
            if (not member.isfile() or member.size > MAX_ARCHIVE or name in files
                    or PurePosixPath(name).is_absolute() or '..' in PurePosixPath(name).parts
                    or '\\' in name or ':' in name):
                raise ValueError('Unsafe recovered member')
            files[name] = archive.extractfile(member).read()
    manifest = json.loads(files.pop('manifest.json'))
    if (manifest.get('project_ref') != SOURCE or manifest.get('organization_id') != ORG
            or manifest.get('source_head') != BACKEND_HEAD or set(manifest.get('files', {})) != set(files)):
        raise ValueError('Recovered source/project/member binding differs')
    for name, data in files.items():
        if manifest['files'][name] != {'bytes': len(data), 'sha256': digest(data)}:
            raise ValueError('Recovered member checksum differs')
    return manifest


def check_email(value):
    if not re.fullmatch(r'[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}', value or ''):
        raise ValueError('Approved alert email is missing or invalid')


def package_files():
    manifest = json.loads((PACKAGE / 'manifest.json').read_text())
    for name, sha in manifest['files'].items():
        path = PACKAGE / name
        if PurePosixPath(name).is_absolute() or '..' in PurePosixPath(name).parts or path.is_symlink() or digest(path.read_bytes()) != sha:
            raise ValueError('Reviewed cloud package changed')
    return manifest


def command(args, **options):
    result = subprocess.run(args, capture_output=True, timeout=options.pop('timeout', 60), **options)
    if result.returncode:
        raise ValueError('Cloud preparation failed; private child output withheld')
    return result.stdout


def protected_directory(path):
    path.mkdir(parents=True, exist_ok=False)
    script = "$ErrorActionPreference='Stop'; $p=[Console]::In.ReadToEnd(); $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $a=[Security.AccessControl.DirectorySecurity]::new(); $a.SetOwner($sid); $a.SetAccessRuleProtection($true,$false); $a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')); Set-Acl -LiteralPath $p -AclObject $a"
    command(['pwsh', '-NoProfile', '-NonInteractive', '-Command', script], input=str(path).encode())


def download_tool(receipt, destination):
    url = receipt['source']
    if not (url.startswith('https://get.enterprisedb.com/postgresql/postgresql-17.11-5-')
            or url == 'https://github.com/restic/restic/releases/download/v0.19.1/restic_0.19.1_windows_amd64.zip'):
        raise ValueError('Unapproved tool source')
    with urllib.request.urlopen(url, timeout=90) as response:
        blob = response.read(450 * 1024 * 1024 + 1)
    if len(blob) > 450 * 1024 * 1024 or digest(blob) != receipt['archive_sha256']:
        raise ValueError('Pinned tool archive differs')
    if 'restic' in url:
        (destination / 'restic_0.19.1_windows_amd64.zip').write_bytes(blob)
    seen = set()
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        for member in archive.infolist():
            path = PurePosixPath(member.filename)
            if path.is_absolute() or '..' in path.parts or '\\' in member.filename or ':' in member.filename or member.filename.casefold() in seen or (member.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError('Unsafe pinned tool archive member')
            seen.add(member.filename.casefold())
            if member.is_dir():
                continue
            selected = member.filename == 'restic_0.19.1_windows_amd64.exe' or member.filename.startswith(('pgsql/bin/', 'pgsql/lib/', 'pgsql/share/'))
            if selected:
                target = destination / ('restic.exe' if 'restic' in url else member.filename)
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open('xb') as stream:
                    stream.write(archive.read(member))


def prepare():
    check_host(os.environ, dt.datetime.now(dt.timezone.utc))
    package_files()
    if os.name != 'nt' or Path.cwd().drive.upper() != 'D:':
        raise ValueError('Reviewed Windows D-drive runtime required; no path/host fallback')
    for name in SECRETS:
        if not os.environ.get(name):
            raise ValueError('Protected cloud secret missing; no native/default credential fallback')
    root = Path.cwd().resolve()
    local = root / '.spec-team/local'
    protected_directory(local)
    for path in (PACKAGE / 'runtime').glob('*.py'):
        shutil.copyfile(path, local / path.name)
    tools = local / 'tools'
    tools.mkdir()
    for path in (PACKAGE / 'tools').iterdir():
        shutil.copyfile(path, tools / path.name)
    reports = root / '.spec-team/reports'
    reports.mkdir(parents=True)
    for path in (PACKAGE / 'receipts').glob('*.json'):
        shutil.copyfile(path, reports / path.name)
    for name in ('por47-postgres-tool.json', 'por47-restic-tool.json'):
        download_tool(json.loads((reports / name).read_text()), tools)
    connected = local / 'supabase-opspilot-state'
    connected.mkdir()
    (connected / 'connected.json').write_text(json.dumps({'profile': 'opspilot', 'organization_id': ORG}))
    source = root / '.worktrees/por-28e'
    command(['git', 'worktree', 'add', '--detach', str(source), BACKEND_HEAD])
    sys.path.insert(0, str(local))
    import continuous_backup_opspilot as runtime
    import backup_runtime as backup
    import hosted_smoke_runtime as smoke
    def authority():
        check_host(os.environ, dt.datetime.now(dt.timezone.utc))
        package_files()
    # Explicit project-scoped cloud credential boundary; no native store or account fallback.
    runtime.dedicated_token = lambda: os.environ['OPSPILOT_SUPABASE_TOKEN']
    backup.read_native = lambda: (os.environ['OPSPILOT_B2_KEY_ID'], os.environ['OPSPILOT_B2_KEY'])
    backup.recovery_password = lambda: backup.validate_password(os.environ['OPSPILOT_RESTIC_PASSWORD'])
    def keys():
        return {role: smoke.decode_project_key(role, os.environ['OPSPILOT_' + ('ANON_KEY' if role == 'anon' else 'SERVICE_ROLE_KEY')].encode('utf-16-le'), role)
                for role in ('anon', 'service_role')}
    runtime.read_project_keys = keys
    def database_environment(poolers):
        authority()
        check_pooler(poolers)
        env = backup.environment(os.environ, 'unused', 'unused', 'unused')
        env = {k: v for k, v in env.items() if not k.startswith(('AWS_', 'RESTIC_'))}
        env.update(PGHOST=poolers[0]['db_host'], PGPORT='5432', PGUSER='postgres.' + SOURCE,
                   PGDATABASE='postgres', PGPASSWORD=os.environ['OPSPILOT_DATABASE_PASSWORD'],
                   PGSSLMODE='verify-full', PGSSLROOTCERT=str(tools / 'supabase-prod-ca-2021.crt'),
                   PGCONNECT_TIMEOUT='15', PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=180000 -c idle_in_transaction_session_timeout=900000',
                   PATH=str(tools / 'pgsql/bin') + ';C:/Program Files/Git/usr/bin;C:/Windows/System32')
        return env
    runtime.database_environment = database_environment
    protected_directory(runtime.RUNS)
    runtime.REPORTS.mkdir(parents=True)
    return runtime, backup, authority


def hydrate(runtime, backup, env):
    snapshots = json.loads(backup.restic(env, ['snapshots', '--json', '--host', 'opspilot-backup', '--tag', runtime.TAG, '--path', runtime.SNAPSHOT_PATH]))
    # Reconcile every prior owned snapshot before a new write, including a terminated prior runner.
    for row in snapshots:
        if not re.fullmatch('[a-f0-9]{64}', row.get('id', '')) or row.get('hostname') != 'opspilot-backup' or row.get('paths') != [runtime.SNAPSHOT_PATH]:
            raise ValueError('Unexpected backup snapshot identity')
        blob = backup.restic(env, ['dump', row['id'], '/' + runtime.ARCHIVE])
        manifest = verify_recovered(blob)
        tags = row.get('tags', [])
        run = manifest.get('run_id')
        if not re.fullmatch(r'[0-9]{8}T[0-9]{6}Z-[a-f0-9]{32}', run or '') or set(tags) != {runtime.TAG, 'run:' + run}:
            raise ValueError('Backup run tag and recovered manifest differ')
        journal = {**{key: manifest[key] for key in ('run_id', 'project_ref', 'organization_id', 'source_head', 'snapshot_started_at', 'snapshot_completed_at', 'migration_count')},
                   'status': 'verified', 'stage': 'complete', 'snapshot_id': row['id'],
                   'archive_sha256': digest(blob), 'recovered_archive_sha256': digest(blob),
                   'restic_read_data_check': 'PASS', 'cloud_hydrated': True, 'database_restore_verified': False}
        (runtime.RUNS / ('run-' + run + '.json')).write_text(json.dumps(journal))
    return snapshots


def alert(test=False):
    check_host(os.environ, dt.datetime.now(dt.timezone.utc), backup=False)
    package_files()
    recipient = os.environ.get('OPSPILOT_ALERT_TO', '')
    check_email(recipient)
    if os.environ.get('OPSPILOT_ALERTS_APPROVED') != 'true' or (test and os.environ.get('OPSPILOT_TEST_ALERT_APPROVED') != 'true'):
        raise ValueError('Alert recipient and test-send authority required')
    from email.message import EmailMessage
    message = EmailMessage()
    message['From'] = 'OpsPilot <noreply@opspilot.artkincarreon.site>'
    message['To'] = recipient
    message['Subject'] = 'OpsPilot backup test alert' if test else 'OpsPilot backup needs attention'
    message.set_content('Test of the owner-authorized backup alert channel.' if test else 'The protected backup workflow failed. Review its sanitized run status before any retry. No private data is included in this message.')
    context = ssl.create_default_context(cafile='C:/Program Files/Git/mingw64/etc/ssl/certs/ca-bundle.crt')
    with smtplib.SMTP_SSL('smtp.resend.com', 465, context=context, timeout=30) as smtp:
        smtp.login('resend', os.environ['OPSPILOT_SMTP_KEY'])
        smtp.send_message(message)
    print('Approved alert submitted; receipt/delivery acceptance remains separate.')


def main():
    operation = sys.argv[1:]
    if operation == ['alert'] or operation == ['alert-test']:
        alert(test=operation == ['alert-test'])
        return 0
    if operation != ['backup']:
        raise ValueError('Only one reviewed weekly backup operation is supported')
    runtime, backup, authority = prepare()
    with runtime.exclusive(runtime.RUNS):
        env, _ = backup.ready(authority=authority)
        backup.restic(env, ['check', '--read-data'], timeout=600)
        old = hydrate(runtime, backup, env)
        token = digest(('kin2001/OpsPilot:' + os.environ['GITHUB_RUN_ID']).encode())[:32]
        if any(any(tag.endswith('-' + token) for tag in row.get('tags', [])) for row in old):
            raise ValueError('This workflow run already has a verified snapshot; no duplicate upload')
        runtime.uuid = types.SimpleNamespace(uuid4=lambda: types.SimpleNamespace(hex=token))
        runtime.backup(runtime_ready=lambda: backup.ready(authority=authority))
        before = set(runtime.REPORTS.glob('retention-plan-*.json'))
        runtime.retention_plan(runtime_ready=lambda: backup.ready(authority=authority))
        created = set(runtime.REPORTS.glob('retention-plan-*.json')) - before
        if len(created) != 1:
            raise ValueError('Exactly one scoped retention preview required')
        receipt = json.loads(created.pop().read_text())
        runtime.retention_plan(receipt['review_sha256'], runtime_ready=lambda: backup.ready(authority=authority))
    print(json.dumps({'result': 'PASS_SCOPED', 'operation': 'weekly_encrypted_backup_and_retention',
                      'database_restore_verified': False, 'scheduled_trigger_proof': os.environ['GITHUB_EVENT_NAME'] == 'schedule'}))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception:
        print('Cloud backup stopped; private details withheld. Reconcile run and remote snapshots before retry.', file=sys.stderr)
        raise SystemExit(2)
