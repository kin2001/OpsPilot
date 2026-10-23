import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { attachmentRecord } from '../contracts/operational';
import type { Database } from '../lib/database.types';
import { domainError } from '../lib/domain-errors';
import { imageMetadataFor, PrivateImage, reserveRecordImage, uploadPrivateImage } from './private-attachments';
import { AppButton, ErrorNotice, LoadingNotice, SuccessNotice } from './ui';

const rowsSchema = z.array(attachmentRecord).max(10);
type FileIntent = { requestId: string; file: File; attachment: z.output<typeof attachmentRecord> | null };

export function RequestEvidence({ client, organizationId, userId, requestId, enabled }: {
  client: SupabaseClient<Database>; organizationId: string; userId: string; requestId: string; enabled: boolean;
}) {
  const queryClient = useQueryClient();
  const key = ['request-attachments', userId, organizationId, requestId] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const result = await client.from('attachments').select('*').eq('organization_id', organizationId).eq('request_id', requestId).eq('status', 'ready').order('created_at').limit(10).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      return rowsSchema.parse(result.data ?? []);
    },
  });
  const intent = useRef<FileIntent | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [reservation, setReservation] = useState<z.output<typeof attachmentRecord> | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const chooseFile = (file?: File) => {
    if (!file || intent.current) return;
    try {
      imageMetadataFor(file);
      const next = { requestId: crypto.randomUUID(), file, attachment: null };
      intent.current = next; setSelectedFile(file); setReservation(null); setError(''); setSuccess('');
    } catch (cause) { setError(domainError(cause).message); }
  };
  const upload = async () => {
    const current = intent.current;
    if (!current) return;
    setAttempted(true);
    setBusy(true); setError(''); setSuccess('');
    try {
      if (!current.attachment) {
        current.attachment = await reserveRecordImage(client, organizationId, 'request', requestId, current.file, current.requestId);
        setReservation(current.attachment);
      }
      await uploadPrivateImage(client, organizationId, current.attachment.id, current.file);
      intent.current = null; setSelectedFile(null); setReservation(null); setAttempted(false); setSuccess('Private request image uploaded and validated.');
      await queryClient.invalidateQueries({ queryKey: key });
    } catch (cause) {
      const code = domainError(cause).code;
      setError(`${domainError(cause).message}${code === 'DEPENDENCY_UNAVAILABLE' || code === 'RATE_LIMITED' ? ' Retry uses the same request and attachment identity.' : ''}`);
      if (code !== 'DEPENDENCY_UNAVAILABLE' && code !== 'RATE_LIMITED' && !current.attachment) {
        intent.current = null; setSelectedFile(null); setAttempted(false);
      }
    } finally { setBusy(false); }
  };

  return <section className="operation-section request-evidence" aria-labelledby={`request-evidence-${requestId}`}>
    <h3 id={`request-evidence-${requestId}`}>Private request images</h3>
    <p className="field-hint">Images are private and require current workspace authorization to retrieve.</p>
    {query.isPending ? <LoadingNotice label="Loading authorized request images…" /> : query.isError ? <ErrorNotice>Request images are unavailable.</ErrorNotice> : query.data.length ? query.data.map((attachment) => <PrivateImage key={attachment.id} client={client} organizationId={organizationId} userId={userId} attachment={attachment} />) : <p className="field-hint">No private images are recorded.</p>}
    {enabled && <div className="form-stack"><label className="field" htmlFor={`request-file-${requestId}`}><span>Choose an image</span><input id={`request-file-${requestId}`} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || Boolean(intent.current)} onChange={(event) => chooseFile(event.currentTarget.files?.[0])} /><span className="field-hint">JPEG, PNG or WebP, up to 5 MB. A pending retry locks the file to the original request.</span></label>
      {selectedFile && <div className="record-card"><strong>{selectedFile.name}</strong>{reservation && <p className="field-hint">Reservation {reservation.status}; retry targets the same attachment ID.</p>}{error && <ErrorNotice>{error}</ErrorNotice>}{success && <SuccessNotice>{success}</SuccessNotice>}<AppButton disabled={busy} onClick={() => void upload()}>{busy ? 'Uploading…' : attempted ? 'Retry same image upload' : 'Upload private image'}</AppButton></div>}
      {!selectedFile && error && <ErrorNotice>{error}</ErrorNotice>}
    </div>}
  </section>;
}
