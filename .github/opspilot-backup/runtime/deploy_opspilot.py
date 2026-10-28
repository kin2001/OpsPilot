"""Guarded deployment of the exact accepted OpsPilot backend. No resets or account fallback."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.request
from backup_runtime import ROOT,environment
from provision_opspilot import dedicated_token,database_password,EXPECTED_ORG
from managed_restore_opspilot import inventory,SOURCE_REF,sql_failure
from capture_opspilot_checkpoint import SOURCE,ACCEPTED_HEAD,TOOLS

RECEIPT=ROOT/'.spec-team/reports/por47-backend-deployment.json'
WORKTREE=ROOT/'.worktrees/por-28e'

def require_settled_migration(status):
    if status in ('pending','uncertain'):
        raise ValueError('Prior migration outcome needs explicit reconciliation before any further write')

def pending_migrations(files,history):
    if len(history)>len(files):raise ValueError('Remote migration history exceeds accepted source')
    for index,row in enumerate(history):
        version,name,sql=files[index]
        if row.get('version')!=version or row.get('name')!=name or row.get('statements')!=[sql]:
            raise ValueError('Migration history is not an exact immutable accepted prefix; no writes')
    return files[len(history):]

def main():
    if sys.argv[1:] not in (['inspect'],['migrate'],['functions'],['auth-config']):raise ValueError('Unsupported backend operation')
    operation=sys.argv[1]
    sys.path.insert(0,str(ROOT/'.agents/skills/spec-team/scripts'))
    from ownership import check_owner
    check_owner(ROOT,'19ab78eb-4f61-4f39-b958-408aa8192e21','78cac194-cc65-48a2-a1d1-2e184895e696')
    if json.loads((ROOT/'.spec-team/run.json').read_text())['stop_requested']:raise ValueError('Owner stop active')
    connected=json.loads((ROOT/'.spec-team/local/supabase-opspilot-state/connected.json').read_text(encoding='utf-8-sig'))
    if connected.get('organization_id')!=EXPECTED_ORG or connected.get('profile')!='opspilot':raise ValueError('Dedicated profile binding mismatch')
    def git(args):
        r=subprocess.run(['git','-C',str(SOURCE),*args],capture_output=True,text=True,timeout=20)
        if r.returncode:raise ValueError('Accepted source inspection failed')
        return r.stdout.strip()
    if git(['rev-parse','HEAD'])!=ACCEPTED_HEAD or git(['status','--porcelain']):raise ValueError('Accepted source changed or is dirty')
    token=dedicated_token()
    def api(path,body=None,method=None):
        req=urllib.request.Request('https://api.supabase.com/v1/'+path,data=None if body is None else json.dumps(body).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},method=method or ('GET' if body is None else 'POST'))
        try:
            with urllib.request.urlopen(req,timeout=45) as r:
                b=r.read();return json.loads(b) if b else None
        except urllib.error.HTTPError as e:raise ValueError('Dedicated provider refused operation (HTTP '+str(e.code)+'); no fallback') from None
    organizations=api('organizations')
    if len(organizations)!=1 or organizations[0]['id']!=EXPECTED_ORG or api('organizations/'+EXPECTED_ORG).get('plan')!='free':raise ValueError('Exact dedicated Free organization required')
    lab=json.loads((ROOT/'.spec-team/reports/por47-managed-restore-target.json').read_text())
    projects=api('projects');inventory(projects,None if lab.get('status')=='removed' else lab)
    source=next(p for p in projects if p['id']==SOURCE_REF)
    if source['status']!='ACTIVE_HEALTHY':raise ValueError('Bound source backend is not healthy')
    poolers=api('projects/'+SOURCE_REF+'/config/database/pooler')
    if len(poolers)!=1 or poolers[0].get('db_host')!='aws-0-ap-southeast-1.pooler.supabase.com' or poolers[0].get('db_user')!='postgres.'+SOURCE_REF:raise ValueError('Bound source pooler mismatch')
    bound=ROOT/'.spec-team/local/credentials/por47-opspilot-db-password.dpapi'
    if not bound.exists():raise ValueError('Bound source password unavailable; no generation')
    env=environment(os.environ,'unused','unused','unused');env={k:v for k,v in env.items() if not k.startswith(('AWS_','RESTIC_'))}
    env.update(PGHOST=poolers[0]['db_host'],PGPORT='5432',PGUSER='postgres.'+SOURCE_REF,PGDATABASE='postgres',PGPASSWORD=database_password(),PGSSLMODE='verify-full',PGSSLROOTCERT=str(TOOLS/'supabase-prod-ca-2021.crt'),PGCONNECT_TIMEOUT='15',PGOPTIONS='-c statement_timeout=180000 -c lock_timeout=4000')
    psql=[str(TOOLS/'pgsql/bin/psql.exe'),'-X','-A','-t','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate']
    def query(sql):
        qenv={**env,'PGOPTIONS':env['PGOPTIONS']+' -c default_transaction_read_only=on'}
        r=subprocess.run(psql+['-c',sql],env=qenv,capture_output=True,timeout=40)
        if r.returncode:raise ValueError('Read-only source inspection failed; database details withheld')
        return json.loads(r.stdout)
    exists=query("SELECT to_json(to_regclass('supabase_migrations.schema_migrations') IS NOT NULL)")
    history=query("SELECT coalesce(json_agg(t ORDER BY version),'[]') FROM (SELECT version,name,statements FROM supabase_migrations.schema_migrations) t") if exists else []
    files=[]
    for path in sorted((SOURCE/'supabase/migrations').glob('*.sql')):
        match=re.fullmatch(r'(\d{14})_(.+)\.sql',path.name)
        if not match:raise ValueError('Unexpected migration filename')
        files.append((match[1],match[2],path.read_text(encoding='utf-8')))
    if len(files)!=17:raise ValueError('Accepted migration count differs from reviewed source')
    pending=pending_migrations(files,history)
    summary={'project_ref':SOURCE_REF,'organization_id':EXPECTED_ORG,'source_head':ACCEPTED_HEAD,'migration_count':len(history),'pending_count':len(pending),'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'migration_files':{version+'_'+name+'.sql':hashlib.sha256(sql.encode()).hexdigest() for version,name,sql in files}}
    previous=json.loads(RECEIPT.read_text()) if RECEIPT.exists() else {}
    def save(values):
        previous.update(values);RECEIPT.write_text(json.dumps(previous,indent=2)+'\n')
    if operation=='inspect':
        save(summary);print('Bound backend inspected: '+str(len(history))+' applied migrations; '+str(len(pending))+' accepted migrations pending.');return
    recovery=json.loads((ROOT/'.spec-team/reports/por47-managed-restore-target.json').read_text())
    if recovery.get('status') not in ('restore_verified','removed') or not recovery.get('application_data_match') or not recovery.get('security_match'):raise ValueError('Verified initial managed recovery checkpoint required')
    if operation=='migrate':
        if not pending:save({**summary,'migration_status':'applied_and_readback_verified'});print('All accepted migrations already applied; no write repeated.');return
        require_settled_migration(previous.get('migration_status'))
        if not history:
            counts=query("SELECT json_build_object('public_tables',(SELECT count(*) FROM pg_tables WHERE schemaname='public'),'users',(SELECT count(*) FROM auth.users),'objects',(SELECT count(*) FROM storage.objects))")
            if any(counts.values()):raise ValueError('Unexpected populated initial backend; no migrations')
        literal=lambda value:"'"+value.replace("'","''")+"'"
        sql="SET lock_timeout='4s'; CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text NOT NULL PRIMARY KEY,statements text[],name text);\n"
        for version,name,text in pending:
            sql+='\\echo OPSPILOT_MIGRATION_'+version+'\n'+text+'\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('+literal(version)+','+literal(name)+',ARRAY['+literal(text)+']::text[]);\n'
        save({**summary,'migration_status':'pending'})
        result=subprocess.run(psql+['--single-transaction','-f','-'],input=sql.encode(),env=env,capture_output=True,timeout=240)
        if result.returncode:
            markers=re.findall(rb'OPSPILOT_MIGRATION_(\d{14})',result.stdout)
            failure=sql_failure(b'',result.stderr)
            save({'migration_status':'failed' if result.returncode==3 and failure['sqlstate']!='unknown' else 'uncertain','client_exit_code':result.returncode,'sqlstate':failure['sqlstate'],'failed_migration':markers[-1].decode() if markers else 'initialization'})
            raise ValueError('Accepted migration transaction stopped; SQLSTATE '+failure['sqlstate']+'; inspect sanitized deployment receipt')
        actual=query("SELECT coalesce(json_agg(t ORDER BY version),'[]') FROM (SELECT version,name,statements FROM supabase_migrations.schema_migrations) t")
        if pending_migrations(files,actual):raise ValueError('Migration readback incomplete')
        counts=query("SELECT json_build_object('public_tables',(SELECT count(*) FROM pg_tables WHERE schemaname='public'),'private_tables',(SELECT count(*) FROM pg_tables WHERE schemaname='private'),'users',(SELECT count(*) FROM auth.users),'objects',(SELECT count(*) FROM storage.objects))")
        jobs=query("SELECT json_agg(json_build_object('jobname',jobname,'schedule',schedule,'active',active) ORDER BY jobname) FROM cron.job WHERE jobname LIKE 'opspilot-%'")
        save({'migration_status':'applied_and_readback_verified','migration_count':17,'pending_count':0,'postdeployment_counts':counts,'cron_jobs':jobs})
        print('All 17 accepted migrations applied atomically and exact history readback verified. No user/private pilot intake created.');return
    if pending:raise ValueError('Backend migrations must be complete before service configuration')
    if operation=='auth-config':
        values={'site_url':'https://opspilot.artkincarreon.site','uri_allow_list':'https://opspilot.artkincarreon.site/invite,https://opspilot.artkincarreon.site/reset-password','jwt_exp':3600,'password_min_length':12,'mailer_autoconfirm':False,'mailer_secure_email_change_enabled':True,'mfa_totp_enroll_enabled':True,'mfa_totp_verify_enabled':True}
        save({'auth_configuration_status':'pending'})
        api('projects/'+SOURCE_REF+'/config/auth',values,method='PATCH')
        actual=api('projects/'+SOURCE_REF+'/config/auth')
        if any(actual.get(k)!=v for k,v in values.items()):raise ValueError('Hosted Auth configuration readback mismatch')
        save({'auth_configuration_status':'verified','auth_configuration':values,'smtp_status':'not_configured_by_this_operation'})
        print('Hosted Auth password, confirmation, TOTP and exact origin/redirect configuration verified; SMTP delivery remains separate.');return
    if operation=='functions':
        config={'APP_ORIGIN':'https://opspilot.artkincarreon.site','INVITATION_EMAIL_ENABLED':'false','ASSISTANT_ENABLED':'false','ASSISTANT_SYNTHETIC_ENVIRONMENT':'false'}
        save({'function_configuration_status':'pending'})
        api('projects/'+SOURCE_REF+'/secrets',[{'name':k,'value':v} for k,v in config.items()])
        # API deployment uses the dedicated native profile, accepted source and no local Docker.
        cli=ROOT/'.worktrees/p1-core-maintenance/node_modules/@supabase/cli-windows-x64/bin/supabase.exe'
        child=environment(os.environ,'unused','unused','unused');child={k:v for k,v in child.items() if not k.startswith(('AWS_','RESTIC_'))}
        child['SUPABASE_HOME']=str(ROOT/'.spec-team/local/supabase-opspilot-state')
        common=[str(cli),'--profile',str(ROOT/'.spec-team/local/supabase-opspilot.yaml'),'--workdir',str(SOURCE),'functions','deploy']
        for name in ('organization-invite','attachment-upload','report-export','assistant'):
            result=subprocess.run([*common,name,'--project-ref',SOURCE_REF,'--use-api','--no-verify-jwt'],env=child,capture_output=True,timeout=150)
            if result.returncode:raise ValueError('Dedicated Edge deployment failed at '+name+'; output withheld; inspect actual provider function inventory before retry')
        actual=api('projects/'+SOURCE_REF+'/functions')
        selected={item.get('slug'):item for item in actual}
        for name in config_names:
            if name not in selected or selected[name].get('status')!='ACTIVE' or selected[name].get('verify_jwt') is not False:raise ValueError('Edge function metadata readback mismatch')
        save({'function_configuration_status':'verified','function_configuration':config,'functions':[{k:item.get(k) for k in ('slug','status','version','verify_jwt')} for item in actual]})
        print('Four accepted Edge functions deployed with handler authentication; exact origin set; invitation mail and private AI remain disabled.')

config_names=('organization-invite','attachment-upload','report-export','assistant')
if __name__=='__main__':
    try:main()
    except Exception as error:
        print(str(error) if isinstance(error,ValueError) else 'Backend operation stopped; details withheld; reconcile saved deployment receipt before retry.',file=sys.stderr);sys.exit(1)
