-- Storage resolves object metadata before serving authenticated bytes.
alter policy evidence_download on storage.objects using (
  (storage.allow_only_operation('object.get_authenticated') or storage.allow_only_operation('object.get_authenticated_info'))
  and bucket_id='repair-evidence'
  and exists (
    select 1 from public.attachments a
    where a.object_key=storage.objects.name and a.status='ready'
      and private.can_read_attachment(a.organization_id,a.work_order_id,a.asset_id,a.request_id,a.inspection_assignment_id)
  )
);
