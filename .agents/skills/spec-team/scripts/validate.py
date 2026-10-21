"""Read-only structural checks. Success is neither live authorization nor acceptance."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import tomllib
import uuid
import unicodedata
from urllib.parse import urlsplit

SKILL = Path('.agents/skills/spec-team')
ROLES = {name: ('gpt-6-luna','max') if name in ('muse','pixel','dock') else ('gpt-6.1-sol',effort) for name,effort in [('spark','high'),('atlas','xhigh'),('relay','high'),('muse','max'),('pixel','max'),('forge','medium'),('lens','xhigh'),('dock','max')]}
CAPABILITIES = ('native_dispatch','role_selection','model_selection','permission_scoping','linear','git_provider','worktrees')
STATUSES = ('backlog','ready','in_progress','in_review','awaiting_acceptance','done')
STATES = ('idea','spec_review','planning','plan_review','setup','implementing','in_review','awaiting_acceptance','merging','cleanup','complete','stopping','stopped','blocked')
ACTIVE = ('implementing','in_review','awaiting_acceptance','merging','cleanup','complete')
REQUIRED_TEXT = {
 'product-spec.md': ('Case coverage','Requirement','Category','Actor','Preconditions','Trigger','Expected behavior','Recovery','Verification','Environment'),
 'technical-plan.md': ('Case coverage','Requirement','Category','Actor','Preconditions','Trigger','Expected behavior','Recovery','Verification','Environment','Owner','Phase','Project quality profile','Criterion / Case IDs','Target / Scope','Rationale / Risk','Verification / Environment','Owner / Phase','Evidence status','Stack recipe and integration','Recipe / Source revision','Fit / Limits','Runtime / Dependency versions','Setup / Lockfiles','Contracts / Security patterns','Validation / Deployment / Recovery'),
 'phase-report.md': ('Case coverage','Project quality evidence','Delivery observations','Environment'),
 'memory.md': ('Project','Purpose and trust boundary','Entries','Finding','Why','Source and revision','Last verified','Recheck when'),
 'linear-issue.md': ('Outcome and purpose','Specification references','Context','Scope and ownership','Dependencies','Implementation checklist','Acceptance criteria','Validation','Documentation','Execution and handoff'),
 'dispatch.md': (),
}


def _text(value):
    return isinstance(value,str) and bool(value.strip())


def _uuid(value):
    try: return isinstance(value,str) and bool(uuid.UUID(value))
    except (ValueError,AttributeError): return False


def _sha(value):
    return isinstance(value,str) and bool(re.fullmatch('[0-9a-fA-F]{40,64}',value))


def _within(path, root):
    return path == root or root in path.parents


def _path(value, root, field, errors):
    if not _text(value): errors.append(field + ': expected path'); return None
    try:
        path = (root / value).resolve()
        if not _within(path,root): errors.append(field + ': path escapes controller'); return None
        return path
    except (OSError,ValueError,RuntimeError): errors.append(field + ': invalid path'); return None


def _object(value, fields, field, errors, exact=False):
    if not isinstance(value,dict): errors.append(field + ': expected object'); return {}
    for key in fields:
        if key not in value: errors.append(field + '.' + key + ': missing')
    if exact and set(value)-set(fields): errors.append(field + ': unknown fields')
    return value


def validate_project(settings: dict) -> list[str]:
    errors=[]
    p=_object(settings,('schema_version','kit_version','runtime','linear','git','validation'),'project',errors,True)
    if not p: return errors
    if type(p.get('schema_version')) is not int or p['schema_version'] != 1: errors.append('project.schema_version: unsupported')
    if p.get('kit_version') != '0.1.0': errors.append('project.kit_version: unsupported')
    def credentials(value):
        if isinstance(value,dict):
            for key,item in value.items():
                if str(key).lower() in ('api_key','access_token','refresh_token','password','secret'): errors.append('project: credential field forbidden')
                credentials(item)
        elif isinstance(value,list):
            for item in value: credentials(item)
    credentials(p)
    runtime=_object(p.get('runtime'),('host','dispatch','capabilities'),'runtime',errors,True)
    if runtime.get('host') not in (None,'codex','chatgpt-desktop'): errors.append('runtime.host: unsupported')
    if runtime.get('dispatch') != 'native': errors.append('runtime.dispatch: expected native')
    caps=_object(runtime.get('capabilities'),CAPABILITIES,'runtime.capabilities',errors,True)
    for key in CAPABILITIES:
        cap=_object(caps.get(key),('available','evidence'),'runtime.capabilities.'+key,errors,True)
        if cap.get('available') is not None and type(cap['available']) is not bool: errors.append('runtime.capabilities.'+key+'.available: expected boolean or null')
        if cap.get('evidence') is not None and not isinstance(cap['evidence'],str): errors.append('runtime.capabilities.'+key+'.evidence: expected string or null')
    linear=_object(p.get('linear'),('workspace_id','team_id','project_id','assignee_id','lead_id','status_ids'),'linear',errors,True)
    for key in ('workspace_id','team_id','project_id','assignee_id','lead_id'):
        if linear.get(key) is not None and not _text(linear[key]): errors.append('linear.'+key+': expected string or null')
    statuses=_object(linear.get('status_ids'),STATUSES,'linear.status_ids',errors,True)
    for key in STATUSES:
        if statuses.get(key) is not None and not _text(statuses[key]): errors.append('linear.status_ids.'+key+': expected string or null')
    git=_object(p.get('git'),('provider','repository_id','remote_url','base_branch','merge_strategy','codex_coauthor'),'git',errors,True)
    for key in ('provider','repository_id','remote_url','base_branch','merge_strategy'):
        if git.get(key) is not None and not _text(git[key]): errors.append('git.'+key+': expected string or null')
    if _text(git.get('remote_url')):
        remote=git['remote_url']
        try:
            parsed=urlsplit(remote)
            if parsed.password or (parsed.scheme in ('https','http') and parsed.username) or parsed.query or parsed.fragment or any(ord(c)<32 for c in remote): errors.append('git.remote_url: expected credential-free URL')
        except ValueError: errors.append('git.remote_url: invalid URL')
    author=_object(git.get('codex_coauthor'),('name','email'),'git.codex_coauthor',errors,True)
    for key in ('name','email'):
        if not _text(author.get(key)) or any(unicodedata.category(c)=='Cc' for c in author.get(key,'') if isinstance(c,str)):
            errors.append('git.codex_coauthor.'+key+': expected single-line attribution')
    validation=_object(p.get('validation'),('test','lint','build','acceptance'),'validation',errors,True)
    for key in ('test','lint','build','acceptance'):
        if validation.get(key) is not None and not isinstance(validation[key],str): errors.append('validation.'+key+': expected command description or null')
    return errors


def validate_run(record: dict, controller_root: Path) -> list[str]:
    errors=[]; root=Path(controller_root).resolve()
    fields=('schema_version','run_id','repository_id','controller_root','owner_claim_id','phase_ids','state','stop_requested','approvals','current_phase','completed_phase_reports')
    r=_object(record,fields,'run',errors,True)
    if not r: return errors
    if type(r.get('schema_version')) is not int or r['schema_version'] != 1: errors.append('run.schema_version: unsupported')
    state=r.get('state'); active=state in ACTIVE
    if state not in STATES: errors.append('run.state: unsupported')
    if type(r.get('stop_requested')) is not bool: errors.append('run.stop_requested: expected boolean')
    if r.get('stop_requested') and state in ACTIVE: errors.append('run.state: stop prevents active execution')
    bound=active or any(r.get(k) is not None for k in ('run_id','repository_id','controller_root','owner_claim_id'))
    if bound:
        for key in ('run_id','owner_claim_id'):
            if not _uuid(r.get(key)): errors.append('run.'+key+': expected UUID')
        if not _text(r.get('repository_id')): errors.append('run.repository_id: required')
        try:
            if not _text(r.get('controller_root')) or Path(r['controller_root']).resolve() != root: errors.append('run.controller_root: mismatch')
        except (OSError,ValueError,RuntimeError): errors.append('run.controller_root: invalid path')
    phases=r.get('phase_ids')
    if not isinstance(phases,list) or any(not _text(p) for p in phases): errors.append('run.phase_ids: expected phase ID list'); phases=[]
    if len(set(phases)) != len(phases): errors.append('run.phase_ids: duplicate IDs')
    if active and not phases: errors.append('run.phase_ids: active run requires phases')
    approvals=_object(r.get('approvals'),('spec','plan'),'run.approvals',errors,True)
    for key in ('spec','plan'):
        receipt=approvals.get(key)
        if receipt is None:
            if active: errors.append('run.approvals.'+key+': required')
            continue
        receipt=_object(receipt,('path','sha256','evidence'),'run.approvals.'+key,errors,True)
        path=_path(receipt.get('path'),root,'run.approvals.'+key+'.path',errors)
        digest=receipt.get('sha256')
        if not isinstance(digest,str) or not re.fullmatch('[0-9a-fA-F]{64}',digest): errors.append('run.approvals.'+key+'.sha256: expected SHA-256')
        if not _text(receipt.get('evidence')): errors.append('run.approvals.'+key+'.evidence: required')
        if path:
            try:
                if hashlib.sha256(path.read_bytes()).hexdigest() != digest: errors.append('run.approvals.'+key+'.sha256: saved bytes changed')
            except OSError: errors.append('run.approvals.'+key+'.path: unreadable document')
    phase=r.get('current_phase')
    if phase is None:
        if active: errors.append('run.current_phase: required')
    else:
        p=_object(phase,('id','issue_ids','worktrees','head','base_sha','tree_sha','review','acceptance','pr','merge','cleanup','dispatches'),'run.current_phase',errors,True)
        if p.get('id') not in phases: errors.append('run.current_phase.id: unknown phase')
        for key in ('issue_ids','worktrees','dispatches'):
            if not isinstance(p.get(key),list): errors.append('run.current_phase.'+key+': expected list')
        ready=state in ('in_review','awaiting_acceptance','merging','cleanup','complete')
        for key in ('head','base_sha','tree_sha'):
            if (ready or p.get(key) is not None) and not _sha(p.get(key)): errors.append('run.current_phase.'+key+': expected commit/tree hash')
        protected=(root/'.spec-team',root/'.git',root/'.codex',root/'.agents')
        for worktree in p.get('worktrees',[]) if isinstance(p.get('worktrees'),list) else []:
            w=_object(worktree,('path','branch','base_sha','owner','status'),'worktree',errors,True)
            if w.get('status') not in ('active','reviewing','retained','removal_pending','removed'): errors.append('worktree.status: unsupported')
            if w.get('branch') is not None and not _text(w['branch']): errors.append('worktree.branch: expected string or null')
            if not _text(w.get('owner')): errors.append('worktree.owner: required')
            if not _sha(w.get('base_sha')): errors.append('worktree.base_sha: expected hash')
            if not _text(w.get('path')): errors.append('worktree.path: required'); continue
            try:
                path=(root/w['path']).resolve()
                if _within(root,path) or any(_within(path,q.resolve()) or _within(q.resolve(),path) for q in protected): errors.append('worktree.path: controller/protected storage overlap')
            except (OSError,ValueError,RuntimeError): errors.append('worktree.path: invalid')
        review=p.get('review'); acceptance=p.get('acceptance'); pr=p.get('pr'); merge=p.get('merge'); cleanup=p.get('cleanup')
        for field,value,keys in (('review',review,('head','base_sha','tree_sha','verdict','evidence')),('acceptance',acceptance,('method','head','base_sha','tree_sha','result','evidence')),('pr',pr,('url','head','base','base_sha')),('merge',merge,('status','request_id','commit','evidence')),('cleanup',cleanup,('status','evidence'))):
            if value is not None: _object(value,keys,'run.current_phase.'+field,errors,True)
        review=review if isinstance(review,dict) else {}; acceptance=acceptance if isinstance(acceptance,dict) else {}; pr=pr if isinstance(pr,dict) else {}; merge=merge if isinstance(merge,dict) else {}; cleanup=cleanup if isinstance(cleanup,dict) else {}
        if review and review.get('verdict') not in (None,'PASS','CHANGES REQUIRED','INCOMPLETE'): errors.append('review.verdict: unsupported')
        if acceptance and (acceptance.get('method') not in (None,'manual','automated') or acceptance.get('result') not in (None,'pending','pass','fail')): errors.append('acceptance: unsupported method/result')
        if merge.get('status') not in (None,'pending','queued','merged','failed','unknown'): errors.append('merge.status: unsupported')
        if cleanup.get('status') not in (None,'pending','preserved','complete','failed'): errors.append('cleanup.status: unsupported')
        def snapshot(receipt,field):
            for key in ('head','base_sha','tree_sha'):
                if receipt.get(key) != p.get(key): errors.append(field+'.'+key+': snapshot mismatch')
        if state in ('awaiting_acceptance','merging','cleanup','complete'):
            if review.get('verdict') != 'PASS' or not _text(review.get('evidence')): errors.append('review: matching evidenced PASS required')
            snapshot(review,'review')
        if state in ('merging','cleanup','complete'):
            if acceptance.get('result') != 'pass' or acceptance.get('method') not in ('manual','automated') or not _text(acceptance.get('evidence')): errors.append('acceptance: selected evidenced pass required')
            snapshot(acceptance,'acceptance')
            for key in ('head','base_sha'):
                if pr.get(key) != p.get(key): errors.append('pr.'+key+': snapshot mismatch')
            if not _text(pr.get('url')) or not _text(pr.get('base')): errors.append('pr: URL/base required')
        if merge.get('status') == 'merged' and (not _sha(merge.get('commit')) or not _text(merge.get('evidence'))): errors.append('merge: actual commit/provider evidence required')
        if state in ('cleanup','complete') and merge.get('status') != 'merged': errors.append('merge.status: verified merged result required')
        if state == 'complete' and cleanup.get('status') != 'complete': errors.append('cleanup.status: complete required')
        if cleanup.get('status') == 'complete' and merge.get('status') != 'merged': errors.append('cleanup: unresolved merge cannot authorize completed cleanup')
        for dispatch in p.get('dispatches',[]) if isinstance(p.get('dispatches'),list) else []:
            d=_object(dispatch,('role','requested_model','requested_effort','observed_model','observed_effort','worker_id','retries','usage'),'dispatch',errors,True)
            if not _text(d.get('role')) or d['role'] not in ROLES: errors.append('dispatch.role: unsupported')
            elif (d.get('requested_model'),d.get('requested_effort')) != ROLES[d['role']]: errors.append('dispatch: requested role model/effort mismatch')
            if type(d.get('retries')) is not int or d['retries']<0: errors.append('dispatch.retries: expected nonnegative integer')
    reports=r.get('completed_phase_reports'); report_ids=[]
    if not isinstance(reports,list): errors.append('run.completed_phase_reports: expected list'); reports=[]
    for report in reports:
        report=_object(report,('id','path','merge_commit','cleanup_status'),'phase_report',errors,True)
        identifier=report.get('id')
        if not _text(identifier) or identifier not in phases or identifier in report_ids: errors.append('phase_report.id: unknown/duplicate phase')
        if _text(identifier): report_ids.append(identifier)
        path=_path(report.get('path'),root,'phase_report.path',errors)
        if path and not path.is_file(): errors.append('phase_report.path: missing retained report')
        if path and isinstance(phase,dict) and isinstance(phase.get('worktrees'),list):
            for worktree in phase['worktrees']:
                if isinstance(worktree,dict) and _text(worktree.get('path')):
                    try:
                        if _within(path,(root/worktree['path']).resolve()): errors.append('phase_report.path: report must survive worktree removal')
                    except (OSError,ValueError,RuntimeError): errors.append('phase_report.path: invalid worktree path')
        if not _sha(report.get('merge_commit')): errors.append('phase_report.merge_commit: required')
        if report.get('cleanup_status') not in ('pending','preserved','complete','failed'): errors.append('phase_report.cleanup_status: unsupported')
        if state=='complete' and report.get('cleanup_status')!='complete': errors.append('phase_report.cleanup_status: complete required')
        if isinstance(phase,dict) and phase.get('id')==identifier and isinstance(phase.get('merge'),dict) and report.get('merge_commit')!=phase['merge'].get('commit'): errors.append('phase_report.merge_commit: current phase mismatch')
    if state=='complete' and (not phases or set(report_ids)!=set(phases) or len(report_ids)!=len(phases)): errors.append('run.completed_phase_reports: every approved phase must be finalized exactly once')
    return errors


def _json(path, errors, field):
    try:
        value=json.loads(path.read_text(encoding='utf-8-sig'))
        if not isinstance(value,dict): errors.append(field+': expected JSON object'); return None
        return value
    except (OSError,ValueError,UnicodeError): errors.append(field+': unreadable or malformed JSON'); return None


def validate_kit(root: Path) -> list[str]:
    root=Path(root); errors=[]
    required=['AGENTS.md',str(SKILL/'SKILL.md'),str(SKILL/'agents/openai.yaml'),str(SKILL/'scripts/setup.py'),str(SKILL/'dependencies.lock.json')]
    required += [str(SKILL/'references'/name) for name in ('workflow.md','linear.md','runtime.md')]
    required += [str(SKILL/'bundles'/(name+'.zip')) for name in ('superpowers','ui-ux-pro-max','ponytail')]
    for name in required:
        if not (root/name).is_file(): errors.append(name+': missing required file')
    for role,(model,effort) in ROLES.items():
        path=Path('.codex/agents')/(role+'.toml'); label=path.as_posix()
        try: data=tomllib.loads((root/path).read_text(encoding='utf-8-sig'))
        except (OSError,ValueError,UnicodeError): errors.append(label+': unreadable or malformed TOML'); continue
        for key in ('name','description','developer_instructions','model','model_reasoning_effort'):
            if not _text(data.get(key)): errors.append(label+'.'+key+': required string')
        if str(data.get('name','')).lower()!=role: errors.append(label+'.name: role mismatch')
        if data.get('model')!=model: errors.append(label+'.model: approved default required')
        if data.get('model_reasoning_effort')!=effort: errors.append(label+'.model_reasoning_effort: approved default required')
        def overrides(value):
            if isinstance(value,dict):
                for key,item in value.items():
                    if key in ('sandbox_mode','approval_policy'): errors.append(label+'.'+key+': role override forbidden')
                    overrides(item)
        overrides(data)
    for name,fields in REQUIRED_TEXT.items():
        path=SKILL/'templates'/name
        try: text=(root/path).read_text(encoding='utf-8-sig')
        except (OSError,UnicodeError): errors.append(path.as_posix()+': missing/unreadable template'); continue
        headings={'Case coverage','Project quality profile','Stack recipe and integration','Project quality evidence','Delivery observations'}
        if name=='memory.md': headings.update(('Project','Purpose and trust boundary','Entries'))
        if name=='linear-issue.md': headings.update(fields)
        for field in fields:
            if field in headings and not re.search(r'^#{1,6}\s+'+re.escape(field)+r'\s*#*\s*$',text,re.I|re.M): errors.append(path.as_posix()+': missing heading '+field)
            elif field.lower() not in text.lower(): errors.append(path.as_posix()+': missing '+field)
    lock_path=SKILL/'dependencies.lock.json'
    lock=_json(root/lock_path,errors,lock_path.as_posix())
    if lock is not None:
        lock=_object(lock,('schema_version','families'),'dependencies.lock',errors)
        if type(lock.get('schema_version')) is not int or lock.get('schema_version')!=1: errors.append('dependencies.lock.schema_version: unsupported')
        families=lock.get('families'); names=[]
        if not isinstance(families,list): errors.append('dependencies.lock.families: expected list'); families=[]
        for family in families:
            f=_object(family,('name','repository','revision','license','archive','sha256','skills'),'dependencies.lock.family',errors)
            name=f.get('name')
            if not _text(name): errors.append('dependencies.lock.family.name: required')
            else: names.append(name)
            for key in ('repository','license','archive'):
                if not _text(f.get(key)): errors.append('dependencies.lock.family.'+key+': required')
            if not isinstance(f.get('revision'),str) or not re.fullmatch('[0-9a-fA-F]{40}',f['revision']): errors.append('dependencies.lock.family.revision: pinned commit required')
            if not isinstance(f.get('sha256'),str) or not re.fullmatch('[0-9a-fA-F]{64}',f['sha256']): errors.append('dependencies.lock.family.sha256: pinned digest required')
            if not isinstance(f.get('skills'),dict) or not f['skills'] or any(not _text(k) or not _text(v) for k,v in f['skills'].items()): errors.append('dependencies.lock.family.skills: nonempty path mapping required')
        if sorted(names)!=['ponytail','superpowers','ui-ux-pro-max']: errors.append('dependencies.lock.families: exactly three approved families required')
    for name,validator in (('project.json',validate_project),('run.json',lambda value:validate_run(value,root))):
        path=SKILL/'templates'/name; value=_json(root/path,errors,path.as_posix())
        if value is not None:
            errors.extend(path.as_posix()+': '+error for error in validator(value))
            if isinstance(value,dict):
                if name=='run.json' and (any(value.get(k) is not None for k in ('run_id','repository_id','controller_root','owner_claim_id','current_phase')) or value.get('phase_ids') or value.get('completed_phase_reports') or value.get('stop_requested') or value.get('state')!='idea' or value.get('approvals')!={'spec':None,'plan':None}): errors.append(path.as_posix()+': template must be inert')
                if name=='project.json':
                    runtime=value.get('runtime')
                    if isinstance(runtime,dict):
                        caps=runtime.get('capabilities')
                        if runtime.get('host') is not None or (isinstance(caps,dict) and any(isinstance(cap,dict) and (cap.get('available') is not None or cap.get('evidence') is not None) for cap in caps.values())): errors.append(path.as_posix()+': runtime template must be inert')
                    linear=value.get('linear')
                    if isinstance(linear,dict) and isinstance(linear.get('status_ids'),dict) and any(v is not None for v in linear['status_ids'].values()): errors.append(path.as_posix()+': status template must be inert')
                    git=value.get('git')
                    if isinstance(git,dict) and git.get('codex_coauthor')!={'name':'Codex','email':'codex@openai.com'}: errors.append(path.as_posix()+': approved Codex attribution default required')
                    for group,keys in (('git',('provider','repository_id','remote_url','base_branch','merge_strategy')),('linear',('workspace_id','team_id','project_id','assignee_id','lead_id'))):
                        if isinstance(value.get(group),dict) and any(value[group].get(k) is not None for k in keys): errors.append(path.as_posix()+': template must be inert')
    # Required repository-relative references are checked, without fetching URLs.
    for path in [root/'AGENTS.md',root/SKILL/'SKILL.md',*(root/'.codex/agents').glob('*.toml')]:
        if not path.is_file(): continue
        try: text=path.read_text(encoding='utf-8-sig')
        except (OSError,UnicodeError): errors.append(path.relative_to(root).as_posix()+': unreadable reference source'); continue
        for reference in re.findall(r'\]\(([^)\s]+)\)',text):
            if '://' in reference or reference.startswith(('#','mailto:')): continue
            target=reference.split('#',1)[0]
            if target and not (path.parent/target).is_file(): errors.append(path.relative_to(root).as_posix()+': missing local reference '+target)
        for reference in re.findall(r'(?:\.agents/skills/spec-team/|\.codex/agents/)[A-Za-z0-9_./-]+\.(?:md|toml|py|json)',text):
            if not (root/reference).is_file(): errors.append(path.relative_to(root).as_posix()+': missing local reference '+reference)
    return errors


def main(argv: list[str] | None = None) -> int:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,required=True); parser.add_argument('--controller-root',type=Path)
    parser.add_argument('--project',type=Path); parser.add_argument('--run',type=Path)
    args=parser.parse_args(argv); controller=(args.controller_root or args.root).resolve()
    errors=validate_kit(args.root)
    project=None
    if args.project:
        project=_json(args.project,errors,'project')
        if project is not None: errors.extend(validate_project(project))
    if args.run:
        record=_json(args.run,errors,'run')
        if record is not None:
            errors.extend(validate_run(record,controller))
            noninert=isinstance(record,dict) and (record.get('state')!='idea' or any(record.get(k) is not None for k in ('run_id','repository_id','controller_root','owner_claim_id')))
            if noninert:
                if not args.project: errors.append('run: non-inert record requires --project')
                if isinstance(project,dict):
                    git=project.get('git')
                    if not isinstance(git,dict) or not _text(git.get('repository_id')) or record.get('repository_id')!=git.get('repository_id'): errors.append('run.repository_id: configured project mismatch')
    if errors:
        for error in errors: print(error)
        return 1
    print('SPEC_TEAM_VALID (structural only; ownership and live checks remain required)'); return 0

if __name__ == '__main__': raise SystemExit(main())
