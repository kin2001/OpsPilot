"""Owned temporary Free Supabase restore target; source stays read-only."""
import datetime
import hashlib
import io
import json
import os
import re
from pathlib import Path
import secrets
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.request
from backup_runtime import ROOT,ready,restic,environment
from provision_opspilot import dedicated_token,EXPECTED_ORG
from capture_opspilot_checkpoint import TOOLS,fingerprints

ORG=EXPECTED_ORG
SOURCE_REF='lhlizmdhxjspnxadtzsm'
NAME='opspilot-recovery-check'
JOURNAL=ROOT/'.spec-team/reports/por47-managed-restore-target.json'
PWSH=r'C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe'

def portable_roles(sql,roles):
    if 'supabase_realtime_admin' in roles:return sql,[]
    output=[];omitted=[]
    for line in sql.splitlines(keepends=True):
        if b'"supabase_realtime_admin"' in line and not line.lstrip().startswith(b'--'):
            if not re.fullmatch(rb'GRANT SET ON PARAMETER "[a-z_]+" TO "supabase_realtime_admin";\r?\n?',line):
                raise ValueError('Unexpected statement for missing provider role; no role privileges bypassed')
            omitted.append({'role':'supabase_realtime_admin','statement_sha256':hashlib.sha256(line.rstrip(b'\r\n')).hexdigest()})
            output.append(b'-- Absent provider-owned realtime role: parameter grant retained in original encrypted archive.\n')
        else:output.append(line)
    return b''.join(output),omitted

def sql_failure(stdout,stderr):
    stages=[stage for line in stdout.splitlines() for stage in ('role','schema','data') if line==('OPSPILOT_'+stage.upper()).encode()]
    state=re.search(rb'ERROR:\s+([0-9A-Z]{5})(?:\s|$)',stderr)
    value={'failed_export':stages[-1] if stages else 'unknown','sqlstate':state.group(1).decode() if state else 'unknown'}
    for marker in ('password authentication failed','certificate verify failed','Tenant or user not found','Connection timed out','connection refused'):
        if marker.lower() in stderr.decode(errors='replace').lower():value['connection_error']=marker;break
    return value

def inventory(projects,receipt):
    expected={SOURCE_REF:'opspilot'}
    if receipt is not None:
        ref=receipt.get('project_ref')
        if not ref or ref==SOURCE_REF or not receipt.get('created_by_this_operation'):
            raise ValueError('Owned restore-target receipt required')
        expected[ref]=NAME
    if len(projects)!=len(expected) or {p['id'] for p in projects}!=set(expected):
        raise ValueError('Unexpected dedicated project inventory; no resource mutation')
    for p in projects:
        if p.get('organization_id')!=ORG or p.get('name')!=expected[p['id']] or p.get('region')!='ap-southeast-1':
            raise ValueError('Project organization/name/region mismatch')

def password(create=False):
    path=ROOT/'.spec-team/local/credentials/por47-restore-project-password.dpapi'
    if path.is_symlink() or not path.parent.exists():raise ValueError('Protected restore credential path unavailable')
    if not path.exists():
        if not create:raise ValueError('Bound restore password missing; no regeneration')
        value=secrets.token_urlsafe(36)
        script="$ErrorActionPreference='Stop'; $v=[Console]::In.ReadToEnd(); ConvertTo-SecureString $v -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath '"+str(path)+"'"
        r=subprocess.run([PWSH,'-NoProfile','-NonInteractive','-Command',script],input=value,capture_output=True,text=True,timeout=20)
        if r.returncode:raise ValueError('Restore password native protection failed')
    script="$ErrorActionPreference='Stop'; $s=Get-Content -LiteralPath '"+str(path)+"' | ConvertTo-SecureString; [Net.NetworkCredential]::new('', $s).Password"
    r=subprocess.run([PWSH,'-NoProfile','-NonInteractive','-Command',script],capture_output=True,text=True,timeout=20)
    if r.returncode or not r.stdout.strip():raise ValueError('Protected restore password unavailable')
    return r.stdout.strip()

def main():
    operation=sys.argv[1:]
    if len(operation)!=1 or operation[0] not in ('create','inspect','restore','diagnose','remove'):raise ValueError('Unsupported restore operation')
    operation=operation[0]
    env,_=ready()
    connected=json.loads((ROOT/'.spec-team/local/supabase-opspilot-state/connected.json').read_text(encoding='utf-8-sig'))
    if connected.get('organization_id')!=ORG or connected.get('profile')!='opspilot':raise ValueError('Dedicated Supabase profile required')
    token=dedicated_token()
    def api(path,body=None,method=None):
        req=urllib.request.Request('https://api.supabase.com/v1/'+path,data=None if body is None else json.dumps(body).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},method=method or ('GET' if body is None else 'POST'))
        try:
            with urllib.request.urlopen(req,timeout=45) as r:
                data=r.read();return json.loads(data) if data else None
        except urllib.error.HTTPError as e:raise ValueError('Dedicated provider request refused (HTTP '+str(e.code)+'); no account or paid fallback') from None
    organizations=api('organizations')
    if len(organizations)!=1 or organizations[0]['id']!=ORG or api('organizations/'+ORG).get('plan')!='free':raise ValueError('Exact dedicated Free organization required')
    previous=json.loads(JOURNAL.read_text()) if JOURNAL.exists() else None
    projects=api('projects')
    def save(value):
        value['checked_at']=datetime.datetime.now(datetime.timezone.utc).isoformat()
        JOURNAL.write_text(json.dumps(value,indent=2)+'\n')
    if operation=='create':
        if previous is not None:raise ValueError('Existing target journal requires readback; no duplicate creation')
        inventory(projects,None)
        pwd=password(create=True)
        value={'status':'creation_pending','name':NAME,'organization_id':ORG,'region':'ap-southeast-1','source_ref':SOURCE_REF,'created_by_this_operation':False}
        save(value)
        target=api('projects',{'name':NAME,'organization_slug':ORG,'region':'ap-southeast-1','db_pass':pwd})
        if target.get('id')==SOURCE_REF or target.get('name')!=NAME or target.get('organization_id',target.get('organization_slug'))!=ORG:raise ValueError('Unexpected creation response; reconcile before any further writes')
        value.update(status='created',project_ref=target['id'],created_by_this_operation=True)
        save(value)
        inventory(api('projects'),value)
        print('Owned temporary Free restore target created in dedicated OpsPilot organization; Singapore.');return
    inventory(projects,previous)
    ref=previous['project_ref']
    target=next(p for p in projects if p['id']==ref)
    if operation=='inspect':
        print(json.dumps({'project_ref':ref,'name':NAME,'status':target['status'],'organization_id':ORG,'region':target['region']}));return
    query="SELECT (SELECT count(*)::int FROM pg_tables WHERE schemaname='public') AS public_tables,(SELECT count(*)::int FROM auth.users) AS auth_users,(SELECT count(*)::int FROM storage.objects) AS storage_objects"
    rows=api('projects/'+ref+'/database/query/read-only',{'query':query})
    if rows!=[{'public_tables':0,'auth_users':0,'storage_objects':0}]:raise ValueError('Restore target has unexpected application contents')
    if operation=='remove':
        if previous.get('status') not in ('restore_verified','restore_failed','restore_uncertain'):raise ValueError('Only the owned completed/failed/uncertain rehearsal may be removed')
        # Disposal intentionally destroys only this empty operator-owned rehearsal, rather than replaying an uncertain commit.
        if ref==SOURCE_REF:raise ValueError('Source deletion prohibited')
        previous['status_before_removal']=previous['status'];previous['status']='removal_pending';save(previous)
        api('projects/'+ref,method='DELETE')
        inventory(api('projects'),None)
        previous['status']='removed';save(previous)
        print('Owned temporary restore project removed; source project inventory unchanged.');return
    if target['status']!='ACTIVE_HEALTHY' or (operation=='restore' and previous.get('status')!='created') or (operation=='diagnose' and previous.get('status') not in ('restore_failed','restore_uncertain')):raise ValueError('Healthy owned target in the required journal state is necessary; no uncertain restore retry')
    checkpoint=json.loads((ROOT/'.spec-team/reports/por47-initial-checkpoint.json').read_text())
    blob=restic(env,['dump',checkpoint['snapshot_id'],'/opspilot-initial-checkpoint.tar'])
    if hashlib.sha256(blob).hexdigest()!=checkpoint['archive_sha256']:raise ValueError('Encrypted checkpoint checksum mismatch')
    with tarfile.open(fileobj=io.BytesIO(blob)) as tar:files={m.name:tar.extractfile(m).read() for m in tar.getmembers() if m.isfile()}
    manifest=json.loads(files.pop('manifest.json'))
    if manifest['project_ref']!=SOURCE_REF or manifest['files']!=checkpoint['files'] or set(files)!=set(checkpoint['files']):raise ValueError('Checkpoint member identity mismatch')
    for name,data in files.items():
        if len(data)!=checkpoint['files'][name]['bytes'] or hashlib.sha256(data).hexdigest()!=checkpoint['files'][name]['sha256']:raise ValueError('Recovered member checksum mismatch')
    poolers=api('projects/'+ref+'/config/database/pooler')
    if len(poolers)!=1 or poolers[0].get('db_host')!='aws-0-ap-southeast-1.pooler.supabase.com' or poolers[0].get('db_user')!='postgres.'+ref:raise ValueError('Owned target pooler mismatch')
    local=environment(os.environ,'unused','unused','unused');local={k:v for k,v in local.items() if not k.startswith(('AWS_','RESTIC_'))}
    local.update(PGHOST=poolers[0]['db_host'],PGPORT='5432',PGUSER='postgres.'+ref,PGDATABASE='postgres',PGPASSWORD=password(),PGSSLMODE='verify-full',PGSSLROOTCERT=str(TOOLS/'supabase-prod-ca-2021.crt'),PGCONNECT_TIMEOUT='15',PGOPTIONS='-c statement_timeout=180000')
    psql=[str(TOOLS/'pgsql/bin/psql.exe'),'-X','-A','-t','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate']
    role_result=subprocess.run(psql+['-c','SELECT rolname FROM pg_roles ORDER BY rolname'],env=local,capture_output=True,timeout=30)
    if role_result.returncode:raise ValueError('Restore-target role inventory unavailable')
    roles=set(role_result.stdout.decode().splitlines())
    role_sql,omitted=portable_roles(files['database/role.sql'],roles)
    started=time.monotonic()
    if operation=='restore':previous.update(status='restore_pending',snapshot_id=checkpoint['snapshot_id'],omitted_absent_provider_parameter_grants=omitted);save(previous)
    sql=b'\n'.join(('\\echo OPSPILOT_'+kind.upper()+'\n').encode()+(role_sql if kind=='role' else files['database/'+kind+'.sql']) for kind in ('role','schema','data'))
    if operation=='diagnose':
        # Role DDL is transactional; data exports may call non-transactional sequence setval().
        role_sql=b'\\echo OPSPILOT_ROLE\n'+files['database/role.sql']
        if any(marker in role_sql.lower() for marker in (b'setval(',b'nextval(',b'commit;',b'rollback;')):raise ValueError('Unexpected non-role transaction operation; no diagnostic executed')
        result=subprocess.run(psql+['-f','-'],input=b'BEGIN;\n'+role_sql+b'\nROLLBACK;\n',env=local,capture_output=True,timeout=180)
        previous.update(diagnostic_exit_code=result.returncode,diagnostic='role_only_rollback',**sql_failure(result.stdout,result.stderr));save(previous)
        print('Role-only rollback diagnostic: '+previous['failed_export']+'; SQLSTATE '+previous['sqlstate']+'; '+previous.get('connection_error','no connection error classified'))
        return
    result=subprocess.run(psql+['--single-transaction','-f','-'],input=sql,env=local,capture_output=True,timeout=180)
    if result.returncode:
        failure=sql_failure(result.stdout,result.stderr)
        safe=result.returncode==3 and failure['sqlstate']!='unknown' and 'connection_error' not in failure
        previous.update(status='restore_failed' if safe else 'restore_uncertain',client_exit_code=result.returncode,rollback_identified=safe,**failure);save(previous)
        raise ValueError('Supported managed database restore failed at '+previous['failed_export']+' (SQLSTATE '+previous['sqlstate']+'; '+previous.get('connection_error','no connection error classified')+'); SQL output withheld')
    previous['restore_sql_committed']=True;save(previous)
    restored=fingerprints(local);expected=json.loads(files['database/core-fingerprints.json'])
    # Provider migration bookkeeping is recreated by Supabase, not imported by its supported data-export recipe.
    excluded={'auth.schema_migrations','storage.migrations','supabase_functions.migrations'}
    application=lambda values:[v for v in values if v['relation'] not in excluded]
    matches={'application_data_match':application(restored['data'])==application(expected['data']),'security_match':restored['security']==expected['security']}
    previous.update(**matches,elapsed_restore_seconds=round(time.monotonic()-started,2),excluded_provider_bookkeeping=sorted(excluded),application_table_count=len(application(restored['data'])),source_archive_sha256=checkpoint['archive_sha256'])
    previous['status']='restore_verified' if all(matches.values()) else 'restore_failed';save(previous)
    if not all(matches.values()):raise ValueError('Managed restore fingerprint mismatch; no recovery PASS')
    print('Isolated managed Supabase database restore PASS: application/Auth/Storage data hashes and recorded security metadata match. No external mail/Cron/AI jobs were invoked.')

if __name__=='__main__':
    try:main()
    except Exception as e:
        print(str(e) if isinstance(e,ValueError) else 'Managed restore stopped; details withheld. Reconcile owned-target journal before retry.',file=sys.stderr);sys.exit(1)
