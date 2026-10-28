"""Owner-authorized, free-only provisioning through the dedicated OpsPilot launcher."""
import base64
import ctypes
from ctypes import wintypes as w
import datetime
import json
from pathlib import Path
import secrets
import subprocess
import sys
import urllib.error
import urllib.request

EXPECTED_ORG = 'woyvnmwsxtjesyvdvfkp'
ROOT = Path(__file__).resolve().parents[2]


def project_summary(project):
    return {k: project.get(k) for k in ('id', 'name', 'organization_id', 'region', 'status')}


def provision(api, password, save):
    organizations = api('organizations')
    if len(organizations) != 1 or organizations[0].get('id') != EXPECTED_ORG:
        raise ValueError('Dedicated token must reach exactly the verified OpsPilot organization')
    organization = api('organizations/' + EXPECTED_ORG)
    if organization.get('id') != EXPECTED_ORG or organization.get('name') != 'OpsPilot' or organization.get('plan') != 'free':
        raise ValueError('Verified free OpsPilot organization required; no paid fallback')
    projects = api('projects')
    if projects:
        if len(projects) != 1 or projects[0].get('organization_id') != EXPECTED_ORG or projects[0].get('name') != 'opspilot' or projects[0].get('region') != 'ap-southeast-1':
            raise ValueError('Unexpected existing project; no resource changed')
        return {'outcome': 'existing', 'project': project_summary(projects[0])}
    body = {'name': 'opspilot', 'organization_slug': EXPECTED_ORG, 'region': 'ap-southeast-1', 'db_pass': password()}
    save({'outcome': 'pending', 'organization_id': EXPECTED_ORG, 'name': 'opspilot', 'region': 'ap-southeast-1'})
    project = api('projects', body)
    if project.get('organization_id', project.get('organization_slug')) != EXPECTED_ORG or project.get('name') != 'opspilot' or not project.get('id'):
        raise ValueError('Unexpected provider response; reconcile project inventory before retry')
    return {'outcome': 'created', 'project': project_summary(project)}


def dedicated_token():
    class Credential(ctypes.Structure):
        _fields_ = [('Flags', w.DWORD), ('Type', w.DWORD), ('TargetName', w.LPWSTR), ('Comment', w.LPWSTR), ('LastWritten', w.FILETIME), ('CredentialBlobSize', w.DWORD), ('CredentialBlob', ctypes.c_void_p), ('Persist', w.DWORD), ('AttributeCount', w.DWORD), ('Attributes', ctypes.c_void_p), ('TargetAlias', w.LPWSTR), ('UserName', w.LPWSTR)]
    api = ctypes.WinDLL('Advapi32', use_last_error=True)
    api.CredReadW.argtypes = [w.LPCWSTR, w.DWORD, w.DWORD, ctypes.POINTER(ctypes.POINTER(Credential))]
    api.CredReadW.restype = w.BOOL
    api.CredFree.argtypes = [ctypes.c_void_p]
    credential = ctypes.POINTER(Credential)()
    if not api.CredReadW('Supabase CLI:opspilot', 1, 0, ctypes.byref(credential)):
        raise ValueError('Dedicated OpsPilot credential missing; reconnect, never fallback')
    try:
        value = ctypes.string_at(credential.contents.CredentialBlob, credential.contents.CredentialBlobSize).decode('utf-8')
    finally:
        api.CredFree(credential)
    if value.startswith('go-keyring-base64:'):
        value = base64.b64decode(value.split(':', 1)[1]).decode('utf-8')
    if not value.startswith('sbp_'):
        raise ValueError('Unsupported dedicated credential format')
    return value


def inspect_project(api, project, expected_ref):
    if project.get('id') != expected_ref or project.get('organization_id') != EXPECTED_ORG:
        raise ValueError('Bound dedicated project mismatch; no target contacted')
    query = "SELECT current_setting('server_version') AS server_version, (SELECT count(*)::int FROM pg_tables WHERE schemaname='public') AS public_tables, (SELECT count(*)::int FROM auth.users) AS auth_users, (SELECT count(*)::int FROM storage.objects) AS storage_objects"
    rows = api('projects/' + expected_ref + '/database/query/read-only', {'query': query})
    if not isinstance(rows, list) or len(rows) != 1 or any(rows[0].get(key) != 0 for key in ('public_tables', 'auth_users', 'storage_objects')):
        raise ValueError('Unexpected project contents; no schema or data changed')
    return {'project': project_summary(project), 'initial_contents': 'empty', 'server_version': rows[0].get('server_version'), 'public_tables': 0, 'auth_users': 0, 'storage_objects': 0}


def database_password():
    path = ROOT / '.spec-team/local/credentials/por47-opspilot-db-password.dpapi'
    for args, expected in [(['git', 'check-ignore', str(path)], 0), (['git', 'ls-files', '--error-unmatch', str(path)], 1)]:
        if subprocess.run(args, cwd=ROOT, capture_output=True).returncode != expected:
            raise ValueError('Credential path must be ignored and untracked')
    if path.is_symlink() or path.parent.is_symlink():
        raise ValueError('Redirected credential path rejected')
    pwsh = r'C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe'
    if not path.exists():
        # Persist only Windows user-bound ciphertext; password travels over stdin, never argv.
        value = secrets.token_urlsafe(36)
        script = "$ErrorActionPreference='Stop'; $v=[Console]::In.ReadToEnd(); ConvertTo-SecureString $v -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath '" + str(path) + "'"
        result = subprocess.run([pwsh, '-NoProfile', '-NonInteractive', '-Command', script], input=value, capture_output=True, text=True, timeout=20)
        if result.returncode:
            raise ValueError('Native database credential protection failed')
        return value
    script = "$ErrorActionPreference='Stop'; $s=Get-Content -LiteralPath '" + str(path) + "' | ConvertTo-SecureString; [Net.NetworkCredential]::new('', $s).Password"
    result = subprocess.run([pwsh, '-NoProfile', '-NonInteractive', '-Command', script], capture_output=True, text=True, timeout=20)
    if result.returncode or len(result.stdout.strip()) < 32:
        raise ValueError('Protected database password unavailable')
    return result.stdout.strip()


def main():
    sys.path.insert(0, str(ROOT / '.agents/skills/spec-team/scripts'))
    from ownership import check_owner
    check_owner(ROOT, '19ab78eb-4f61-4f39-b958-408aa8192e21', '78cac194-cc65-48a2-a1d1-2e184895e696')
    connected = json.loads((ROOT / '.spec-team/local/supabase-opspilot-state/connected.json').read_text(encoding='utf-8-sig'))
    if connected.get('organization_id') != EXPECTED_ORG or connected.get('profile') != 'opspilot':
        raise ValueError('Dedicated target receipt mismatch')
    token = dedicated_token()
    def api(path, body=None):
        request = urllib.request.Request('https://api.supabase.com/v1/' + path, data=None if body is None else json.dumps(body).encode(), headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}, method='GET' if body is None else 'POST')
        with urllib.request.urlopen(request, timeout=45) as response:
            return json.load(response)
    provision_receipt = ROOT / '.spec-team/reports/por47-dedicated-project-provision.json'
    inspect_only = sys.argv[1:] == ['inspect-project']
    if sys.argv[1:] and not inspect_only:
        raise ValueError('Unsupported operation')
    receipt = ROOT / '.spec-team/reports/por47-dedicated-project-baseline.json' if inspect_only else provision_receipt
    previous = json.loads(provision_receipt.read_text()) if provision_receipt.exists() else {}
    def save(value):
        value = {**value, 'checked_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'dedicated_profile': 'opspilot'}
        temporary = receipt.with_suffix('.tmp')
        temporary.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')
        temporary.replace(receipt)
    try:
        def no_password():
            raise ValueError('Inspection cannot create a missing project')
        unresolved = previous.get('outcome') in ('pending', 'http_failure')
        result = provision(api, no_password if inspect_only or unresolved else database_password, save)
        expected_ref = previous.get('project', {}).get('id')
        if expected_ref and result['project']['id'] != expected_ref:
            raise ValueError('Existing project differs from the bound receipt; no binding was changed')
        if inspect_only:
            bound = json.loads(provision_receipt.read_text())['project']['id']
            result = inspect_project(api, result['project'], bound)
    except urllib.error.HTTPError as error:
        save({'outcome': 'http_failure', 'http_status': error.code, 'organization_id': EXPECTED_ORG})
        raise ValueError(f'Provider refused request (HTTP {error.code}); no account or paid fallback') from None
    except (TimeoutError, urllib.error.URLError):
        raise ValueError('Transport outcome uncertain; inspect dedicated inventory before retry, pending receipt retained') from None
    save(result)
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Do not print arbitrary provider bodies, exceptions, locals or request credentials.
        print(str(error) if isinstance(error, ValueError) else 'Provisioning failed; details withheld, inspect sanitized receipt', file=sys.stderr)
        sys.exit(1)
