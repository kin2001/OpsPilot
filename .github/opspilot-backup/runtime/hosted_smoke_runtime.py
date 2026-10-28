"""Load only dedicated native OpsPilot secrets into the reviewed hosted-smoke child."""
import datetime
import base64
import ctypes
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.error
import urllib.request
from backup_runtime import ROOT,environment
from provision_opspilot import dedicated_token,database_password,EXPECTED_ORG
from managed_restore_opspilot import inventory,SOURCE_REF
from capture_opspilot_checkpoint import TOOLS
from connect_opspilot_b2 import Credential,w

def decode_project_key(username,payload,label):
    try:
        value=payload.decode('utf-16-le')
        parts=value.split('.')
        if username!=label or len(parts)!=3 or not all(parts):raise ValueError()
        claims=json.loads(base64.urlsafe_b64decode(parts[1]+'='*(-len(parts[1])%4)))
        if claims.get('ref')!=SOURCE_REF or claims.get('role')!=label:raise ValueError()
        return value
    except Exception:
        raise ValueError('Stored '+label+' entry must contain the matching OpsPilot legacy project API key; value withheld') from None

def read_project_keys():
    api=ctypes.WinDLL('Advapi32',use_last_error=True)
    api.CredReadW.argtypes=[w.LPCWSTR,w.DWORD,w.DWORD,ctypes.POINTER(ctypes.POINTER(Credential))]
    api.CredReadW.restype=w.BOOL
    api.CredFree.argtypes=[ctypes.c_void_p]
    values={}
    for label in ('anon','service_role'):
        target='OpsPilot Supabase:'+label
        credential=ctypes.POINTER(Credential)()
        if not api.CredReadW(target,1,0,ctypes.byref(credential)):
            raise ValueError('Dedicated manual key missing: '+target+'; no API or other-account fallback')
        try:
            values[label]=decode_project_key(credential.contents.UserName,ctypes.string_at(credential.contents.CredentialBlob,credential.contents.CredentialBlobSize),label)
        finally:
            api.CredFree(credential)
    # Embedded claims detect entry mix-ups only; Supabase validates the key signatures at the fixed project endpoint.
    return values

def settled_smoke(previous):
    if previous.get('status')=='PASS':return
    proof=previous.get('reconciliation',{})
    if previous.get('status')!='reconciled_retained' or previous.get('project')!=SOURCE_REF or proof.get('source_ref')!=SOURCE_REF or proof.get('run_id')!=previous.get('run_id') or proof.get('no_pending_mutations') is not True or proof.get('reviewer')!='independent Lens' or proof.get('retained_user_ids')!=[u['id'] for u in previous.get('users',[])]:
        raise ValueError('A prior synthetic smoke run needs exact fixture reconciliation before any retry')

def private_acl(value):
    expected={'sid':value.get('current_sid'),'rights':2032127,'control':'Allow','inherited':False,'inheritance':3,'propagation':0}
    if not value.get('current_sid') or value.get('owner_sid')!=value['current_sid'] or value.get('protected') is not True or value.get('rules')!=[expected]:
        raise ValueError('Protected journal directory must grant only the current native owner full control; no additional principals or inherited access')

def verify_private_directory(protected):
    script=r'''$ErrorActionPreference='Stop'; $p=[Console]::In.ReadToEnd(); $a=Get-Acl -LiteralPath $p;
$rules=@($a.Access | ForEach-Object { @{sid=$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value;rights=[int]$_.FileSystemRights;control=$_.AccessControlType.ToString();inherited=$_.IsInherited;inheritance=[int]$_.InheritanceFlags;propagation=[int]$_.PropagationFlags} });
@{current_sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;owner_sid=([Security.Principal.NTAccount]::new($a.Owner)).Translate([Security.Principal.SecurityIdentifier]).Value;protected=$a.AreAccessRulesProtected;rules=$rules} | ConvertTo-Json -Depth 5 -Compress'''
    pwsh=r'C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe'
    result=subprocess.run([pwsh,'-NoProfile','-NonInteractive','-Command',script],input=str(protected),capture_output=True,text=True,timeout=20)
    if result.returncode:raise ValueError('Native structured journal ACL inspection unavailable')
    private_acl(json.loads(result.stdout))

def main():
    sys.path.insert(0,str(ROOT/'.agents/skills/spec-team/scripts'))
    from ownership import check_owner
    check_owner(ROOT,'19ab78eb-4f61-4f39-b958-408aa8192e21','78cac194-cc65-48a2-a1d1-2e184895e696')
    if json.loads((ROOT/'.spec-team/run.json').read_text())['stop_requested']:raise ValueError('Owner stop active')
    connected=json.loads((ROOT/'.spec-team/local/supabase-opspilot-state/connected.json').read_text(encoding='utf-8-sig'))
    if connected.get('profile')!='opspilot' or connected.get('organization_id')!=EXPECTED_ORG:raise ValueError('Dedicated profile binding mismatch')
    candidate=json.loads((ROOT/'.spec-team/reports/por47-candidate-review.json').read_text())
    worktree=ROOT/'.worktrees/por-28e'
    for args,expected in [(['rev-parse','HEAD'],candidate['head']),(['rev-parse','HEAD^{tree}'],candidate['tree']),(['status','--porcelain'],'')]:
        r=subprocess.run(['git','-C',str(worktree),*args],capture_output=True,text=True,timeout=15)
        if r.returncode or r.stdout.strip()!=expected:raise ValueError('Reviewed hosted-smoke source changed; obtain independent review before secret delivery')
    if candidate.get('code_review')!='IndependentLensPASS':raise ValueError('Independent candidate review required')
    token=dedicated_token()
    def api(path):
        req=urllib.request.Request('https://api.supabase.com/v1/'+path,headers={'Authorization':'Bearer '+token})
        try:
            with urllib.request.urlopen(req,timeout=30) as response:return json.load(response)
        except urllib.error.HTTPError as error:raise ValueError('Dedicated hosted-smoke access refused (HTTP '+str(error.code)+'); reconnect only opspilot, no fallback') from None
    orgs=api('organizations')
    if len(orgs)!=1 or orgs[0]['id']!=EXPECTED_ORG:raise ValueError('Exact dedicated organization required')
    lab=json.loads((ROOT/'.spec-team/reports/por47-managed-restore-target.json').read_text())
    inventory(api('projects'),None if lab.get('status')=='removed' else lab)
    values=read_project_keys()
    protected=ROOT/'.spec-team/local/credentials'
    if protected.is_symlink():raise ValueError('Redirected protected credential directory rejected')
    verify_private_directory(protected)
    for path in protected.glob('hosted-smoke-*.json'):
        previous=json.loads(path.read_text())
        settled_smoke(previous)
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    journal=protected/('hosted-smoke-'+stamp+'.json')
    env=environment(os.environ,'unused','unused','unused');env={k:v for k,v in env.items() if not k.startswith(('AWS_','RESTIC_'))}
    env.update(OPSPILOT_PROJECT_REF=SOURCE_REF,OPSPILOT_ORGANIZATION_ID=EXPECTED_ORG,SUPABASE_URL='https://'+SOURCE_REF+'.supabase.co',OPSPILOT_MANAGEMENT_TOKEN=token,OPSPILOT_ANON_KEY=values['anon'],OPSPILOT_SERVICE_ROLE_KEY=values['service_role'],OPSPILOT_SMOKE_RECEIPT=str(journal),PGHOST='aws-0-ap-southeast-1.pooler.supabase.com',PGPORT='5432',PGUSER='postgres.'+SOURCE_REF,PGDATABASE='postgres',PGPASSWORD=database_password(),PGSSLMODE='verify-full',PGSSLROOTCERT=str(TOOLS/'supabase-prod-ca-2021.crt'),PGCONNECT_TIMEOUT='15')
    env['PATH']=str(TOOLS/'pgsql/bin')+';C:/Program Files/nodejs;C:/Windows/System32'
    result=subprocess.run(['C:/Program Files/nodejs/node.exe',str(worktree/'.github/hosted-smoke.mjs')],cwd=worktree,env=env,capture_output=True,timeout=300)
    if result.returncode:raise ValueError('Hosted smoke stopped; inspect its protected run journal before retry; raw secret-bearing child output withheld')
    try:summary=json.loads(result.stdout)
    except json.JSONDecodeError:raise ValueError('Hosted smoke returned unexpected output; inspect protected journal, no raw output printed') from None
    if summary.get('status')!='PASS':raise ValueError('Hosted smoke has no passing result')
    summary.update(head=candidate['head'],tree=candidate['tree'],protected_run_journal=str(journal))
    (ROOT/'.spec-team/reports/por47-authenticated-smoke.json').write_text(json.dumps(summary,indent=2)+'\n')
    print('Hosted authenticated smoke PASS; sanitized checks saved. Synthetic fixtures retained for populated recovery.')

if __name__=='__main__':
    try:main()
    except Exception as error:
        print(str(error) if isinstance(error,ValueError) else 'Hosted smoke launcher stopped; details withheld. Inspect protected run journal before retry.',file=sys.stderr);sys.exit(1)
