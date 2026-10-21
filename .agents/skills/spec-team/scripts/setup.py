"""Additive, offline, project-local bootstrap. Python 3.11+, standard library only."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import zipfile

SKILL = Path('.agents/skills/spec-team')
POINTER = b'\n<!-- spec-team:start -->\nRead .agents/skills/spec-team/SKILL.md for the spec-team workflow.\n<!-- spec-team:end -->\n'
IGNORE = b'\n# spec-team:start\n/.spec-team/\n/.superpowers/\n/.worktrees/\n# spec-team:end\n'
MANAGED = {'AGENTS.md': (POINTER, b'<!-- spec-team:'), '.gitignore': (IGNORE, b'# spec-team:')}
MAX_BYTES = 50 * 1024 * 1024
ROLES = ('spark', 'atlas', 'relay', 'muse', 'pixel', 'forge', 'lens', 'dock')


def _kit_payloads(kit):
    payloads = {path.relative_to(kit).as_posix(): path.read_bytes() for path in _files(kit / SKILL)}
    for role in ROLES:
        path = kit / f'.codex/agents/{role}.toml'
        _check_path(path)
        if not path.is_file():
            raise ValueError('kit_root: missing required role profile')
        payloads[path.relative_to(kit).as_posix()] = path.read_bytes()
    payloads.update({name: block for name, (block, marker) in MANAGED.items()})
    memory = kit / SKILL / 'templates/memory.md'
    _check_path(memory)
    payloads['docs/MEMORY.md'] = memory.read_bytes() if memory.is_file() else b'# Project memory\n\nRecord verified project decisions here.\n'
    return payloads


def _safe_path(value):
    if not isinstance(value, str) or not value or '\\' in value:
        raise ValueError('path: expected a portable relative path')
    parts = value.split('/')
    reserved = {'CON', 'PRN', 'AUX', 'NUL', *(f'COM{i}' for i in range(1, 10)), *(f'LPT{i}' for i in range(1, 10))}
    if any(p in ('', '.', '..') or p.endswith((' ', '.')) or re.search(r'[<>:"|?*\x00-\x1f]', p) or p.split('.')[0].upper() in reserved for p in parts):
        raise ValueError('path: unsafe archive or manifest path')
    return PurePosixPath(value)


def _check_path(path):
    for p in [path, *path.parents]:
        try:
            info = p.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise ValueError('path: symlink or reparse redirection rejected')
        if p != path and not stat.S_ISDIR(info.st_mode):
            raise ValueError('path: parent is not a directory')
        if not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
            raise ValueError('path: unsupported filesystem type')
        if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
            raise ValueError('path: hardlink or unknown link count rejected')
    if os.name == 'nt' and not hasattr(path.anchor and Path(path.anchor).stat(), 'st_file_attributes'):
        raise ValueError('path: reparse checking unavailable')


def _files(root):
    _check_path(root)
    for path in sorted(root.rglob('*')):
        _check_path(path)
        if path.is_file():
            yield path


def _archive(skill_root, family):
    required = {'name', 'repository', 'revision', 'license', 'archive', 'sha256', 'skills'}
    if not isinstance(family, dict) or not required <= family.keys():
        raise ValueError('families: missing metadata')
    if not re.fullmatch(r'[a-z][a-z0-9-]*', family['name']) or not re.fullmatch(r'[0-9a-f]{40}', family['revision']):
        raise ValueError('families: invalid name or immutable revision')
    if family['license'] != 'MIT' or not re.fullmatch(r'https://github.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', family['repository']):
        raise ValueError('families: unsupported license or repository')
    if not isinstance(family['skills'], dict) or not family['skills'] or not re.fullmatch(r'[0-9a-f]{64}', family['sha256']):
        raise ValueError('families: invalid exports or digest')
    archive = skill_root / _safe_path(family['archive'])
    _check_path(archive)
    if archive.stat().st_size > MAX_BYTES:
        raise ValueError('archive: compressed size exceeds limit')
    raw = archive.read_bytes()
    if hashlib.sha256(raw).hexdigest() != family['sha256']:
        raise ValueError('archive.sha256: mismatch')
    contents = {}
    seen = set()
    spellings = {}
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        entries = z.infolist()
        if len(entries) > 2000 or sum(i.file_size for i in entries) > MAX_BYTES:
            raise ValueError('archive: exceeds file or size limit')
        for info in entries:
            name = info.filename[:-1] if info.is_dir() else info.filename
            _safe_path(name)
            path = PurePosixPath(name)
            for part in [path, *path.parents]:
                text = str(part)
                if spellings.setdefault(text.casefold(), text) != text:
                    raise ValueError('archive: case-colliding directory or member')
            folded = name.casefold()
            if folded in seen:
                raise ValueError('archive: duplicate or case-colliding member')
            seen.add(folded)
            mode = info.external_attr >> 16
            kind = stat.S_IFMT(mode)
            if kind not in (0, stat.S_IFDIR, stat.S_IFREG) or info.flag_bits & 1:
                raise ValueError('archive: links, special files, or encryption rejected')
            if not info.is_dir():
                contents[name] = z.read(info)
    for name in contents:
        if any(str(p).casefold() in {n.casefold() for n in contents} for p in PurePosixPath(name).parents if str(p) != '.'):
            raise ValueError('archive: file overlaps parent directory')
    exports = {}
    for name, folder in family['skills'].items():
        if not re.fullmatch(r'[a-z][a-z0-9-]*', name):
            raise ValueError('skills: invalid skill name')
        folder = str(_safe_path(folder))
        prefix = folder + '/'
        files = {n[len(prefix):]: data for n, data in contents.items() if n.startswith(prefix)}
        if 'SKILL.md' not in files:
            raise ValueError('skills: export missing SKILL.md')
        exports[name] = files
    return exports


def _default_roots():
    home = Path.home()
    return [home / '.agents/skills', home / '.codex/skills', home / '.claude/skills', *sorted((home / '.codex/plugins/cache').glob('*/*/*/skills'))]


def plan_setup(kit_root: Path, project_root: Path, skill_roots: list[Path] | None = None) -> dict:
    kit = Path(os.path.abspath(kit_root))
    project = Path(os.path.abspath(project_root))
    roots = [Path(os.path.abspath(p)) for p in (skill_roots if skill_roots is not None else _default_roots())]
    plan = {'kit_root': str(kit), 'project_root': str(project), 'skill_roots': [str(p) for p in roots], 'operations': [], 'reused': [], 'conflicts': [], 'readiness': {'host_discovery': 'unknown', 'model_routing': 'unknown', 'services': 'unknown'}}
    field = 'project_root'
    try:
        _check_path(kit)
        _check_path(project)
        # Canonicalize comparisons only after rejecting redirected input paths.
        project_key, kit_key = project.resolve(), kit.resolve()
        home = Path.home().resolve()
        global_roots = ('.codex/skills', '.codex/agents', '.codex/plugins', '.codex/memories', '.codex/automations', '.codex/sessions', '.codex/rules', '.codex/logs', '.codex/tmp', '.codex/state', '.codex/visualizations', '.codex/cache', '.agents/skills', '.claude/skills', '.claude/agents', '.claude/plugins', '.claude/projects')
        if project_key == home or project_key in home.parents or project_key in [home / p for p in ('.codex', '.agents', '.claude')] or any(project_key == home / p or (home / p) in project_key.parents for p in global_roots):
            raise ValueError('project_root: protected user storage')
        if project_key != kit_key and (project_key in kit_key.parents or kit_key in project_key.parents):
            raise ValueError('project_root: overlaps source kit')
        for root in roots:
            _check_path(root)
            root_key = root.resolve()
            if project_key == root_key or project_key in root_key.parents or root_key in project_key.parents:
                raise ValueError('project_root: overlaps discovery storage')
        skill = kit / SKILL
        field = 'dependencies.lock.json'
        _check_path(skill / 'dependencies.lock.json')
        lock = json.loads((skill / 'dependencies.lock.json').read_text(encoding='utf-8'))
        if not isinstance(lock, dict) or lock.get('schema_version') != 1 or not isinstance(lock.get('families'), list) or not lock['families']:
            raise ValueError('manifest: invalid schema_version or families')
        desired = {}
        def add(relative, data, mode='new'):
            relative = str(_safe_path(relative))
            if relative.casefold() in {p.casefold() for p in desired}:
                raise ValueError('operations: duplicate destination')
            desired[relative] = (data, mode)
        if not (skill / 'SKILL.md').is_file() or not (kit / '.codex/agents').is_dir():
            raise ValueError('kit_root: missing skill or role profiles')
        field = 'kit_files'
        for name, data in _kit_payloads(kit).items():
            if name == 'docs/MEMORY.md' and (project / name).exists():
                _check_path(project / name)
                if not (project / name).is_file():
                    raise ValueError('docs/MEMORY.md: expected a regular file')
                continue
            add(name, data, 'managed' if name in MANAGED else 'new')
        families = set()
        skills = set()
        for family in lock['families']:
            field = 'families.archive'
            exports = _archive(skill, family)
            if family['name'] in families:
                raise ValueError('families: duplicate family')
            families.add(family['name'])
            for name, files in exports.items():
                if name in skills or name == 'spec-team':
                    raise ValueError('skills: duplicate export')
                skills.add(name)
                found = None
                for root in [project / '.agents/skills', *roots]:
                    candidate = root / name
                    _check_path(candidate)
                    if candidate.exists():
                        if not (candidate / 'SKILL.md').is_file():
                            raise ValueError('skills: existing skill missing SKILL.md')
                        found = candidate
                        break
                if found:
                    actual = {p.relative_to(found).as_posix(): p.read_bytes() for p in _files(found)}
                    plan['reused'].append({'name': name, 'path': str(found), 'status': 'matching-pin' if actual == files else 'present-unverified'})
                else:
                    for relative, data in files.items():
                        add(f'.agents/skills/{name}/{relative}', data)
        for relative, (data, mode) in sorted(desired.items()):
            field = relative
            target = project / relative
            _check_path(target)
            old = target.read_bytes() if target.is_file() else None
            if target.exists() and old is None:
                raise ValueError('destination: expected file')
            if old == data:
                continue
            if old is not None:
                if mode == 'managed':
                    if data in old:
                        continue
                    if MANAGED[relative][1] in old:
                        raise ValueError(f'{relative}: conflicting managed block')
                    data = old + data
                else:
                    plan['conflicts'].append({'field': relative, 'error': 'existing file differs; manual reconciliation required'})
                    continue
            plan['operations'].append({'path': relative, 'sha256': hashlib.sha256(data).hexdigest(), 'previous_sha256': hashlib.sha256(old).hexdigest() if old is not None else None})
    except (OSError, ValueError, TypeError, KeyError, zipfile.BadZipFile, RuntimeError) as error:
        message = str(error) if type(error) is ValueError else 'invalid or unavailable source, archive, or destination'
        plan['conflicts'].append({'field': field, 'error': message})
    return plan


def _write_new(path, data):
    with path.open('xb') as stream:
        try:
            stream.write(data)
            stream.flush()
        except BaseException:
            stream.close()
            path.unlink()
            raise


def apply_setup(plan: dict) -> dict:
    fresh = plan_setup(Path(plan['kit_root']), Path(plan['project_root']), [Path(p) for p in plan['skill_roots']])
    if fresh != plan or fresh['conflicts']:
        raise ValueError('setup: plan is stale, unsafe, conflicting, or modified; plan again')
    project = Path(plan['project_root'])
    kit = Path(plan['kit_root'])
    # Materialize all verified bytes before the first target write.
    payloads = _kit_payloads(kit)
    lock = json.loads((kit / SKILL / 'dependencies.lock.json').read_text(encoding='utf-8'))
    for family in lock['families']:
        for name, files in _archive(kit / SKILL, family).items():
            for relative, data in files.items():
                payloads[f'.agents/skills/{name}/{relative}'] = data
    writes = []
    for operation in plan['operations']:
        target = project / operation['path']
        _check_path(target)
        old = target.read_bytes() if target.is_file() else None
        data = payloads[operation['path']]
        if operation['path'] in MANAGED and old is not None:
            data = old + data
        if hashlib.sha256(data).hexdigest() != operation['sha256'] or (hashlib.sha256(old).hexdigest() if old is not None else None) != operation['previous_sha256']:
            raise ValueError('setup: source or target changed during preflight')
        writes.append((target, data, old))
    created_files, created_dirs, appended = [], [], []
    try:
        for target, data, old in writes:
            _check_path(target)
            missing = []
            parent = target.parent
            while not parent.exists():
                missing.append(parent)
                parent = parent.parent
            for folder in reversed(missing):
                folder.mkdir()
                created_dirs.append(folder)
            if old is None:
                if target.exists():
                    raise ValueError('destination: appeared after preflight')
                _write_new(target, data)
                created_files.append(target)
            else:
                with target.open('r+b') as stream:
                    if stream.read() != old:
                        raise ValueError('destination: changed after preflight')
                    appended.append((target, old, data))
                    stream.write(data[len(old):])
        return {**plan, 'applied': len(writes)}
    except BaseException:
        for target, old, data in reversed(appended):
            _check_path(target)
            current = target.read_bytes()
            if current.startswith(old) and data.startswith(current):
                with target.open('r+b') as stream:
                    stream.truncate(len(old))
        for target in reversed(created_files):
            _check_path(target)
            target.unlink(missing_ok=True)
        for folder in reversed(created_dirs):
            folder.rmdir()
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', required=True, type=Path)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--skills-root', action='append', type=Path)
    args = parser.parse_args(argv)
    plan = plan_setup(Path(__file__).absolute().parents[4], args.project, args.skills_root)
    if plan['conflicts']:
        print(json.dumps(plan, indent=2))
        return 1
    try:
        result = apply_setup(plan) if args.apply else plan
    except (OSError, ValueError):
        print('setup: apply failed; inspect destination and retry planning')
        return 1
    print('SPEC_TEAM_SETUP_APPLIED' if args.apply else 'SPEC_TEAM_SETUP_PLANNED')
    print(json.dumps(result, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
