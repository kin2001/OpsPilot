// Library invoked only after the recovery rehearsal verifies the actual job-owned service target.
export async function reconcileAttachments(client) {
  const batch = await client.rpc('attachment_cleanup_batch');
  if (batch.error || !Array.isArray(batch.data)) throw new Error('Orphan admission failed');
  let cleaned = 0;
  for (const item of batch.data) {
    if (!/^[0-9a-f-]{36}$/.test(item.id) || typeof item.object_key !== 'string' || !item.object_key.endsWith(`/${item.id}`)) throw new Error('Invalid cleanup reference');
    const removed = await client.storage.from('repair-evidence').remove([item.object_key]);
    if (removed.error) throw new Error('Orphan removal remains pending');
    const acknowledged = await client.rpc('attachment_cleanup_done', { attachment_id: item.id });
    if (acknowledged.error) throw new Error('Orphan acknowledgment remains pending');
    cleaned++;
  }
  return cleaned;
}
