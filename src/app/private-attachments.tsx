import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { attachmentRecord, imageMetadata } from '../contracts/operational';
import type { Database } from '../lib/database.types';
import { domainError } from '../lib/domain-errors';
import { ErrorNotice } from './ui';
import { contextFor } from './commands';
import { createPrivateImageLifecycle } from './private-image-lifecycle';

const reservationResult = z.strictObject({ data: attachmentRecord, version: z.number().int().positive(), request_id: z.uuid() });
const functionError = z.strictObject({ code: z.string() });
const maxImageBytes = 5 * 1024 * 1024;

export function imageMetadataFor(file: File) {
  try {
    return imageMetadata.parse({ name: file.name, media_type: file.type, size: file.size });
  } catch {
    throw new Error('VALIDATION');
  }
}

async function authenticatedRequest(client: SupabaseClient<Database>, path: string, init: RequestInit = {}) {
  const { data, error } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) throw new Error('UNAUTHENTICATED');
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) throw new Error('DEPENDENCY_UNAVAILABLE');
  try {
    return await fetch(`${url.replace(/\/$/, '')}/functions/v1/attachment-upload${path}`, {
      ...init,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, apikey: key, ...(init.headers ?? {}) },
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new Error('DEPENDENCY_UNAVAILABLE');
  }
}

async function responseError(response: Response): Promise<never> {
  const body: unknown = await response.json().catch(() => null);
  const parsed = functionError.safeParse(body);
  throw new Error(domainError(parsed.success ? { message: parsed.data.code } : null).code);
}

export async function reserveRecordImage(client: SupabaseClient<Database>, organizationId: string, parentType: 'asset' | 'request', parentId: string, file: File, requestId: string) {
  const metadata = imageMetadataFor(file);
  const response = await authenticatedRequest(client, '', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ctx: contextFor(organizationId, requestId), parent_type: parentType, parent_id: parentId, ...metadata }),
  });
  if (!response.ok) return responseError(response);
  const parsed = reservationResult.safeParse(await response.json().catch(() => null));
  if (!parsed.success || parsed.data.request_id !== requestId) throw new Error('DEPENDENCY_UNAVAILABLE');
  return parsed.data.data;
}

export async function reserveWorkOrderImage(client: SupabaseClient<Database>, organizationId: string, workOrderId: string, file: File, requestId: string) {
  const metadata = imageMetadataFor(file);
  const response = await authenticatedRequest(client, '', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ctx: contextFor(organizationId, requestId), id: workOrderId, ...metadata }),
  });
  if (!response.ok) return responseError(response);
  const parsed = reservationResult.safeParse(await response.json().catch(() => null));
  if (!parsed.success || parsed.data.request_id !== requestId) throw new Error('DEPENDENCY_UNAVAILABLE');
  return parsed.data.data;
}

export async function uploadPrivateImage(client: SupabaseClient<Database>, organizationId: string, attachmentId: string, file: File, signal?: AbortSignal) {
  const metadata = imageMetadataFor(file);
  const query = new URLSearchParams({ organization_id: organizationId, attachment_id: attachmentId });
  const response = await authenticatedRequest(client, `?${query}`, {
    method: 'PUT',
    headers: { 'Content-Type': metadata.media_type },
    body: file,
    signal,
  });
  if (!response.ok) return responseError(response);
  const parsed = attachmentRecord.safeParse(await response.json().catch(() => null));
  if (!parsed.success || parsed.data.id !== attachmentId || parsed.data.status !== 'ready') throw new Error('DEPENDENCY_UNAVAILABLE');
  return parsed.data;
}

async function readBounded(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('DEPENDENCY_UNAVAILABLE');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > maxImageBytes) {
        await reader.cancel();
        throw new Error('DEPENDENCY_UNAVAILABLE');
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function downloadPrivateImage(client: SupabaseClient<Database>, organizationId: string, attachment: z.output<typeof attachmentRecord>, signal?: AbortSignal) {
  if (attachment.status !== 'ready') throw new Error('NOT_FOUND');
  const query = new URLSearchParams({ organization_id: organizationId, attachment_id: attachment.id });
  const response = await authenticatedRequest(client, `?${query}`, { method: 'GET', signal });
  if (!response.ok) return responseError(response);
  if (response.headers.get('Content-Type')?.split(';')[0] !== attachment.media_type) throw new Error('DEPENDENCY_UNAVAILABLE');
  return new Blob([await readBounded(response)], { type: attachment.media_type });
}

export function PrivateImage({ client, organizationId, userId, attachment }: {
  client: SupabaseClient<Database>;
  organizationId: string;
  userId: string;
  attachment: z.output<typeof attachmentRecord>;
}) {
  const [image, setImage] = useState<{ key: string; source: string } | null>(null);
  const [error, setError] = useState('');
  const imageKey = `${organizationId}:${userId}:${attachment.id}:${attachment.status}`;
  useEffect(() => {
    const controller = new AbortController();
    const lifecycle = createPrivateImageLifecycle();
    setImage(null);
    setError('');
    void downloadPrivateImage(client, organizationId, attachment, controller.signal).then((blob) => {
      const source = lifecycle.createSource(blob);
      if (source) setImage({ key: imageKey, source });
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(domainError(cause).message);
    });
    return () => {
      controller.abort();
      lifecycle.dispose();
    };
  }, [attachment, client, imageKey, organizationId]);

  if (attachment.status !== 'ready') return <p className="field-hint">{attachment.status === 'pending' ? 'Image is still processing.' : 'Image is unavailable.'}</p>;
  if (error) return <ErrorNotice>{error}</ErrorNotice>;
  if (!image || image.key !== imageKey) return <p className="field-hint" role="status">Loading private image…</p>;
  return <img className="private-image" src={image.source} alt={attachment.name} />;
}
