"""Dedicated OpsPilot restic runtime; credentials stay in native storage and child memory."""
import base64
import ctypes
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import zipfile
from connect_opspilot_b2 import Credential, w, read_native, validate_authorization, BUCKET_NAME

ROOT = Path(__file__).resolve().parents[2]

def repository():
    return 's3:https://s3.us-west-004.backblazeb2.com/' + BUCKET_NAME + '/opspilot/restic-v1'

def version_bytes(files):
    total = 0
    for item in files:
        length = item.get('contentLength')
        if type(length) is not int or length < 0:
            raise ValueError('B2 inventory has no valid content length; capacity cannot be inferred')
        total += length
    return total

def validate_password(value):
    if not value or any(c in value for c in '\x00\r\n'):
        raise ValueError('Recovery credential is empty or contains unsupported control characters')
    return value

def recovery_password():
    api = ctypes.WinDLL('Advapi32', use_last_error=True)
    api.CredReadW.argtypes = [w.LPCWSTR, w.DWORD, w.DWORD, ctypes.POINTER(ctypes.POINTER(Credential))]
    api.CredReadW.restype = w.BOOL
    api.CredFree.argtypes = [ctypes.c_void_p]
    credential = ctypes.POINTER(Credential)()
    if not api.CredReadW('OpsPilot Restic:recovery', 1, 0, ctypes.byref(credential)):
        raise ValueError('Dedicated recovery credential missing; no fallback')
    try:
        if credential.contents.UserName != 'opspilot':
            raise ValueError('Recovery credential username mismatch')
        return validate_password(ctypes.string_at(credential.contents.CredentialBlob, credential.contents.CredentialBlobSize).decode('utf-16-le'))
    finally:
        api.CredFree(credential)

def environment(base, key_id, secret, password):
    names = {'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PATH', 'PROGRAMDATA'}
    env = {k: v for k, v in base.items() if k.upper() in names}
    env.update(AWS_ACCESS_KEY_ID=key_id, AWS_SECRET_ACCESS_KEY=secret, AWS_DEFAULT_REGION='us-west-004', AWS_EC2_METADATA_DISABLED='true', RESTIC_PASSWORD=validate_password(password), RESTIC_REPOSITORY=repository())
    return env

def ready(authority=None):
    if authority is None:
        sys.path.insert(0, str(ROOT / '.agents/skills/spec-team/scripts'))
        from ownership import check_owner
        check_owner(ROOT, '19ab78eb-4f61-4f39-b958-408aa8192e21', '78cac194-cc65-48a2-a1d1-2e184895e696')
        if json.loads((ROOT / '.spec-team/run.json').read_text())['stop_requested']:
            raise ValueError('Owner stop is active')
    else:
        authority()
    tools = ROOT / '.spec-team/local/tools'
    receipt = json.loads((ROOT / '.spec-team/reports/por47-restic-tool.json').read_text())
    archive = tools / 'restic_0.19.1_windows_amd64.zip'
    if hashlib.sha256(archive.read_bytes()).hexdigest() != receipt['archive_sha256']:
        raise ValueError('Verified restic archive changed')
    with zipfile.ZipFile(archive) as z:
        expected = hashlib.sha256(z.read('restic_0.19.1_windows_amd64.exe')).digest()
    if hashlib.sha256((tools / 'restic.exe').read_bytes()).digest() != expected:
        raise ValueError('Restic executable differs from verified archive')
    key_id, secret = read_native()
    basic = base64.b64encode((key_id + ':' + secret).encode()).decode()
    request = urllib.request.Request('https://api.backblazeb2.com/b2api/v4/b2_authorize_account', headers={'Authorization': 'Basic ' + basic})
    with urllib.request.urlopen(request, timeout=30) as response:
        authorization = json.load(response)
    validate_authorization(authorization, time.time())
    return environment(os.environ, key_id, secret, recovery_password()), authorization

def restic(env, args, data=None, timeout=180):
    result = subprocess.run([str(ROOT / '.spec-team/local/tools/restic.exe'), '--no-cache', '-o', 's3.bucket-lookup=path', '-o', 's3.connections=2', *args], cwd=ROOT, env=env, input=data, capture_output=True, timeout=timeout)
    if result.returncode:
        raise ValueError('Restic operation stopped (exit ' + str(result.returncode) + '); reconcile before repeating a write')
    return result.stdout
