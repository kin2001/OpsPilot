"""Validate the user-entered scoped B2 key and save it only in Windows Credential Manager."""
import base64
import ctypes
from ctypes import wintypes as w
import datetime
import getpass
import json
from pathlib import Path
import sys
import time
import urllib.error
import urllib.request

BUCKET_ID = '9dd7257d9ea8748eaa190a16'
BUCKET_NAME = 'opspilot-backups-lhlizmdh'
TARGET = 'OpsPilot B2:backup'
ROOT = Path(__file__).resolve().parents[2]


def validate_authorization(data, now):
    storage = data.get('apiInfo', {}).get('storageApi', {})
    allowed = storage.get('allowed', {})
    buckets = allowed.get('buckets')
    if not isinstance(buckets, list) or len(buckets) != 1 or buckets[0].get('id') != BUCKET_ID or buckets[0].get('name') != BUCKET_NAME:
        raise ValueError('Key must reach only the verified OpsPilot bucket; nothing saved')
    if allowed.get('namePrefix') != 'opspilot/' or storage.get('s3ApiUrl') != 'https://s3.us-west-004.backblazeb2.com':
        raise ValueError('Key prefix or region mismatch; nothing saved')
    capabilities = set(allowed.get('capabilities', []))
    # Standard B2 Read/Write includes writeBuckets; the exact bucket restriction above remains mandatory.
    if not {'listFiles', 'readFiles', 'writeFiles', 'deleteFiles'} <= capabilities or capabilities & {'listAllBucketNames', 'writeKeys', 'deleteKeys', 'listKeys', 'deleteBuckets', 'bypassGovernance'}:
        raise ValueError('Key capabilities do not match the approved backup scope; nothing saved')
    expires = data.get('applicationKeyExpirationTimestamp')
    if not isinstance(expires, (int, float)):
        raise ValueError('Expiring setup key required; nothing saved')
    if expires > 10**12:
        expires /= 1000
    if not now < expires <= now + 604800 + 300:
        raise ValueError('Key must be valid and expire within seven days; nothing saved')
    return {'bucket': BUCKET_NAME, 'bucket_id': BUCKET_ID, 'prefix': 'opspilot/', 'endpoint': storage['s3ApiUrl'], 'capabilities': sorted(capabilities), 'expires_at': datetime.datetime.fromtimestamp(expires, datetime.timezone.utc).isoformat()}


class Credential(ctypes.Structure):
    _fields_ = [('Flags', w.DWORD), ('Type', w.DWORD), ('TargetName', w.LPWSTR), ('Comment', w.LPWSTR), ('LastWritten', w.FILETIME), ('CredentialBlobSize', w.DWORD), ('CredentialBlob', ctypes.c_void_p), ('Persist', w.DWORD), ('AttributeCount', w.DWORD), ('Attributes', ctypes.c_void_p), ('TargetAlias', w.LPWSTR), ('UserName', w.LPWSTR)]


def save_native(key_id, secret):
    api = ctypes.WinDLL('Advapi32', use_last_error=True)
    api.CredReadW.argtypes = [w.LPCWSTR, w.DWORD, w.DWORD, ctypes.POINTER(ctypes.POINTER(Credential))]
    api.CredReadW.restype = w.BOOL
    api.CredWriteW.argtypes = [ctypes.POINTER(Credential), w.DWORD]
    api.CredWriteW.restype = w.BOOL
    api.CredFree.argtypes = [ctypes.c_void_p]
    existing = ctypes.POINTER(Credential)()
    if api.CredReadW(TARGET, 1, 0, ctypes.byref(existing)):
        api.CredFree(existing)
        raise ValueError('B2 credential already exists; reconcile before replacing it')
    if ctypes.get_last_error() != 1168:
        raise ValueError('Native credential store unavailable; no plaintext fallback')
    payload = json.dumps({'key_id': key_id, 'application_key': secret}).encode('utf-8')
    blob = ctypes.create_string_buffer(payload)
    credential = Credential(Type=1, TargetName=TARGET, CredentialBlobSize=len(payload), CredentialBlob=ctypes.cast(blob, ctypes.c_void_p), Persist=2, UserName='opspilot-backup')
    if not api.CredWriteW(ctypes.byref(credential), 0):
        raise ValueError('Native credential persistence failed; no plaintext fallback')
    stored = ctypes.POINTER(Credential)()
    if not api.CredReadW(TARGET, 1, 0, ctypes.byref(stored)):
        raise ValueError('Native credential readback unavailable; reconcile before retry')
    try:
        if ctypes.string_at(stored.contents.CredentialBlob, stored.contents.CredentialBlobSize) != payload:
            raise ValueError('Native credential readback mismatch; reconcile before retry')
    finally:
        api.CredFree(stored)
        ctypes.memset(blob, 0, len(payload))


def validate_input(key_id, secret):
    if not key_id:
        raise ValueError('B2 keyID is empty; paste its value before pressing Enter. Nothing saved.')
    if not secret:
        raise ValueError('B2 applicationKey is empty; paste its value before pressing Enter. Nothing saved.')
    if ':' in key_id or any(c.isspace() for c in key_id) or len(key_id) > 256:
        raise ValueError('B2 keyID must contain only the value, without its label. Nothing saved.')
    if any(c.isspace() for c in secret) or len(secret) > 1024:
        raise ValueError('B2 applicationKey must contain only the value, without its label. Nothing saved.')


def decode_native(username, payload):
    try:
        text = payload.decode('utf-16-le') if b'\x00' in payload else payload.decode('utf-8')
        if text.startswith('{'):
            data = json.loads(text)
            key_id, secret = data['key_id'], data['application_key']
        else:
            key_id, secret = username, text
        key_id, secret = key_id.strip(), secret.strip()
        validate_input(key_id, secret)
        return key_id, secret
    except (UnicodeError, KeyError, TypeError, json.JSONDecodeError):
        raise ValueError('Stored B2 entry format is invalid; values withheld') from None


def read_native():
    api = ctypes.WinDLL('Advapi32', use_last_error=True)
    api.CredReadW.argtypes = [w.LPCWSTR, w.DWORD, w.DWORD, ctypes.POINTER(ctypes.POINTER(Credential))]
    api.CredReadW.restype = w.BOOL
    api.CredFree.argtypes = [ctypes.c_void_p]
    credential = ctypes.POINTER(Credential)()
    if not api.CredReadW(TARGET, 1, 0, ctypes.byref(credential)):
        raise ValueError('OpsPilot B2 credential not found; no fallback used')
    try:
        return decode_native(credential.contents.UserName, ctypes.string_at(credential.contents.CredentialBlob, credential.contents.CredentialBlobSize))
    finally:
        api.CredFree(credential)


def main():
    verify_existing = sys.argv[1:] == ['--verify-stored']
    if verify_existing:
        key_id, secret = read_native()
    elif sys.argv[1:] == ['--masked-pipe']:
        key_id = sys.stdin.readline().strip()
        secret = sys.stdin.readline().strip()
    elif not sys.stdin.isatty():
        raise ValueError('Use an interactive local terminal; secret input must be masked')
    else:
        print('Enter the NEW bucket-scoped B2 key pair. Input is masked; do not paste into chat.')
        key_id = getpass.getpass('B2 keyID (masked): ').strip()
        secret = getpass.getpass('B2 applicationKey (masked): ').strip()
    validate_input(key_id, secret)
    basic = base64.b64encode((key_id + ':' + secret).encode()).decode()
    request = urllib.request.Request('https://api.backblazeb2.com/b2api/v4/b2_authorize_account', headers={'Authorization': 'Basic ' + basic})
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise ValueError(f'B2 verification failed (HTTP {error.code}); stored credentials unchanged') from None
    except (urllib.error.URLError, TimeoutError):
        raise ValueError('B2 verification connection failed; nothing saved') from None
    metadata = validate_authorization(result, time.time())
    if not verify_existing:
        save_native(key_id, secret)
    receipt = ROOT / '.spec-team/reports/por47-b2-access.json'
    temporary = receipt.with_suffix('.tmp')
    temporary.write_text(json.dumps({**metadata, 'credential_store': 'Windows Credential Manager', 'credential_target': TARGET, 'checked_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}, indent=2) + '\n', encoding='utf-8')
    temporary.replace(receipt)
    print('B2 key verified in Windows Credential Manager. No secret file was created.')
    print('Bucket: ' + BUCKET_NAME + '; prefix: opspilot/; expiry: ' + metadata['expires_at'])


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, ValueError) else 'Setup failed; details withheld to protect credentials', file=sys.stderr)
        sys.exit(1)
