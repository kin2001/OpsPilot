import datetime as dt
import io
import json
import tarfile
import unittest
from unittest.mock import patch
import cloud_runner as c

class CloudBoundary(unittest.TestCase):
    def env(self):return {'GITHUB_ACTIONS':'true','GITHUB_REPOSITORY':'kin2001/OpsPilot','GITHUB_REF':'refs/heads/main','GITHUB_EVENT_NAME':'schedule','GITHUB_SHA':'a'*40,'OPSPILOT_APPROVED_OPERATOR_SHA':'a'*40,'OPSPILOT_CLOUD_ENABLED':'true','GITHUB_RUN_ID':'123'}
    def test_trusted_default_branch_and_explicit_exact_source_only(self):
        c.check_host(self.env(),dt.datetime(2026,10,28,tzinfo=dt.timezone.utc))
        for key,value in [('GITHUB_REPOSITORY','other/repo'),('GITHUB_REF','refs/heads/feature'),('GITHUB_EVENT_NAME','pull_request'),('GITHUB_SHA','b'*40),('OPSPILOT_CLOUD_ENABLED','false'),('GITHUB_RUN_ID','')]:
            with self.assertRaises(ValueError):c.check_host({**self.env(),key:value},dt.datetime(2026,10,28,tzinfo=dt.timezone.utc))
        with self.assertRaises(ValueError):c.check_host(self.env(),dt.datetime(2026,11,3,tzinfo=dt.timezone.utc))
    def test_fixed_source_pooler_tls(self):
        good=[{'db_host':'aws-0-ap-southeast-1.pooler.supabase.com','db_user':'postgres.lhlizmdhxjspnxadtzsm'}]
        c.check_pooler(good)
        for rows in [[],good+good,[{**good[0],'db_user':'postgres.other'}]]:
            with self.assertRaises(ValueError):c.check_pooler(rows)
    def test_expired_backup_can_alert_but_unapproved_code_cannot(self):
        after_expiry=dt.datetime(2026,11,3,tzinfo=dt.timezone.utc)
        with self.assertRaises(ValueError):c.check_host(self.env(),after_expiry)
        c.check_host(self.env(),after_expiry,backup=False)
        with self.assertRaises(ValueError):c.check_host({**self.env(),'GITHUB_SHA':'b'*40},after_expiry,backup=False)
    def test_archive_member_checksums_identity_and_traversal(self):
        data=b'payload';manifest={'project_ref':c.SOURCE,'organization_id':c.ORG,'source_head':c.BACKEND_HEAD,'snapshot_started_at':'2026-10-28T00:00:00+00:00','files':{'safe.txt':{'bytes':len(data),'sha256':c.digest(data)}}}
        def pack(name='safe.txt',value=data):
            output=io.BytesIO()
            with tarfile.open(fileobj=output,mode='w') as tar:
                for path,body in [('manifest.json',json.dumps(manifest).encode()),(name,value)]:
                    item=tarfile.TarInfo(path);item.size=len(body);tar.addfile(item,io.BytesIO(body))
            return output.getvalue()
        self.assertEqual(c.verify_recovered(pack())['project_ref'],c.SOURCE)
        for blob in [pack(value=b'changed'),pack('../safe.txt')]:
            with self.assertRaises(ValueError):c.verify_recovered(blob)
    def test_email_and_archive_limits_fail_closed(self):
        c.check_email('test@example.com')
        for value in ['test','a@example.com\nBcc:x@example.com','x y@example.com']:
            with self.assertRaises(ValueError):c.check_email(value)
        with self.assertRaises(ValueError):c.verify_recovered(b'x'*(20*1024*1024+1))
    def test_smtp_uses_verified_git_bundle_on_both_windows_layouts(self):
        for prefix in ('ucrt64','mingw64'):
            with patch.object(c.Path,'is_file',lambda path: prefix in path.parts), patch.object(c.ssl,'create_default_context') as create:
                c.smtp_context()
                self.assertIn(prefix,create.call_args.kwargs['cafile'])
        with patch.object(c.Path,'is_file',return_value=False), patch.object(c.ssl,'create_default_context') as create:
            with self.assertRaises(ValueError):c.smtp_context()
            create.assert_not_called()

if __name__=='__main__':unittest.main()
