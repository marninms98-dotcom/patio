// ════════════════════════════════════════════════════════════
// Microsoft Graph API Client
//
// OAuth2 client credentials flow (app-only) for email monitoring.
// Singleton client with cached token. Delta sync support.
// ════════════════════════════════════════════════════════════

import { Client } from '@microsoft/microsoft-graph-client';
import { ClientSecretCredential } from '@azure/identity';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { acquireLock, releaseLock, getCache, setCache } from '../../utils/redis.js';

let _graphClient: Client | null = null;
let _credential: ClientSecretCredential | null = null;
let _sb: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_sb) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    _sb = createClient(url, key);
  }
  return _sb;
}

function getCredential(): ClientSecretCredential {
  if (!_credential) {
    const tenantId = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;
    if (!tenantId || !clientId || !clientSecret) {
      throw new Error('AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET must be set');
    }
    _credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  }
  return _credential;
}

export interface GraphMessage {
  id: string;
  subject: string;
  bodyPreview: string;
  body: { contentType: string; content: string };
  from: { emailAddress: { name: string; address: string } };
  toRecipients: Array<{ emailAddress: { name: string; address: string } }>;
  ccRecipients?: Array<{ emailAddress: { name: string; address: string } }>;
  receivedDateTime: string;
  sentDateTime: string;
  conversationId?: string;
  isRead: boolean;
  hasAttachments: boolean;
}

export interface Subscription {
  id: string;
  resource: string;
  changeType: string;
  expirationDateTime: string;
}

/**
 * Get an OAuth2 access token. Uses Redis mutex to prevent concurrent refreshes.
 */
export async function getAccessToken(): Promise<string> {
  // Check cache first
  const cached = await getCache<string>('graph_access_token');
  if (cached) return cached;

  // Acquire lock to prevent concurrent token refreshes
  const lockAcquired = await acquireLock('graph_token_refresh', 10_000);
  if (!lockAcquired) {
    // Another process is refreshing — wait and retry cache
    await new Promise((r) => setTimeout(r, 2000));
    const retried = await getCache<string>('graph_access_token');
    if (retried) return retried;
    throw new Error('Could not acquire Graph token refresh lock');
  }

  try {
    const credential = getCredential();
    const tokenResponse = await credential.getToken('https://graph.microsoft.com/.default');
    if (!tokenResponse?.token) throw new Error('Failed to get Graph access token');

    // Cache for 50 minutes (tokens last 60 min)
    await setCache('graph_access_token', tokenResponse.token, 50 * 60 * 1000);
    return tokenResponse.token;
  } finally {
    await releaseLock('graph_token_refresh');
  }
}

/**
 * Get an authenticated Microsoft Graph client (singleton).
 */
export function getGraphClient(): Client {
  if (!_graphClient) {
    _graphClient = Client.init({
      authProvider: async (done) => {
        try {
          const token = await getAccessToken();
          done(null, token);
        } catch (err) {
          done(err as Error, null);
        }
      },
    });
  }
  return _graphClient;
}

/**
 * List recent messages from a mailbox.
 */
export async function listMessages(
  mailbox: string,
  since?: Date,
): Promise<GraphMessage[]> {
  const client = getGraphClient();
  let request = client
    .api(`/users/${mailbox}/messages`)
    .top(50)
    .select('id,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,conversationId,isRead,hasAttachments')
    .orderby('receivedDateTime desc');

  if (since) {
    request = request.filter(`receivedDateTime ge ${since.toISOString()}`);
  }

  const response = await request.get();
  return response.value || [];
}

/**
 * Get a single message by ID.
 */
export async function getMessage(
  mailbox: string,
  messageId: string,
): Promise<GraphMessage> {
  const client = getGraphClient();
  return client
    .api(`/users/${mailbox}/messages/${messageId}`)
    .select('id,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,conversationId,isRead,hasAttachments')
    .get();
}

/**
 * Create a Graph webhook subscription for new emails.
 */
export async function createSubscription(
  mailbox: string,
  webhookUrl: string,
): Promise<Subscription> {
  const client = getGraphClient();
  const sb = getSupabase();

  const expiry = new Date();
  expiry.setHours(expiry.getHours() + 48); // Max 4230 minutes for mail

  const subscription = await client.api('/subscriptions').post({
    changeType: 'created',
    notificationUrl: webhookUrl,
    resource: `/users/${mailbox}/messages`,
    expirationDateTime: expiry.toISOString(),
    clientState: process.env.GRAPH_WEBHOOK_SECRET || '',
  });

  // Store subscription state
  await sb.from('email_sync_state').upsert({
    mailbox,
    subscription_id: subscription.id,
    subscription_expiry: subscription.expirationDateTime,
    last_sync_at: new Date().toISOString(),
  }, { onConflict: 'mailbox' });

  return subscription;
}

/**
 * Renew an existing subscription before it expires.
 * Falls back to creating a new subscription if renewal fails (e.g. 404 expired).
 */
export async function renewSubscription(
  subscriptionId: string,
  mailbox: string,
  webhookUrl: string,
): Promise<void> {
  const client = getGraphClient();
  const sb = getSupabase();

  try {
    const expiry = new Date();
    expiry.setHours(expiry.getHours() + 48);

    await client.api(`/subscriptions/${subscriptionId}`).patch({
      expirationDateTime: expiry.toISOString(),
    });

    await sb
      .from('email_sync_state')
      .update({ subscription_expiry: expiry.toISOString() })
      .eq('subscription_id', subscriptionId);
  } catch (err) {
    console.warn(`Subscription renewal failed for ${subscriptionId}, creating new:`, (err as Error).message);
    await createSubscription(mailbox, webhookUrl);
  }
}

/**
 * Get messages since last delta sync. Uses delta tokens from email_sync_state.
 */
export async function getDeltaMessages(
  mailbox: string,
): Promise<{ messages: GraphMessage[]; deltaToken: string }> {
  const client = getGraphClient();
  const sb = getSupabase();

  // Get stored delta token
  const { data: syncState } = await sb
    .from('email_sync_state')
    .select('delta_token')
    .eq('mailbox', mailbox)
    .single();

  let url: string;
  if (syncState?.delta_token) {
    url = syncState.delta_token; // Delta token IS the next URL
  } else {
    url = `/users/${mailbox}/mailFolders/inbox/messages/delta`;
  }

  const allMessages: GraphMessage[] = [];
  let nextDeltaToken = '';

  // Page through delta results
  let response = await client.api(url).get();
  allMessages.push(...(response.value || []));

  while (response['@odata.nextLink']) {
    response = await client.api(response['@odata.nextLink']).get();
    allMessages.push(...(response.value || []));
  }

  // Store the delta link for next sync
  if (response['@odata.deltaLink']) {
    nextDeltaToken = response['@odata.deltaLink'];
    await sb.from('email_sync_state').upsert({
      mailbox,
      delta_token: nextDeltaToken,
      last_sync_at: new Date().toISOString(),
    }, { onConflict: 'mailbox' });
  }

  return { messages: allMessages, deltaToken: nextDeltaToken };
}
