// ════════════════════════════════════════════════════════════
// SecureWorks — Send Quote Edge Function
//
// Sends a quote PDF to the client via email and provides
// a client-facing acceptance page.
//
// Deploy: supabase functions deploy send-quote
//
// Endpoints:
//   POST /send - Send quote email to client
//   GET  /view?token=xxx - Client views their quote
//   POST /accept?token=xxx - Client accepts quote
//   POST /decline?token=xxx - Client declines quote
// ════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') || 'quotes@secureworkswa.com.au'
const FROM_NAME = Deno.env.get('FROM_NAME') || 'SecureWorks WA'
const BASE_URL = Deno.env.get('PUBLIC_URL') || SUPABASE_URL

serve(async (req: Request) => {
  const url = new URL(req.url)
  const path = url.pathname.split('/').pop()

  // CORS
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  try {
    // ── SEND QUOTE EMAIL ──
    if (path === 'send' && req.method === 'POST') {
      const { document_id, client_email, client_name, message } = await req.json()

      if (!document_id || !client_email) {
        return jsonResponse({ error: 'document_id and client_email required' }, 400, corsHeaders)
      }

      // Get document record
      const { data: doc, error: docErr } = await sb
        .from('job_documents')
        .select('*, jobs(client_name, site_suburb, type)')
        .eq('id', document_id)
        .single()

      if (docErr || !doc) {
        return jsonResponse({ error: 'Document not found' }, 404, corsHeaders)
      }

      // Build client view URL
      const viewUrl = `${BASE_URL}/functions/v1/send-quote/view?token=${doc.share_token}`

      // Send email via Resend
      if (RESEND_API_KEY) {
        const emailHtml = buildQuoteEmail({
          clientName: client_name || doc.jobs?.client_name || 'there',
          viewUrl,
          pdfUrl: doc.pdf_url,
          projectType: doc.jobs?.type || 'project',
          suburb: doc.jobs?.site_suburb || '',
          customMessage: message || '',
        })

        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: `${FROM_NAME} <${FROM_EMAIL}>`,
            to: client_email,
            subject: `Your ${doc.jobs?.type || 'project'} quote from SecureWorks WA`,
            html: emailHtml,
          }),
        })

        if (!emailRes.ok) {
          const errData = await emailRes.json()
          throw new Error(`Email failed: ${JSON.stringify(errData)}`)
        }
      }

      // Mark as sent
      await sb
        .from('job_documents')
        .update({ sent_to_client: true, sent_at: new Date().toISOString() })
        .eq('id', document_id)

      // Update job status to quoted
      if (doc.job_id) {
        await sb
          .from('jobs')
          .update({ status: 'quoted', quoted_at: new Date().toISOString() })
          .eq('id', doc.job_id)
          .eq('status', 'draft') // only if still draft

        await sb.from('job_events').insert({
          job_id: doc.job_id,
          event_type: 'quote_sent',
          detail_json: { document_id, sent_to: client_email },
        })
      }

      return jsonResponse({ success: true, view_url: viewUrl }, 200, corsHeaders)
    }

    // ── CLIENT VIEWS QUOTE ──
    if (path === 'view' && req.method === 'GET') {
      const token = url.searchParams.get('token')
      if (!token) return htmlResponse(errorPage('Invalid link'))

      const { data: doc, error } = await sb
        .from('job_documents')
        .select('*, jobs(client_name, site_suburb, type, status)')
        .eq('share_token', token)
        .eq('sent_to_client', true)
        .single()

      if (error || !doc) return htmlResponse(errorPage('Quote not found or link has expired'))

      // Mark as viewed
      if (!doc.viewed_at) {
        await sb
          .from('job_documents')
          .update({ viewed_at: new Date().toISOString() })
          .eq('id', doc.id)

        if (doc.job_id) {
          await sb.from('job_events').insert({
            job_id: doc.job_id,
            event_type: 'quote_viewed',
            detail_json: { document_id: doc.id },
          })
        }
      }

      return htmlResponse(buildClientPage(doc, token))
    }

    // ── CLIENT ACCEPTS QUOTE ──
    if (path === 'accept' && req.method === 'POST') {
      const token = url.searchParams.get('token')
      if (!token) return jsonResponse({ error: 'Token required' }, 400, corsHeaders)

      const { data: doc, error } = await sb
        .from('job_documents')
        .select('*')
        .eq('share_token', token)
        .eq('sent_to_client', true)
        .single()

      if (error || !doc) return jsonResponse({ error: 'Quote not found' }, 404, corsHeaders)

      if (doc.accepted_at) return jsonResponse({ error: 'Already accepted' }, 400, corsHeaders)
      if (doc.declined_at) return jsonResponse({ error: 'Already declined' }, 400, corsHeaders)

      await sb
        .from('job_documents')
        .update({ accepted_at: new Date().toISOString() })
        .eq('id', doc.id)

      if (doc.job_id) {
        await sb
          .from('jobs')
          .update({ status: 'accepted', accepted_at: new Date().toISOString() })
          .eq('id', doc.job_id)

        await sb.from('job_events').insert({
          job_id: doc.job_id,
          event_type: 'quote_accepted',
          detail_json: { document_id: doc.id },
        })
      }

      return jsonResponse({ success: true, message: 'Quote accepted' }, 200, corsHeaders)
    }

    // ── CLIENT DECLINES QUOTE ──
    if (path === 'decline' && req.method === 'POST') {
      const token = url.searchParams.get('token')
      const body = await req.json().catch(() => ({}))

      if (!token) return jsonResponse({ error: 'Token required' }, 400, corsHeaders)

      const { data: doc, error } = await sb
        .from('job_documents')
        .select('*')
        .eq('share_token', token)
        .eq('sent_to_client', true)
        .single()

      if (error || !doc) return jsonResponse({ error: 'Quote not found' }, 404, corsHeaders)

      await sb
        .from('job_documents')
        .update({ declined_at: new Date().toISOString() })
        .eq('id', doc.id)

      if (doc.job_id) {
        await sb.from('job_events').insert({
          job_id: doc.job_id,
          event_type: 'quote_declined',
          detail_json: { document_id: doc.id, reason: body.reason || '' },
        })
      }

      return jsonResponse({ success: true, message: 'Quote declined' }, 200, corsHeaders)
    }

    return jsonResponse({ error: 'Not found' }, 404, corsHeaders)

  } catch (err) {
    console.error('Send-quote error:', err)
    return jsonResponse({ error: err.message || 'Internal error' }, 500, corsHeaders)
  }
})

// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════

function jsonResponse(data: any, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

function htmlResponse(html: string) {
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

// ════════════════════════════════════════════════════════════
// EMAIL TEMPLATE
// ════════════════════════════════════════════════════════════

function buildQuoteEmail(opts: {
  clientName: string
  viewUrl: string
  pdfUrl: string
  projectType: string
  suburb: string
  customMessage: string
}): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;">
    <!-- Header -->
    <tr><td style="background:#F15A29;height:4px;"></td></tr>
    <tr><td style="background:#293C46;padding:20px 32px;">
      <span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:0.5px;">SecureWorks</span>
      <span style="color:rgba(255,255,255,0.6);font-size:16px;font-weight:400;margin-left:4px;">Group</span>
    </td></tr>

    <!-- Body -->
    <tr><td style="padding:32px;">
      <h1 style="margin:0 0 16px;color:#293C46;font-size:22px;">Your ${opts.projectType} quote is ready</h1>
      <p style="color:#4C6A7C;font-size:15px;line-height:1.6;margin:0 0 16px;">
        Hi ${opts.clientName},
      </p>
      ${opts.customMessage ? `<p style="color:#333;font-size:15px;line-height:1.6;margin:0 0 16px;">${opts.customMessage}</p>` : ''}
      <p style="color:#4C6A7C;font-size:15px;line-height:1.6;margin:0 0 24px;">
        Thank you for giving us the opportunity to quote on your ${opts.projectType} project${opts.suburb ? ' in ' + opts.suburb : ''}.
        Please find your detailed quote attached below.
      </p>

      <!-- CTA Button -->
      <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
        <tr><td style="background:#F15A29;border-radius:8px;">
          <a href="${opts.viewUrl}" style="display:inline-block;padding:14px 32px;color:#fff;text-decoration:none;font-size:16px;font-weight:600;">
            View Your Quote
          </a>
        </td></tr>
      </table>

      <p style="color:#4C6A7C;font-size:13px;line-height:1.6;margin:0 0 8px;">
        You can also <a href="${opts.pdfUrl}" style="color:#F15A29;">download the PDF directly</a>.
      </p>

      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">

      <p style="color:#4C6A7C;font-size:14px;line-height:1.6;margin:0 0 8px;">
        If you have any questions, don't hesitate to reach out. We're happy to walk through the quote with you.
      </p>
      <p style="color:#293C46;font-size:14px;font-weight:600;margin:0;">
        Marnin Stobbe<br>
        <span style="font-weight:400;color:#4C6A7C;">SecureWorks WA</span><br>
        <a href="tel:0450000000" style="color:#F15A29;text-decoration:none;">Call us</a> &nbsp;|&nbsp;
        <a href="mailto:admin@secureworkswa.com.au" style="color:#F15A29;text-decoration:none;">Email</a>
      </p>
    </td></tr>

    <!-- Footer -->
    <tr><td style="background:#f5f5f7;padding:20px 32px;border-top:1px solid #eee;">
      <p style="color:#999;font-size:11px;margin:0;line-height:1.5;">
        SecureWorks WA Pty Ltd | ABN 64 689 223 416<br>
        This quote is valid for 30 days from the date of issue.
      </p>
    </td></tr>
  </table>
</body>
</html>`
}

// ════════════════════════════════════════════════════════════
// CLIENT-FACING QUOTE PAGE
// ════════════════════════════════════════════════════════════

function buildClientPage(doc: any, token: string): string {
  const clientName = doc.jobs?.client_name || 'Customer'
  const projectType = doc.jobs?.type || 'project'
  const suburb = doc.jobs?.site_suburb || ''
  const isAccepted = !!doc.accepted_at
  const isDeclined = !!doc.declined_at

  let statusHtml = ''
  if (isAccepted) {
    statusHtml = '<div style="background:#34C75920;color:#34C759;padding:16px;border-radius:8px;text-align:center;font-weight:600;margin-bottom:24px;">Quote Accepted &mdash; Thank you! We\'ll be in touch shortly.</div>'
  } else if (isDeclined) {
    statusHtml = '<div style="background:#FF3B3020;color:#FF3B30;padding:16px;border-radius:8px;text-align:center;font-weight:600;margin-bottom:24px;">Quote Declined</div>'
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Quote — SecureWorks WA</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif; background: #f5f5f7; color: #333; }
    .header { background: #293C46; padding: 16px 24px; }
    .header-brand { color: #fff; font-size: 18px; font-weight: 700; }
    .header-brand span { color: rgba(255,255,255,0.6); font-weight: 400; }
    .container { max-width: 600px; margin: 0 auto; padding: 24px 16px; }
    .card { background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); margin-bottom: 16px; }
    h1 { color: #293C46; font-size: 22px; margin-bottom: 8px; }
    .subtitle { color: #4C6A7C; font-size: 14px; margin-bottom: 24px; }
    .pdf-frame { width: 100%; height: 500px; border: 1px solid #eee; border-radius: 8px; }
    .btn { display: inline-block; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600; text-decoration: none; cursor: pointer; border: none; text-align: center; width: 100%; margin-bottom: 8px; }
    .btn-accept { background: #34C759; color: #fff; }
    .btn-decline { background: #f5f5f7; color: #FF3B30; border: 1px solid #FF3B30; }
    .btn-download { background: #293C46; color: #fff; }
    .btn:hover { opacity: 0.9; }
    .footer { text-align: center; color: #999; font-size: 12px; padding: 24px; }
    @media (max-width: 480px) { .pdf-frame { height: 350px; } }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-brand">SecureWorks <span>Group</span></div>
  </div>
  <div class="container">
    <div class="card">
      <h1>Your ${projectType} quote</h1>
      <p class="subtitle">For ${clientName}${suburb ? ' — ' + suburb : ''}</p>

      ${statusHtml}

      ${doc.pdf_url ? `<iframe src="${doc.pdf_url}" class="pdf-frame" title="Quote PDF"></iframe>` : '<p>PDF not available</p>'}

      <div style="margin-top:16px;">
        ${doc.pdf_url ? `<a href="${doc.pdf_url}" class="btn btn-download" target="_blank">Download PDF</a>` : ''}
      </div>

      ${!isAccepted && !isDeclined ? `
      <div style="margin-top:24px;padding-top:24px;border-top:1px solid #eee;">
        <p style="color:#4C6A7C;font-size:14px;margin-bottom:16px;">Happy with the quote? Accept below to confirm and we'll be in touch to schedule your project.</p>
        <button class="btn btn-accept" onclick="respondToQuote('accept')">Accept Quote</button>
        <button class="btn btn-decline" onclick="respondToQuote('decline')">Decline</button>
      </div>
      ` : ''}
    </div>

    <div class="card" style="text-align:center;">
      <p style="color:#4C6A7C;font-size:14px;">Questions about your quote?</p>
      <p style="margin-top:8px;">
        <a href="tel:0450000000" style="color:#F15A29;font-weight:600;text-decoration:none;">Call Us</a> &nbsp;|&nbsp;
        <a href="mailto:admin@secureworkswa.com.au" style="color:#F15A29;font-weight:600;text-decoration:none;">Email</a>
      </p>
    </div>

    <div class="footer">
      SecureWorks WA Pty Ltd | ABN 64 689 223 416<br>
      This quote is valid for 30 days from the date of issue.
    </div>
  </div>

  <script>
    async function respondToQuote(action) {
      if (action === 'accept' && !confirm('Accept this quote? This confirms your agreement to the terms and conditions included.')) return;
      if (action === 'decline' && !confirm('Are you sure you want to decline this quote?')) return;

      try {
        var res = await fetch(window.location.pathname.replace('/view', '/' + action) + '?token=${token}', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: action === 'decline' ? prompt('Any feedback for us? (optional)') || '' : '' })
        });
        if (res.ok) {
          window.location.reload();
        } else {
          var data = await res.json();
          alert(data.error || 'Something went wrong');
        }
      } catch(e) {
        alert('Failed to send response. Please try again.');
      }
    }
  </script>
</body>
</html>`
}

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SecureWorks WA</title></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">
  <div style="background:#fff;border-radius:12px;padding:40px;max-width:400px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <h1 style="color:#293C46;font-size:20px;margin-bottom:12px;">${message}</h1>
    <p style="color:#4C6A7C;font-size:14px;">Please contact SecureWorks WA if you need assistance.</p>
    <a href="mailto:admin@secureworkswa.com.au" style="display:inline-block;margin-top:16px;padding:10px 24px;background:#F15A29;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">Contact Us</a>
  </div>
</body></html>`
}
