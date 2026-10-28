"""Bounded pre-change checkpoint; secrets and plaintext exports stay in memory."""
import datetime
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tarfile
import urllib.parse
import urllib.request
from backup_runtime import ROOT, ready, restic, environment, version_bytes
from capture_opspilot_checkpoint import TOOLS, SOURCE, ACCEPTED_HEAD, command, go_list, package
from provision_opspilot import dedicated_token, database_password, EXPECTED_ORG
from managed_restore_opspilot import inventory, SOURCE_REF
from hosted_smoke_runtime import read_project_keys, verify_private_directory
from connect_opspilot_b2 import BUCKET_ID

RECEIPT=ROOT/'.spec-team/reports/por47-populated-prechange-checkpoint.json'
SCHEMAS=('public','private','auth','storage','supabase_migrations')

def validate_objects(rows):
    if len(rows)>128:raise ValueError('Pre-change object-count guard exceeded')
    total=0
    for row in rows:
        key=row['name']
        if row['bucket_id']!='repair-evidence' or not key or any(p in ('','..','.') for p in key.split('/')) or '\\' in key or ':' in key:raise ValueError('Unexpected Storage object identity')
        size=row.get('size')
        if type(size) is not int or not 0<size<=5242880 or not re.fullmatch('[a-f0-9]{64}',row.get('checksum') or ''):raise ValueError('Object lacks bounded ready checksum')
        total+=size
    if total>10*1024*1024:raise ValueError('Pre-change Storage transfer guard exceeded')

def main():
    if RECEIPT.exists():raise ValueError('Existing checkpoint outcome must be reconciled; no duplicate upload')
    verify_private_directory(ROOT/'.spec-team/local/credentials')
    backup_env,authorization=ready()
    connected=json.loads((ROOT/'.spec-team/local/supabase-opspilot-state/connected.json').read_text(encoding='utf-8-sig'))
    if connected.get('profile')!='opspilot' or connected.get('organization_id')!=EXPECTED_ORG:raise ValueError('Dedicated profile binding mismatch')
    token=dedicated_token()
    def api(path):
        req=urllib.request.Request('https://api.supabase.com/v1/'+path,headers={'Authorization':'Bearer '+token})
        with urllib.request.urlopen(req,timeout=30) as r:return json.load(r)
    orgs=api('organizations')
    if len(orgs)!=1 or orgs[0]['id']!=EXPECTED_ORG:raise ValueError('Dedicated organization mismatch')
    lab=json.loads((ROOT/'.spec-team/reports/por47-managed-restore-target.json').read_text())
    projects=api('projects');inventory(projects,None if lab.get('status')=='removed' else lab)
    source=next(p for p in projects if p['id']==SOURCE_REF)
    if source.get('status')!='ACTIVE_HEALTHY':raise ValueError('Source not healthy')
    if command(['git','-C',str(SOURCE),'rev-parse','HEAD']).decode().strip()!=ACCEPTED_HEAD or command(['git','-C',str(SOURCE),'status','--porcelain']):raise ValueError('Accepted baseline source changed')
    config={path:api('projects/'+SOURCE_REF+'/'+path) for path in ('config/auth','ssl-enforcement','config/database/pooler','functions')}
    poolers=config['config/database/pooler']
    if len(poolers)!=1 or poolers[0].get('db_host')!='aws-0-ap-southeast-1.pooler.supabase.com' or poolers[0].get('db_user')!='postgres.'+SOURCE_REF:raise ValueError('Dedicated pooler mismatch')
    values=read_project_keys()
    env=environment(os.environ,'unused','unused','unused');env={k:v for k,v in env.items() if not k.startswith(('AWS_','RESTIC_'))}
    env.update(PGHOST=poolers[0]['db_host'],PGPORT='5432',PGUSER=poolers[0]['db_user'],PGDATABASE='postgres',PGPASSWORD=database_password(),PGSSLMODE='verify-full',PGSSLROOTCERT=str(TOOLS/'supabase-prod-ca-2021.crt'),PGCONNECT_TIMEOUT='15',PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=180000')
    env['PATH']=str(TOOLS/'pgsql/bin')+';C:/Program Files/Git/usr/bin;C:/Windows/System32'
    psql=[str(TOOLS/'pgsql/bin/psql.exe'),'-X','-q','-A','-t','-v','ON_ERROR_STOP=1']
    holder=subprocess.Popen(psql,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    files={}
    try:
        holder.stdin.write(b'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();\n');holder.stdin.flush()
        snapshot=holder.stdout.readline().decode().strip()
        if not re.fullmatch('[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9]+',snapshot):raise ValueError('Snapshot export failed')
        def query(sql):
            return json.loads(command(psql+['-c',"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '"+snapshot+"'; "+sql+'; COMMIT;'],env))
        history=query("SELECT coalesce(json_agg(t ORDER BY version),'[]') FROM (SELECT version,name,statements FROM supabase_migrations.schema_migrations)t")
        from deploy_opspilot import pending_migrations
        migrations=[]
        for path in sorted((SOURCE/'supabase/migrations').glob('*.sql')):
            version,name=path.stem.split('_',1);migrations.append((version,name,path.read_text(encoding='utf-8')))
        if len(history)!=17 or pending_migrations(migrations,history):raise ValueError('Pre-change history must match all 17 accepted migrations exactly')
        object_sql="SELECT coalesce(json_agg(t ORDER BY bucket_id,name),'[]') FROM (SELECT o.bucket_id,o.name,a.size,a.checksum FROM storage.objects o LEFT JOIN public.attachments a ON a.object_key=o.name AND a.status='ready')t"
        objects=query(object_sql);validate_objects(objects)
        env.update(EXTRA_SED='',INCLUDED_SCHEMAS='*',RESERVED_ROLES=go_list('reservedRoles'),ALLOWED_CONFIGS=go_list('allowedConfigs'))
        for kind in ('role','schema','data'):
            env['EXCLUDED_SCHEMAS']=go_list('InternalSchemas' if kind=='schema' else 'excludedSchemas')
            env['EXTRA_FLAGS']='' if kind=='role' else '--snapshot='+snapshot
            if kind=='data':env['EXTRA_FLAGS']+=' --exclude-table=storage.buckets_vectors --exclude-table=storage.vector_indexes'
            files['database/'+kind+'.sql']=command(['C:/Program Files/Git/bin/bash.exe','--noprofile','--norc',str(TOOLS/('dump_'+kind+'.sh'))],env,180)
        args=[str(TOOLS/'pgsql/bin/pg_dump.exe'),'--no-password','--format=custom','--snapshot='+snapshot]
        for schema in SCHEMAS:args+=['--schema='+schema]
        files['database/operational.dump']=command(args,env,180)
        files['database/migration-history.json']=json.dumps(history).encode()
        tables=query("SELECT json_agg(json_build_array(schemaname,tablename) ORDER BY schemaname,tablename) FROM pg_tables WHERE schemaname IN ('public','private','auth','storage','supabase_migrations')")
        facts=[]
        for schema,table in tables:
            if not re.fullmatch('[a-z_][a-z0-9_]*',schema) or not re.fullmatch('[a-z_][a-z0-9_]*',table):raise ValueError('Unexpected table identifier')
            facts.append(query('SELECT json_build_object(\'relation\',\''+schema+'.'+table+'\',\'rows\',count(*),\'sha256\',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,chr(10) ORDER BY to_jsonb(t)::text),\'\'),\'UTF8\')),\'hex\')) FROM "'+schema+'"."'+table+'" t'))
        files['database/row-fingerprints.json']=json.dumps(facts).encode()
        for row in objects:
            url='https://'+SOURCE_REF+'.supabase.co/storage/v1/object/authenticated/repair-evidence/'+urllib.parse.quote(row['name'],safe='/')
            req=urllib.request.Request(url,headers={'Authorization':'Bearer '+values['service_role'],'apikey':values['service_role']})
            with urllib.request.urlopen(req,timeout=30) as r:data=r.read(row['size']+1)
            if len(data)!=row['size'] or hashlib.sha256(data).hexdigest()!=row['checksum']:raise ValueError('Storage bytes differ from snapshotted ready checksum')
            files['storage/repair-evidence/'+row['name']]=data
        files['storage/inventory.json']=json.dumps(objects).encode()
        current=json.loads(command(psql+['-c',object_sql],env))
        if current!=objects:raise ValueError('Storage inventory changed during capture')
        holder.stdin.write(b'ROLLBACK;\n\\q\n');holder.stdin.flush();holder.communicate(timeout=20)
        if holder.returncode:raise ValueError('Snapshot session failed')
    finally:
        if holder.poll() is None:holder.kill();holder.communicate(timeout=10)
    files['configuration/hosted.json']=json.dumps({'project':source,'configuration':config}).encode()
    paths=command(['git','-C',str(SOURCE),'ls-files','supabase/config.toml','supabase/migrations','supabase/functions']).decode().splitlines()
    for name in paths:files['source/'+name]=(SOURCE/name).read_bytes()
    now=datetime.datetime.now(datetime.timezone.utc).isoformat()
    blob,manifest=package(files,{'project_ref':SOURCE_REF,'organization_id':EXPECTED_ORG,'source_head':ACCEPTED_HEAD,'created_at':now,'storage_object_count':len(objects),'consistency':'Shared exported PostgreSQL snapshot; immutable ready blob checksum and before/after inventory; hosted configuration read separately'})
    storage=authorization['apiInfo']['storageApi']
    req=urllib.request.Request(storage['apiUrl']+'/b2api/v4/b2_list_file_versions',data=json.dumps({'bucketId':BUCKET_ID,'prefix':'opspilot/','maxFileCount':1000}).encode(),headers={'Authorization':authorization['authorizationToken'],'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=30) as r:versions=json.load(r)
    if versions.get('nextFileId') or versions.get('nextFileName') or version_bytes(versions['files'])+len(blob)>100*1024*1024:raise ValueError('Pre-change B2 capacity guard exceeded')
    receipt={'status':'upload_pending','project_ref':SOURCE_REF,'source_head':ACCEPTED_HEAD,'created_at':now,'archive_bytes':len(blob),'archive_sha256':hashlib.sha256(blob).hexdigest(),'storage_object_count':len(objects),'database_restore_verified':False}
    def save():RECEIPT.write_text(json.dumps(receipt,indent=2)+'\n')
    save()
    output=restic(backup_env,['backup','--stdin','--stdin-filename','opspilot-populated-prechange.tar','--host','opspilot-backup','--tag','populated-prechange','--json'],blob)
    summaries=[v for line in output.splitlines() if (v:=json.loads(line)).get('message_type')=='summary']
    if len(summaries)!=1 or not summaries[0].get('snapshot_id'):raise ValueError('Upload outcome requires reconciliation')
    receipt.update(status='uploaded_encrypted',snapshot_id=summaries[0]['snapshot_id']);save()
    restic(backup_env,['check','--read-data'])
    recovered=restic(backup_env,['dump',receipt['snapshot_id'],'/opspilot-populated-prechange.tar'])
    if recovered!=blob:raise ValueError('Recovered archive differs')
    with tarfile.open(fileobj=io.BytesIO(recovered)) as tar:
        if set(tar.getnames())!=set(files)|{'manifest.json'}:raise ValueError('Recovered inventory differs')
        for name,data in files.items():
            if tar.extractfile(name).read()!=data:raise ValueError('Recovered member differs')
    receipt.update(status='encrypted_upload_and_archive_recovery_verified',restic_read_data_check='PASS');save()
    print('Populated pre-change checkpoint encrypted and recovered byte-for-byte; isolated populated restore remains pending.')

if __name__=='__main__':
    try:main()
    except Exception:
        print('Populated checkpoint stopped; raw credential/database output withheld. Reconcile any saved receipt before retry.',file=sys.stderr);sys.exit(1)
