"""Exclusive ownership for cooperating sessions sharing one local controller."""
import argparse
import json
import os
from pathlib import Path
import stat
import uuid


def _uuid(value, field):
    try:
        if not isinstance(value, str): raise ValueError()
        uuid.UUID(value)
    except (ValueError, TypeError, AttributeError):
        raise ValueError(field + ': expected UUID') from None


def _storage(root):
    root = Path(root).resolve(strict=True)
    if not root.is_dir(): raise ValueError('controller_root: expected directory')
    folder = root / '.spec-team'
    path = folder / 'owner.json'
    for item in (folder, path):
        try: info = item.lstat()
        except FileNotFoundError: continue
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0x400):
            raise ValueError('owner storage: redirected path rejected')
    if os.name == 'nt' and not hasattr(os.stat_result, 'st_file_attributes'):
        # Windows stat results normally expose this field; fail closed if unavailable.
        if not hasattr(root.stat(), 'st_file_attributes'):
            raise ValueError('owner storage: required reparse check unsupported')
    return root, folder, path


def claim_owner(controller_root: Path, session_id: str, run_id: str) -> dict:
    _uuid(run_id, 'run_id')
    if not isinstance(session_id, str) or not session_id.strip() or any(ord(c) < 32 for c in session_id):
        raise ValueError('session_id: expected nonempty single-line string')
    try:
        root, folder, path = _storage(controller_root)
        folder.mkdir(exist_ok=True)
        root, folder, path = _storage(root)
        claim = {'claim_id': str(uuid.uuid4()), 'session_id': session_id, 'run_id': run_id, 'controller_root': str(root)}
        with path.open('x', encoding='utf-8') as stream:
            json.dump(claim, stream)
            stream.flush()
            os.fsync(stream.fileno())
        return claim
    except (OSError, RuntimeError):
        raise ValueError('owner storage: exclusive claim unavailable; retained state requires inspection') from None


def _read(controller_root, claim_id, run_id=None):
    _uuid(claim_id, 'claim_id')
    if run_id is not None: _uuid(run_id, 'run_id')
    try:
        root, _, path = _storage(controller_root)
        claim = json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(claim, dict) or set(claim) != {'claim_id','session_id','run_id','controller_root'}:
            raise ValueError('owner storage: malformed claim')
        _uuid(claim['claim_id'], 'stored claim_id'); _uuid(claim['run_id'], 'stored run_id')
        if not isinstance(claim['session_id'],str) or not claim['session_id'].strip(): raise ValueError('owner storage: malformed session_id')
        if not isinstance(claim['controller_root'],str) or Path(claim['controller_root']).resolve() != root:
            raise ValueError('controller_root: claim mismatch')
        if claim['claim_id'] != claim_id: raise ValueError('claim_id: ownership mismatch')
        if run_id is not None and claim['run_id'] != run_id: raise ValueError('run_id: ownership mismatch')
        return claim, path
    except (OSError, RuntimeError, json.JSONDecodeError, UnicodeError):
        raise ValueError('owner storage: missing or malformed claim') from None


def check_owner(controller_root: Path, claim_id: str, run_id: str) -> dict:
    return _read(controller_root, claim_id, run_id)[0]


def release_owner(controller_root: Path, claim_id: str) -> None:
    _, path = _read(controller_root, claim_id)
    try: path.unlink()
    except OSError: raise ValueError('owner storage: release failed') from None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    for command in ('claim','check','release'):
        p = sub.add_parser(command); p.add_argument('--root', type=Path, required=True)
        if command == 'claim': p.add_argument('--session-id',required=True)
        else: p.add_argument('--claim-id',required=True)
        if command != 'release': p.add_argument('--run-id',required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == 'claim': print('OWNER_CLAIMED ' + claim_owner(args.root,args.session_id,args.run_id)['claim_id'])
        elif args.command == 'check': check_owner(args.root,args.claim_id,args.run_id); print('OWNER_OK')
        else: release_owner(args.root,args.claim_id); print('OWNER_RELEASED')
    except (ValueError, OSError):
        print('owner: invalid fields, conflict, or unavailable storage'); return 1
    return 0

if __name__ == '__main__': raise SystemExit(main())
