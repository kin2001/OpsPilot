import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { assistantMessage, assistantRequest, type AssistantRequest, type AssistantResult } from '../contracts/assistant';
import { domainError } from '../lib/domain-errors';
import { askAssistant, deleteAssistantConversation, getAssistantMessages, listAssistantConversations } from './assistant-client';
import { createWorkOrder, validateCreateWorkOrderFields } from './commands';
import { useWorkspace } from './workspace';
import { AppButton, ErrorNotice, Field, LoadingNotice, PageHeader, SelectField, TextAreaField } from './ui';
import '../styles/assistant.css';

const modes = [
  { value: 'draft', label: 'Draft work order' },
  { value: 'priority', label: 'Priority suggestion' },
  { value: 'operations', label: 'Operations question' },
  { value: 'asset_history', label: 'Asset history' },
  { value: 'daily_brief', label: 'Daily brief' },
] as const;
type AssistantMode = typeof modes[number]['value'];

const queries = [
  { value: 'blocked_work_orders', label: 'Blocked work orders' },
  { value: 'completed_work', label: 'Completed work' },
  { value: 'overdue_work', label: 'Overdue work' },
  { value: 'awaiting_parts', label: 'Work awaiting parts' },
  { value: 'asset_history', label: 'Work-order history for an asset' },
  { value: 'daily_metrics', label: 'Daily metrics' },
  { value: 'recurring_fault_counts', label: 'Recurring fault counts' },
] as const;
type QueryKind = typeof queries[number]['value'];
type DraftFields = { title: string; problem: string; category: string; priority: 'low' | 'normal' | 'high' | 'critical'; criticalReason: string; assetId: string };
type AssistantMessage = z.infer<typeof assistantMessage>;
type DraftState = DraftFields & { messageId: string };
type CreateIntent = { messageId: string; requestId: string; assetId: string; fields: Omit<DraftFields, 'assetId'> };
type AssistantSource = AssistantResult['retrieval']['sources'][number];

function localDate(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(value: string, days: number) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

function conversationDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(value));
}

function sourceDate(value: string | null, timeZone: string) {
  return value ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone }).format(new Date(value)) : 'Date not recorded';
}

function assistantFailure(error: unknown) {
  const code = error instanceof Error && ['AI_DISABLED', 'AI_BUSY', 'AI_QUOTA', 'AI_REQUEST_REUSED', 'AI_HISTORY_LIMIT', 'AI_TIMEOUT', 'AI_UNAVAILABLE', 'FORBIDDEN', 'UNAUTHENTICATED', 'VALIDATION'].includes(error.message)
    ? error.message
    : domainError(error).code;
  const messages: Record<string, string> = {
    AI_DISABLED: 'Assistant features are disabled for this workspace. Your prompt is still here.',
    AI_BUSY: 'Assistant is busy. Your prompt is still here; no automatic retry was sent.',
    AI_QUOTA: 'The assistant usage limit was reached. Your prompt is still here; no automatic retry was sent.',
    AI_REQUEST_REUSED: 'This request was already submitted. Your prompt is still here; a new explicit request uses a new identity.',
    AI_HISTORY_LIMIT: 'Saved Assistant history is full. Delete a conversation before starting another request.',
    AI_TIMEOUT: 'The request timed out. Your prompt is still here; no automatic retry was sent.',
    AI_UNAVAILABLE: 'Assistant is unavailable. Your prompt is still here; continue manually or try a new explicit request later.',
    FORBIDDEN: 'Your current role or workspace cannot access that data. Your prompt is still here.',
    UNAUTHENTICATED: 'Your session needs attention. Your prompt is still here.',
    VALIDATION: 'Check your prompt, calendar range, and selected asset. Your prompt is still here.',
  };
  return messages[code] ?? messages.AI_UNAVAILABLE!;
}

function workOrderFailure(error: unknown) {
  const code = domainError(error).code;
  const uncertain = code === 'DEPENDENCY_UNAVAILABLE' || code === 'RATE_LIMITED';
  return {
    uncertain,
    message: uncertain
      ? 'The save result is uncertain. Retry the same reviewed values with the original request ID.'
      : code === 'VALIDATION'
        ? 'Review the required fields. Critical priority needs a recorded reason.'
        : 'The work order was not confirmed. Your reviewed draft remains available; check your access and try again.',
  };
}

function draftFrom(message: AssistantMessage): DraftState | null {
  if (message.role !== 'assistant' || !message.result.draft) return null;
  return {
    messageId: message.id,
    title: message.result.draft.title,
    problem: message.result.draft.reported_problem,
    category: message.result.draft.category,
    priority: message.result.draft.suggested_priority ?? 'normal',
    criticalReason: '',
    assetId: '',
  };
}

function factsScope(scope: AssistantResult['retrieval']['facts']['scope']) {
  return scope === 'current_authorized_work'
    ? 'Counts cover the current work visible to your role.'
    : 'These counts cover only the records returned for your current access.';
}

function sourceLink(source: AssistantSource) {
  return `/work-orders?workOrder=${encodeURIComponent(source.id)}`;
}

export function AssistantPage() {
  const { client, user, organization, role } = useWorkspace();
  const navigate = useNavigate();
  const coordinator = ['owner', 'manager', 'supervisor'].includes(role);
  const inventory = role === 'inventory';
  const canUseAssistant = coordinator || role === 'technician' || inventory;
  const allowedModes = coordinator ? modes : inventory ? modes.filter((mode) => mode.value === 'operations') : modes.filter((mode) => ['operations', 'asset_history', 'daily_brief'].includes(mode.value) && role === 'technician');
  const [mode, setMode] = useState<AssistantMode>('operations');
  const [queryKind, setQueryKind] = useState<QueryKind>(inventory ? 'awaiting_parts' : 'blocked_work_orders');
  const today = localDate(organization.timezone);
  const [from, setFrom] = useState(() => addDays(today, -6));
  const [to, setTo] = useState(() => addDays(today, 1));
  const [assetId, setAssetId] = useState('');
  const [category, setCategory] = useState('');
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [conversations, setConversations] = useState<{ id: string; created_at: string }[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationCursor, setConversationCursor] = useState<string | null>(null);
  const [messageCursor, setMessageCursor] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [assistantError, setAssistantError] = useState('');
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [createIntent, setCreateIntent] = useState<CreateIntent | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState('');
  const [deleteBusyId, setDeleteBusyId] = useState('');
  const historyLoadSequence = useRef(0);
  const fallbackPath = role === 'technician' ? '/requests' : inventory ? '/inventory' : '/work-orders';

  const authorizedAssets = useQuery({
    queryKey: ['assistant-assets', user.id, organization.id, role],
    enabled: queryKind === 'asset_history',
    queryFn: async ({ signal }) => {
      const result = await client.from('assets').select('id,code,name').eq('organization_id', organization.id).order('name').limit(100).abortSignal(signal);
      if (result.error) throw new Error('DEPENDENCY_UNAVAILABLE');
      return result.data;
    },
  });

  useEffect(() => {
    let active = true;
    setHistoryLoading(true);
    setHistoryError('');
    void listAssistantConversations(client, organization.id).then((page) => {
      if (!active) return;
      setConversations(page.items);
      setConversationCursor(page.next_cursor);
    }).catch(() => {
      if (active) setHistoryError('Saved conversations are unavailable with the current workspace access.');
    }).finally(() => {
      if (active) setHistoryLoading(false);
    });
    return () => { active = false; };
  }, [client, organization.id, user.id]);

  const availableQueries = inventory
    ? queries.filter((query) => query.value === 'awaiting_parts')
    : mode === 'asset_history'
      ? queries.filter((query) => query.value === 'asset_history')
      : mode === 'daily_brief'
        ? queries.filter((query) => query.value === 'daily_metrics')
        : queries;

  const changeMode = (next: AssistantMode) => {
    setMode(next);
    if (next === 'asset_history') setQueryKind('asset_history');
    else if (next === 'daily_brief') { setQueryKind('daily_metrics'); setFrom(today); setTo(addDays(today, 1)); }
    setAssistantError('');
  };

  const refreshConversations = async () => {
    try {
      const page = await listAssistantConversations(client, organization.id);
      setConversations(page.items);
      setConversationCursor(page.next_cursor);
      setHistoryError('');
    } catch {
      setHistoryError('The answer was saved, but the conversation list could not be refreshed.');
    }
  };

  const openConversation = async (id: string) => {
    if (assistantBusy || createIntent) return;
    const sequence = ++historyLoadSequence.current;
    setConversationId(id);
    setMessages([]);
    setMessageCursor(null);
    setPrompt('');
    setDraft(null);
    setAssistantError('');
    setHistoryError('');
    setConversationLoading(true);
    try {
      const page = await getAssistantMessages(client, organization.id, id);
      if (sequence !== historyLoadSequence.current) return;
      setMessages(page.items);
      setMessageCursor(page.next_cursor);
      const latestDraft = [...page.items].reverse().find((message) => message.role === 'assistant' && message.result.draft !== null);
      setDraft(latestDraft ? draftFrom(latestDraft) : null);
    } catch {
      if (sequence === historyLoadSequence.current) setHistoryError('This conversation is unavailable under your current workspace access.');
    } finally {
      if (sequence === historyLoadSequence.current) setConversationLoading(false);
    }
  };

  const newConversation = () => {
    if (assistantBusy || createIntent) return;
    historyLoadSequence.current++;
    setConversationId(null);
    setMessages([]);
    setMessageCursor(null);
    setPrompt('');
    setDraft(null);
    setAssistantError('');
    setCreateError('');
    setHistoryError('');
    setConversationLoading(false);
  };

  const loadMoreConversations = async () => {
    if (!conversationCursor || historyLoadingMore) return;
    setHistoryLoadingMore(true);
    setHistoryError('');
    try {
      const page = await listAssistantConversations(client, organization.id, conversationCursor);
      setConversations((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setConversationCursor(page.next_cursor);
    } catch {
      setHistoryError('More conversations could not be loaded. Your current view is unchanged.');
    } finally {
      setHistoryLoadingMore(false);
    }
  };

  const loadMoreMessages = async () => {
    if (!conversationId || !messageCursor || conversationLoading) return;
    setConversationLoading(true);
    setHistoryError('');
    const sequence = ++historyLoadSequence.current;
    try {
      const page = await getAssistantMessages(client, organization.id, conversationId, messageCursor);
      if (sequence !== historyLoadSequence.current) return;
      setMessages((current) => [...current, ...page.items]);
      setMessageCursor(page.next_cursor);
    } catch {
      if (sequence === historyLoadSequence.current) setHistoryError('More messages could not be loaded. Your current view is unchanged.');
    } finally {
      if (sequence === historyLoadSequence.current) setConversationLoading(false);
    }
  };

  const removeConversation = async (id: string) => {
    if (createIntent || assistantBusy || deleteBusyId || !window.confirm('Delete this saved conversation and its messages?')) return;
    setDeleteBusyId(id);
    setHistoryError('');
    try {
      await deleteAssistantConversation(client, organization.id, id);
      setConversations((current) => current.filter((conversation) => conversation.id !== id));
      if (conversationId === id) {
        historyLoadSequence.current++;
        setConversationId(null);
        setMessages([]);
        setMessageCursor(null);
        setDraft(null);
      }
    } catch {
      setHistoryError('The conversation was not deleted. Check your access and try again.');
    } finally {
      setDeleteBusyId('');
    }
  };

  const ask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (assistantBusy || conversationLoading || createIntent || !canUseAssistant) return;
    setAssistantError('');
    setHistoryError('');
    const request: AssistantRequest = {
      organization_id: organization.id,
      request_id: crypto.randomUUID(),
      ...(conversationId ? { conversation_id: conversationId } : {}),
      mode,
      prompt,
      query: {
        kind: queryKind,
        range: { from, to },
        ...(queryKind === 'asset_history' ? { asset_id: assetId, ...(category.trim() ? { category: category.trim() } : {}) } : {}),
      },
    };
    const parsed = assistantRequest.safeParse(request);
    if (!parsed.success) {
      setAssistantError(parsed.error.issues.some((issue) => issue.path.includes('asset_id'))
        ? 'Choose an authorized asset before asking about its history.'
        : 'Enter a question and a valid calendar range of 1 to 366 days.');
      return;
    }
    setAssistantBusy(true);
    try {
      if (conversationId && messageCursor) {
        setConversationLoading(true);
        try {
          const page = await getAssistantMessages(client, organization.id, conversationId, messageCursor);
          setMessages((current) => [...current, ...page.items]);
          setMessageCursor(page.next_cursor);
          if (page.next_cursor) {
            setHistoryError('More saved messages remain. Load them before asking a follow-up; your question was not sent.');
            return;
          }
        } catch {
          setHistoryError('The remaining saved messages could not be loaded. Your follow-up was not sent; your question is still here.');
          return;
        } finally {
          setConversationLoading(false);
        }
      }
      const result = await askAssistant(client, parsed.data);
      const createdAt = new Date().toISOString();
      const userMessage: AssistantMessage = { id: crypto.randomUUID(), created_at: createdAt, role: 'user', prompt, result: null };
      const responseMessage: AssistantMessage = { id: crypto.randomUUID(), created_at: new Date().toISOString(), role: 'assistant', prompt: null, result };
      setMessages((current) => [...current, userMessage, responseMessage]);
      setConversationId(result.conversation_id);
      if (result.draft) setDraft(draftFrom(responseMessage));
      setPrompt('');
      void refreshConversations();
    } catch (cause) {
      setAssistantError(assistantFailure(cause));
    } finally {
      setAssistantBusy(false);
    }
  };

  const reviewDraft = (message: AssistantMessage) => {
    if (createIntent || message.role !== 'assistant') return;
    setDraft(draftFrom(message));
    setCreateError('');
  };

  const editDraft = (field: keyof DraftFields, value: string) => {
    setDraft((current) => current ? { ...current, [field]: value } as DraftState : current);
  };

  const saveDraft = async (event: FormEvent<HTMLFormElement>, message: AssistantMessage) => {
    event.preventDefault();
    if (createBusy || message.role !== 'assistant' || !message.result.draft || !draft || draft.messageId !== message.id) return;
    let intent = createIntent;
    if (!intent) {
      const validated = validateCreateWorkOrderFields({
        title: draft.title,
        description: draft.problem,
        category: draft.category,
        priority: draft.priority,
        ...(draft.priority === 'critical' ? { critical_reason: draft.criticalReason } : {}),
        supervisor_id: user.id,
      });
      if (!validated.success) {
        setCreateError('Enter a nonblank title, problem description and category. Critical priority needs a reason. No work order was sent.');
        return;
      }
      intent = {
        messageId: message.id,
        requestId: message.result.confirmation.request_id,
        assetId: draft.assetId,
        fields: {
          title: validated.data.title,
          problem: validated.data.description,
          category: validated.data.category,
          priority: validated.data.priority,
          criticalReason: validated.data.critical_reason ?? '',
        },
      };
    }
    if (!intent.assetId) { setCreateError('Choose a current asset before creating the draft.'); return; }
    setCreateIntent(intent);
    setCreateBusy(true);
    setCreateError('');
    try {
      const created = await createWorkOrder(client, organization.id, intent.assetId, {
        title: intent.fields.title,
        description: intent.fields.problem,
        category: intent.fields.category,
        priority: intent.fields.priority,
        ...(intent.fields.priority === 'critical' ? { critical_reason: intent.fields.criticalReason } : {}),
        supervisor_id: user.id,
      }, intent.requestId);
      setCreateIntent(null);
      navigate(`/work-orders?workOrder=${encodeURIComponent(created.id)}`);
    } catch (cause) {
      const failure = workOrderFailure(cause);
      setCreateError(failure.message);
      if (!failure.uncertain) setCreateIntent(null);
    } finally {
      setCreateBusy(false);
    }
  };

  const showsAsset = queryKind === 'asset_history';

  return <>
    <PageHeader eyebrow="Operations" title="Operations assistant" description="Ask about authorized maintenance records, prepare an editable work-order draft, or review a daily brief." />
    {!canUseAssistant ? <section className="panel"><h2>Assistant access unavailable</h2><p>Your current workspace role cannot use Assistant. Continue with your usual workflow.</p><Link className="button button--secondary" to={fallbackPath}>Continue manually</Link></section> : <div className="assistant-layout">
      <aside className="panel assistant-history" aria-label="Recent conversations">
        <div className="assistant-history__heading"><div><p className="page-kicker">Your history</p><h2>Recent conversations</h2></div><AppButton variant="secondary" disabled={assistantBusy || Boolean(createIntent)} onClick={newConversation}>New conversation</AppButton></div>
        {historyError && <ErrorNotice>{historyError}</ErrorNotice>}
        {historyLoading ? <LoadingNotice label="Loading your conversations…" /> : conversations.length === 0 ? <p className="field-hint">Saved conversations appear here after a successful answer.</p> : <ol className="assistant-history__list">
          {conversations.map((conversation) => {
            const label = conversationDate(conversation.created_at, organization.timezone);
            return <li className="assistant-history__item" key={conversation.id}>
              <button type="button" className="assistant-history__open" aria-label={`Open conversation created ${label}`} aria-current={conversationId === conversation.id ? 'true' : undefined} disabled={assistantBusy || Boolean(createIntent) || conversationLoading} onClick={() => void openConversation(conversation.id)}>
                <span>{label}</span><small>{conversationId === conversation.id ? 'Selected' : 'Open conversation'}</small>
              </button>
              <AppButton variant="quiet" className="assistant-history__delete" aria-label="Delete conversation" disabled={Boolean(createIntent) || assistantBusy || deleteBusyId === conversation.id} onClick={() => void removeConversation(conversation.id)}>{deleteBusyId === conversation.id ? 'Deleting…' : 'Delete'}</AppButton>
            </li>;
          })}
        </ol>}
        {conversationCursor && <AppButton variant="secondary" className="assistant-history__more" disabled={historyLoadingMore} onClick={() => void loadMoreConversations()}>{historyLoadingMore ? 'Loading…' : 'Load more conversations'}</AppButton>}
        <p className="assistant-history__privacy">History is scoped to your account and the current workspace. You can delete a conversation at any time.</p>
      </aside>

      <section className="assistant-workspace" aria-label="Assistant conversation">
        <div className="panel assistant-thread">
          <div className="assistant-thread__heading"><div><p className="page-kicker">{conversationId ? 'Saved conversation' : 'New conversation'}</p><h2>{conversationId ? 'Authorized record answers' : 'Start a conversation'}</h2></div>{conversationId && <AppButton variant="quiet" disabled={assistantBusy || Boolean(createIntent)} onClick={newConversation}>New</AppButton>}</div>
          {conversationLoading && messages.length === 0 ? <LoadingNotice label="Loading this conversation…" /> : messages.length === 0 ? <p className="assistant-empty">Your answers will show their database facts, uncertainty, and authorized source records here.</p> : <ol className="assistant-messages">
            {messages.map((message) => message.role === 'user' ? <li className="assistant-message assistant-message--user" key={message.id}><p className="page-kicker">Your question</p><p>{message.prompt}</p></li> : <li className="assistant-message assistant-message--answer" key={message.id}>
              <article>
                <p className="page-kicker">Assistant suggestion · review before acting</p>
                <p className="assistant-answer">{message.result.answer}</p>
                <p className="assistant-uncertainty"><strong>Uncertainty:</strong> {message.result.uncertainty}</p>
                <p className="assistant-provider">Provider {message.result.provider.name} · Model {message.result.provider.model}{message.result.provider.response_id ? ` · Response ${message.result.provider.response_id}` : ''}</p>
                <section className="assistant-facts" aria-label="Database facts">
                  <h3>Database facts</h3>
                  <p className="assistant-facts__scope">{factsScope(message.result.retrieval.facts.scope)} Range: {message.result.retrieval.range.from} to {message.result.retrieval.range.to} (exclusive). Retrieved {sourceDate(message.result.retrieval.retrieved_at, organization.timezone)}.</p>
                  <dl className="assistant-facts__grid">
                    <div><dt>Matching work orders</dt><dd>{message.result.retrieval.facts.matching_work_orders}</dd></div>
                    <div><dt>Completed</dt><dd>{message.result.retrieval.facts.completed}</dd></div>
                    <div><dt>Blocked</dt><dd>{message.result.retrieval.facts.blocked}</dd></div>
                    <div><dt>Overdue</dt><dd>{message.result.retrieval.facts.overdue}</dd></div>
                  </dl>
                  {message.result.retrieval.facts.recurring_fault_counts.length > 0 && <ul className="assistant-recurring-facts">{message.result.retrieval.facts.recurring_fault_counts.map((fault) => <li key={`${fault.asset_id}:${fault.category}`}>Asset {fault.asset_id} · {fault.category}: {fault.recorded_work_orders} recorded work orders</li>)}</ul>}
                </section>
                {message.result.retrieval.truncated && <p className="assistant-truncated" role="status">This answer uses a limited sample of matching records. Narrow the date range or filters before relying on it.</p>}
                {message.result.retrieval.sources.length > 0 && <section className="assistant-sources" aria-label="Authorized source records">
                  <h3>Authorized source records</h3>
                  <ul>{message.result.retrieval.sources.map((source) => <li key={source.id}>
                    <div className="assistant-source__heading"><Link to={sourceLink(source)}>{source.label}</Link><span>{message.result.source_ids.includes(source.id) ? 'Cited' : 'Retrieved'}</span></div>
                    <p>{source.category} · {source.status} · {sourceDate(source.occurred_at, organization.timezone)}</p>
                    {source.note && <p className="assistant-source__note">{source.note}</p>}
                  </li>)}</ul>
                </section>}
                {message.result.draft && <section className="assistant-draft" aria-label="Suggested work-order draft">
                  {message.result.confirmation.allowed && coordinator ? <>
                    <div className="assistant-draft__heading"><div><p className="page-kicker">AI suggestion</p><h3>Suggested work-order draft</h3></div><span>Review required</span></div>
                    <p className="assistant-draft__reasoning">{message.result.draft.reasoning_summary}</p>
                    {draft && draft.messageId === message.id ? <form className="form-stack assistant-draft__form" onSubmit={(event) => void saveDraft(event, message)}>
                      {createError && <ErrorNotice>{createError}</ErrorNotice>}
                      <SelectField id={`assistant-asset-${message.id}`} label="Choose a current asset" required disabled={createBusy || Boolean(createIntent)} value={draft.assetId} onChange={(event) => editDraft('assetId', event.target.value)}><option value="">Choose an asset after reviewing the candidates</option>{message.result.draft.asset_candidates.map((asset) => <option key={asset.id} value={asset.id}>{asset.label}</option>)}</SelectField>
                      {message.result.draft.asset_candidates.length === 0 && <p className="field-hint">No authorized asset candidate was returned. Choose a current asset in the manual work-order form.</p>}
                      <Field id={`assistant-title-${message.id}`} label="Draft title" required maxLength={200} disabled={createBusy || Boolean(createIntent)} value={draft.title} onChange={(event) => editDraft('title', event.target.value)} />
                      <TextAreaField id={`assistant-problem-${message.id}`} label="Problem description" required maxLength={4000} disabled={createBusy || Boolean(createIntent)} value={draft.problem} onChange={(event) => editDraft('problem', event.target.value)} />
                      <div className="assistant-draft__fields"><Field id={`assistant-category-${message.id}`} label="Category" required maxLength={100} disabled={createBusy || Boolean(createIntent)} value={draft.category} onChange={(event) => editDraft('category', event.target.value)} /><SelectField id={`assistant-priority-${message.id}`} label="Priority" disabled={createBusy || Boolean(createIntent)} value={draft.priority} onChange={(event) => editDraft('priority', event.target.value as DraftFields['priority'])}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></SelectField></div>
                      {draft.priority === 'critical' && <TextAreaField id={`assistant-critical-reason-${message.id}`} label="Critical priority reason" required maxLength={2000} disabled={createBusy || Boolean(createIntent)} value={draft.criticalReason} onChange={(event) => editDraft('criticalReason', event.target.value)} hint="This reason is saved with the priority. It does not change asset availability." />}
                      <p className="assistant-draft__disclaimer">Nothing is created until you confirm. The work order remains a draft.</p>
                      <AppButton type="submit" disabled={createBusy || !draft.assetId}>{createBusy ? 'Saving…' : createIntent ? 'Retry save draft' : 'Create draft work order'}</AppButton>
                    </form> : <div className="assistant-draft__summary"><strong>{message.result.draft.title}</strong><p>{message.result.draft.reported_problem}</p><p>Suggested priority: {message.result.draft.suggested_priority ?? 'Not known'}</p><AppButton variant="secondary" disabled={Boolean(createIntent)} onClick={() => reviewDraft(message)}>Review draft</AppButton></div>}
                  </> : <><h3>Suggested draft · no direct confirmation</h3><p>This suggestion cannot create a work order under your current role. Continue through the authorized manual workflow.</p><Link className="button button--secondary" to={fallbackPath}>Continue manually</Link></>}
                </section>}
              </article>
            </li>)}
          </ol>}
          {messageCursor && <AppButton variant="secondary" disabled={conversationLoading} onClick={() => void loadMoreMessages()}>{conversationLoading ? 'Loading…' : 'Load newer messages'}</AppButton>}
          {conversationLoading && messages.length > 0 && <LoadingNotice label="Loading more conversation history…" />}
        </div>

        <section className="panel assistant-compose" aria-label="Ask the assistant">
          <h2>Ask about authorized records</h2>
          {assistantError && <ErrorNotice>{assistantError}</ErrorNotice>}
          {showsAsset && authorizedAssets.isError && <ErrorNotice>Authorized assets could not be loaded. Check your workspace access before asking about asset history.</ErrorNotice>}
          <form className="form-stack" onSubmit={(event) => void ask(event)}>
            <div className="assistant-compose__fields">
              <SelectField id="assistant-mode" label="Assistant mode" value={mode} disabled={assistantBusy || Boolean(createIntent)} onChange={(event) => changeMode(event.target.value as AssistantMode)}>{allowedModes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</SelectField>
              <SelectField id="assistant-query" label="Record query" value={queryKind} disabled={assistantBusy || Boolean(createIntent)} onChange={(event) => { setQueryKind(event.target.value as QueryKind); setAssistantError(''); }}>{availableQueries.map((query) => <option key={query.value} value={query.value}>{query.label}</option>)}</SelectField>
            </div>
            {showsAsset && <div className="assistant-compose__fields">
              <SelectField id="assistant-history-asset" label="Asset" required disabled={authorizedAssets.isPending || authorizedAssets.isError || assistantBusy || Boolean(createIntent)} value={assetId} onChange={(event) => setAssetId(event.target.value)}><option value="">Choose an authorized asset</option>{(authorizedAssets.data ?? []).map((asset) => <option key={asset.id} value={asset.id}>{asset.code} · {asset.name}</option>)}</SelectField>
              <Field id="assistant-history-category" label="Optional category" maxLength={100} disabled={assistantBusy || Boolean(createIntent)} value={category} onChange={(event) => setCategory(event.target.value)} />
            </div>}
            <div className="assistant-compose__fields assistant-compose__fields--range">
              <Field id="assistant-range-from" label={`From · ${organization.timezone}`} type="date" required disabled={assistantBusy || Boolean(createIntent)} value={from} onChange={(event) => setFrom(event.target.value)} />
              <Field id="assistant-range-to" label="To (exclusive)" type="date" required disabled={assistantBusy || Boolean(createIntent)} value={to} onChange={(event) => setTo(event.target.value)} hint="Uses workspace calendar dates; the end date is not included." />
            </div>
            <TextAreaField id="assistant-prompt" label="Your question" required maxLength={4000} rows={3} disabled={assistantBusy || Boolean(createIntent)} value={prompt} onChange={(event) => setPrompt(event.target.value)} hint="Use only information relevant to your current work. Notes and prompts are treated as untrusted text." />
            <div className="assistant-compose__actions"><AppButton type="submit" disabled={assistantBusy || Boolean(createIntent) || conversationLoading || !prompt.trim() || (showsAsset && (authorizedAssets.isPending || authorizedAssets.isError))}>{assistantBusy ? 'Checking authorized records…' : 'Ask assistant'}</AppButton><Link className="button button--secondary" to={fallbackPath}>Continue manually</Link></div>
            <p className="assistant-compose__privacy">No AI feature can approve, release equipment, change stock, or manage membership. A suggested work order needs your review and explicit confirmation.</p>
          </form>
        </section>
      </section>
    </div>}
  </>;
}
